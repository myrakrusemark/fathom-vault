"""Vault browser endpoints: tree, folder listing, file read/write, raw image serving, search."""

import glob
import os
import re
import subprocess
from datetime import datetime

from flask import Blueprint, jsonify, request, send_from_directory

from config import IMAGE_EXTENSIONS, VAULT_DIR
from services.links import find_file, get_file_links
from services.settings import load_settings
from services.vault import append_file, list_folder, read_file, write_file

bp = Blueprint("vault", __name__)


def _scan_tree(path: str, prefix: str = "") -> list[dict]:
    """Recursively scan vault directory for folder tree."""
    items = []
    try:
        for entry in os.scandir(path):
            if entry.is_dir() and not entry.name.startswith("."):
                rel_path = os.path.join(prefix, entry.name) if prefix else entry.name
                md_files = glob.glob(os.path.join(entry.path, "*.md"))
                image_files = []
                for ext in IMAGE_EXTENSIONS:
                    image_files.extend(glob.glob(os.path.join(entry.path, f"*{ext}")))
                all_files = md_files + image_files
                mtime = max((os.path.getmtime(f) for f in all_files), default=0)
                children = _scan_tree(entry.path, rel_path)
                items.append(
                    {
                        "name": entry.name,
                        "path": rel_path,
                        "file_count": len(md_files),
                        "image_count": len(image_files),
                        "last_modified": (
                            datetime.fromtimestamp(mtime).isoformat() if mtime else None
                        ),
                        "children": children,
                    }
                )
    except PermissionError:
        pass
    return sorted(items, key=lambda x: x["name"])


@bp.route("/api/vault")
def vault_tree():
    """Folder tree — recursive, md + image counts."""
    try:
        root_md = glob.glob(os.path.join(VAULT_DIR, "*.md"))
        root_img = []
        for ext in IMAGE_EXTENSIONS:
            root_img.extend(glob.glob(os.path.join(VAULT_DIR, f"*{ext}")))

        tree = _scan_tree(VAULT_DIR)

        if root_md or root_img:
            all_root = root_md + root_img
            mtime = max((os.path.getmtime(f) for f in all_root), default=0)
            tree.insert(
                0,
                {
                    "name": "(root)",
                    "path": "",
                    "file_count": len(root_md),
                    "image_count": len(root_img),
                    "last_modified": (
                        datetime.fromtimestamp(mtime).isoformat() if mtime else None
                    ),
                    "children": [],
                },
            )

        return jsonify(tree)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/vault/folder/", defaults={"folder_path": ""})
@bp.route("/api/vault/folder/<path:folder_path>")
def vault_folder(folder_path):
    """Files in a folder (title, date, tags, preview). Supports nested paths."""
    result = list_folder(folder_path)
    if "error" in result:
        code = 404 if result["error"] in ("Folder not found",) else 400
        return jsonify(result), code
    return jsonify(result)


@bp.route("/api/vault/file/<path:rel_path>", methods=["GET"])
def vault_file_get(rel_path):
    """File content + parsed frontmatter."""
    result = read_file(rel_path)
    if "error" in result:
        code = 404 if result["error"] == "File not found" else 400
        return jsonify(result), code
    return jsonify(result)


@bp.route("/api/vault/file/<path:rel_path>", methods=["POST"])
def vault_file_post(rel_path):
    """Write (create/overwrite) a vault file."""
    data = request.get_json(silent=True) or {}
    content = data.get("content", "")
    if not isinstance(content, str):
        return jsonify({"error": "content must be a string"}), 400

    result = write_file(rel_path, content)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@bp.route("/api/vault/append/<path:rel_path>", methods=["POST"])
def vault_append(rel_path):
    """Append a content block to a vault file (creates if absent)."""
    data = request.get_json(silent=True) or {}
    content = data.get("content", "")
    if not isinstance(content, str):
        return jsonify({"error": "content must be a string"}), 400

    result = append_file(rel_path, content)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@bp.route("/api/vault/links/<path:rel_path>")
def vault_links(rel_path):
    """Forward links and backlinks for a vault file (V-3/V-6)."""
    result = get_file_links(rel_path)
    return jsonify(result)


@bp.route("/api/vault/resolve")
def vault_resolve():
    """Resolve a wikilink name to its full relative path (V-5)."""
    name = request.args.get("name", "").strip()
    if not name:
        return jsonify({"error": "name parameter required"}), 400
    path = find_file(name)
    if path:
        return jsonify({"path": path})
    return jsonify({"error": f"Not found: {name}"}), 404


@bp.route("/api/vault/raw/<path:rel_path>")
def vault_raw(rel_path):
    """Serve raw file (images). Validates path stays within VAULT_DIR."""
    abs_path = os.path.realpath(os.path.join(VAULT_DIR, rel_path))
    vault_real = os.path.realpath(VAULT_DIR)
    if abs_path != vault_real and not abs_path.startswith(vault_real + os.sep):
        return jsonify({"error": "Invalid path"}), 403
    if not os.path.isfile(abs_path):
        return jsonify({"error": "File not found"}), 404

    directory = os.path.dirname(abs_path)
    filename = os.path.basename(abs_path)
    return send_from_directory(directory, filename, as_attachment=False)


# --- Search ---

# Pattern: "qmd://collection/path/file.md:line #color"
_QMD_HEADER_RE = re.compile(r"^qmd://[^/]+/(.+?):\d+\s+#[0-9a-f]+$")
_TITLE_RE = re.compile(r"^Title:\s+(.+)$")
_SCORE_RE = re.compile(r"^Score:\s+(\d+)%$")
_CONTEXT_RE = re.compile(r"^@@\s+")


def _parse_qmd_query_output(output: str) -> list[dict]:
    """Parse qmd query/search rich output into structured results.

    Each result block looks like:
        qmd://collection/path/file.md:line #color
        Title: The Title
        Score: NN%

        @@ -start,count @@ (N before, N after)
        excerpt lines...
    """
    results = []
    current = None

    for line in output.splitlines():
        header_match = _QMD_HEADER_RE.match(line)
        if header_match:
            if current:
                current["excerpt"] = current["excerpt"].strip()
                results.append(current)
            current = {
                "file": header_match.group(1),
                "title": "",
                "score": 0,
                "excerpt": "",
            }
            continue

        if current is None:
            continue

        title_match = _TITLE_RE.match(line)
        if title_match:
            current["title"] = title_match.group(1)
            continue

        score_match = _SCORE_RE.match(line)
        if score_match:
            current["score"] = int(score_match.group(1))
            continue

        if _CONTEXT_RE.match(line):
            continue

        if line.strip():
            current["excerpt"] += line + " "

    if current:
        current["excerpt"] = current["excerpt"].strip()
        results.append(current)

    return results


@bp.route("/api/vault/search")
def vault_search():
    """Full-text search via qmd. Reads settings for defaults; accepts override params.

    Query params (all optional — fall back to settings when absent):
        q        Search query string (required).
        n        Result limit override (int).
        mode     Search mode override: "hybrid" or "keyword".
        timeout  Timeout override in seconds (int).

    Response: {"results": [...], "excluded": N}
        excluded — number of results filtered by excluded_dirs setting.
    """
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": [], "excluded": 0})

    settings = load_settings()
    mcp = settings["mcp"]
    excluded_dirs = settings["background_index"].get("excluded_dirs", [])

    # Resolve params: query params override settings
    n_param = request.args.get("n")
    mode_param = request.args.get("mode")
    timeout_param = request.args.get("timeout")

    try:
        n = int(n_param) if n_param is not None else mcp["search_results"]
    except (ValueError, TypeError):
        n = mcp["search_results"]

    mode = mode_param if mode_param in ("hybrid", "keyword") else mcp["search_mode"]

    try:
        timeout = int(timeout_param) if timeout_param is not None else mcp["query_timeout_seconds"]
    except (ValueError, TypeError):
        timeout = mcp["query_timeout_seconds"]

    # "keyword" mode uses qmd search (BM25 only); "hybrid" uses qmd query (BM25 + vector)
    if mode == "keyword":
        cmd = ["qmd", "search", q, "-n", str(n)]
    else:
        cmd = ["qmd", "query", q, "-n", str(n)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        parsed = _parse_qmd_query_output(result.stdout)

        # Post-filter: remove results whose path starts with any excluded dir
        if excluded_dirs:
            before = len(parsed)
            parsed = [
                r for r in parsed
                if not any(
                    r["file"] == ex.rstrip("/") or r["file"].startswith(ex.rstrip("/") + "/")
                    for ex in excluded_dirs
                )
            ]
            excluded_count = before - len(parsed)
        else:
            excluded_count = 0

        return jsonify({"results": parsed, "excluded": excluded_count})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Search timed out"}), 504
    except FileNotFoundError:
        return jsonify({"error": "qmd not found on PATH"}), 500
