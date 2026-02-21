"""Settings persistence — load/save to ~/.config/fathom-vault/settings.json."""

import json
import os

_SETTINGS_DIR = os.path.expanduser("~/.config/fathom-vault")
_SETTINGS_FILE = os.path.join(_SETTINGS_DIR, "settings.json")

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
}


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
    return settings


def save_settings(settings: dict) -> None:
    """Persist settings to disk."""
    os.makedirs(_SETTINGS_DIR, exist_ok=True)
    with open(_SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)
