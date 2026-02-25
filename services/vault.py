"""Vault file operations: read, write, append, frontmatter."""

import os
from datetime import date, datetime

import yaml

from config import IMAGE_EXTENSIONS, VAULT_DIR
from services.schema import validate_frontmatter


def _safe_path(rel_path: str, vault_dir: str = None) -> tuple[str, str | None]:
    """Resolve and validate that path stays within vault_dir. Returns (abs_path, error)."""
    vault_dir = vault_dir or VAULT_DIR
    abs_path = os.path.realpath(os.path.join(vault_dir, rel_path))
    vault_real = os.path.realpath(vault_dir)
    if abs_path != vault_real and not abs_path.startswith(vault_real + os.sep):
        return abs_path, "Path traversal detected"
    return abs_path, None


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Extract YAML frontmatter and body from file content."""
    if not content.startswith("---"):
        return {}, content

    lines = content.split("\n")
    end_idx = None
    for i, line in enumerate(lines[1:], 1):
        if line.strip() == "---":
            end_idx = i
            break

    if end_idx is None:
        return {}, content

    try:
        raw = yaml.safe_load("\n".join(lines[1:end_idx])) or {}
        # Coerce datetime.date / datetime.datetime to ISO strings so downstream
        # code always sees plain strings for date fields.
        import datetime as _dt

        frontmatter = {
            k: v.isoformat() if isinstance(v, _dt.date | _dt.datetime) else v
            for k, v in raw.items()
        }
        body = "\n".join(lines[end_idx + 1 :]).lstrip("\n")
        return frontmatter, body
    except yaml.YAMLError:
        return {}, content


def list_folder(folder_path: str = "", vault_dir: str = None) -> dict:
    """List markdown and image files in a vault folder. Returns {folder, files} or {error}."""
    vault_dir = vault_dir or VAULT_DIR
    abs_folder = os.path.join(vault_dir, folder_path) if folder_path else vault_dir
    abs_folder = os.path.realpath(abs_folder)
    vault_real = os.path.realpath(vault_dir)

    if abs_folder != vault_real and not abs_folder.startswith(vault_real + os.sep):
        return {"error": "Path traversal detected"}
    if not os.path.isdir(abs_folder):
        return {"error": "Folder not found"}

    files = []
    try:
        for fname in os.listdir(abs_folder):
            fpath = os.path.join(abs_folder, fname)
            if not os.path.isfile(fpath):
                continue
            stat = os.stat(fpath)
            ext = os.path.splitext(fname)[1].lower()

            if fname.endswith(".md"):
                fm: dict = {}
                preview = ""
                try:
                    with open(fpath) as f:
                        raw = f.read()
                    fm, body = parse_frontmatter(raw)
                    # Preview: first non-empty, non-header, non-frontmatter line
                    for line in body.splitlines():
                        line = line.strip()
                        if line and not line.startswith("#"):
                            preview = line[:120]
                            break
                except Exception:
                    pass

                files.append(
                    {
                        "name": fname,
                        "type": "markdown",
                        "title": fm.get("title", fname),
                        "date": fm.get("date"),
                        "tags": fm.get("tags") or [],
                        "status": fm.get("status"),
                        "project": fm.get("project"),
                        "preview": preview,
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "size": stat.st_size,
                    }
                )
            elif ext in IMAGE_EXTENSIONS:
                files.append(
                    {
                        "name": fname,
                        "type": "image",
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "size": stat.st_size,
                    }
                )

        files.sort(key=lambda x: x["modified"], reverse=True)
        return {"folder": folder_path or "(root)", "files": files}
    except Exception as e:
        return {"error": str(e)}


def read_file(rel_path: str, vault_dir: str = None) -> dict:
    """Read a vault file. Returns {path, content, frontmatter, body, modified, size} or {error}."""
    abs_path, err = _safe_path(rel_path, vault_dir)
    if err:
        return {"error": err}
    if not os.path.isfile(abs_path):
        return {"error": "File not found"}

    try:
        with open(abs_path) as f:
            content = f.read()
        stat = os.stat(abs_path)
        fm, body = parse_frontmatter(content)
        return {
            "path": rel_path,
            "content": content,
            "frontmatter": fm,
            "body": body,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "size": stat.st_size,
        }
    except Exception as e:
        return {"error": str(e)}


def write_file(rel_path: str, content: str, vault_dir: str = None) -> dict:
    """Write content to a vault file. Validates frontmatter if present. Returns {ok} or {error}."""
    abs_path, err = _safe_path(rel_path, vault_dir)
    if err:
        return {"error": err}

    fm, _ = parse_frontmatter(content)
    if fm:
        errors = validate_frontmatter(fm)
        if errors:
            return {"error": "Frontmatter validation failed", "validation_errors": errors}

    try:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w") as f:
            f.write(content)
        return {"ok": True, "path": rel_path}
    except Exception as e:
        return {"error": str(e)}


def append_file(rel_path: str, content: str, vault_dir: str = None) -> dict:
    """Append content to a vault file. Creates with minimal frontmatter if absent."""
    abs_path, err = _safe_path(rel_path, vault_dir)
    if err:
        return {"error": err}

    created = not os.path.isfile(abs_path)

    try:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        if created:
            today = date.today().isoformat()
            title = os.path.splitext(os.path.basename(rel_path))[0].replace("-", " ").title()
            initial = f"---\ntitle: {title}\ndate: {today}\n---\n\n{content}\n"
            with open(abs_path, "w") as f:
                f.write(initial)
        else:
            with open(abs_path, "a") as f:
                f.write("\n" + content + "\n")
        return {"ok": True, "path": rel_path, "created": created}
    except Exception as e:
        return {"error": str(e)}
