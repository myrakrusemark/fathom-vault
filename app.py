#!/usr/bin/env python3
"""Fathom Vault — standalone viewer + write API for the vault layer."""

from flask import Flask, send_from_directory

from config import FRONTEND_DIR, PORT

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

from routes.activation import bp as activation_bp  # noqa: E402
from routes.settings import bp as settings_bp  # noqa: E402
from routes.terminal import sock as terminal_sock  # noqa: E402
from routes.vault import bp as vault_bp  # noqa: E402

terminal_sock.init_app(app)
app.register_blueprint(activation_bp)
app.register_blueprint(vault_bp)
app.register_blueprint(settings_bp)

# Start background indexer with persisted settings
from services.crystal_scheduler import crystal_scheduler  # noqa: E402
from services.indexer import indexer  # noqa: E402
from services.persistent_session import ensure_running as session_ensure_running  # noqa: E402
from services.ping_scheduler import ping_scheduler  # noqa: E402
from services.settings import load_settings  # noqa: E402

_startup_settings = load_settings()

# Ensure persistent fathom-session is running (non-blocking: starts it in background)
import threading as _threading  # noqa: E402

_threading.Thread(target=session_ensure_running, daemon=True).start()

indexer.configure(
    _startup_settings["background_index"]["enabled"],
    _startup_settings["background_index"]["interval_minutes"],
    _startup_settings["background_index"]["excluded_dirs"],
)
crystal_scheduler.configure(
    _startup_settings["crystal_regen"]["enabled"],
    _startup_settings["crystal_regen"]["interval_days"],
)
ping_scheduler.configure_all(_startup_settings["ping"]["routines"])


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def spa(path):  # noqa: ARG001
    """Catch-all for SPA client-side routing."""
    return send_from_directory(FRONTEND_DIR, "index.html")


if __name__ == "__main__":
    app.run(port=PORT, threaded=True)
