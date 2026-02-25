# Fathom Vault

A multi-workspace markdown vault system with browser UI, MCP server, full-text search, activity tracking, and agent coordination. Built for AI agents that need persistent, searchable knowledge stores — but works great for humans too.

## What it does

- **Vault file operations** — read, write, append markdown files with YAML frontmatter validation
- **Multi-workspace** — multiple isolated vaults, each with its own settings, search index, and agent session
- **Search** — keyword (BM25), semantic (vector), and hybrid search via [qmd](https://github.com/nicoblu/qmd)
- **Activity tracking** — SQLite-backed file access history with heat decay scoring
- **Agent coordination** — send messages between workspace Claude sessions via tmux
- **Browser UI** — React SPA with file browser, editor, active files panel, heat indicators, and WebSocket terminal
- **Background services** — vault indexing, identity crystal regeneration, ping scheduling, persistent session management

## Requirements

- Python 3.11+
- Node.js 18+
- [qmd](https://github.com/nicoblu/qmd) — `npm install -g @tobilu/qmd` (powers search)
- tmux (for agent sessions and inter-workspace messaging)

## Install

```bash
git clone https://github.com/myrakrusemark/fathom-vault.git
cd fathom-vault

# Python dependencies
pip install -r requirements.txt

# MCP server dependencies
cd mcp && npm install && cd ..

# Frontend
cd frontend && npm install && npm run build && cd ..
```

## Quick start — new workspace

A workspace is a project directory with a `vault/` subdirectory. To set one up:

```bash
# 1. Create the vault directory in your project
mkdir -p /path/to/your-project/vault

# 2. Register it as a workspace
# (via the browser UI at Settings > Workspaces, or manually:)
```

Edit `~/.config/fathom-vault/settings.json`:

```json
{
  "workspaces": {
    "my-project": "/path/to/your-project"
  },
  "default_workspace": "my-project"
}
```

Per-workspace settings live at `<project>/.fathom/settings.json` and are auto-created with defaults on first use:

```json
{
  "background_index": {
    "enabled": true,
    "interval_minutes": 15,
    "excluded_dirs": []
  },
  "mcp": {
    "query_timeout_seconds": 120,
    "search_results": 10,
    "search_mode": "hybrid"
  },
  "activity": {
    "decay_halflife_days": 7,
    "recency_window_hours": 48,
    "max_access_boost": 2.0,
    "activity_sort_default": false,
    "show_heat_indicator": true,
    "excluded_from_scoring": ["daily"]
  },
  "crystal_regen": {
    "enabled": false,
    "interval_days": 7
  },
  "ping": {
    "routines": []
  }
}
```

### Set up search indexing

Each workspace needs a qmd collection pointing at its vault:

```bash
qmd collection add /path/to/your-project/vault --name my-project
```

The collection name must match the workspace name. Rebuild the index:

```bash
qmd index my-project
```

The background indexer will keep it updated automatically if `background_index.enabled` is true.

## Run

```bash
python app.py
```

Opens at `http://localhost:4243`. On startup the server:

1. Loads all workspaces from `~/.config/fathom-vault/settings.json`
2. Starts persistent Claude sessions for each workspace (if configured)
3. Configures ping schedulers, background indexer, and crystal regeneration

## MCP server

The MCP server gives AI agents direct vault access over stdio. Register it in your Claude/MCP config:

```json
{
  "fathom-vault": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/fathom-vault/mcp/index.js"]
  }
}
```

All tools accept an optional `workspace` parameter. When omitted, they use the default workspace.

### Tools — vault operations

| Tool | Description |
|------|-------------|
| `fathom_vault_read` | Read a file — returns content, parsed frontmatter, body, size, modified time |
| `fathom_vault_write` | Create or overwrite a file — validates YAML frontmatter if present |
| `fathom_vault_append` | Append to a file — auto-creates with frontmatter if file doesn't exist |
| `fathom_vault_list` | List all vault folders with file counts and last-modified signals |
| `fathom_vault_folder` | List files in a folder with metadata, previews, tag filtering, sorting |
| `fathom_vault_image` | Read an image as base64 (jpg, png, gif, webp, svg — max 5MB) |
| `fathom_vault_write_asset` | Save a base64 image into a folder's `assets/` subdirectory |

### Tools — search

Requires qmd with a collection matching the workspace name.

| Tool | Description |
|------|-------------|
| `fathom_vault_search` | BM25 keyword search — fast, exact-match oriented |
| `fathom_vault_vsearch` | Semantic/vector search — finds conceptually similar content |
| `fathom_vault_query` | Hybrid search — BM25 + vector + reranking, most thorough |

### Tools — coordination

| Tool | Description |
|------|-------------|
| `fathom_workspaces` | List all workspaces with running status, paths, tmux sessions |
| `fathom_send` | Send a message to another workspace's Claude session via tmux |

### Frontmatter schema

Files with YAML frontmatter are validated on write. Required fields: `title` (string), `date` (string, YYYY-MM-DD). Optional: `tags` (list), `status` (draft/published/archived), `project` (string), `aliases` (list).

## Architecture

```
fathom-vault/
├── app.py                  # Flask server — routes, startup, service orchestration
├── config.py               # Workspace resolution, path config
├── requirements.txt        # Python deps: flask, flask-sock, pyyaml, python-dotenv
├── pyproject.toml          # Ruff + pytest config
├── mcp/
│   ├── index.js            # MCP server (Node.js, stdio transport)
│   └── package.json        # @modelcontextprotocol/sdk, better-sqlite3
├── routes/
│   ├── vault.py            # Vault CRUD, search, links, activity endpoints
│   ├── settings.py         # Settings + workspace management API
│   ├── activation.py       # Identity crystal + activation endpoints
│   └── terminal.py         # WebSocket terminal (tmux integration)
├── services/
│   ├── access.py           # SQLite file access tracking + activity scoring
│   ├── settings.py         # Global + per-workspace settings persistence
│   ├── indexer.py           # Background vault indexing (qmd)
│   ├── links.py            # Wikilink parsing + backlink resolution
│   ├── crystallization.py  # Identity crystal synthesis
│   ├── crystal_scheduler.py # Scheduled crystal regeneration
│   ├── persistent_session.py # Claude tmux session management
│   ├── ping_scheduler.py   # Scheduled ping routines per workspace
│   ├── memento.py          # Memento SaaS API integration
│   ├── schema.py           # Shared schema definitions
│   └── vault.py            # Core vault file operations
├── frontend/               # React SPA (Vite, Tailwind, DaisyUI, xterm.js)
├── data/                   # SQLite database (access.db)
├── scripts/                # Hook scripts, utilities
├── tests/                  # pytest suite
└── vault/                  # Included example vault with documentation
```

### Settings architecture

Two-level settings — global registry plus per-workspace config:

**Global** (`~/.config/fathom-vault/settings.json`) — workspace names and paths only. This is how fathom-vault discovers your workspaces.

**Per-workspace** (`<project>/.fathom/settings.json`) — all operational config: indexing intervals, search settings, activity scoring parameters, crystal regen schedule, ping routines. Lives in the project directory so it travels with the project.

### Activity tracking

Every MCP read/write records the file in a SQLite database (`data/access.db`). The browser UI surfaces recently active files with heat indicators. Activity scores use exponential decay + recency weighting — configurable via per-workspace `activity` settings.

### HTTP API

The Flask server exposes REST endpoints under `/api/`:

- `/api/vault` — folder tree
- `/api/vault/folder/<path>` — list files with metadata
- `/api/vault/file/<path>` — read/write files
- `/api/vault/append/<path>` — append to files
- `/api/vault/search` — full-text search
- `/api/vault/links/<path>` — forward/backlinks
- `/api/vault/resolve` — wikilink resolution
- `/api/vault/raw/<path>` — serve images
- `/api/vault/access` — record file opens
- `/api/vault/activity` — activity-scored file list
- `/api/settings` — get/post settings
- `/api/settings/index-now` — trigger reindex
- `/api/workspaces` — workspace CRUD

## Test

```bash
pytest
```

Pre-commit hooks run ruff (lint + format) and pytest:

```bash
pre-commit install
pre-commit run --all-files
```

## License

MIT
