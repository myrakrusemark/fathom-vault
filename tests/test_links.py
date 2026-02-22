"""Unit tests for wikilink parsing and index building (V-3)."""

from unittest.mock import patch

import pytest

from services.links import _extract_links, find_file, get_file_links


@pytest.fixture()
def tmp_vault(tmp_path):
    """Temp vault with a small set of interlinked files."""
    reflections = tmp_path / "reflections"
    reflections.mkdir()
    daily = tmp_path / "daily"
    daily.mkdir()

    (reflections / "on-identity.md").write_text(
        "---\ntitle: On Identity\ndate: 2026-01-29\n---\n\n"
        "See also [[on-consciousness]] and [[daily/heartbeat]].\n"
    )
    (reflections / "on-consciousness.md").write_text(
        "---\ntitle: On Consciousness\ndate: 2026-02-01\n---\n\nLinks back to [[on-identity]].\n"
    )
    (daily / "heartbeat.md").write_text(
        "---\ntitle: Heartbeat\ndate: 2026-02-19\n---\n\nNo wikilinks here.\n"
    )

    with patch("services.links.VAULT_DIR", str(tmp_path)):
        yield tmp_path


# ---------------------------------------------------------------------------
# _extract_links
# ---------------------------------------------------------------------------


def test_extract_links_basic():
    links = _extract_links("See [[foo]] and [[bar]].")
    assert links == ["foo", "bar"]


def test_extract_links_with_display():
    links = _extract_links("See [[target|Display Text]].")
    assert links == ["target"]


def test_extract_links_none():
    assert _extract_links("No links here.") == []


def test_extract_links_multiple_occurrences():
    """extract_links returns all occurrences — dedup is caller's responsibility."""
    links = _extract_links("[[a]] and [[a]] again.")
    assert links == ["a", "a"]


# ---------------------------------------------------------------------------
# find_file
# ---------------------------------------------------------------------------


def test_find_file_by_stem(tmp_vault):
    result = find_file("on-identity")
    assert result == "reflections/on-identity.md"


def test_find_file_with_md_extension(tmp_vault):
    result = find_file("on-consciousness.md")
    assert result == "reflections/on-consciousness.md"


def test_find_file_nested(tmp_vault):
    result = find_file("heartbeat")
    assert result == "daily/heartbeat.md"


def test_find_file_not_found(tmp_vault):
    result = find_file("nonexistent-file")
    assert result is None


# ---------------------------------------------------------------------------
# get_file_links
# ---------------------------------------------------------------------------


def test_get_file_links_forward(tmp_vault):
    result = get_file_links("reflections/on-identity.md")
    assert "reflections/on-consciousness.md" in result["forward_links"]
    assert "daily/heartbeat.md" in result["forward_links"]


def test_get_file_links_backlinks(tmp_vault):
    result = get_file_links("reflections/on-consciousness.md")
    assert "reflections/on-identity.md" in result["backlinks"]


def test_get_file_links_no_outbound(tmp_vault):
    result = get_file_links("daily/heartbeat.md")
    assert result["forward_links"] == []
    # heartbeat is linked from on-identity
    assert "reflections/on-identity.md" in result["backlinks"]


def test_get_file_links_path_returned(tmp_vault):
    result = get_file_links("reflections/on-identity.md")
    assert result["path"] == "reflections/on-identity.md"
