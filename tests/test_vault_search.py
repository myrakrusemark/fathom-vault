"""Tests for /api/vault/search: settings-aware defaults, overrides, excluded_dirs."""

from unittest.mock import MagicMock, patch

import pytest

from app import app

# Fake qmd output — two results in different directories
_FAKE_QMD_OUTPUT = """\
qmd://fathom-vault/daily/heartbeat.md:1 #aabbcc
Title: Heartbeat
Score: 85%

@@ -1,5 @@ (2 before, 3 after)
Some heartbeat content here
qmd://fathom-vault/research/ns.md:1 #112233
Title: NS Notes
Score: 70%

@@ -1,3 @@ (1 before, 2 after)
Research notes here
"""

_DEFAULT_SETTINGS = {
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
}


@pytest.fixture()
def client():
    app.config["TESTING"] = True
    return app.test_client()


def _mock_proc(stdout="", returncode=0):
    m = MagicMock()
    m.stdout = stdout
    m.returncode = returncode
    return m


def _settings(**mcp_overrides):
    s = {
        "background_index": dict(_DEFAULT_SETTINGS["background_index"]),
        "mcp": {**_DEFAULT_SETTINGS["mcp"], **mcp_overrides},
    }
    return s


# ---------------------------------------------------------------------------
# Defaults — values come from settings when no override params supplied
# ---------------------------------------------------------------------------


def test_uses_settings_n(client):
    settings = _settings(search_results=7)
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test")
        assert resp.status_code == 200
        cmd = mock_run.call_args[0][0]
        assert cmd[cmd.index("-n") + 1] == "7"


def test_uses_settings_mode_hybrid(client):
    settings = _settings(search_mode="hybrid")
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test")
        assert resp.status_code == 200
        cmd = mock_run.call_args[0][0]
        assert "query" in cmd


def test_uses_settings_mode_keyword(client):
    settings = _settings(search_mode="keyword")
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test")
        assert resp.status_code == 200
        cmd = mock_run.call_args[0][0]
        assert "search" in cmd


def test_response_includes_excluded_count(client):
    with (
        patch("routes.vault.load_settings", return_value=_DEFAULT_SETTINGS),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)),
    ):
        resp = client.get("/api/vault/search?q=test")
        data = resp.get_json()
        assert "excluded" in data
        assert data["excluded"] == 0


def test_empty_query_returns_zero_excluded(client):
    resp = client.get("/api/vault/search?q=")
    data = resp.get_json()
    assert data == {"results": [], "excluded": 0}


# ---------------------------------------------------------------------------
# Override params — query params win over settings
# ---------------------------------------------------------------------------


def test_mode_override_hybrid_beats_keyword_setting(client):
    """?mode=hybrid overrides search_mode=keyword in settings."""
    settings = _settings(search_mode="keyword")
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test&mode=hybrid")
        assert resp.status_code == 200
        cmd = mock_run.call_args[0][0]
        assert "query" in cmd


def test_mode_override_keyword_beats_hybrid_setting(client):
    """?mode=keyword overrides search_mode=hybrid in settings."""
    settings = _settings(search_mode="hybrid")
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test&mode=keyword")
        assert resp.status_code == 200
        cmd = mock_run.call_args[0][0]
        assert "search" in cmd


def test_n_override_beats_settings(client):
    """?n=5 overrides search_results=10 in settings."""
    settings = _settings(search_results=10)
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test&n=5")
        assert resp.status_code == 200
        cmd = mock_run.call_args[0][0]
        assert cmd[cmd.index("-n") + 1] == "5"


def test_timeout_override_beats_settings(client):
    """?timeout=30 overrides query_timeout_seconds=120 in settings."""
    with (
        patch("routes.vault.load_settings", return_value=_DEFAULT_SETTINGS),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test&timeout=30")
        assert resp.status_code == 200
        _, kwargs = mock_run.call_args
        assert kwargs["timeout"] == 30


def test_invalid_mode_param_falls_back_to_settings(client):
    """Unknown ?mode= value falls back to the setting (hybrid → query)."""
    settings = _settings(search_mode="hybrid")
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)) as mock_run,
    ):
        resp = client.get("/api/vault/search?q=test&mode=fuzzy")
        assert resp.status_code == 200
        cmd = mock_run.call_args[0][0]
        assert "query" in cmd


# ---------------------------------------------------------------------------
# excluded_dirs — post-filter applied after qmd runs
# ---------------------------------------------------------------------------


def test_excluded_dirs_filters_matching_results(client):
    """Results under excluded dir are removed; excluded count reflects it."""
    settings = {
        **_DEFAULT_SETTINGS,
        "background_index": {
            **_DEFAULT_SETTINGS["background_index"],
            "excluded_dirs": ["daily"],
        },
    }
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)),
    ):
        resp = client.get("/api/vault/search?q=test")
        data = resp.get_json()
        assert data["excluded"] == 1
        assert len(data["results"]) == 1
        assert data["results"][0]["file"] == "research/ns.md"


def test_excluded_dirs_empty_passes_all_results(client):
    with (
        patch("routes.vault.load_settings", return_value=_DEFAULT_SETTINGS),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)),
    ):
        resp = client.get("/api/vault/search?q=test")
        data = resp.get_json()
        assert data["excluded"] == 0
        assert len(data["results"]) == 2


def test_excluded_dirs_no_partial_match(client):
    """'dai' should NOT exclude 'daily/heartbeat.md' (must match full segment)."""
    settings = {
        **_DEFAULT_SETTINGS,
        "background_index": {
            **_DEFAULT_SETTINGS["background_index"],
            "excluded_dirs": ["dai"],
        },
    }
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)),
    ):
        resp = client.get("/api/vault/search?q=test")
        data = resp.get_json()
        assert data["excluded"] == 0
        assert len(data["results"]) == 2


def test_excluded_dirs_with_trailing_slash(client):
    """Trailing slash on excluded dir is handled gracefully."""
    settings = {
        **_DEFAULT_SETTINGS,
        "background_index": {
            **_DEFAULT_SETTINGS["background_index"],
            "excluded_dirs": ["daily/"],
        },
    }
    with (
        patch("routes.vault.load_settings", return_value=settings),
        patch("routes.vault.subprocess.run", return_value=_mock_proc(_FAKE_QMD_OUTPUT)),
    ):
        resp = client.get("/api/vault/search?q=test")
        data = resp.get_json()
        assert data["excluded"] == 1
