#!/usr/bin/env python3
"""Fathom Vault — standalone viewer + write API for the vault layer."""

from flask import Flask, send_from_directory

from config import FRONTEND_DIR, PORT

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")

from routes.settings import bp as settings_bp  # noqa: E402
from routes.vault import bp as vault_bp  # noqa: E402

app.register_blueprint(vault_bp)
app.register_blueprint(settings_bp)

# Start background indexer with persisted settings
from services.indexer import indexer  # noqa: E402
from services.settings import load_settings  # noqa: E402

_startup_settings = load_settings()
indexer.configure(
    _startup_settings["background_index"]["enabled"],
    _startup_settings["background_index"]["interval_minutes"],
    _startup_settings["background_index"]["excluded_dirs"],
)


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def spa(path):  # noqa: ARG001
    """Catch-all for SPA client-side routing."""
    return send_from_directory(FRONTEND_DIR, "index.html")


if __name__ == "__main__":
    app.run(port=PORT, threaded=True)
