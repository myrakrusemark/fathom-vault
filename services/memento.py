"""Memento SaaS client — connectivity check and identity crystal fetch."""

import json
import os
import pathlib
import urllib.error
import urllib.request

_DEFAULT_API_URL = "https://memento-api.myrakrusemark.workers.dev"
_NO_CRYSTAL = "No identity crystal found"


def _load_memento_config() -> dict:
    """Walk upward from cwd looking for .memento.json; return its contents or {}."""
    here = pathlib.Path.cwd()
    for directory in [here, *here.parents]:
        candidate = directory / ".memento.json"
        if candidate.exists():
            try:
                return json.loads(candidate.read_text())
            except (json.JSONDecodeError, OSError):
                pass
    return {}


def get_status() -> dict:
    """Return Memento configuration + crystal status.

    Reads credentials from .memento.json (walking upward from cwd), falling
    back to MEMENTO_API_KEY / MEMENTO_API_URL / MEMENTO_WORKSPACE env vars.

    Returns dict with keys:
        configured  bool  — API key is available
        connected   bool  — API responded successfully
        error       str   — only present on connection failure
        crystal     dict | None — {exists, created_at, source_count, preview} or None
    """
    cfg = _load_memento_config()
    api_key = cfg.get("apiKey") or os.getenv("MEMENTO_API_KEY", "")
    workspace = cfg.get("workspace") or os.getenv("MEMENTO_WORKSPACE", "default")
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
