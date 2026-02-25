"""Tests for activation API routes: spawn and SSE stream."""

import json
from unittest.mock import patch

import pytest

from app import app


@pytest.fixture()
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# POST /api/activation/crystal/spawn
# ---------------------------------------------------------------------------


def test_spawn_returns_job_id(client):
    """spawn endpoint should return a job_id string."""
    fake_job_id = "abc-123"
    with patch("routes.activation.spawn", return_value=fake_job_id) as mock_spawn:
        resp = client.post(
            "/api/activation/crystal/spawn",
            json={"additionalContext": "some extra"},
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["job_id"] == fake_job_id
    mock_spawn.assert_called_once_with(
        additional_context="some extra",
        workspace=None,
    )


def test_spawn_empty_body_uses_defaults(client):
    """spawn endpoint should work with no request body (uses defaults)."""
    with patch("routes.activation.spawn", return_value="xyz-456") as mock_spawn:
        resp = client.post("/api/activation/crystal/spawn")
    assert resp.status_code == 200
    mock_spawn.assert_called_once_with(additional_context="", workspace=None)


def test_spawn_partial_body(client):
    """spawn endpoint should apply only the fields provided."""
    with patch("routes.activation.spawn", return_value="partial-789") as mock_spawn:
        resp = client.post(
            "/api/activation/crystal/spawn",
            json={"additionalContext": "partial context"},
        )
    assert resp.status_code == 200
    mock_spawn.assert_called_once_with(additional_context="partial context", workspace=None)


# ---------------------------------------------------------------------------
# GET /api/activation/crystal/stream/<job_id>
# ---------------------------------------------------------------------------


def test_stream_unknown_job(client):
    """stream endpoint should yield an error event for unknown job IDs."""
    with patch("routes.activation.get_events", return_value=(None, None)):
        resp = client.get("/api/activation/crystal/stream/no-such-job")
    assert resp.status_code == 200
    assert resp.content_type.startswith("text/event-stream")
    body = resp.data.decode()
    assert '"type":"error"' in body


def test_stream_yields_events_then_done(client):
    """stream endpoint should yield queued events followed by the done sentinel."""
    events = [
        {"type": "progress", "progress": 10, "stage": "Loading tools"},
        {"type": "progress", "progress": 50, "stage": "Synthesizing"},
        {"type": "done", "status": "done", "exit_code": 0},
    ]

    call_count = 0

    def fake_get_events(job_id, after=0):
        nonlocal call_count
        call_count += 1
        remaining = events[after:]
        # Report done status once all events are visible
        final_status = "done" if after >= len(events) - 1 else "running"
        return remaining, final_status

    with patch("routes.activation.get_events", side_effect=fake_get_events):
        resp = client.get("/api/activation/crystal/stream/some-job-id")

    body = resp.data.decode()
    lines = [ln for ln in body.splitlines() if ln.startswith("data: ")]
    parsed = [json.loads(ln[len("data: ") :]) for ln in lines]

    types = [e["type"] for e in parsed]
    assert "progress" in types
    assert "done" in types


def test_stream_failed_job(client):
    """stream endpoint should emit the failed done event from the job store."""
    events = [{"type": "done", "status": "failed", "exit_code": 1}]

    def fake_get_events(job_id, after=0):
        return events[after:], "failed"

    with patch("routes.activation.get_events", side_effect=fake_get_events):
        resp = client.get("/api/activation/crystal/stream/fail-job")

    body = resp.data.decode()
    assert '"status": "failed"' in body or '"status":"failed"' in body


# ---------------------------------------------------------------------------
# Ping routes
# ---------------------------------------------------------------------------

PING_STATUS = {
    "enabled": False,
    "interval_minutes": 60,
    "next_ping_at": None,
    "last_ping_at": None,
    "context_sources": {"time": True, "scripts": [], "texts": []},
}


def test_get_ping_returns_status(client):
    """GET /api/activation/ping returns first routine status."""
    with patch("routes.activation.ping_scheduler") as mock_sched:
        mock_sched.first_routine_status = PING_STATUS
        resp = client.get("/api/activation/ping")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "enabled" in data
    assert "interval_minutes" in data
    assert "context_sources" in data


ROUTINES_STATUS = {"routines": [{"id": "default", **PING_STATUS}]}
SETTINGS_WITH_ROUTINES = {"ping": {"routines": [{"id": "default", **PING_STATUS}]}}


def test_post_ping_configures_scheduler(client):
    """POST /api/activation/ping configures the first routine."""
    result_status = {**PING_STATUS, "enabled": True, "interval_minutes": 30}
    with (
        patch("routes.activation.ping_scheduler") as mock_sched,
        patch("routes.activation.load_settings", return_value=SETTINGS_WITH_ROUTINES),
        patch("routes.activation.save_settings"),
    ):
        mock_sched.status = ROUTINES_STATUS
        mock_sched.configure_routine.return_value = result_status
        resp = client.post(
            "/api/activation/ping",
            json={"enabled": True, "intervalMinutes": 30},
        )
    assert resp.status_code == 200
    mock_sched.configure_routine.assert_called_once_with(
        "default", enabled=True, interval_minutes=30
    )


def test_post_ping_with_context_sources(client):
    """POST /api/activation/ping passes contextSources through to the scheduler."""
    ctx = {"time": True, "last_summary": False, "scripts": [], "texts": []}
    with (
        patch("routes.activation.ping_scheduler") as mock_sched,
        patch("routes.activation.load_settings", return_value=SETTINGS_WITH_ROUTINES),
        patch("routes.activation.save_settings"),
    ):
        mock_sched.status = ROUTINES_STATUS
        mock_sched.configure_routine.return_value = PING_STATUS
        resp = client.post(
            "/api/activation/ping",
            json={"enabled": False, "intervalMinutes": 60, "contextSources": ctx},
        )
    assert resp.status_code == 200
    mock_sched.configure_routine.assert_called_once_with(
        "default", enabled=False, interval_minutes=60, context_sources=ctx
    )


def test_post_ping_now_fires(client):
    """POST /api/activation/ping/now triggers fire_now and returns fired=True."""
    with patch("routes.activation.ping_scheduler") as mock_sched:
        resp = client.post("/api/activation/ping/now")
    assert resp.status_code == 200
    assert resp.get_json()["fired"] is True
    mock_sched.fire_now.assert_called_once()


def test_get_session_status(client):
    """GET /api/activation/session returns session name and running state."""
    with patch(
        "routes.activation.session_status",
        return_value={
            "session": "fathom-session",
            "pane": "%0",
            "running": True,
        },
    ):
        resp = client.get("/api/activation/session")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["session"] == "fathom-session"
    assert "running" in data
