---
title: Activity tracking
date: 2026-02-21
tags:
  - documentation
  - fathom-vault
  - activity-tracking
status: published
---

# Activity tracking

Fathom Vault tracks which files you (and your AI agent) actually work with. Files you use more often float up; files you've set down fade back. The score drives heat indicators in the file list and the Active Files panel.

---

## How scores work

```
score = recency × access_boost × last_access_recency
```

| Factor | Formula | What it captures |
|--------|---------|-----------------|
| `recency` | `e^(-days_since_last_opened / half_life)` | How recently the file was touched |
| `access_boost` | `min(log2(open_count + 1), max_boost)` | How often it's been touched (diminishing returns) |
| `last_access_recency` | `1.0` if opened within recency window, else `0.5` | Short-term boost for files in active use |

**Default parameters:** 7-day half-life, 48-hour recency window, 2.0× max boost.

A file read once today scores around 1.0. A file read ten times over the past week scores near 2.0. A file untouched for a month drops below 0.1.

---

## What feeds the tracker

**MCP tool calls** are the primary signal. Every call to `fathom_vault_read`, `fathom_vault_write`, or `fathom_vault_append` records the file in `data/access.db`.

The browser UI does **not** record access. Clicking a file to inspect it is not the same as your agent reading or writing it.

The `POST /api/vault/access` endpoint exists for external callers but is not used by the UI.

---

## Heat indicators

Files in the folder view display a heat dot based on their score:

| Score | Indicator | Meaning |
|-------|-----------|---------|
| > 1.5 | 🔥 | Hot — actively in use |
| 0.5 – 1.5 | 🌡 (purple dot) | Warm — recent activity |
| < 0.5 | (none) | Cold |

Heat dots can be toggled in Settings → Activity tracking → Show heat indicator.

---

## Active Files panel

Click the file icon (⊙) in the header bar to open the Active Files panel. It shows the top files ranked by score across the entire vault, with relative timestamps and heat icons.

Click any file to navigate directly to it.

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `decay_halflife_days` | 7 | Score half-life in days |
| `recency_window_hours` | 48 | Short-term boost window |
| `max_access_boost` | 2.0 | Frequency multiplier cap |
| `activity_sort_default` | off | Use activity as default sort in folder view |
| `show_heat_indicator` | on | Show heat dots in file list |
| `excluded_from_scoring` | `["daily"]` | Folders excluded from scoring |

Daily notes are excluded by default — frequent writes to heartbeat files would otherwise dominate the activity list.

---

## Database

Scores are stored in `data/access.db` (SQLite). The table:

```sql
CREATE TABLE file_access (
  path         TEXT PRIMARY KEY,
  open_count   INTEGER NOT NULL DEFAULT 0,
  last_opened  REAL    NOT NULL,   -- Unix timestamp
  first_opened REAL    NOT NULL    -- Unix timestamp
);
```

Query directly:

```bash
sqlite3 data/access.db \
  "SELECT path, open_count, datetime(last_opened, 'unixepoch', 'localtime')
   FROM file_access ORDER BY last_opened DESC LIMIT 10;"
```
