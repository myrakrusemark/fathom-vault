"""Settings API — background indexer config and manual trigger."""

from flask import Blueprint, jsonify, request

from services.indexer import indexer
from services.settings import load_settings, save_settings

bp = Blueprint("settings", __name__)


@bp.route("/api/settings", methods=["GET"])
def get_settings():
    """Return current settings merged with live indexer status."""
    settings = load_settings()
    settings["background_index"]["last_indexed"] = indexer.status["last_indexed"]
    return jsonify(settings)


@bp.route("/api/settings", methods=["POST"])
def update_settings():
    """Persist settings and apply to indexer."""
    data = request.get_json(silent=True) or {}
    bi = data.get("background_index", {})

    if not isinstance(bi, dict):
        return jsonify({"error": "background_index must be an object"}), 400

    settings = load_settings()

    if "enabled" in bi:
        settings["background_index"]["enabled"] = bool(bi["enabled"])
    if "interval_minutes" in bi:
        minutes = bi["interval_minutes"]
        if not isinstance(minutes, int) or minutes < 1:
            return jsonify({"error": "interval_minutes must be a positive integer"}), 400
        settings["background_index"]["interval_minutes"] = minutes

    save_settings(settings)
    indexer.configure(
        settings["background_index"]["enabled"],
        settings["background_index"]["interval_minutes"],
    )

    settings["background_index"]["last_indexed"] = indexer.status["last_indexed"]
    return jsonify(settings)


@bp.route("/api/settings/index-now", methods=["POST"])
def index_now():
    """Trigger an immediate background index run."""
    indexer.run_now()
    return jsonify({"ok": True})
