"""Tests for settings API: GET/POST with mcp and excluded_dirs fields."""

import json
from unittest.mock import MagicMock, patch

import pytest

from app import app


@pytest.fixture()
def client(tmp_path):
    """Flask test client with settings and indexer mocked to use a temp dir."""
    settings_file = tmp_path / "settings.json"

    def fake_load(workspace=None):
        try:
            return json.loads(settings_file.read_text())
        except FileNotFoundError:
            return {
                "background_index": {
                    "enabled": True,
                    "interval_minutes": 15,
                    "excluded_dirs": [],
                },
                "mcp": {
                    "query_timeout_seconds": 120,
                    "search_results": 10,
                    "search_mode": "hybrid",
                },
                "terminal": {
                    "working_dir": "/data/Dropbox/Work",
                },
            }

    def fake_save(s, workspace=None):
        settings_file.write_text(json.dumps(s))

    mock_indexer = MagicMock()
    mock_indexer.status = {"last_indexed": None}

    with (
        patch("routes.settings.load_settings", side_effect=fake_load),
        patch("routes.settings.save_settings", side_effect=fake_save),
        patch("routes.settings.indexer", mock_indexer),
    ):
        app.config["TESTING"] = True
        yield app.test_client()


# ---------------------------------------------------------------------------
# GET /api/settings
# ---------------------------------------------------------------------------


def test_get_settings_returns_mcp_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "mcp" in data
    assert data["mcp"]["query_timeout_seconds"] == 120
    assert data["mcp"]["search_results"] == 10
    assert data["mcp"]["search_mode"] == "hybrid"


def test_get_settings_returns_excluded_dirs(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["background_index"]["excluded_dirs"] == []


# ---------------------------------------------------------------------------
# POST /api/settings — mcp fields
# ---------------------------------------------------------------------------


def test_post_updates_query_timeout(client):
    resp = client.post(
        "/api/settings",
        json={"mcp": {"query_timeout_seconds": 60}},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["mcp"]["query_timeout_seconds"] == 60


def test_post_rejects_timeout_too_low(client):
    resp = client.post(
        "/api/settings",
        json={"mcp": {"query_timeout_seconds": 5}},
    )
    assert resp.status_code == 400
    assert "query_timeout_seconds" in resp.get_json()["error"]


def test_post_rejects_timeout_too_high(client):
    resp = client.post(
        "/api/settings",
        json={"mcp": {"query_timeout_seconds": 999}},
    )
    assert resp.status_code == 400


def test_post_updates_search_results(client):
    resp = client.post(
        "/api/settings",
        json={"mcp": {"search_results": 20}},
    )
    assert resp.status_code == 200
    assert resp.get_json()["mcp"]["search_results"] == 20


def test_post_updates_search_mode_keyword(client):
    resp = client.post(
        "/api/settings",
        json={"mcp": {"search_mode": "keyword"}},
    )
    assert resp.status_code == 200
    assert resp.get_json()["mcp"]["search_mode"] == "keyword"


def test_post_rejects_invalid_search_mode(client):
    resp = client.post(
        "/api/settings",
        json={"mcp": {"search_mode": "fuzzy"}},
    )
    assert resp.status_code == 400
    assert "search_mode" in resp.get_json()["error"]


# ---------------------------------------------------------------------------
# POST /api/settings — excluded_dirs
# ---------------------------------------------------------------------------


def test_post_updates_excluded_dirs(client):
    resp = client.post(
        "/api/settings",
        json={"background_index": {"excluded_dirs": ["/tmp/private", "/home/myra/secret"]}},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["background_index"]["excluded_dirs"] == ["/tmp/private", "/home/myra/secret"]


def test_post_rejects_excluded_dirs_not_a_list(client):
    resp = client.post(
        "/api/settings",
        json={"background_index": {"excluded_dirs": "/tmp/private"}},
    )
    assert resp.status_code == 400
    assert "excluded_dirs" in resp.get_json()["error"]


def test_post_rejects_excluded_dirs_with_non_strings(client):
    resp = client.post(
        "/api/settings",
        json={"background_index": {"excluded_dirs": ["/tmp/ok", 42]}},
    )
    assert resp.status_code == 400
    assert "excluded_dirs" in resp.get_json()["error"]


def test_post_accepts_empty_excluded_dirs(client):
    resp = client.post(
        "/api/settings",
        json={"background_index": {"excluded_dirs": []}},
    )
    assert resp.status_code == 200
    assert resp.get_json()["background_index"]["excluded_dirs"] == []


# ---------------------------------------------------------------------------
# POST /api/settings — terminal fields
# ---------------------------------------------------------------------------


def test_post_ignores_terminal_field(client):
    """Terminal settings are per-workspace now — POST /api/settings ignores them."""
    resp = client.post(
        "/api/settings",
        json={"terminal": {"working_dir": "/home/myra"}},
    )
    assert resp.status_code == 200


def test_get_settings_returns_terminal_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "terminal" in data
    assert data["terminal"]["working_dir"] == "/data/Dropbox/Work"
