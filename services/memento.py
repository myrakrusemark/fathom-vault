"""Memento SaaS client — connectivity check, identity crystal read/write."""

import json
import os
import pathlib
import urllib.error
import urllib.request

_DEFAULT_API_URL = "https://memento-api.myrakrusemark.workers.dev"
_NO_CRYSTAL = "No identity crystal found"


def _load_memento_config(start_dir: str | None = None) -> dict:
    """Walk upward from start_dir looking for .memento.json; return its contents or {}.

    If start_dir is None, walks from cwd (server fallback).
    """
    here = pathlib.Path(start_dir) if start_dir else pathlib.Path.cwd()
    for directory in [here, *here.parents]:
        candidate = directory / ".memento.json"
        if candidate.exists():
            try:
                return json.loads(candidate.read_text())
            except (json.JSONDecodeError, OSError):
                pass
    return {}


def _workspace_project_path(workspace: str | None) -> str | None:
    """Resolve a workspace name to its project directory path."""
    if not workspace:
        return None
    from services.settings import load_global_settings

    gs = load_global_settings()
    ws_entry = gs.get("workspaces", {}).get(workspace, {})
    return ws_entry.get("path") if isinstance(ws_entry, dict) else ws_entry or None


def write_crystal(crystal_text: str, workspace: str = None) -> dict:
    """Write an identity crystal to Memento SaaS.

    Returns dict with keys: ok (bool), error (str, optional).
    """
    project_path = _workspace_project_path(workspace)
    cfg = _load_memento_config(project_path)
    api_key = cfg.get("apiKey") or os.getenv("MEMENTO_API_KEY", "")
    workspace = workspace or cfg.get("workspace") or os.getenv("MEMENTO_WORKSPACE", "default")
    api_url = os.getenv("MEMENTO_API_URL", _DEFAULT_API_URL)

    if not api_key:
        return {"ok": False, "error": "No API key configured"}

    body = json.dumps({"crystal": crystal_text}).encode()
    req = urllib.request.Request(
        f"{api_url}/v1/identity",
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {api_key}",
            "X-Memento-Workspace": workspace,
            "Content-Type": "application/json",
            "User-Agent": "fathom-vault/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            json.loads(resp.read())  # consume response
        return {"ok": True}
    except urllib.error.URLError as e:
        return {"ok": False, "error": str(e.reason)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def get_status(workspace: str = None) -> dict:
    """Return Memento configuration + crystal status.

    Reads credentials from .memento.json in the workspace's project directory
    (walking upward), falling back to MEMENTO_API_KEY / MEMENTO_API_URL env vars.

    Returns dict with keys:
        configured  bool  — API key is available
        connected   bool  — API responded successfully
        error       str   — only present on connection failure
        crystal     dict | None — {exists, created_at, source_count, preview} or None
    """
    project_path = _workspace_project_path(workspace)
    cfg = _load_memento_config(project_path)
    api_key = cfg.get("apiKey") or os.getenv("MEMENTO_API_KEY", "")
    workspace = workspace or cfg.get("workspace") or os.getenv("MEMENTO_WORKSPACE", "default")
    api_url = os.getenv("MEMENTO_API_URL", _DEFAULT_API_URL)

    if not api_key:
        return {"configured": False, "connected": False, "crystal": None}

    req = urllib.request.Request(
        f"{api_url}/v1/identity",
        headers={
            "Authorization": f"Bearer {api_key}",
            "X-Memento-Workspace": workspace,
            "User-Agent": "fathom-vault/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        crystal_text = (data.get("content") or [{}])[0].get("text", "")
        meta = data.get("meta") or {}
        exists = bool(crystal_text) and _NO_CRYSTAL not in crystal_text
        return {
            "configured": True,
            "connected": True,
            "crystal": {
                "exists": exists,
                "created_at": meta.get("created_at") if exists else None,
                "source_count": meta.get("source_count", 0) if exists else 0,
                "preview": crystal_text if exists else None,
            },
        }
    except urllib.error.URLError as e:
        return {"configured": True, "connected": False, "error": str(e.reason)}
    except Exception as e:  # noqa: BLE001
        return {"configured": True, "connected": False, "error": str(e)}
