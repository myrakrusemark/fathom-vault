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
    mcp_data = data.get("mcp", {})

    if not isinstance(bi, dict):
        return jsonify({"error": "background_index must be an object"}), 400
    if not isinstance(mcp_data, dict):
        return jsonify({"error": "mcp must be an object"}), 400

    settings = load_settings()

    # --- background_index fields ---
    if "enabled" in bi:
        settings["background_index"]["enabled"] = bool(bi["enabled"])
    if "interval_minutes" in bi:
        minutes = bi["interval_minutes"]
        if not isinstance(minutes, int) or minutes < 1:
            return jsonify({"error": "interval_minutes must be a positive integer"}), 400
        settings["background_index"]["interval_minutes"] = minutes
    if "excluded_dirs" in bi:
        excluded = bi["excluded_dirs"]
        if not isinstance(excluded, list) or not all(isinstance(d, str) for d in excluded):
            return jsonify({"error": "excluded_dirs must be a list of strings"}), 400
        settings["background_index"]["excluded_dirs"] = excluded

    # --- mcp fields ---
    if "query_timeout_seconds" in mcp_data:
        timeout = mcp_data["query_timeout_seconds"]
        if not isinstance(timeout, int) or not (10 <= timeout <= 300):
            return jsonify({"error": "query_timeout_seconds must be an integer between 10 and 300"}), 400
        settings["mcp"]["query_timeout_seconds"] = timeout
    if "search_results" in mcp_data:
        results = mcp_data["search_results"]
        if not isinstance(results, int) or not (1 <= results <= 100):
            return jsonify({"error": "search_results must be an integer between 1 and 100"}), 400
        settings["mcp"]["search_results"] = results
    if "search_mode" in mcp_data:
        mode = mcp_data["search_mode"]
        if mode not in ("hybrid", "keyword"):
            return jsonify({"error": 'search_mode must be "hybrid" or "keyword"'}), 400
        settings["mcp"]["search_mode"] = mode

    save_settings(settings)
    indexer.configure(
        settings["background_index"]["enabled"],
        settings["background_index"]["interval_minutes"],
        settings["background_index"]["excluded_dirs"],
    )

    settings["background_index"]["last_indexed"] = indexer.status["last_indexed"]
    return jsonify(settings)


@bp.route("/api/settings/index-now", methods=["POST"])
def index_now():
    """Trigger an immediate background index run."""
    indexer.run_now()
    return jsonify({"ok": True})
