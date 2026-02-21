"""Wikilink parsing and index building (V-3)."""

import os
import re

from config import VAULT_DIR

WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


def _normalize(name: str) -> str:
    """Normalize a wikilink name for fuzzy matching: lowercase, spaces→hyphens."""
    return name.lower().replace(" ", "-")


def find_file(name: str) -> str | None:
    """Find a vault file matching a wikilink name. Returns relative path or None.

    Matches by filename stem (without .md). Supports 'folder/stem' paths too.
    Normalizes case and spaces-vs-hyphens so [[On Restraint]] finds on-restraint.md.
    """
    # Strip .md if caller included it
    if name.endswith(".md"):
        name = name[:-3]

    # Check if name includes a path separator — try direct resolve first
    if "/" in name or os.sep in name:
        candidates = [name + ".md", name]
        for candidate in candidates:
            abs_path = os.path.join(VAULT_DIR, candidate)
            if os.path.isfile(abs_path):
                return candidate.replace(os.sep, "/")

    # Walk vault looking for stem match (normalized: case-insensitive, space≈hyphen)
    norm_name = _normalize(name)
    for root, dirs, files in os.walk(VAULT_DIR):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for fname in files:
            if not fname.endswith(".md"):
                continue
            stem = os.path.splitext(fname)[0]
            if _normalize(stem) == norm_name:
                rel_root = os.path.relpath(root, VAULT_DIR)
                if rel_root == ".":
                    return fname
                return os.path.join(rel_root, fname).replace(os.sep, "/")

    return None


def _extract_links(content: str) -> list[str]:
    """Extract raw wikilink targets from markdown content."""
    raw = WIKILINK_RE.findall(content)
    targets = []
    for match in raw:
        # Support [[Target|Display text]] — take only the target part
        target = match.split("|")[0].strip()
        if target:
            targets.append(target)
    return targets


def build_link_index() -> dict[str, list[str]]:
    """Return {rel_path: [resolved_rel_paths]} — forward link index for all .md files."""
    index: dict[str, list[str]] = {}

    for root, dirs, files in os.walk(VAULT_DIR):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for fname in files:
            if not fname.endswith(".md"):
                continue
            abs_path = os.path.join(root, fname)
            rel_root = os.path.relpath(root, VAULT_DIR)
            rel_path = fname if rel_root == "." else os.path.join(rel_root, fname).replace(os.sep, "/")

            try:
                with open(abs_path) as f:
                    content = f.read()
                targets = _extract_links(content)
                resolved = []
                for target in targets:
                    found = find_file(target)
                    if found and found != rel_path:
                        resolved.append(found)
                index[rel_path] = resolved
            except Exception:
                index[rel_path] = []

    return index


def get_file_links(rel_path: str) -> dict:
    """Return forward links and backlinks for a specific vault file."""
    index = build_link_index()
    forward = index.get(rel_path, [])
    backlinks = sorted(src for src, targets in index.items() if rel_path in targets)
    return {
        "path": rel_path,
        "forward_links": forward,
        "backlinks": backlinks,
    }
