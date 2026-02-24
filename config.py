"""Shared constants and path configuration for Fathom Vault."""

import json
import os

_SETTINGS_FILE = os.path.expanduser("~/.config/fathom-vault/settings.json")
_DEFAULT_VAULT_DIR = "/data/Dropbox/Work/vault"


def _read_setting(*keys, default=None):
    """Read a nested setting from the settings file."""
    try:
        with open(_SETTINGS_FILE) as f:
            data = json.load(f)
        for k in keys:
            data = data[k]
        return data
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError):
        return default


VAULT_DIR = _read_setting("terminal", "vault_dir", default=_DEFAULT_VAULT_DIR)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp")
PORT = 4243
