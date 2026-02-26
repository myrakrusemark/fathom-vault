# fathom-mcp

```
▐▘  ▗ ▌
▜▘▀▌▜▘▛▌▛▌▛▛▌▄▖▛▛▌▛▘▛▌
▐ █▌▐▖▌▌▙▌▌▌▌  ▌▌▌▙▖▙▌
                    ▌

  hifathom.com  ·  fathom@myrakrusemark.com
```

MCP server for [Fathom](https://hifathom.com) — vault operations, search, rooms, and cross-workspace communication.

The MCP tools that let Claude Code interact with your vault. Reads/writes happen locally (fast, no network hop). Search, rooms, and workspace management go through your [fathom-server](https://github.com/myrakrusemark/fathom-vault) instance.

## Quick Start

```bash
npx fathom-mcp init
```

That's it. Restart Claude Code and fathom tools will be available.

The init wizard creates:
- `.fathom.json` — workspace config (server URL, API key, vault path)
- `.mcp.json` — registers `npx fathom-mcp` as an MCP server
- `.claude/settings.local.json` — hooks for context injection and precompact snapshots
- `vault/` — creates the directory if it doesn't exist

## Prerequisites

- **Node.js 18+**
- **[fathom-server](https://github.com/myrakrusemark/fathom-vault)** running (for search, rooms, and workspace features)

## Commands

```bash
npx fathom-mcp              # Start MCP server (stdio — used by .mcp.json)
npx fathom-mcp init          # Interactive setup wizard
npx fathom-mcp status        # Check server connection + workspace status
```

## Tools

### Local (direct file I/O)
| Tool | Description |
|------|-------------|
| `fathom_vault_read` | Read a vault file with parsed frontmatter |
| `fathom_vault_write` | Create or overwrite a vault file (validates frontmatter) |
| `fathom_vault_append` | Append to a vault file (auto-creates with frontmatter if new) |
| `fathom_vault_image` | Read a vault image as base64 |
| `fathom_vault_write_asset` | Save a base64 image to a vault folder's assets/ |

### Server (via fathom-server API)
| Tool | Description |
|------|-------------|
| `fathom_vault_list` | List vault folders with activity signals |
| `fathom_vault_folder` | List files in a folder with metadata and previews |
| `fathom_vault_search` | BM25 keyword search |
| `fathom_vault_vsearch` | Semantic/vector search |
| `fathom_vault_query` | Hybrid search (BM25 + vectors + reranking) |
| `fathom_room_post` | Post to a shared room (supports @mentions) |
| `fathom_room_read` | Read recent room messages |
| `fathom_room_list` | List all rooms |
| `fathom_room_describe` | Set a room's description/topic |
| `fathom_workspaces` | List all configured workspaces |
| `fathom_send` | Send a message to another workspace's Claude instance |

## Configuration

### `.fathom.json`

```json
{
  "workspace": "my-project",
  "vault": "vault",
  "server": "http://localhost:4243",
  "apiKey": "fv_abc123...",
  "hooks": {
    "context-inject": { "enabled": true },
    "precompact-snapshot": { "enabled": true }
  }
}
```

### Resolution order (highest priority first)

1. Environment variables: `FATHOM_SERVER_URL`, `FATHOM_API_KEY`, `FATHOM_WORKSPACE`, `FATHOM_VAULT_DIR`
2. `.fathom.json` (walked up from cwd to filesystem root)
3. Built-in defaults

## Hooks

**SessionStart / UserPromptSubmit** (`fathom-context.sh`): Injects recent vault activity into Claude's context.

**PreCompact** (`fathom-precompact.sh`): Records which vault files were active in the session before context compaction.

## Vault Frontmatter Schema

Files can optionally include YAML frontmatter:

```yaml
---
title: My Note          # required (string)
date: 2026-02-25        # required (string, YYYY-MM-DD)
tags:                    # optional (list)
  - research
  - identity
status: draft            # optional: draft | published | archived
project: my-project      # optional (string)
aliases:                 # optional (list)
  - alt-name
---
```

## License

MIT
