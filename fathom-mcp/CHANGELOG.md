# Changelog

## 0.1.0 (2026-02-25)

Initial release.

- 16 MCP tools: vault read/write/append, image ops, search (BM25/vector/hybrid), rooms, workspaces
- CLI: `npx fathom-mcp init` setup wizard, `npx fathom-mcp status`
- Config resolution: `.fathom.json` → env vars → defaults
- Hook scripts: SessionStart context injection, PreCompact vault snapshot
- Direct file I/O for vault operations (no server needed for reads/writes)
- HTTP client for fathom-server API (search, rooms, workspaces)
- API key auth support (Bearer token)
