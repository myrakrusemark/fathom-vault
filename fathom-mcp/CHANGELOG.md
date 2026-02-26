# Changelog

## 0.2.0 (2026-02-26)

Multi-agent support.

- **Multi-agent init wizard** — auto-detects installed agents and generates per-agent MCP configs
- **Supported agents:** Claude Code, OpenAI Codex, Gemini CLI, OpenCode
- **Per-agent config writers** — `.mcp.json`, `.codex/config.toml`, `.gemini/settings.json`, `opencode.json`
- **Agent instructions boilerplate** — `fathom-agents.md` template for memory discipline, vault conventions, cross-workspace communication
- **Conditional hooks** — hook setup only for Claude Code (other agents don't support hooks)
- **`agents` array** replaces legacy `architecture` string in `.fathom.json` — backward compatible
- **Server-side agent dispatch** — persistent sessions launch the correct agent CLI per workspace
- **Status command** — now shows configured agents per workspace

## 0.1.0 (2026-02-25)

Initial release.

- 16 MCP tools: vault read/write/append, image ops, search (BM25/vector/hybrid), rooms, workspaces
- CLI: `npx fathom-mcp init` setup wizard, `npx fathom-mcp status`
- Config resolution: `.fathom.json` → env vars → defaults
- Hook scripts: SessionStart context injection, PreCompact vault snapshot
- Direct file I/O for vault operations (no server needed for reads/writes)
- HTTP client for fathom-server API (search, rooms, workspaces)
- API key auth support (Bearer token)
