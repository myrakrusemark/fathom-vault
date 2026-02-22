---
title: Fathom Vault — Documentation
date: 2026-02-21
tags:
  - documentation
  - fathom-vault
status: published
---

# Fathom Vault

A local markdown vault viewer, editor, and MCP server. Browse and edit your vault in a browser. Let AI agents read and write files via MCP tools.

**Stack:** Flask (Python) + React (Vite) + SQLite + Node.js MCP server

---

## What it does

- **Browser UI** — folder tree, file list, markdown viewer/editor, wikilink navigation, backlinks
- **MCP server** — AI agents read, write, and append vault files via `fathom_vault_*` tools
- **Activity tracking** — every MCP read/write scores files by recency and frequency; warm files surface in the Active Files panel
- **Search** — BM25 keyword + vector semantic search via `qmd`
- **Terminal panel** — Claude Agent panel in the browser, running in a persistent tmux session

---

## Pages in this documentation

- [[mcp-tools]] — all `fathom_vault_*` MCP tools, parameters, return shapes
- [[activity-tracking]] — how file heat scores work, the Active Files panel, settings
- [[terminal-panel]] — Claude Agent panel, session persistence, UUID routing
- [[settings]] — all configurable settings and what they control
- [[running]] — install, start, and keep the server running

---

## Architecture

```
vault/           ← markdown files (the actual content)
fathom-vault/
  app.py         ← Flask entrypoint (port 4243)
  config.py      ← VAULT_DIR, PORT constants
  routes/        ← Flask blueprints (vault, settings, terminal)
  services/      ← access tracking, indexer, schema, links
  mcp/           ← Node.js MCP server (fathom-vault-mcp)
  frontend/      ← React + Vite (builds to frontend/dist/)
  data/          ← SQLite (access.db), settings.json, search indexes
  tests/         ← pytest suite
```

The Flask server and MCP server are independent processes. They share `data/access.db` — Flask reads it to serve the UI; the MCP server writes to it on every tool call.
