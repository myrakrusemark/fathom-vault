"""Activation layer: Memento status, identity crystal, ping config."""

import json
import time

from flask import Blueprint, Response, jsonify, request, stream_with_context

from services.crystal_scheduler import crystal_scheduler
from services.crystallization import get_events, spawn
from services.memento import get_status
from services.persistent_session import restart as session_restart
from services.persistent_session import status as session_status
from services.ping_scheduler import ping_scheduler
from services.settings import load_settings, new_routine_id, save_settings

bp = Blueprint("activation", __name__)


@bp.route("/api/activation/status")
def activation_status():
    """Memento connectivity + identity crystal status."""
    return jsonify(get_status())


@bp.route("/api/activation/crystal/spawn", methods=["POST"])
def crystal_spawn():
    """Spawn a crystallization agent subprocess. Returns job_id."""
    body = request.get_json(silent=True) or {}
    job_id = spawn(
        additional_context=body.get("additionalContext", ""),
        strip_system=body.get("stripSystemPrompt", True),
    )
    return jsonify({"job_id": job_id})


@bp.route("/api/activation/schedule")
def get_schedule():
    """Return current crystal auto-regenerate schedule."""
    return jsonify(crystal_scheduler.status)


@bp.route("/api/activation/schedule", methods=["POST"])
def set_schedule():
    """Configure crystal auto-regenerate schedule and persist to settings."""
    body = request.get_json(silent=True) or {}
    enabled = bool(body.get("enabled", False))
    interval_days = max(1, int(body.get("intervalDays", 7)))
    crystal_scheduler.configure(enabled, interval_days)
    s = load_settings()
    s["crystal_regen"] = {"enabled": enabled, "interval_days": interval_days}
    save_settings(s)
    return jsonify(crystal_scheduler.status)


# ── Ping routines CRUD ────────────────────────────────────────────────────────


@bp.route("/api/activation/ping/routines")
def list_routines():
    """List all ping routines."""
    return jsonify(ping_scheduler.status)


@bp.route("/api/activation/ping/routines", methods=["POST"])
def create_routine():
    """Create a new ping routine."""
    body = request.get_json(silent=True) or {}
    rid = new_routine_id()
    routine_dict = {
        "id": rid,
        "name": body.get("name", "New Routine"),
        "enabled": bool(body.get("enabled", False)),
        "interval_minutes": max(1, int(body.get("intervalMinutes", 60))),
        "context_sources": body.get("contextSources", {"time": True, "scripts": [], "texts": []}),
    }
    result = ping_scheduler.add_routine(routine_dict)

    # Persist
    s = load_settings()
    s["ping"]["routines"].append(routine_dict)
    save_settings(s)

    return jsonify(result), 201


@bp.route("/api/activation/ping/routines/<routine_id>")
def get_routine(routine_id):
    """Get one routine."""
    result = ping_scheduler.get_routine(routine_id)
    if result is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@bp.route("/api/activation/ping/routines/<routine_id>", methods=["POST"])
def update_routine(routine_id):
    """Update a routine's fields."""
    body = request.get_json(silent=True) or {}
    kwargs = {}
    if "name" in body:
        kwargs["name"] = body["name"]
    if "enabled" in body:
        kwargs["enabled"] = bool(body["enabled"])
    if "intervalMinutes" in body:
        kwargs["interval_minutes"] = max(1, int(body["intervalMinutes"]))
    if "contextSources" in body:
        kwargs["context_sources"] = body["contextSources"]

    result = ping_scheduler.configure_routine(routine_id, **kwargs)
    if result is None:
        return jsonify({"error": "not found"}), 404

    # Persist updated routine to settings
    s = load_settings()
    for saved_r in s["ping"]["routines"]:
        if saved_r["id"] == routine_id:
            if "name" in kwargs:
                saved_r["name"] = kwargs["name"]
            if "enabled" in kwargs:
                saved_r["enabled"] = kwargs["enabled"]
            if "interval_minutes" in kwargs:
                saved_r["interval_minutes"] = kwargs["interval_minutes"]
            if "context_sources" in kwargs:
                saved_r["context_sources"] = kwargs["context_sources"]
            saved_r["next_ping_at"] = result["next_ping_at"]
            break
    save_settings(s)

    return jsonify(result)


@bp.route("/api/activation/ping/routines/<routine_id>", methods=["DELETE"])
def delete_routine(routine_id):
    """Delete a routine."""
    removed = ping_scheduler.remove_routine(routine_id)
    if not removed:
        return jsonify({"error": "not found"}), 404

    # Remove from persisted settings
    s = load_settings()
    s["ping"]["routines"] = [r for r in s["ping"]["routines"] if r["id"] != routine_id]
    save_settings(s)

    return jsonify({"deleted": True})


@bp.route("/api/activation/ping/routines/<routine_id>/now", methods=["POST"])
def fire_routine_now(routine_id):
    """Fire one routine immediately (non-blocking)."""
    ping_scheduler.fire_now(routine_id)
    return jsonify({"fired": True})


# ── Backward-compatible single-routine endpoints ──────────────────────────────


@bp.route("/api/activation/ping")
def get_ping():
    """Return first routine's status (backward compat)."""
    return jsonify(ping_scheduler.first_routine_status)


@bp.route("/api/activation/ping", methods=["POST"])
def set_ping():
    """Update the first routine (backward compat)."""
    body = request.get_json(silent=True) or {}
    # Find first routine ID
    st = ping_scheduler.status
    routines = st.get("routines", [])
    if not routines:
        return jsonify({"error": "no routines"}), 400
    first_id = routines[0]["id"]

    kwargs = {}
    if "enabled" in body:
        kwargs["enabled"] = bool(body["enabled"])
    if "intervalMinutes" in body:
        kwargs["interval_minutes"] = max(1, int(body["intervalMinutes"]))
    if "contextSources" in body:
        kwargs["context_sources"] = body["contextSources"]

    result = ping_scheduler.configure_routine(first_id, **kwargs)

    # Persist
    s = load_settings()
    for saved_r in s["ping"]["routines"]:
        if saved_r["id"] == first_id:
            if "enabled" in kwargs:
                saved_r["enabled"] = kwargs["enabled"]
            if "interval_minutes" in kwargs:
                saved_r["interval_minutes"] = kwargs["interval_minutes"]
            if "context_sources" in kwargs:
                saved_r["context_sources"] = kwargs["context_sources"]
            if result:
                saved_r["next_ping_at"] = result["next_ping_at"]
            break
    save_settings(s)

    return jsonify(result or ping_scheduler.first_routine_status)


@bp.route("/api/activation/ping/now", methods=["POST"])
def ping_now():
    """Fire first routine immediately (backward compat)."""
    ping_scheduler.fire_now()
    return jsonify({"fired": True})


# ── Session & Crystal stream ──────────────────────────────────────────────────


@bp.route("/api/activation/session")
def get_session():
    """Return persistent session status."""
    return jsonify(session_status())


@bp.route("/api/activation/session/restart", methods=["POST"])
def restart_session():
    """Kill and restart the persistent session with --continue."""
    ok = session_restart()
    return jsonify({"restarted": ok}), 200 if ok else 500


@bp.route("/api/activation/crystal/stream/<job_id>")
def crystal_stream(job_id):
    """SSE stream of progress events for a crystallization job."""

    def generate():
        cursor = 0
        while True:
            events, status = get_events(job_id, after=cursor)
            if events is None:
                yield 'data: {"type":"error","message":"job not found"}\n\n'
                return
            for event in events:
                yield f"data: {json.dumps(event)}\n\n"
                cursor += 1
            if status in ("done", "failed"):
                return
            time.sleep(0.2)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
