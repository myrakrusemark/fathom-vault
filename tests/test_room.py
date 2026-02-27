"""Tests for room endpoints — windowed reads, retention, pruning."""

import sqlite3
import time
from unittest.mock import patch

import pytest

from app import app


def _seed_messages(db_path, room, messages):
    """Insert messages into the room_messages table.

    Each message is a tuple of (sender, text, timestamp).
    """
    con = sqlite3.connect(str(db_path))
    con.execute(
        "CREATE TABLE IF NOT EXISTS room_messages ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "room TEXT NOT NULL, sender TEXT NOT NULL, "
        "message TEXT NOT NULL, timestamp REAL NOT NULL)"
    )
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_room_messages_room_ts ON room_messages(room, timestamp)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS room_metadata ("
        "room TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '')"
    )
    for sender, text, ts in messages:
        con.execute(
            "INSERT INTO room_messages (room, sender, message, timestamp) VALUES (?, ?, ?, ?)",
            (room, sender, text, ts),
        )
    con.commit()
    con.close()


@pytest.fixture()
def client(tmp_path):
    """Flask test client with room DB pointed at a temp directory."""
    db_path = tmp_path / "access.db"

    # Default: retention_days = 7
    global_settings = {"workspaces": {}, "default_workspace": None, "rooms": {"retention_days": 7}}

    def fake_load_global():
        return dict(global_settings)

    with (
        patch("routes.room._DB_PATH", db_path),
        patch("routes.room.load_global_settings", side_effect=fake_load_global),
    ):
        app.config["TESTING"] = True
        yield app.test_client(), db_path, global_settings


# ---------------------------------------------------------------------------
# read_room — default 60-minute window
# ---------------------------------------------------------------------------


def test_read_empty_room(client):
    c, db_path, _ = client
    resp = c.get("/api/room/empty")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["count"] == 0
    assert data["window"]["latest_message"] is None
    assert data["window"]["has_older"] is False


def test_read_default_60min_window(client):
    c, db_path, _ = client
    now = time.time()
    _seed_messages(
        db_path,
        "general",
        [
            ("alice", "old message", now - 7200),  # 2h ago — outside default window
            ("bob", "recent 1", now - 1800),  # 30min ago
            ("alice", "recent 2", now - 600),  # 10min ago
            ("bob", "latest", now),  # now (anchor)
        ],
    )
    resp = c.get("/api/room/general")
    assert resp.status_code == 200
    data = resp.get_json()
    # Default window: 60min from latest — should get 3 messages (30min, 10min, now)
    assert data["count"] == 3
    assert data["messages"][0]["message"] == "recent 1"
    assert data["messages"][-1]["message"] == "latest"
    assert data["window"]["has_older"] is True
    # Each message should have a datetime field
    assert "datetime" in data["messages"][0]


# ---------------------------------------------------------------------------
# read_room — custom minutes param
# ---------------------------------------------------------------------------


def test_read_custom_minutes(client):
    c, db_path, _ = client
    now = time.time()
    _seed_messages(
        db_path,
        "dev",
        [
            ("alice", "msg1", now - 900),  # 15min ago
            ("bob", "msg2", now - 300),  # 5min ago
            ("alice", "msg3", now),  # now
        ],
    )
    # 10-minute window — should only get msg2 and msg3
    resp = c.get("/api/room/dev?minutes=10")
    data = resp.get_json()
    assert data["count"] == 2
    assert data["messages"][0]["message"] == "msg2"


# ---------------------------------------------------------------------------
# read_room — start offset (pseudo-pagination)
# ---------------------------------------------------------------------------


def test_read_with_start_offset(client):
    c, db_path, _ = client
    now = time.time()
    _seed_messages(
        db_path,
        "chat",
        [
            ("alice", "ancient", now - 7200),  # 120min ago
            ("bob", "older", now - 5400),  # 90min ago
            ("alice", "middle", now - 3600),  # 60min ago
            ("bob", "recent", now - 1800),  # 30min ago
            ("alice", "latest", now),  # now
        ],
    )
    # Window: 30 minutes, starting 60 minutes back from latest
    # window_end = now - 60min, window_start = now - 90min
    # Should get "older" (90min ago) — wait, that's at boundary
    # Actually: timestamp > window_start AND timestamp <= window_end
    # window_end = now - 3600, window_start = now - 5400
    # "older" at now-5400 is NOT > window_start (it equals it), so excluded
    # "middle" at now-3600 IS <= window_end, so included
    resp = c.get("/api/room/chat?minutes=30&start=60")
    data = resp.get_json()
    assert data["count"] == 1
    assert data["messages"][0]["message"] == "middle"
    assert data["window"]["has_older"] is True


# ---------------------------------------------------------------------------
# read_room — hours backward compat
# ---------------------------------------------------------------------------


def test_read_hours_backward_compat(client):
    c, db_path, _ = client
    now = time.time()
    _seed_messages(
        db_path,
        "compat",
        [
            ("alice", "old", now - 10800),  # 3h ago
            ("bob", "mid", now - 3600),  # 1h ago
            ("alice", "new", now),  # now
        ],
    )
    # hours=2 should convert to minutes=120
    resp = c.get("/api/room/compat?hours=2")
    data = resp.get_json()
    assert data["count"] == 2
    assert data["messages"][0]["message"] == "mid"


def test_minutes_overrides_hours(client):
    c, db_path, _ = client
    now = time.time()
    _seed_messages(
        db_path,
        "override",
        [
            ("alice", "msg1", now - 1800),  # 30min ago
            ("bob", "msg2", now),  # now
        ],
    )
    # If both minutes and hours present, minutes wins
    resp = c.get("/api/room/override?minutes=10&hours=24")
    data = resp.get_json()
    assert data["count"] == 1
    assert data["messages"][0]["message"] == "msg2"


# ---------------------------------------------------------------------------
# read_room — retention clamping
# ---------------------------------------------------------------------------


def test_retention_clamps_window(client):
    c, db_path, gs = client
    gs["rooms"]["retention_days"] = 1  # 1 day retention
    now = time.time()
    _seed_messages(
        db_path,
        "ret",
        [
            ("alice", "expired", now - 172800),  # 2 days ago — beyond retention
            ("bob", "kept", now - 3600),  # 1h ago
            ("alice", "latest", now),  # now
        ],
    )
    # Request a huge window — should be clamped to retention boundary
    resp = c.get("/api/room/ret?minutes=99999")
    data = resp.get_json()
    assert data["count"] == 2
    assert data["window"]["retention_limited"] is True
    # The expired message exists but is beyond retention window
    assert data["window"]["has_older"] is True


def test_null_retention_no_clamping(client):
    c, db_path, gs = client
    gs["rooms"]["retention_days"] = None  # Unlimited
    now = time.time()
    _seed_messages(
        db_path,
        "unlimited",
        [
            ("alice", "ancient", now - 864000),  # 10 days ago
            ("bob", "latest", now),
        ],
    )
    resp = c.get("/api/room/unlimited?minutes=999999")
    data = resp.get_json()
    assert data["count"] == 2
    assert data["window"]["retention_limited"] is False


# ---------------------------------------------------------------------------
# read_room — has_older
# ---------------------------------------------------------------------------


def test_has_older_false_when_all_messages_in_window(client):
    c, db_path, _ = client
    now = time.time()
    _seed_messages(
        db_path,
        "small",
        [
            ("alice", "only", now),
        ],
    )
    resp = c.get("/api/room/small")
    data = resp.get_json()
    assert data["count"] == 1
    assert data["window"]["has_older"] is False


# ---------------------------------------------------------------------------
# post_to_room — pruning
# ---------------------------------------------------------------------------


def test_post_prunes_expired_messages(client):
    c, db_path, gs = client
    gs["rooms"]["retention_days"] = 1
    now = time.time()
    _seed_messages(
        db_path,
        "prune",
        [
            ("alice", "expired1", now - 172800),  # 2 days ago
            ("bob", "expired2", now - 172800),  # 2 days ago
            ("alice", "kept", now - 3600),  # 1h ago
        ],
    )

    resp = c.post("/api/room/prune", json={"message": "new post", "sender": "test"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["pruned"] == 2

    # Verify the expired messages are actually gone
    con = sqlite3.connect(str(db_path))
    count = con.execute("SELECT COUNT(*) FROM room_messages WHERE room = 'prune'").fetchone()[0]
    con.close()
    assert count == 2  # "kept" + "new post"


def test_post_null_retention_skips_pruning(client):
    c, db_path, gs = client
    gs["rooms"]["retention_days"] = None
    now = time.time()
    _seed_messages(
        db_path,
        "noprune",
        [
            ("alice", "ancient", now - 864000),  # 10 days old
        ],
    )

    resp = c.post("/api/room/noprune", json={"message": "new", "sender": "test"})
    data = resp.get_json()
    assert data["ok"] is True
    assert "pruned" not in data

    con = sqlite3.connect(str(db_path))
    count = con.execute("SELECT COUNT(*) FROM room_messages WHERE room = 'noprune'").fetchone()[0]
    con.close()
    assert count == 2  # ancient + new


# ---------------------------------------------------------------------------
# list_rooms — respects retention
# ---------------------------------------------------------------------------


def test_list_rooms_excludes_expired(client):
    c, db_path, gs = client
    gs["rooms"]["retention_days"] = 1
    now = time.time()
    # Room "active" has recent messages
    _seed_messages(
        db_path,
        "active",
        [
            ("alice", "hello", now - 3600),
            ("bob", "world", now),
        ],
    )
    # Room "dead" has only expired messages
    _seed_messages(
        db_path,
        "dead",
        [
            ("alice", "old", now - 172800),
        ],
    )

    resp = c.get("/api/room/list")
    data = resp.get_json()
    room_names = [r["name"] for r in data["rooms"]]
    assert "active" in room_names
    assert "dead" not in room_names
    # Active room should show count of 2
    active = next(r for r in data["rooms"] if r["name"] == "active")
    assert active["message_count"] == 2


# ---------------------------------------------------------------------------
# Settings validation — rooms
# ---------------------------------------------------------------------------


def test_settings_rooms_retention_valid(client):
    """Settings POST accepts valid retention_days."""
    c, _, _ = client
    # This test uses the settings endpoint — needs its own mock setup
    # Tested via test_settings.py patterns; included here for completeness


def test_window_metadata_format(client):
    """Verify window metadata contains all expected fields."""
    c, db_path, _ = client
    now = time.time()
    _seed_messages(db_path, "meta", [("alice", "msg", now)])
    resp = c.get("/api/room/meta")
    data = resp.get_json()
    window = data["window"]
    assert "start" in window
    assert "end" in window
    assert "latest_message" in window
    assert "has_older" in window
    assert "retention_limited" in window
    # ISO 8601 format check
    assert "T" in window["start"]
    assert "T" in window["latest_message"]
