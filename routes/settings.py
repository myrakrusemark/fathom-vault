"""Settings API — workspace-scoped config and manual index trigger."""

from flask import Blueprint, jsonify, request

from services.indexer import indexer
from services.settings import (
    add_workspace,
    load_settings,
    remove_workspace,
    save_settings,
    set_default_workspace,
)

bp = Blueprint("settings", __name__)


@bp.route("/api/settings", methods=["GET"])
def get_settings():
    """Return merged settings for the active workspace + live indexer status."""
    workspace = request.args.get("workspace")
    settings = load_settings(workspace)
    settings["background_index"]["last_indexed"] = indexer.status["last_indexed"]
    return jsonify(settings)


@bp.route("/api/settings", methods=["POST"])
def update_settings():
    """Persist settings and apply to indexer. Workspace-scoped."""
    workspace = request.args.get("workspace")
    data = request.get_json(silent=True) or {}
    bi = data.get("background_index", {})
    mcp_data = data.get("mcp", {})

    if not isinstance(bi, dict):
        return jsonify({"error": "background_index must be an object"}), 400
    if not isinstance(mcp_data, dict):
        return jsonify({"error": "mcp must be an object"}), 400

    settings = load_settings(workspace)

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
            return jsonify(
                {"error": "query_timeout_seconds must be an integer between 10 and 300"}
            ), 400
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

    # --- activity fields ---
    if "activity" in data:
        act = data["activity"]
        if not isinstance(act, dict):
            return jsonify({"error": "activity must be an object"}), 400
        act_settings = settings.get("activity", {})
        if "decay_halflife_days" in act:
            v = act["decay_halflife_days"]
            if not isinstance(v, int | float) or v <= 0:
                return jsonify({"error": "decay_halflife_days must be a positive number"}), 400
            act_settings["decay_halflife_days"] = float(v)
        if "recency_window_hours" in act:
            v = act["recency_window_hours"]
            if not isinstance(v, int | float) or v <= 0:
                return jsonify({"error": "recency_window_hours must be a positive number"}), 400
            act_settings["recency_window_hours"] = float(v)
        if "max_access_boost" in act:
            v = act["max_access_boost"]
            if not isinstance(v, int | float) or v <= 0:
                return jsonify({"error": "max_access_boost must be a positive number"}), 400
            act_settings["max_access_boost"] = float(v)
        if "activity_sort_default" in act:
            act_settings["activity_sort_default"] = bool(act["activity_sort_default"])
        if "show_heat_indicator" in act:
            act_settings["show_heat_indicator"] = bool(act["show_heat_indicator"])
        if "excluded_from_scoring" in act:
            ex = act["excluded_from_scoring"]
            if not isinstance(ex, list) or not all(isinstance(d, str) for d in ex):
                return jsonify({"error": "excluded_from_scoring must be a list of strings"}), 400
            act_settings["excluded_from_scoring"] = ex
        settings["activity"] = act_settings

    # --- workspace fields (global) ---
    if "workspaces" in data:
        ws = data["workspaces"]
        if not isinstance(ws, dict):
            return jsonify({"error": "workspaces must be an object"}), 400
        for k, v in ws.items():
            if not isinstance(k, str) or not isinstance(v, str):
                return jsonify({"error": "workspaces must be {name: path} strings"}), 400
        settings["workspaces"] = ws
    if "default_workspace" in data:
        dw = data["default_workspace"]
        if not isinstance(dw, str):
            return jsonify({"error": "default_workspace must be a string"}), 400
        ws = settings.get("workspaces", {})
        if dw not in ws:
            return jsonify({"error": f'default_workspace "{dw}" not in workspaces'}), 400
        settings["default_workspace"] = dw

    save_settings(settings, workspace)
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


# --- Workspace CRUD endpoints ---


@bp.route("/api/workspaces", methods=["POST"])
def create_workspace():
    """Add a workspace. Body: {"name": "...", "path": "..."}."""
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    # Accept both "path" (new) and "vault_path" (legacy) field names
    project_path = data.get("path", "").strip() or data.get("vault_path", "").strip()

    ok, err = add_workspace(name, project_path)
    if not ok:
        return jsonify({"error": err}), 400
    return jsonify({"ok": True, "workspace": name})


@bp.route("/api/workspaces/<name>", methods=["DELETE"])
def delete_workspace(name):
    """Remove a workspace by name."""
    ok, err = remove_workspace(name)
    if not ok:
        return jsonify({"error": err}), 400
    return jsonify({"ok": True})


@bp.route("/api/workspaces/default", methods=["POST"])
def update_default_workspace():
    """Set the default workspace. Body: {"name": "..."}."""
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()

    ok, err = set_default_workspace(name)
    if not ok:
        return jsonify({"error": err}), 400
    return jsonify({"ok": True, "default_workspace": name})
