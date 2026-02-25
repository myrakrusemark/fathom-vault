"""Vault file access tracking — SQLite-backed, workspace-scoped.

Score formula (matches Memento Protocol's deployed algorithm):
    score = recency(7d half-life) × access_boost × last_access_recency(48h)

Where:
    recency             = e^(-days_since_last_opened / half_life_days)
    access_boost        = min(log2(open_count + 1), max_boost)
    last_access_recency = 1.0 if opened within recency_window_hours, else 0.5

Uses file_access_v2 table with (path, workspace) composite PK,
matching the MCP layer's schema for consistency.
"""

import math
import sqlite3
import time
from pathlib import Path

_DB_PATH = Path(__file__).parent.parent / "data" / "access.db"

_CREATE_TABLE_V2 = """
CREATE TABLE IF NOT EXISTS file_access_v2 (
    path         TEXT NOT NULL,
    workspace    TEXT NOT NULL DEFAULT 'fathom',
    open_count   INTEGER NOT NULL DEFAULT 0,
    last_opened  REAL    NOT NULL,
    first_opened REAL    NOT NULL,
    PRIMARY KEY (path, workspace)
)
"""


def _conn() -> sqlite3.Connection:
    """Open (and if needed initialise) the access database."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(_DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute(_CREATE_TABLE_V2)
    con.commit()

    # One-time migration from v1 to v2
    try:
        old_count = con.execute("SELECT COUNT(*) as c FROM file_access").fetchone()
        new_count = con.execute("SELECT COUNT(*) as c FROM file_access_v2").fetchone()
        if old_count["c"] > 0 and new_count["c"] == 0:
            con.execute(
                "INSERT INTO file_access_v2 (path, workspace, open_count, last_opened, first_opened) "
                "SELECT path, 'fathom', open_count, last_opened, first_opened FROM file_access"
            )
            con.commit()
    except sqlite3.OperationalError:
        pass  # v1 table doesn't exist — fine

    return con


def record_access(path: str, workspace: str = "fathom") -> None:
    """Upsert an access record for *path* (relative to vault root)."""
    now = time.time()
    with _conn() as con:
        con.execute(
            """
            INSERT INTO file_access_v2 (path, workspace, open_count, last_opened, first_opened)
            VALUES (?, ?, 1, ?, ?)
            ON CONFLICT(path, workspace) DO UPDATE SET
                open_count  = open_count + 1,
                last_opened = excluded.last_opened
            """,
            (path, workspace, now, now),
        )


def _compute_score(
    open_count: int,
    last_opened: float,
    *,
    half_life_days: float = 7.0,
    recency_window_hours: float = 48.0,
    max_boost: float = 2.0,
) -> float:
    """Compute a warmth score for a single file access record."""
    now = time.time()
    days_since = (now - last_opened) / 86400.0
    recency = math.exp(-days_since / half_life_days)
    access_boost = min(math.log2(open_count + 1), max_boost)
    hours_since = days_since * 24.0
    last_access_recency = 1.0 if hours_since <= recency_window_hours else 0.5
    return recency * access_boost * last_access_recency


def get_activity_scores(
    limit: int = 50,
    *,
    workspace: str = "fathom",
    half_life_days: float = 7.0,
    recency_window_hours: float = 48.0,
    max_boost: float = 2.0,
) -> list[dict]:
    """Return files sorted by activity score descending, filtered by workspace.

    Each dict contains:
        path, open_count, last_opened (Unix timestamp), score (float)
    """
    try:
        con = _conn()
    except Exception:
        return []

    rows = con.execute(
        "SELECT path, open_count, last_opened FROM file_access_v2 "
        "WHERE workspace = ? ORDER BY last_opened DESC",
        (workspace,),
    ).fetchall()
    con.close()

    scored = []
    for row in rows:
        score = _compute_score(
            row["open_count"],
            row["last_opened"],
            half_life_days=half_life_days,
            recency_window_hours=recency_window_hours,
            max_boost=max_boost,
        )
        scored.append(
            {
                "path": row["path"],
                "open_count": row["open_count"],
                "last_opened": row["last_opened"],
                "score": score,
            }
        )

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]


def get_score(
    path: str,
    *,
    workspace: str = "fathom",
    half_life_days: float = 7.0,
    recency_window_hours: float = 48.0,
    max_boost: float = 2.0,
) -> float:
    """Return activity score for *path*, or 0.0 if never opened."""
    try:
        con = _conn()
        row = con.execute(
            "SELECT open_count, last_opened FROM file_access_v2 WHERE path = ? AND workspace = ?",
            (path, workspace),
        ).fetchone()
        con.close()
    except Exception:
        return 0.0

    if row is None:
        return 0.0

    return _compute_score(
        row["open_count"],
        row["last_opened"],
        half_life_days=half_life_days,
        recency_window_hours=recency_window_hours,
        max_boost=max_boost,
    )


def get_scores_for_paths(
    paths: list[str],
    *,
    workspace: str = "fathom",
    half_life_days: float = 7.0,
    recency_window_hours: float = 48.0,
    max_boost: float = 2.0,
) -> dict[str, dict]:
    """Bulk-fetch scores for a list of paths.  Returns {path: {score, open_count, last_opened}}."""
    if not paths:
        return {}
    try:
        con = _conn()
        placeholders = ",".join("?" * len(paths))
        rows = con.execute(
            f"SELECT path, open_count, last_opened FROM file_access_v2 "
            f"WHERE workspace = ? AND path IN ({placeholders})",
            [workspace, *paths],
        ).fetchall()
        con.close()
    except Exception:
        return {}

    result: dict[str, dict] = {}
    for row in rows:
        score = _compute_score(
            row["open_count"],
            row["last_opened"],
            half_life_days=half_life_days,
            recency_window_hours=recency_window_hours,
            max_boost=max_boost,
        )
        result[row["path"]] = {
            "score": score,
            "open_count": row["open_count"],
            "last_opened": row["last_opened"],
        }
    return result
