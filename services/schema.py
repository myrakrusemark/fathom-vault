"""Vault frontmatter schema and validation (V-1)."""

VAULT_SCHEMA = {
    "title":   {"type": str,  "required": True},
    "date":    {"type": str,  "required": True},    # ISO: YYYY-MM-DD
    "tags":    {"type": list, "required": False, "default": []},
    "status":  {"type": str,  "required": False},   # draft | published | archived
    "project": {"type": str,  "required": False},   # navier-stokes | memento | personal | etc.
    "aliases": {"type": list, "required": False, "default": []},
}

VALID_STATUSES = {"draft", "published", "archived"}


def validate_frontmatter(fm: dict) -> list[str]:
    """Return list of validation errors. Empty list means valid."""
    errors = []

    for field, spec in VAULT_SCHEMA.items():
        value = fm.get(field)
        if spec.get("required") and value is None:
            errors.append(f"Missing required field: {field!r}")
            continue
        if value is not None and not isinstance(value, spec["type"]):
            expected = spec["type"].__name__
            got = type(value).__name__
            errors.append(f"Field {field!r} must be {expected}, got {got}")

    status = fm.get("status")
    if status is not None and status not in VALID_STATUSES:
        errors.append(f"Field 'status' must be one of {sorted(VALID_STATUSES)}, got {status!r}")

    return errors
