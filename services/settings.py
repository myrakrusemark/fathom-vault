"""Settings persistence — load/save to ~/.config/fathom-vault/settings.json."""

import json
import os

_SETTINGS_DIR = os.path.expanduser("~/.config/fathom-vault")
_SETTINGS_FILE = os.path.join(_SETTINGS_DIR, "settings.json")

_DEFAULTS = {
    "background_index": {
        "enabled": True,
        "interval_minutes": 15,
    }
}


def load_settings() -> dict:
    """Load settings from disk, merging with defaults for any missing keys."""
    try:
        with open(_SETTINGS_FILE) as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        saved = {}

    settings = dict(_DEFAULTS)
    settings["background_index"] = {
        **_DEFAULTS["background_index"],
        **saved.get("background_index", {}),
    }
    return settings


def save_settings(settings: dict) -> None:
    """Persist settings to disk."""
    os.makedirs(_SETTINGS_DIR, exist_ok=True)
    with open(_SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)
