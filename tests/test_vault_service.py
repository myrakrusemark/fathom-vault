"""Unit tests for vault service: read/write/append/validate."""

from unittest.mock import patch

import pytest

from services.schema import validate_frontmatter
from services.vault import append_file, parse_frontmatter, read_file, write_file

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_MD = """\
---
title: Test Note
date: 2026-02-19
tags:
  - test
status: draft
---

Body content here.
"""


@pytest.fixture()
def tmp_vault(tmp_path):
    """Patch VAULT_DIR to a temp directory for isolated tests."""
    with patch("services.vault.VAULT_DIR", str(tmp_path)):
        yield tmp_path


# ---------------------------------------------------------------------------
# parse_frontmatter
# ---------------------------------------------------------------------------


def test_parse_frontmatter_with_fm():
    fm, body = parse_frontmatter(SAMPLE_MD)
    assert fm["title"] == "Test Note"
    assert fm["date"] == "2026-02-19"
    assert fm["tags"] == ["test"]
    assert fm["status"] == "draft"
    assert "Body content here." in body


def test_parse_frontmatter_no_fm():
    fm, body = parse_frontmatter("No frontmatter here.\n")
    assert fm == {}
    assert "No frontmatter here." in body


def test_parse_frontmatter_unclosed():
    content = "---\ntitle: Oops\nNo closing delimiter\n"
    fm, body = parse_frontmatter(content)
    assert fm == {}
    assert body == content


# ---------------------------------------------------------------------------
# validate_frontmatter
# ---------------------------------------------------------------------------


def test_validate_ok():
    errors = validate_frontmatter({"title": "Hello", "date": "2026-01-01"})
    assert errors == []


def test_validate_missing_required():
    errors = validate_frontmatter({"title": "Hello"})  # missing date
    assert any("date" in e for e in errors)


def test_validate_wrong_type():
    errors = validate_frontmatter({"title": 42, "date": "2026-01-01"})
    assert any("title" in e for e in errors)


def test_validate_bad_status():
    errors = validate_frontmatter({"title": "X", "date": "2026-01-01", "status": "unknown"})
    assert any("status" in e for e in errors)


def test_validate_valid_statuses():
    for status in ("draft", "published", "archived"):
        errors = validate_frontmatter({"title": "X", "date": "2026-01-01", "status": status})
        assert errors == [], f"Expected no errors for status={status!r}"


# ---------------------------------------------------------------------------
# read_file
# ---------------------------------------------------------------------------


def test_read_file_happy(tmp_vault):
    (tmp_vault / "note.md").write_text(SAMPLE_MD)
    result = read_file("note.md")
    assert "error" not in result
    assert result["frontmatter"]["title"] == "Test Note"
    assert "Body content here." in result["body"]


def test_read_file_not_found(tmp_vault):
    result = read_file("nonexistent.md")
    assert "error" in result


def test_read_file_traversal(tmp_vault):
    result = read_file("../../../etc/passwd")
    assert "error" in result


# ---------------------------------------------------------------------------
# write_file
# ---------------------------------------------------------------------------


def test_write_file_happy(tmp_vault):
    content = "---\ntitle: New Note\ndate: 2026-02-19\n---\n\nHello.\n"
    result = write_file("new.md", content)
    assert result.get("ok") is True
    assert (tmp_vault / "new.md").read_text() == content


def test_write_file_invalid_frontmatter(tmp_vault):
    content = "---\ndate: 2026-02-19\n---\n\nMissing title.\n"
    result = write_file("bad.md", content)
    assert "error" in result
    assert "validation_errors" in result


def test_write_file_no_frontmatter(tmp_vault):
    """Files without frontmatter are written without validation."""
    content = "Plain markdown, no frontmatter.\n"
    result = write_file("plain.md", content)
    assert result.get("ok") is True


def test_write_file_traversal(tmp_vault):
    result = write_file("../../../tmp/evil.md", "# Evil\n")
    assert "error" in result


# ---------------------------------------------------------------------------
# append_file
# ---------------------------------------------------------------------------


def test_append_creates_file(tmp_vault):
    result = append_file("new-note.md", "## Section\n\nContent.")
    assert result.get("ok") is True
    assert result.get("created") is True
    text = (tmp_vault / "new-note.md").read_text()
    assert "## Section" in text
    assert "title: New Note" in text  # auto-generated frontmatter


def test_append_to_existing(tmp_vault):
    (tmp_vault / "existing.md").write_text(SAMPLE_MD)
    result = append_file("existing.md", "## Appended\n\nNew content.")
    assert result.get("ok") is True
    assert result.get("created") is False
    text = (tmp_vault / "existing.md").read_text()
    assert "## Appended" in text
    assert "Body content here." in text  # original preserved
