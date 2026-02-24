"""Settings persistence — load/save to ~/.config/fathom-vault/settings.json."""

import json
import os
import uuid

_SETTINGS_DIR = os.path.expanduser("~/.config/fathom-vault")
_SETTINGS_FILE = os.path.join(_SETTINGS_DIR, "settings.json")

_DEFAULT_ROUTINE = {
    "id": "default",
    "name": "Default",
    "enabled": False,
    "interval_minutes": 60,
    "next_ping_at": None,
    "last_ping_at": None,
    "context_sources": {
        "time": True,
        "scripts": [
            {
                "label": "Weather",
                "command": "ping-weather 63101",
                "enabled": False,
            }
        ],
        "texts": [
            {
                "label": "Three phases",
                "content": (
                    "You are running the standard ping routine. Three phases:\n\n"
                    "Phase 1 — Orient (5 min): Load MCP tools. Check Memento active_work + skip_list.\n"
                    "Check Telegram for unread messages. Quick news scan (respect skip list).\n\n"
                    "Phase 2 — Go Deep: Pick ONE thing from active_work and tunnel in. Produce something\n"
                    "that didn't exist before this ping.\n\n"
                    'Phase 3 — Eagle Eye (15-20 min): Zoom out. Browse. Look for the "oh!" moment.\n\n'
                    "Write Back: Update Memento items. Write a heartbeat to vault/daily/."
                ),
                "enabled": True,
            }
        ],
    },
}

_DEFAULTS = {
    "background_index": {
        "enabled": True,
        "interval_minutes": 15,
        "excluded_dirs": [],  # skipped by indexer AND filtered from search results
    },
    "mcp": {
        "query_timeout_seconds": 120,
        "search_results": 10,
        "search_mode": "hybrid",  # "hybrid" | "keyword"
    },
    "activity": {
        "decay_halflife_days": 7,
        "recency_window_hours": 48,
        "max_access_boost": 2.0,
        "activity_sort_default": False,
        "show_heat_indicator": True,
        "excluded_from_scoring": ["daily"],
    },
    "terminal": {
        "working_dir": "/data/Dropbox/Work",
        "vault_dir": "/data/Dropbox/Work/vault",
    },
    "crystal_regen": {
        "enabled": False,
        "interval_days": 7,
    },
    "ping": {
        "routines": [_DEFAULT_ROUTINE],
    },
}


def _migrate_ping(saved_ping: dict) -> dict:
    """Migrate old flat ping config to routines[] format."""
    if "routines" in saved_ping:
        return saved_ping
    # Old format had enabled, interval_minutes, etc. at top level — wrap as routines[0]
    routine = {
        "id": "default",
        "name": "Default",
        "enabled": saved_ping.get("enabled", False),
        "interval_minutes": saved_ping.get("interval_minutes", 60),
        "next_ping_at": saved_ping.get("next_ping_at"),
        "last_ping_at": saved_ping.get("last_ping_at"),
        "context_sources": saved_ping.get("context_sources", _DEFAULT_ROUTINE["context_sources"]),
    }
    return {"routines": [routine]}


def new_routine_id() -> str:
    """Generate a short unique ID for a new routine."""
    return uuid.uuid4().hex[:8]


def load_settings() -> dict:
    """Load settings from disk, merging with defaults for any missing keys."""
    try:
        with open(_SETTINGS_FILE) as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        saved = {}

    settings = {}
    settings["background_index"] = {
        **_DEFAULTS["background_index"],
        **saved.get("background_index", {}),
    }
    settings["mcp"] = {
        **_DEFAULTS["mcp"],
        **saved.get("mcp", {}),
    }
    settings["activity"] = {
        **_DEFAULTS["activity"],
        **saved.get("activity", {}),
    }
    settings["terminal"] = {
        **_DEFAULTS["terminal"],
        **saved.get("terminal", {}),
    }
    settings["crystal_regen"] = {
        **_DEFAULTS["crystal_regen"],
        **saved.get("crystal_regen", {}),
    }

    # Ping: migrate old format if needed
    saved_ping = saved.get("ping", {})
    settings["ping"] = _migrate_ping(saved_ping) if saved_ping else _DEFAULTS["ping"]

    return settings


def save_settings(settings: dict) -> None:
    """Persist settings to disk."""
    os.makedirs(_SETTINGS_DIR, exist_ok=True)
    with open(_SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)
