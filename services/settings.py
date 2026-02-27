"""Settings persistence — global + per-workspace split.

Global settings (~/.config/fathom-vault/settings.json):
    workspaces dict + default_workspace only.

Per-workspace settings (<project>/.fathom/settings.json):
    All operational config (indexing, MCP, activity, crystal, ping).
"""

import json
import os
import re
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

_WORKSPACE_DEFAULTS = {
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
    "activity": {
        "decay_halflife_days": 7,
        "recency_window_hours": 48,
        "max_access_boost": 2.0,
        "activity_sort_default": False,
        "show_heat_indicator": True,
        "excluded_from_scoring": ["daily"],
    },
    "crystal_regen": {
        "enabled": False,
        "interval_days": 7,
    },
    "session": {
        "bypass_permissions": False,
    },
    "ping": {
        "routines": [_DEFAULT_ROUTINE],
    },
}


def _migrate_ping(saved_ping: dict) -> dict:
    """Migrate old flat ping config to routines[] format."""
    if "routines" in saved_ping:
        return saved_ping
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


# ── Workspace entry normalization ─────────────────────────────────────────────


def _normalize_workspace_entry(entry) -> dict:
    """Normalize a workspace entry to dict format.

    Handles both string entries ("path") and rich dict entries
    ({"path": ..., "vault": ..., "description": ..., "agents": [...]}).
    """
    if isinstance(entry, str):
        return {
            "path": entry,
            "vault": "vault",
            "description": "",
            "agents": [],
            "type": "local",
        }
    if isinstance(entry, dict):
        return {
            "path": entry.get("path", ""),
            "vault": entry.get("vault", "vault"),
            "description": entry.get("description", ""),
            "agents": entry.get("agents", []),
            "type": entry.get("type", "local"),
        }
    return {
        "path": str(entry),
        "vault": "vault",
        "description": "",
        "agents": [],
        "type": "local",
    }


def _sanitize_description(text: str) -> str:
    """Strip HTML tags, whitespace, and truncate to 200 chars."""
    if not text:
        return ""
    cleaned = re.sub(r"<[^>]+>", "", str(text)).strip()
    return cleaned[:200]


# ── Global settings ──────────────────────────────────────────────────────────


def load_global_settings() -> dict:
    """Load ~/.config/fathom-vault/settings.json — workspaces registry only."""
    try:
        with open(_SETTINGS_FILE) as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        saved = {}

    workspaces = saved.get("workspaces", {})
    default_ws = saved.get("default_workspace")

    if not workspaces or not isinstance(workspaces, dict):
        workspaces = {}
        default_ws = None
    else:
        # Normalize all entries to dict format on load
        workspaces = {name: _normalize_workspace_entry(entry) for name, entry in workspaces.items()}
        if not default_ws or default_ws not in workspaces:
            default_ws = next(iter(workspaces))

    return {"workspaces": workspaces, "default_workspace": default_ws}


def save_global_settings(settings: dict) -> None:
    """Save global settings — workspaces + default only."""
    os.makedirs(_SETTINGS_DIR, exist_ok=True)
    data = {
        "workspaces": settings.get("workspaces", {}),
        "default_workspace": settings.get("default_workspace"),
    }
    with open(_SETTINGS_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ── Per-workspace settings ───────────────────────────────────────────────────


def _resolve_workspace_path(workspace: str = None) -> str:
    """Resolve project root path for a workspace name."""
    gs = load_global_settings()
    ws_name = workspace or gs["default_workspace"]
    ws_entry = gs["workspaces"].get(ws_name)
    if not ws_entry:
        msg = f"Unknown workspace: {ws_name}"
        raise ValueError(msg)
    # Entry is always a dict after normalization in load_global_settings
    return ws_entry["path"]


def load_workspace_settings(workspace: str = None) -> dict:
    """Load <project>/.fathom/settings.json, merged with defaults."""
    try:
        ws_path = _resolve_workspace_path(workspace)
        settings_path = os.path.join(ws_path, ".fathom", "settings.json")
    except ValueError:
        return {k: (dict(v) if isinstance(v, dict) else v) for k, v in _WORKSPACE_DEFAULTS.items()}

    try:
        with open(settings_path) as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        saved = {}

    settings = {}
    for key, default_val in _WORKSPACE_DEFAULTS.items():
        if key == "ping":
            saved_ping = saved.get("ping", {})
            settings["ping"] = (
                _migrate_ping(saved_ping) if saved_ping else {"routines": [dict(_DEFAULT_ROUTINE)]}
            )
        elif isinstance(default_val, dict):
            settings[key] = {**default_val, **saved.get(key, {})}
        else:
            settings[key] = saved.get(key, default_val)

    return settings


def save_workspace_settings(workspace: str, settings: dict) -> None:
    """Save to <project>/.fathom/settings.json."""
    ws_path = _resolve_workspace_path(workspace)
    settings_path = os.path.join(ws_path, ".fathom", "settings.json")
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)

    # Only persist workspace-specific keys
    data = {}
    for key in _WORKSPACE_DEFAULTS:
        if key in settings:
            data[key] = settings[key]
    with open(settings_path, "w") as f:
        json.dump(data, f, indent=2)


# ── One-time migration ──────────────────────────────────────────────────────

_MIGRATED = False


def _migrate_to_split_settings() -> None:
    """One-time migration: split monolithic settings into global + per-workspace.

    1. Strip /vault suffix from workspace paths (store project roots, not vault dirs).
    2. Extract operational config into per-workspace .fathom/settings.json files.
    3. Clean global settings to workspaces + default_workspace only.
    """
    global _MIGRATED
    if _MIGRATED:
        return
    _MIGRATED = True

    try:
        with open(_SETTINGS_FILE) as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return

    workspaces = saved.get("workspaces", {})
    if not workspaces:
        return

    # Detect if migration is needed — extract paths from both string and dict entries
    def _entry_path(entry):
        return entry["path"] if isinstance(entry, dict) else entry

    needs_path_migration = any(_entry_path(p).endswith("/vault") for p in workspaces.values())
    operational_keys = ("background_index", "mcp", "activity", "crystal_regen", "ping", "terminal")
    has_operational_config = any(k in saved for k in operational_keys)

    if not needs_path_migration and not has_operational_config:
        return  # Already migrated

    # Step 1: Strip /vault suffix from workspace paths
    new_workspaces = {}
    for name, entry in workspaces.items():
        ws_path = _entry_path(entry)
        if ws_path.endswith("/vault"):
            project_root = ws_path[:-6]
            if os.path.isdir(project_root):
                new_workspaces[name] = project_root
            else:
                new_workspaces[name] = ws_path  # keep as-is
        else:
            new_workspaces[name] = ws_path

    # Step 2: Extract operational config
    ws_config = {}
    ws_keys = ("background_index", "mcp", "activity", "crystal_regen", "ping")
    for key in ws_keys:
        if key in saved:
            ws_config[key] = saved[key]

    # Step 3: Create per-workspace .fathom/settings.json for each workspace
    for _name, project_root in new_workspaces.items():
        ws_settings_dir = os.path.join(project_root, ".fathom")
        ws_settings_path = os.path.join(ws_settings_dir, "settings.json")
        if not os.path.exists(ws_settings_path) and ws_config:
            os.makedirs(ws_settings_dir, exist_ok=True)
            with open(ws_settings_path, "w") as f:
                json.dump(ws_config, f, indent=2)

    # Step 4: Write clean global settings
    global_data = {
        "workspaces": new_workspaces,
        "default_workspace": saved.get("default_workspace", next(iter(new_workspaces))),
    }
    os.makedirs(_SETTINGS_DIR, exist_ok=True)
    with open(_SETTINGS_FILE, "w") as f:
        json.dump(global_data, f, indent=2)


# ── Backward-compatible wrappers ─────────────────────────────────────────────


def load_settings(workspace: str = None) -> dict:
    """Load merged settings: global (workspaces) + per-workspace (operational).

    Triggers one-time migration on first call.
    """
    _migrate_to_split_settings()

    gs = load_global_settings()
    ws_name = workspace or gs["default_workspace"]
    ws_s = load_workspace_settings(ws_name)

    # Merge: per-workspace config + global fields
    merged = {**ws_s}
    merged["workspaces"] = gs["workspaces"]
    merged["default_workspace"] = gs["default_workspace"]
    return merged


def save_settings(settings: dict, workspace: str = None) -> None:
    """Save settings, routing global and per-workspace fields to correct files."""
    gs = load_global_settings()
    ws_name = workspace or gs["default_workspace"]

    # Route global fields
    changed_global = False
    if "workspaces" in settings:
        gs["workspaces"] = settings["workspaces"]
        changed_global = True
    if "default_workspace" in settings:
        gs["default_workspace"] = settings["default_workspace"]
        changed_global = True
    if changed_global:
        save_global_settings(gs)

    # Route per-workspace fields
    ws_keys = set(_WORKSPACE_DEFAULTS.keys())
    ws_data = {k: v for k, v in settings.items() if k in ws_keys}
    if ws_data:
        current = load_workspace_settings(ws_name)
        current.update(ws_data)
        save_workspace_settings(ws_name, current)


# ── Workspace CRUD ───────────────────────────────────────────────────────────


def add_workspace(
    name: str,
    project_path: str,
    vault: str = "vault",
    description: str = "",
    agents: list | None = None,
    type: str = "local",
) -> tuple[bool, str]:
    """Add or update a workspace. Path is the project root (must contain vault/ subdir).

    Idempotent: same name + same path = update metadata (vault, description).
    Same name + different path = reject with error.

    Creates .fathom/ directory with default settings if missing.
    Returns (ok, error_message).
    """
    if not name or not isinstance(name, str):
        return False, "Workspace name is required"
    if not project_path or not isinstance(project_path, str):
        return False, "Project path is required"
    if not os.path.isdir(project_path):
        return False, f"Path does not exist: {project_path}"

    vault_subdir = vault or "vault"
    vault_dir = os.path.join(project_path, vault_subdir)
    if not os.path.isdir(vault_dir):
        return False, f"No {vault_subdir}/ subdirectory found at: {vault_dir}"

    agents_list = agents or []

    gs = load_global_settings()
    existing = gs["workspaces"].get(name)
    if existing:
        existing_path = existing["path"]
        if os.path.realpath(existing_path) != os.path.realpath(project_path):
            return False, f'Workspace "{name}" already exists at a different path'
        # Idempotent upsert — merge new metadata into existing entry
        if vault:
            existing["vault"] = vault_subdir
        if description:
            existing["description"] = _sanitize_description(description)
        if agents_list:
            existing["agents"] = agents_list
        if type:
            existing["type"] = type
        gs["workspaces"][name] = existing
    else:
        gs["workspaces"][name] = {
            "path": project_path,
            "vault": vault_subdir,
            "description": _sanitize_description(description),
            "agents": agents_list,
            "type": type,
        }

    save_global_settings(gs)

    # Create .fathom/settings.json with defaults if missing
    ws_settings_dir = os.path.join(project_path, ".fathom")
    ws_settings_path = os.path.join(ws_settings_dir, "settings.json")
    if not os.path.exists(ws_settings_path):
        os.makedirs(ws_settings_dir, exist_ok=True)
        with open(ws_settings_path, "w") as f:
            json.dump(dict(_WORKSPACE_DEFAULTS), f, indent=2)

    return True, ""


def remove_workspace(name: str) -> tuple[bool, str]:
    """Remove a workspace. Cannot remove the default. Returns (ok, error_message)."""
    gs = load_global_settings()

    if name not in gs["workspaces"]:
        return False, f'Workspace "{name}" not found'
    if name == gs["default_workspace"]:
        return False, "Cannot remove the default workspace"

    del gs["workspaces"][name]
    save_global_settings(gs)
    return True, ""


def set_default_workspace(name: str) -> tuple[bool, str]:
    """Set a workspace as default. Returns (ok, error_message)."""
    gs = load_global_settings()

    if name not in gs["workspaces"]:
        return False, f'Workspace "{name}" not found'

    gs["default_workspace"] = name
    save_global_settings(gs)
    return True, ""
