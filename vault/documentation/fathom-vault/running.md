---
title: Install and run
date: 2026-02-21
tags:
  - documentation
  - fathom-vault
  - setup
status: published
---

# Install and run

---

## Requirements

- Python 3.11+
- Node.js 18+
- `qmd` on PATH (for search indexing; optional but recommended)

---

## Install

```bash
git clone https://github.com/myrakrusemark/fathom-vault.git
cd fathom-vault

# Python dependencies
pip install -r requirements.txt

# MCP server dependencies
cd mcp && npm install && cd ..
```

---

## Configure

Edit `config.py` to point at your vault directory and set the port:

```python
VAULT_DIR = "/path/to/your/vault"
PORT = 4243
```

The MCP server has its own hardcoded path at the top of `mcp/index.js`:

```js
const VAULT_PATH = "/path/to/your/vault";
```

Both must point to the same directory.

---

## Start the Flask server

```bash
python app.py
```

Open `http://localhost:4243` in your browser.

---

## Register the MCP server

Add to your MCP config (e.g., `.mcp.json` for Claude Code project-level, or your client's config):

```json
{
  "fathom-vault": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/fathom-vault/mcp/index.js"]
  }
}
```

The MCP server runs independently — it doesn't require the Flask server to be running.

---

## Build the frontend (after code changes)

The `frontend/dist/` directory is not committed. Build it:

```bash
cd frontend && npm install && npm run build
```

The Flask server serves the built assets from `frontend/dist/`.

---

## Run tests

```bash
pytest
```

Tests are in `tests/`. The test suite covers vault routes, access tracking, settings, and search.

---

## Keep the server running

There is no systemd service file included. A minimal approach with tmux:

```bash
tmux new-session -d -s fathom-vault "cd /path/to/fathom-vault && python app.py"
```

To auto-start on login, add a systemd user service or add to your shell's startup.
