"""Room chat endpoints — list rooms, read messages, post messages."""

import json
import os
import re
import sqlite3
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

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
        time.sleep(0.5)
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
    project_path = workspaces.get(workspace)
    if not project_path:
        return {"error": f'Unknown workspace: "{workspace}"', "workspace": workspace}

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
            subprocess.run(
                [
                    "tmux",
                    "new-session",
                    "-d",
                    "-s",
                    session_name,
                    str(Path.home() / ".local" / "bin" / "claude"),
                    "--model",
                    "opus",
                    "--permission-mode",
                    "bypassPermissions",
                ],
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
    con = _conn()
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
    """Read messages from a room within a time window (default 24h)."""
    hours = float(request.args.get("hours", 24))
    cutoff = time.time() - (hours * 3600)

    con = _conn()
    rows = con.execute(
        "SELECT id, sender, message, timestamp FROM room_messages "
        "WHERE room = ? AND timestamp > ? ORDER BY timestamp ASC",
        (room_name, cutoff),
    ).fetchall()
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
                }
                for r in rows
            ],
            "count": len(rows),
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
    con.close()

    result = {
        "ok": True,
        "id": msg_id,
        "room": room_name,
        "sender": sender,
        "timestamp": timestamp,
    }

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
