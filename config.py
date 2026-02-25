"""Shared constants and path configuration for Fathom Vault."""

import json
import os

_SETTINGS_FILE = os.path.expanduser("~/.config/fathom-vault/settings.json")
_DEFAULT_VAULT_DIR = "/data/Dropbox/Work/vault"


def _read_setting(*keys, default=None):
    """Read a nested setting from the global settings file."""
    try:
        with open(_SETTINGS_FILE) as f:
            data = json.load(f)
        for k in keys:
            data = data[k]
        return data
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError):
        return default


def get_workspace_path(workspace=None):
    """Resolve project root directory for a workspace name.

    Returns (path, None) on success, (None, error_dict) on failure.
    If workspace is None, returns the default workspace path.
    """
    workspaces = _read_setting("workspaces", default={})
    default_ws = _read_setting("default_workspace", default=None)

    if not workspace:
        if default_ws and workspaces.get(default_ws):
            return workspaces[default_ws], None
        # Legacy fallback — derive from terminal.vault_dir or default
        vault_dir = _read_setting("terminal", "vault_dir", default=_DEFAULT_VAULT_DIR)
        return os.path.dirname(vault_dir), None

    ws_path = workspaces.get(workspace)
    if not ws_path:
        available = list(workspaces.keys()) if workspaces else []
        return None, {
            "error": f'Unknown workspace: "{workspace}"',
            "available_workspaces": available,
        }
    return ws_path, None


def get_vault_path(workspace=None):
    """Resolve vault directory for a workspace name.

    Vault path = workspace project root + "/vault".
    Returns (path, None) on success, (None, error_dict) on failure.
    """
    ws_path, err = get_workspace_path(workspace)
    if err:
        return None, err
    return os.path.join(ws_path, "vault"), None


def get_workspace_settings_path(workspace=None):
    """Resolve per-workspace settings file path.

    Returns (<project_root>/.fathom/settings.json, None) on success.
    """
    ws_path, err = get_workspace_path(workspace)
    if err:
        return None, err
    return os.path.join(ws_path, ".fathom", "settings.json"), None


def get_workspaces():
    """Return dict of all configured workspaces {name: project_root_path}."""
    return _read_setting("workspaces", default={})


def get_default_workspace():
    """Return the default workspace name."""
    return _read_setting("default_workspace", default=None)


# Legacy constant — pre-migration reads terminal.vault_dir, post-migration falls back to default.
# Used by services/indexer.py (until Phase 3 makes it workspace-aware).
VAULT_DIR = _read_setting("terminal", "vault_dir", default=_DEFAULT_VAULT_DIR)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp")
PORT = 4243
