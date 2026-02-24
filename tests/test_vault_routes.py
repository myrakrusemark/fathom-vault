"""Integration tests for vault API routes."""

import subprocess
from unittest.mock import MagicMock, patch

import pytest

from app import app
from routes.vault import _parse_qmd_query_output

# ---------------------------------------------------------------------------
# Shared sample content
# ---------------------------------------------------------------------------

SAMPLE_MD = "---\ntitle: Test Note\ndate: 2026-01-01\n---\n\nBody text.\n"

FAKE_SETTINGS = {
    "background_index": {"excluded_dirs": []},
    "mcp": {
        "query_timeout_seconds": 10,
        "search_results": 10,
        "search_mode": "hybrid",
    },
    "activity": {
        "decay_halflife_days": 7,
        "recency_window_hours": 48,
        "max_access_boost": 2.0,
        "excluded_from_scoring": ["daily"],
    },
}


@pytest.fixture()
def client(tmp_path):
    """Flask test client with VAULT_DIR and external services patched to temp directory."""
    vault_dir = str(tmp_path)
    with (
        patch("routes.vault.VAULT_DIR", vault_dir),
        patch("services.vault.VAULT_DIR", vault_dir),
        patch("services.links.VAULT_DIR", vault_dir),
        patch("routes.vault.get_activity_scores", return_value=[]),
        patch("routes.vault.get_scores_for_paths", return_value={}),
        patch("routes.vault.record_access"),
        patch("routes.vault.load_settings", return_value=FAKE_SETTINGS),
    ):
        app.config["TESTING"] = True
        yield tmp_path, app.test_client()


# ---------------------------------------------------------------------------
# _parse_qmd_query_output — pure function, no fixtures
# ---------------------------------------------------------------------------


def test_parse_empty_output():
    assert _parse_qmd_query_output("") == []


def test_parse_single_result():
    output = (
        "qmd://collection/thinking/note.md:1 #abc123\n"
        "Title: My Note\n"
        "Score: 85%\n"
        "\n"
        "@@ -1,3 @@ (1 before, 1 after)\n"
        "Some excerpt text here\n"
    )
    results = _parse_qmd_query_output(output)
    assert len(results) == 1
    assert results[0]["file"] == "thinking/note.md"
    assert results[0]["title"] == "My Note"
    assert results[0]["score"] == 85
    assert "Some excerpt text here" in results[0]["excerpt"]


def test_parse_multiple_results():
    output = (
        "qmd://collection/a.md:1 #aaa\n"
        "Title: First\n"
        "Score: 90%\n"
        "\n"
        "Some text\n"
        "qmd://collection/b.md:5 #bbb\n"
        "Title: Second\n"
        "Score: 75%\n"
        "\n"
        "Other text\n"
    )
    results = _parse_qmd_query_output(output)
    assert len(results) == 2
    assert results[0]["file"] == "a.md"
    assert results[1]["file"] == "b.md"
    assert results[0]["score"] == 90
    assert results[1]["score"] == 75


def test_parse_skips_context_header_lines():
    output = (
        "qmd://collection/note.md:1 #aaa\n"
        "Title: Test\n"
        "Score: 60%\n"
        "\n"
        "@@ -1,3 @@ (1 before, 1 after)\n"
        "real excerpt\n"
    )
    results = _parse_qmd_query_output(output)
    assert "@@ " not in results[0]["excerpt"]


def test_parse_result_with_nested_path():
    output = (
        "qmd://vault/research/navier-stokes/deep.md:10 #ff0000\n"
        "Title: NS Deep\n"
        "Score: 77%\n"
        "\n"
        "Some math content\n"
    )
    results = _parse_qmd_query_output(output)
    assert results[0]["file"] == "research/navier-stokes/deep.md"


# ---------------------------------------------------------------------------
# GET /api/vault — folder tree
# ---------------------------------------------------------------------------


def test_vault_tree_empty_vault(client):
    _, c = client
    resp = c.get("/api/vault")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)


def test_vault_tree_with_subfolder(client):
    tmp_path, c = client
    subdir = tmp_path / "thinking"
    subdir.mkdir()
    (subdir / "note.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault")
    data = resp.get_json()
    names = [d["name"] for d in data]
    assert "thinking" in names


def test_vault_tree_subfolder_has_file_count(client):
    tmp_path, c = client
    subdir = tmp_path / "thinking"
    subdir.mkdir()
    (subdir / "one.md").write_text(SAMPLE_MD)
    (subdir / "two.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault")
    data = resp.get_json()
    thinking = next(d for d in data if d["name"] == "thinking")
    assert thinking["file_count"] == 2


def test_vault_tree_root_files_appear_as_root_folder(client):
    tmp_path, c = client
    (tmp_path / "root-note.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault")
    data = resp.get_json()
    names = [d["name"] for d in data]
    assert "(root)" in names


def test_vault_tree_hides_dot_folders(client):
    tmp_path, c = client
    (tmp_path / ".hidden").mkdir()

    resp = c.get("/api/vault")
    data = resp.get_json()
    names = [d["name"] for d in data]
    assert ".hidden" not in names


def test_vault_tree_nested_children(client):
    tmp_path, c = client
    parent = tmp_path / "research"
    parent.mkdir()
    child = parent / "sub"
    child.mkdir()
    (child / "paper.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault")
    data = resp.get_json()
    research = next(d for d in data if d["name"] == "research")
    assert len(research["children"]) == 1
    assert research["children"][0]["name"] == "sub"


# ---------------------------------------------------------------------------
# GET /api/vault/folder/<path>
# ---------------------------------------------------------------------------


def test_vault_folder_not_found(client):
    _, c = client
    resp = c.get("/api/vault/folder/nonexistent")
    assert resp.status_code == 404


def test_vault_folder_returns_files(client):
    tmp_path, c = client
    folder = tmp_path / "thinking"
    folder.mkdir()
    (folder / "note.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault/folder/thinking")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "files" in data
    names = [f["name"] for f in data["files"]]
    assert "note.md" in names


def test_vault_folder_includes_activity_scores(client):
    tmp_path, c = client
    folder = tmp_path / "thinking"
    folder.mkdir()
    (folder / "note.md").write_text(SAMPLE_MD)

    with patch(
        "routes.vault.get_scores_for_paths",
        return_value={"thinking/note.md": {"score": 1.5, "open_count": 3, "last_opened": None}},
    ):
        resp = c.get("/api/vault/folder/thinking")

    data = resp.get_json()
    note = next(f for f in data["files"] if f["name"] == "note.md")
    assert note["activity_score"] == 1.5
    assert note["open_count"] == 3


def test_vault_folder_nested_path(client):
    tmp_path, c = client
    nested = tmp_path / "research" / "sub"
    nested.mkdir(parents=True)
    (nested / "paper.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault/folder/research/sub")
    assert resp.status_code == 200
    data = resp.get_json()
    names = [f["name"] for f in data["files"]]
    assert "paper.md" in names


# ---------------------------------------------------------------------------
# GET /api/vault/file/<path>
# ---------------------------------------------------------------------------


def test_vault_file_get_happy(client):
    tmp_path, c = client
    (tmp_path / "test.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault/file/test.md")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["frontmatter"]["title"] == "Test Note"
    assert "Body text." in data["body"]


def test_vault_file_get_not_found(client):
    _, c = client
    resp = c.get("/api/vault/file/missing.md")
    assert resp.status_code == 404


def test_vault_file_get_in_subfolder(client):
    tmp_path, c = client
    sub = tmp_path / "thinking"
    sub.mkdir()
    (sub / "note.md").write_text(SAMPLE_MD)

    resp = c.get("/api/vault/file/thinking/note.md")
    assert resp.status_code == 200
    assert resp.get_json()["frontmatter"]["title"] == "Test Note"


# ---------------------------------------------------------------------------
# POST /api/vault/file/<path>
# ---------------------------------------------------------------------------


def test_vault_file_post_creates_file(client):
    tmp_path, c = client
    content = "---\ntitle: New\ndate: 2026-01-01\n---\n\nContent.\n"

    resp = c.post("/api/vault/file/new.md", json={"content": content})
    assert resp.status_code == 200
    assert (tmp_path / "new.md").exists()
    assert (tmp_path / "new.md").read_text() == content


def test_vault_file_post_overwrites_existing(client):
    tmp_path, c = client
    (tmp_path / "existing.md").write_text(SAMPLE_MD)
    new_content = "---\ntitle: Updated\ndate: 2026-01-01\n---\n\nNew body.\n"

    resp = c.post("/api/vault/file/existing.md", json={"content": new_content})
    assert resp.status_code == 200
    assert (tmp_path / "existing.md").read_text() == new_content


def test_vault_file_post_rejects_invalid_frontmatter(client):
    _, c = client
    content = "---\ndate: 2026-01-01\n---\n\nMissing title.\n"

    resp = c.post("/api/vault/file/bad.md", json={"content": content})
    assert resp.status_code == 400
    assert "validation_errors" in resp.get_json()


def test_vault_file_post_rejects_non_string_content(client):
    _, c = client
    resp = c.post("/api/vault/file/x.md", json={"content": 42})
    assert resp.status_code == 400


def test_vault_file_post_accepts_no_frontmatter(client):
    tmp_path, c = client
    resp = c.post("/api/vault/file/plain.md", json={"content": "Plain markdown.\n"})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/vault/append/<path>
# ---------------------------------------------------------------------------


def test_vault_append_creates_new_file(client):
    tmp_path, c = client
    resp = c.post("/api/vault/append/new-note.md", json={"content": "## Section\n\nContent."})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("ok") is True
    assert data.get("created") is True
    assert (tmp_path / "new-note.md").exists()


def test_vault_append_to_existing(client):
    tmp_path, c = client
    (tmp_path / "existing.md").write_text(SAMPLE_MD)

    resp = c.post("/api/vault/append/existing.md", json={"content": "## Added\n\nNew section."})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("ok") is True
    assert data.get("created") is False
    text = (tmp_path / "existing.md").read_text()
    assert "Body text." in text
    assert "## Added" in text


def test_vault_append_rejects_non_string_content(client):
    _, c = client
    resp = c.post("/api/vault/append/x.md", json={"content": 123})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/vault/links/<path>
# ---------------------------------------------------------------------------


def test_vault_links_returns_structure(client):
    _, c = client
    with patch(
        "routes.vault.get_file_links",
        return_value={"forward": ["thinking/other.md"], "backlinks": []},
    ):
        resp = c.get("/api/vault/links/thinking/note.md")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "forward" in data
    assert "backlinks" in data


def test_vault_links_empty_file(client):
    _, c = client
    with patch("routes.vault.get_file_links", return_value={"forward": [], "backlinks": []}):
        resp = c.get("/api/vault/links/thinking/note.md")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["forward"] == []
    assert data["backlinks"] == []


# ---------------------------------------------------------------------------
# GET /api/vault/resolve
# ---------------------------------------------------------------------------


def test_vault_resolve_missing_name_param(client):
    _, c = client
    resp = c.get("/api/vault/resolve")
    assert resp.status_code == 400
    assert "name parameter required" in resp.get_json()["error"]


def test_vault_resolve_found(client):
    _, c = client
    with patch("routes.vault.find_file", return_value="thinking/my-note.md"):
        resp = c.get("/api/vault/resolve?name=my-note")
    assert resp.status_code == 200
    assert resp.get_json()["path"] == "thinking/my-note.md"


def test_vault_resolve_not_found(client):
    _, c = client
    with patch("routes.vault.find_file", return_value=None):
        resp = c.get("/api/vault/resolve?name=ghost")
    assert resp.status_code == 404
    assert "Not found" in resp.get_json()["error"]


# ---------------------------------------------------------------------------
# GET /api/vault/raw/<path>
# ---------------------------------------------------------------------------


def test_vault_raw_traversal_blocked(client):
    _, c = client
    # Flask URL routing normalizes path; test with a symlink-based attempt
    resp = c.get("/api/vault/raw/../../../../etc/passwd")
    # Flask may return 404 before the view runs due to path normalization,
    # but if the view runs it should return 403
    assert resp.status_code in (403, 404)


def test_vault_raw_not_found(client):
    _, c = client
    resp = c.get("/api/vault/raw/missing.png")
    assert resp.status_code == 404


def test_vault_raw_serves_file(client):
    tmp_path, c = client
    img = tmp_path / "photo.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")

    resp = c.get("/api/vault/raw/photo.png")
    assert resp.status_code == 200


def test_vault_raw_serves_nested_file(client):
    tmp_path, c = client
    assets = tmp_path / "thinking" / "assets"
    assets.mkdir(parents=True)
    (assets / "chart.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    resp = c.get("/api/vault/raw/thinking/assets/chart.png")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/vault/access
# ---------------------------------------------------------------------------


def test_vault_access_happy(client):
    tmp_path, c = client
    (tmp_path / "note.md").write_text(SAMPLE_MD)

    resp = c.post("/api/vault/access", json={"path": "note.md"})
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True


def test_vault_access_missing_path(client):
    _, c = client
    resp = c.post("/api/vault/access", json={})
    assert resp.status_code == 400
    assert "path is required" in resp.get_json()["error"]


def test_vault_access_traversal_blocked(client):
    _, c = client
    resp = c.post("/api/vault/access", json={"path": "../../../etc/passwd"})
    assert resp.status_code == 400


def test_vault_access_empty_path(client):
    _, c = client
    resp = c.post("/api/vault/access", json={"path": "   "})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/vault/activity
# ---------------------------------------------------------------------------


def test_vault_activity_returns_files(client):
    _, c = client
    with patch(
        "routes.vault.get_activity_scores",
        return_value=[
            {"path": "thinking/note.md", "score": 1.8, "open_count": 5, "last_opened": None}
        ],
    ):
        resp = c.get("/api/vault/activity")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "files" in data
    assert len(data["files"]) == 1


def test_vault_activity_empty_returns_empty_list(client):
    _, c = client
    resp = c.get("/api/vault/activity")
    data = resp.get_json()
    assert data["files"] == []


def test_vault_activity_filters_by_folder(client):
    _, c = client
    with patch(
        "routes.vault.get_activity_scores",
        return_value=[
            {"path": "thinking/note.md", "score": 1.0, "open_count": 1, "last_opened": None},
            {"path": "daily/heartbeat.md", "score": 0.5, "open_count": 1, "last_opened": None},
        ],
    ):
        resp = c.get("/api/vault/activity?folder=thinking")

    data = resp.get_json()
    assert all(f["path"].startswith("thinking/") for f in data["files"])
    assert len(data["files"]) == 1


def test_vault_activity_excludes_configured_folders(client):
    _, c = client
    # FAKE_SETTINGS has excluded_from_scoring: ["daily"]
    with patch(
        "routes.vault.get_activity_scores",
        return_value=[
            {"path": "daily/heartbeat.md", "score": 2.0, "open_count": 10, "last_opened": None},
            {"path": "thinking/note.md", "score": 0.5, "open_count": 1, "last_opened": None},
        ],
    ):
        resp = c.get("/api/vault/activity")

    data = resp.get_json()
    paths = [f["path"] for f in data["files"]]
    assert all(not p.startswith("daily/") for p in paths)
    assert "thinking/note.md" in paths


def test_vault_activity_respects_limit(client):
    _, c = client
    many = [
        {"path": f"thinking/note{i}.md", "score": float(i), "open_count": i, "last_opened": None}
        for i in range(30)
    ]
    with patch("routes.vault.get_activity_scores", return_value=many):
        resp = c.get("/api/vault/activity?limit=5")

    data = resp.get_json()
    assert len(data["files"]) <= 5


def test_vault_activity_invalid_limit_falls_back_to_default(client):
    _, c = client
    resp = c.get("/api/vault/activity?limit=notanumber")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/vault/search
# ---------------------------------------------------------------------------


def test_vault_search_empty_query_returns_empty(client):
    _, c = client
    resp = c.get("/api/vault/search")
    assert resp.status_code == 200
    assert resp.get_json() == {"results": [], "excluded": 0}


def test_vault_search_calls_qmd_query_in_hybrid_mode(client):
    _, c = client
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout="", returncode=0)
        resp = c.get("/api/vault/search?q=fathom")
    assert resp.status_code == 200
    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "qmd"
    assert cmd[1] == "query"


def test_vault_search_keyword_mode_calls_qmd_search(client):
    _, c = client
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout="", returncode=0)
        resp = c.get("/api/vault/search?q=fathom&mode=keyword")
    assert resp.status_code == 200
    cmd = mock_run.call_args[0][0]
    assert cmd[1] == "search"


def test_vault_search_invalid_mode_falls_back_to_settings(client):
    _, c = client
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout="", returncode=0)
        resp = c.get("/api/vault/search?q=test&mode=fuzzy")
    assert resp.status_code == 200
    # Should fall back to "hybrid" from FAKE_SETTINGS
    cmd = mock_run.call_args[0][0]
    assert cmd[1] == "query"


def test_vault_search_returns_parsed_results(client):
    _, c = client
    fake_output = (
        "qmd://collection/thinking/note.md:1 #abc\nTitle: My Note\nScore: 80%\n\nSome excerpt\n"
    )
    with patch("subprocess.run", return_value=MagicMock(stdout=fake_output, returncode=0)):
        resp = c.get("/api/vault/search?q=note")
    data = resp.get_json()
    assert len(data["results"]) == 1
    assert data["results"][0]["file"] == "thinking/note.md"
    assert data["excluded"] == 0


def test_vault_search_filters_excluded_dirs(client):
    _, c = client
    settings_with_excluded = {
        **FAKE_SETTINGS,
        "background_index": {"excluded_dirs": ["private"]},
    }
    fake_output = (
        "qmd://collection/private/secret.md:1 #aaa\n"
        "Title: Secret\n"
        "Score: 90%\n"
        "\n"
        "Private\n"
        "qmd://collection/thinking/note.md:1 #bbb\n"
        "Title: Public\n"
        "Score: 80%\n"
        "\n"
        "Public\n"
    )
    with (
        patch("routes.vault.load_settings", return_value=settings_with_excluded),
        patch("subprocess.run", return_value=MagicMock(stdout=fake_output, returncode=0)),
    ):
        resp = c.get("/api/vault/search?q=test")
    data = resp.get_json()
    assert data["excluded"] == 1
    assert len(data["results"]) == 1
    assert data["results"][0]["file"] == "thinking/note.md"


def test_vault_search_timeout_returns_504(client):
    _, c = client
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("qmd", 10)):
        resp = c.get("/api/vault/search?q=test")
    assert resp.status_code == 504
    assert "timed out" in resp.get_json()["error"]


def test_vault_search_qmd_not_found_returns_500(client):
    _, c = client
    with patch("subprocess.run", side_effect=FileNotFoundError()):
        resp = c.get("/api/vault/search?q=test")
    assert resp.status_code == 500
    assert "qmd not found" in resp.get_json()["error"]


def test_vault_search_n_param_overrides_settings(client):
    _, c = client
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout="", returncode=0)
        c.get("/api/vault/search?q=test&n=3")
    cmd = mock_run.call_args[0][0]
    n_idx = cmd.index("-n")
    assert cmd[n_idx + 1] == "3"
