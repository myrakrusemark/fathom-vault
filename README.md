# Fathom Server

Dashboard, API, and background services for [Fathom](https://hifathom.com) — a multi-workspace vault system with search, activity tracking, rooms, and agent coordination.

Runs once, serves all workspaces. Per-workspace MCP tools are provided by [`fathom-mcp`](./fathom-mcp/).

## Architecture

```
┌──────────────────────────────────────────────┐
│  fathom-server (Python)                      │
│                                              │
│  React Dashboard ─── REST API ─── Services   │
│  (vault browser,    (Flask,      (indexer,   │
│   terminal,          :4243)       pings,     │
│   activation,                     crystal,   │
│   rooms)                          access)    │
│                                              │
│  Workspace Registry + API Key Auth           │
└──────────────────┬───────────────────────────┘
                   │ HTTP localhost:4243
      ┌────────────┼──────────────┐
      ▼            ▼              ▼
┌──────────┐ ┌──────────┐  ┌──────────┐
│ ws: main │ │ ws: ns   │  │ ws: apps │
│ npx      │ │ npx      │  │ npx      │
│ fathom-  │ │ fathom-  │  │ fathom-  │
│ mcp      │ │ mcp      │  │ mcp      │
└──────────┘ └──────────┘  └──────────┘
 Claude inst. Claude inst.  Claude inst.
```

## Requirements

- Python 3.11+
- Node.js 18+ (for frontend build and [qmd](https://github.com/nicoblu/qmd))
- [qmd](https://github.com/nicoblu/qmd) — `npm install -g @tobilu/qmd` (powers search)
- tmux (for agent sessions and inter-workspace messaging)

## Install

### Option A — pip (recommended)

```bash
pip install fathom-server
fathom-server                # Start on :4243
fathom-server --port 8080    # Custom port
```

### Option B — from source

```bash
git clone https://github.com/myrakrusemark/fathom-vault.git
cd fathom-vault

pip install -r requirements.txt

cd frontend && npm install && npm run build && cd ..

python app.py
```

On first run the server generates an API key, printed to the console. Copy it — you'll need it when running `npx fathom-mcp init` in your project directories.

## Quick start — new workspace

```bash
# In your project directory:
npx fathom-mcp init
```

The init wizard prompts for server URL and API key, creates `.fathom.json`, registers the workspace with the server, and sets up Claude Code hooks. See [`fathom-mcp` README](./fathom-mcp/README.md) for details.

You can also add workspaces via the dashboard at Settings > Workspaces.

## Run

```bash
# pip install
fathom-server

# or from source
python app.py
```

Opens at `http://localhost:4243`. On startup the server:

1. Generates an API key if none exists (stored in `data/server.json`)
2. Loads all registered workspaces
3. Starts persistent Claude sessions for each workspace (if configured)
4. Configures ping schedulers, background indexer, and crystal regeneration

### Configuration

**Environment variables** (override defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `FATHOM_PORT` | `4243` | Server port |
| `FATHOM_VAULT_DIR` | (none) | Default vault directory |

**Server config** — `data/server.json` (auto-generated):

```json
{
  "api_key": "fv_...",
  "auth_enabled": true
}
```

**Per-workspace config** — `<project>/.fathom/settings.json` (auto-created with defaults):

```json
{
  "background_index": {
    "enabled": true,
    "interval_minutes": 15
  },
  "mcp": {
    "query_timeout_seconds": 120,
    "search_results": 10,
    "search_mode": "hybrid"
  },
  "activity": {
    "decay_halflife_days": 7,
    "recency_window_hours": 48,
    "show_heat_indicator": true
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

## API Authentication

All `/api/*` routes require a Bearer token when auth is enabled:

```bash
curl -H "Authorization: Bearer fv_abc123..." http://localhost:4243/api/workspaces
```

The dashboard is exempt (served from the same origin). Manage the API key from the dashboard at Settings > API Key & Auth.

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workspaces` | GET | List all workspaces with status |
| `/api/workspaces` | POST | Register a workspace (name, path) |
| `/api/workspaces/<name>` | DELETE | Unregister a workspace |
| `/api/vault` | GET | Folder tree |
| `/api/vault/folder/<path>` | GET | List files with metadata and previews |
| `/api/vault/file/<path>` | GET/POST | Read/write files |
| `/api/vault/append/<path>` | POST | Append to files |
| `/api/search` | GET | Unified search (`?q=...&mode=bm25\|vector\|hybrid`) |
| `/api/vault/links/<path>` | GET | Forward/backlinks |
| `/api/vault/activity` | GET | Activity-scored file list |
| `/api/room` | GET | List all rooms |
| `/api/room/<name>` | GET/POST | Read/post room messages |
| `/api/room/<name>/describe` | POST | Set room description |
| `/api/settings` | GET/POST | Settings management |
| `/api/auth/status` | GET | Auth status (masked key) |
| `/api/auth/key` | GET | Full API key |
| `/api/auth/key/regenerate` | POST | Generate new API key |
| `/api/auth/toggle` | POST | Enable/disable auth |

All endpoints accept `?workspace=` parameter. When omitted, they use the default workspace.

## Search

Requires qmd with a collection matching the workspace name:

```bash
qmd collection add /path/to/project/vault --name my-project
qmd index my-project
```

The background indexer keeps it updated automatically.

Three search modes:
- **bm25** — keyword search, fast, exact-match oriented
- **vector** — semantic/vector search, finds conceptually similar content
- **hybrid** — BM25 + vector + reranking, most thorough (default)

## Dashboard

The React SPA at `localhost:4243` provides:

- **Vault browser** — file tree with previews, heat indicators, frontmatter display
- **Editor** — markdown editing with frontmatter validation
- **Terminal** — WebSocket-connected tmux terminal for workspace sessions
- **Activation** — identity crystal viewer, ping scheduler controls
- **Rooms** — shared chatrooms for cross-workspace communication
- **Settings** — workspace management, API key management, per-workspace config

## Project structure

```
fathom-server/
├── app.py                    # Flask entry — routes, startup, CLI entry point
├── auth.py                   # API key generation + Bearer token middleware
├── config.py                 # Port, paths — configurable via env vars
├── routes/
│   ├── vault.py              # Vault CRUD, search, links, activity
│   ├── room.py               # Room chat endpoints
│   ├── settings.py           # Settings, workspace CRUD, auth management
│   ├── activation.py         # Identity crystal + activation
│   └── terminal.py           # WebSocket terminal (tmux)
├── services/
│   ├── access.py             # SQLite activity tracking + scoring
│   ├── settings.py           # Settings persistence
│   ├── indexer.py             # Background vault indexing (qmd)
│   ├── links.py              # Wikilink parsing + backlinks
│   ├── crystallization.py    # Identity crystal synthesis
│   ├── crystal_scheduler.py  # Scheduled crystal regen
│   ├── persistent_session.py # Claude tmux session management
│   ├── ping_scheduler.py     # Scheduled ping routines
│   ├── memento.py            # Memento SaaS API integration
│   └── vault.py              # Core vault file operations
├── frontend/                 # React SPA (Vite, Tailwind, DaisyUI, xterm.js)
├── fathom-mcp/               # MCP tools npm package (see fathom-mcp/README.md)
├── data/                     # Runtime data (SQLite, server.json)
├── tests/                    # pytest suite
├── pyproject.toml            # pip packaging + ruff/pytest config
└── requirements.txt
```

## Test

```bash
pytest
```

Pre-commit hooks run ruff (lint + format) and pytest:

```bash
pre-commit install
pre-commit run --all-files
```

## systemd service

```ini
[Unit]
Description=Fathom Server
After=network.target

[Service]
ExecStart=fathom-server
Restart=always
Environment=FATHOM_PORT=4243

[Install]
WantedBy=multi-user.target
```

## License

MIT
