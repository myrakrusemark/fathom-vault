"""API key authentication for fathom-server.

Generates a server API key on first run (stored in data/server.json).
Provides a Flask middleware decorator to require Bearer token auth on API routes.
Dashboard routes (serving static files) are exempt.
"""

import json
import os
import secrets
from functools import wraps

from flask import jsonify, request

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_SERVER_CONFIG_PATH = os.path.join(_DATA_DIR, "server.json")

# Prefix makes keys visually identifiable and greppable
_KEY_PREFIX = "fv_"
_KEY_BYTES = 24  # 24 bytes = 32 base64 chars


def _generate_api_key() -> str:
    """Generate a new API key with the fv_ prefix."""
    return _KEY_PREFIX + secrets.token_urlsafe(_KEY_BYTES)


def load_server_config() -> dict:
    """Load server config from data/server.json, creating with defaults if missing."""
    os.makedirs(_DATA_DIR, exist_ok=True)

    try:
        with open(_SERVER_CONFIG_PATH) as f:
            config = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        config = {}

    changed = False

    if "api_key" not in config:
        config["api_key"] = _generate_api_key()
        changed = True

    if "auth_enabled" not in config:
        config["auth_enabled"] = False  # Off by default for backward compat
        changed = True

    if changed:
        save_server_config(config)

    return config


def save_server_config(config: dict) -> None:
    """Persist server config to data/server.json."""
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_SERVER_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def get_api_key() -> str:
    """Return the current server API key."""
    return load_server_config()["api_key"]


def regenerate_api_key() -> str:
    """Generate a new API key, invalidating the old one."""
    config = load_server_config()
    config["api_key"] = _generate_api_key()
    save_server_config(config)
    return config["api_key"]


def is_auth_enabled() -> bool:
    """Check whether API key auth is currently enforced."""
    return load_server_config().get("auth_enabled", False)


def set_auth_enabled(enabled: bool) -> None:
    """Enable or disable API key auth enforcement."""
    config = load_server_config()
    config["auth_enabled"] = enabled
    save_server_config(config)


def require_api_key(f):
    """Flask route decorator — requires valid Bearer token when auth is enabled.

    When auth is disabled (default), all requests pass through.
    When auth is enabled, validates Authorization: Bearer <key> header.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        if not is_auth_enabled():
            return f(*args, **kwargs)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or malformed Authorization header"}), 401

        token = auth_header[7:]  # Strip "Bearer "
        expected = get_api_key()

        if not secrets.compare_digest(token, expected):
            return jsonify({"error": "Invalid API key"}), 401

        return f(*args, **kwargs)

    return decorated
