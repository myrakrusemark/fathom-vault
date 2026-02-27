"""Room chat endpoints — list rooms, read messages, post messages."""

import json
import os
import re
import sqlite3
import subprocess
import tempfile
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

from services.persistent_session import (
    _AGENT_COMMANDS,
    _get_agent,
    _inbox_path,
    _is_human_workspace,
)
from services.settings import load_global_settings, load_workspace_settings

bp = Blueprint("room", __name__)

_DB_PATH = Path(__file__).parent.parent / "data" / "access.db"

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS room_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    room      TEXT NOT NULL,
    sender    TEXT NOT NULL,
    message   TEXT NOT NULL,
    timestamp REAL NOT NULL
)
"""

_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_room_messages_room_ts
    ON room_messages(room, timestamp)
"""

_CREATE_METADATA = """
CREATE TABLE IF NOT EXISTS room_metadata (
    room        TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT ''
)
"""


def _conn() -> sqlite3.Connection:
    """Open (and if needed initialise) the room_messages table."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(_DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute(_CREATE_TABLE)
    con.execute(_CREATE_INDEX)
    con.execute(_CREATE_METADATA)
    con.commit()
    return con


def _get_retention_days():
    """Read rooms.retention_days from global settings. Returns int or None."""
    gs = load_global_settings()
    return gs.get("rooms", {}).get("retention_days")


def _prune_expired(con, retention_days):
    """Delete messages older than retention_days. Returns count deleted."""
    if not retention_days:
        return 0
    cutoff = time.time() - (retention_days * 86400)
    cur = con.execute("DELETE FROM room_messages WHERE timestamp < ?", (cutoff,))
    con.commit()
    return cur.rowcount


def _ts_to_iso(ts):
    """Convert unix timestamp to ISO 8601 UTC string."""
    return datetime.fromtimestamp(ts, tz=UTC).isoformat()


_SETTINGS_PATH = Path.home() / ".config" / "fathom-vault" / "settings.json"


def _load_settings() -> dict:
    try:
        return json.loads(_SETTINGS_PATH.read_text())
    except Exception:
        return {}


def _parse_mentions(message: str) -> list[str]:
    """Extract @workspace tokens, deduplicated and lowercased."""
    matches = re.findall(r"@([\w][\w-]*)", message)
    return list(dict.fromkeys(m.lower() for m in matches))  # dedup, preserve order


def _resolve_mentions(tokens: list[str], sender: str) -> list[str]:
    """Map tokens to configured workspace names. Expands @all, filters self."""
    settings = _load_settings()
    all_ws = list((settings.get("workspaces") or {}).keys())
    sender_lower = sender.lower()

    targets: set[str] = set()
    for token in tokens:
        if token == "all":
            targets.update(all_ws)
        else:
            match = next((ws for ws in all_ws if ws.lower() == token), None)
            if match:
                targets.add(match)

    # Filter self-mentions
    self_ws = next((ws for ws in all_ws if ws.lower() == sender_lower), sender)
    targets.discard(self_ws)
    return list(targets)


def _inject_message(target: str, formatted: str, workspace: str) -> bool:
    """Inject a message into a tmux target via load-buffer + paste-buffer."""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f"fathom-room-{workspace}-",
            suffix=".txt",
            delete=False,
            mode="w",
        ) as tmp:
            tmp.write(formatted)
            tmp_path = tmp.name
        subprocess.run(["tmux", "load-buffer", tmp_path], check=True, capture_output=True)
        subprocess.run(["tmux", "paste-buffer", "-t", target], check=True, capture_output=True)
        time.sleep(2)
        subprocess.run(
            ["tmux", "send-keys", "-t", target, "", "Enter"],
            check=True,
            capture_output=True,
        )
        return True
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _inject_to_workspace(workspace: str, formatted: str) -> dict:
    """Resolve workspace and inject — mirrors MCP injectToWorkspace()."""
    settings = _load_settings()
    workspaces = settings.get("workspaces") or {}
    ws_entry = workspaces.get(workspace)
    if not ws_entry:
        return {"error": f'Unknown workspace: "{workspace}"', "workspace": workspace}
    project_path = ws_entry.get("path") if isinstance(ws_entry, dict) else ws_entry

    # Human workspaces — append to inbox file (no tmux agent)
    if _is_human_workspace(workspace):
        inbox = _inbox_path(workspace)
        inbox.parent.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        header = f"--- {timestamp} ---"
        try:
            with open(inbox, "a") as f:
                f.write(f"\n{header}\n{formatted}\n")
            return {"ok": True, "delivered": True, "workspace": workspace}
        except Exception as e:
            return {"error": str(e), "workspace": workspace}

    session_name = f"{workspace}_fathom-session"
    pane_file = Path.home() / ".config" / "fathom" / f"{workspace}-pane-id"

    # Check if session is running
    running = (
        subprocess.run(["tmux", "has-session", "-t", session_name], capture_output=True).returncode
        == 0
    )

    if running:
        target = session_name
        try:
            saved = pane_file.read_text().strip()
            if saved:
                target = saved
        except Exception:
            pass
        try:
            _inject_message(target, formatted, workspace)
            return {"ok": True, "delivered": True, "workspace": workspace}
        except Exception as e:
            return {"error": str(e), "workspace": workspace}

    # Not running — fire-and-forget background delivery
    def _bg():
        try:
            env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
            agent_id = _get_agent(workspace)
            agent = _AGENT_COMMANDS.get(agent_id, _AGENT_COMMANDS["claude-code"])
            ws_settings = load_workspace_settings(workspace)
            bypass = ws_settings.get("session", {}).get("bypass_permissions", False)
            cmd = [
                "tmux",
                "new-session",
                "-d",
                "-s",
                session_name,
                *agent["command"],
            ]
            if bypass and agent_id == "claude-code":
                cmd += ["--permission-mode", "bypassPermissions"]
            subprocess.run(
                cmd,
                cwd=project_path,
                env=env,
                capture_output=True,
                check=True,
            )
            # Poll for readiness
            deadline = time.time() + 60
            ready = False
            while time.time() < deadline:
                time.sleep(2)
                try:
                    out = subprocess.run(
                        ["tmux", "capture-pane", "-t", session_name, "-p", "-S", "-10"],
                        capture_output=True,
                        text=True,
                    ).stdout
                    if "\u276f" in out:
                        ready = True
                        break
                except Exception:
                    pass
            if not ready:
                return
            # Save pane ID
            try:
                pane_out = (
                    subprocess.run(
                        ["tmux", "list-panes", "-t", session_name, "-F", "#{pane_id}"],
                        capture_output=True,
                        text=True,
                    )
                    .stdout.strip()
                    .split("\n")[0]
                )
                if pane_out:
                    pane_file.parent.mkdir(parents=True, exist_ok=True)
                    pane_file.write_text(pane_out)
            except Exception:
                pass
            target = session_name
            try:
                saved = pane_file.read_text().strip()
                if saved:
                    target = saved
            except Exception:
                pass
            _inject_message(target, formatted, workspace)
        except Exception:
            pass

    threading.Thread(target=_bg, daemon=True).start()
    return {"ok": True, "delivered": False, "queued": True, "workspace": workspace}


@bp.route("/api/room/list")
def list_rooms():
    """List all rooms with message count, last activity, last sender, and description."""
    retention_days = _get_retention_days()
    con = _conn()

    if retention_days:
        cutoff = time.time() - (retention_days * 86400)
        rows = con.execute(
            """
            SELECT
                room,
                COUNT(*) as message_count,
                MAX(timestamp) as last_activity,
                (SELECT sender FROM room_messages r2
                 WHERE r2.room = r1.room AND r2.timestamp > ?
                 ORDER BY timestamp DESC LIMIT 1) as last_sender,
                COALESCE((SELECT description FROM room_metadata m
                 WHERE m.room = r1.room), '') as description
            FROM room_messages r1
            WHERE timestamp > ?
            GROUP BY room
            ORDER BY last_activity DESC
        """,
            (cutoff, cutoff),
        ).fetchall()
    else:
        rows = con.execute("""
            SELECT
                room,
                COUNT(*) as message_count,
                MAX(timestamp) as last_activity,
                (SELECT sender FROM room_messages r2
                 WHERE r2.room = r1.room ORDER BY timestamp DESC LIMIT 1) as last_sender,
                COALESCE((SELECT description FROM room_metadata m
                 WHERE m.room = r1.room), '') as description
            FROM room_messages r1
            GROUP BY room
            ORDER BY last_activity DESC
        """).fetchall()
    con.close()

    return jsonify(
        {
            "rooms": [
                {
                    "name": r["room"],
                    "message_count": r["message_count"],
                    "last_activity": r["last_activity"],
                    "last_sender": r["last_sender"],
                    "description": r["description"],
                }
                for r in rows
            ]
        }
    )


@bp.route("/api/room/<room_name>")
def read_room(room_name):
    """Read messages from a room within a time window anchored to the latest message.

    Params:
        minutes: Window duration in minutes (default 60).
        start: Offset in minutes from the latest message (default 0).
        hours: Legacy param — converted to minutes if minutes not provided.
    """
    # Parse params with backward compat
    raw_minutes = request.args.get("minutes")
    raw_hours = request.args.get("hours")
    start = float(request.args.get("start", 0))

    if raw_minutes is not None:
        minutes = float(raw_minutes)
    elif raw_hours is not None:
        minutes = float(raw_hours) * 60
    else:
        minutes = 60

    retention_days = _get_retention_days()
    con = _conn()

    # Find the latest message timestamp as anchor
    row = con.execute(
        "SELECT MAX(timestamp) as latest FROM room_messages WHERE room = ?",
        (room_name,),
    ).fetchone()
    latest_ts = row["latest"] if row else None

    if latest_ts is None:
        con.close()
        return jsonify(
            {
                "room": room_name,
                "messages": [],
                "count": 0,
                "window": {
                    "start": None,
                    "end": None,
                    "latest_message": None,
                    "has_older": False,
                    "retention_limited": False,
                },
            }
        )

    # Window calculation relative to latest message
    anchor = latest_ts
    window_end = anchor - (start * 60)
    window_start = window_end - (minutes * 60)

    # Clamp to retention boundary
    retention_limited = False
    if retention_days:
        retention_boundary = time.time() - (retention_days * 86400)
        if window_start < retention_boundary:
            window_start = retention_boundary
            retention_limited = True

    # Query messages in window
    rows = con.execute(
        "SELECT id, sender, message, timestamp FROM room_messages "
        "WHERE room = ? AND timestamp > ? AND timestamp <= ? ORDER BY timestamp ASC",
        (room_name, window_start, window_end),
    ).fetchall()

    # Check if there are older messages before window_start
    older = con.execute(
        "SELECT 1 FROM room_messages WHERE room = ? AND timestamp <= ? LIMIT 1",
        (room_name, window_start),
    ).fetchone()
    has_older = older is not None

    con.close()

    return jsonify(
        {
            "room": room_name,
            "messages": [
                {
                    "id": r["id"],
                    "sender": r["sender"],
                    "message": r["message"],
                    "timestamp": r["timestamp"],
                    "datetime": _ts_to_iso(r["timestamp"]),
                }
                for r in rows
            ],
            "count": len(rows),
            "window": {
                "start": _ts_to_iso(window_start),
                "end": _ts_to_iso(window_end),
                "latest_message": _ts_to_iso(latest_ts),
                "has_older": has_older,
                "retention_limited": retention_limited,
            },
        }
    )


@bp.route("/api/room/<room_name>/description", methods=["PUT"])
def set_room_description(room_name):
    """Set or update the description/topic for a room."""
    data = request.get_json(force=True)
    description = data.get("description", "").strip()

    con = _conn()
    con.execute(
        "INSERT INTO room_metadata (room, description) VALUES (?, ?) "
        "ON CONFLICT(room) DO UPDATE SET description = excluded.description",
        (room_name, description),
    )
    con.commit()
    con.close()

    return jsonify({"ok": True, "room": room_name, "description": description})


@bp.route("/api/send/<workspace_name>", methods=["POST"])
def send_to_workspace(workspace_name):
    """Send a direct message to a workspace's agent session. Ephemeral — no storage."""
    data = request.get_json(force=True)
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    sender = data.get("from", "unknown")
    formatted = (
        f"Message from workspace ({sender}): {message}\n"
        f'(This is a direct message. Reply with fathom_send workspace="{sender}" — not in a room.)'
    )

    result = _inject_to_workspace(workspace_name, formatted)
    return jsonify(result), 200 if not result.get("error") else 400


@bp.route("/api/room/<room_name>", methods=["POST"])
def post_to_room(room_name):
    """Post a message to a room. Supports @workspace mentions."""
    data = request.get_json(force=True)
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    sender = data.get("sender", "myra")
    timestamp = time.time()

    # Phase 1: Store in room
    con = _conn()
    cur = con.execute(
        "INSERT INTO room_messages (room, sender, message, timestamp) VALUES (?, ?, ?, ?)",
        (room_name, sender, message, timestamp),
    )
    msg_id = cur.lastrowid
    con.commit()

    # Prune expired messages
    retention_days = _get_retention_days()
    pruned = _prune_expired(con, retention_days)
    con.close()

    result = {
        "ok": True,
        "id": msg_id,
        "room": room_name,
        "sender": sender,
        "timestamp": timestamp,
    }
    if pruned > 0:
        result["pruned"] = pruned

    # Phase 2: Parse mentions and inject into targeted workspaces
    tokens = _parse_mentions(message)
    targets = _resolve_mentions(tokens, sender)

    if targets:
        notified = []
        for ws in targets:
            formatted = (
                f"Room message from {sender} in #{room_name} (@{ws}): {message}\n"
                f"(Read the room with fathom_room_read before replying — this is one message without context.)"
            )
            injection = _inject_to_workspace(ws, formatted)
            if injection.get("error"):
                notified.append({"workspace": ws, "delivered": False, "error": injection["error"]})
            else:
                notified.append(
                    {
                        "workspace": ws,
                        "delivered": bool(injection.get("delivered")),
                        "queued": bool(injection.get("queued")),
                    }
                )
        result["mentions"] = {"parsed": tokens, "notified": notified}

    return jsonify(result)
