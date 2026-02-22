"""Tests for services/access.py — SQLite access tracking and score computation."""

import time
from unittest.mock import patch

import pytest

import services.access as access_mod


@pytest.fixture(autouse=True)
def isolated_db(tmp_path):
    """Redirect the DB to a temp directory for every test."""
    db_path = tmp_path / "data" / "access.db"
    with patch.object(access_mod, "_DB_PATH", db_path):
        yield db_path


# ---------------------------------------------------------------------------
# record_access
# ---------------------------------------------------------------------------


def test_record_access_creates_entry():
    access_mod.record_access("daily/note.md")
    result = access_mod.get_activity_scores(limit=10)
    assert len(result) == 1
    assert result[0]["path"] == "daily/note.md"
    assert result[0]["open_count"] == 1


def test_record_access_increments_count():
    for _ in range(3):
        access_mod.record_access("daily/note.md")
    result = access_mod.get_activity_scores(limit=10)
    assert result[0]["open_count"] == 3


def test_record_access_multiple_files():
    access_mod.record_access("a.md")
    access_mod.record_access("b.md")
    result = access_mod.get_activity_scores(limit=10)
    paths = {r["path"] for r in result}
    assert paths == {"a.md", "b.md"}


# ---------------------------------------------------------------------------
# get_score
# ---------------------------------------------------------------------------


def test_get_score_never_opened():
    score = access_mod.get_score("nonexistent.md")
    assert score == 0.0


def test_get_score_just_opened():
    access_mod.record_access("fresh.md")
    score = access_mod.get_score("fresh.md")
    # Just opened: recency ≈ 1.0, boost = log2(2) = 1.0, recency_window = 1.0 → score ≈ 1.0
    assert 0.9 < score <= 2.1  # within reasonable bounds


def test_get_score_old_file():
    """A file opened 30 days ago should have a very low score."""
    thirty_days_ago = time.time() - 30 * 86400
    access_mod.record_access("old.md")
    # Manually update last_opened to simulate old access
    con = access_mod._conn()
    con.execute(
        "UPDATE file_access SET last_opened = ? WHERE path = ?", (thirty_days_ago, "old.md")
    )
    con.commit()
    con.close()

    score = access_mod.get_score("old.md")
    # e^(-30/7) ≈ 0.0134, × 1.0 (boost) × 0.5 (>48h) ≈ 0.0067
    assert score < 0.05


def test_get_score_custom_params():
    access_mod.record_access("x.md")
    # With a 1-day half-life and just-opened, score should still be < max_boost
    score = access_mod.get_score("x.md", half_life_days=1.0, max_boost=3.0)
    assert 0.0 < score <= 3.0


# ---------------------------------------------------------------------------
# get_activity_scores — ordering and limit
# ---------------------------------------------------------------------------


def test_activity_scores_sorted_by_score():
    """Higher open count should produce a higher score (all opened just now)."""
    access_mod.record_access("low.md")  # count=1
    for _ in range(10):
        access_mod.record_access("high.md")  # count=10

    results = access_mod.get_activity_scores(limit=10)
    paths = [r["path"] for r in results]
    assert paths[0] == "high.md"


def test_activity_scores_respects_limit():
    for i in range(10):
        access_mod.record_access(f"file{i}.md")

    results = access_mod.get_activity_scores(limit=3)
    assert len(results) == 3


def test_activity_scores_returns_required_fields():
    access_mod.record_access("z.md")
    result = access_mod.get_activity_scores(limit=1)[0]
    assert "path" in result
    assert "open_count" in result
    assert "last_opened" in result
    assert "score" in result


# ---------------------------------------------------------------------------
# get_scores_for_paths
# ---------------------------------------------------------------------------


def test_get_scores_for_paths_empty():
    result = access_mod.get_scores_for_paths([])
    assert result == {}


def test_get_scores_for_paths_returns_known():
    access_mod.record_access("a.md")
    access_mod.record_access("b.md")
    result = access_mod.get_scores_for_paths(["a.md", "b.md", "never.md"])
    assert "a.md" in result
    assert "b.md" in result
    # "never.md" was never opened — not in result dict
    assert "never.md" not in result


def test_get_scores_for_paths_score_structure():
    access_mod.record_access("q.md")
    result = access_mod.get_scores_for_paths(["q.md"])
    entry = result["q.md"]
    assert "score" in entry
    assert "open_count" in entry
    assert "last_opened" in entry
    assert entry["open_count"] == 1
