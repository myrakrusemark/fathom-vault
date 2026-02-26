#!/usr/bin/env python3
"""Fathom Server — dashboard + REST API + background services for the vault layer."""

import argparse

from flask import Flask, send_from_directory

from config import FRONTEND_DIR, PORT

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

from routes.activation import bp as activation_bp  # noqa: E402
from routes.room import bp as room_bp  # noqa: E402
from routes.settings import bp as settings_bp  # noqa: E402
from routes.terminal import sock as terminal_sock  # noqa: E402
from routes.vault import bp as vault_bp  # noqa: E402

terminal_sock.init_app(app)
app.register_blueprint(activation_bp)
app.register_blueprint(vault_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(room_bp)

# Bootstrap all workspaces on startup
import threading as _threading  # noqa: E402

from services.crystal_scheduler import crystal_scheduler  # noqa: E402
from services.indexer import indexer  # noqa: E402
from services.persistent_session import ensure_running as session_ensure_running  # noqa: E402
from services.ping_scheduler import ping_scheduler  # noqa: E402
from services.settings import (  # noqa: E402
    load_global_settings,
    load_workspace_settings,
)

_global_settings = load_global_settings()
_workspaces = _global_settings["workspaces"]
_default_ws = _global_settings["default_workspace"]

# Ensure persistent sessions for all workspaces (non-blocking)
for _ws_name in _workspaces:
    _threading.Thread(target=session_ensure_running, args=(_ws_name,), daemon=True).start()

# Collect all ping routines across workspaces (tagged with workspace)
_all_routines = []
for _ws_name in _workspaces:
    _ws_settings = load_workspace_settings(_ws_name)
    for _r in _ws_settings["ping"]["routines"]:
        _r["workspace"] = _ws_name
    _all_routines.extend(_ws_settings["ping"]["routines"])

ping_scheduler.configure_all(_all_routines)

# Configure indexer from default workspace settings (indexes all workspaces)
_default_settings = load_workspace_settings(_default_ws)
indexer.configure(
    _default_settings["background_index"]["enabled"],
    _default_settings["background_index"]["interval_minutes"],
    _default_settings["background_index"]["excluded_dirs"],
)

# Configure crystal scheduler from default workspace
crystal_scheduler.configure(
    _default_settings["crystal_regen"]["enabled"],
    _default_settings["crystal_regen"]["interval_days"],
    workspace=_default_ws,
)


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def spa(path):  # noqa: ARG001
    """Catch-all for SPA client-side routing."""
    return send_from_directory(FRONTEND_DIR, "index.html")


def main():
    """Entry point for `fathom-server` CLI command."""
    from auth import load_server_config

    parser = argparse.ArgumentParser(description="Fathom Server")
    parser.add_argument(
        "--port", type=int, default=PORT, help=f"Port to listen on (default: {PORT})"
    )
    cli_args = parser.parse_args()

    # Ensure server config exists (generates API key on first run)
    server_config = load_server_config()
    api_key = server_config["api_key"]
    auth_enabled = server_config.get("auth_enabled", False)

    print("\n  Fathom Server v0.1.0")
    print(f"  Port: {cli_args.port}")
    print(f"  Auth: {'enabled' if auth_enabled else 'disabled (enable via dashboard)'}")
    print(f"  API Key: {api_key[:7]}...{api_key[-4:]}")
    print(f"  Dashboard: http://localhost:{cli_args.port}\n")

    app.run(port=cli_args.port, threaded=True)


if __name__ == "__main__":
    main()
