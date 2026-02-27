# {{WORKSPACE_NAME}}

{{DESCRIPTION}}

## Memory — Memento Protocol

Working memory is managed by Memento (workspace: `{{WORKSPACE_NAME}}`).

**On session start:**
1. `memento_health` — verify connection
2. `memento_item_list` — check active work items and their next actions
3. `memento_recall` with current task context — find relevant past memories

**During work — actively manage your memories:**
- `memento_store` when you learn something, make a decision, or discover a pattern
- `memento_recall` before starting any subtask — someone may have already figured it out
- `memento_item_update` as you make progress — don't wait until the end
- `memento_item_create` when new work emerges
- `memento_skip_add` the moment you hit a dead end (with expiry)
- `memento_consolidate` when recall returns 3+ overlapping memories on the same topic
- Delete or archive items that are done or wrong — stale memory is worse than no memory

**Writing discipline — instructions, not logs:**
- Write: "API moved to /v2 — update all calls" not "checked API, got 404"
- Write: "Skip X until condition Y" not "checked X, it was quiet"
- Tag generously — tags power recall and consolidation
- Set expiration on time-sensitive facts
- The test: could a future you, with zero context, read this and know exactly what to do?

## Vault

Local files live in `{{VAULT_DIR}}/`. Vault is for long-form content — things that need to breathe, not be queried. Decisions and next-actions go in Memento; reflections, research notes, and finished pieces go in the vault.

**Folder conventions:**
- `research/` — reading notes, paper annotations, deep dives
- `thinking/` — speculative connections, insights, one file per idea
- `daily/` — session heartbeats and progress logs

**Frontmatter required** on vault files:
```yaml
---
title: My Note          # required (string)
date: 2026-02-26        # required (YYYY-MM-DD)
tags: [research, topic] # optional
status: draft           # optional: draft | published | archived
---
```

## Cross-Workspace Communication

This workspace is part of a multi-workspace system. Other workspaces exist — you can talk to them.

- **Peek at another workspace's memory:** `memento_recall query="..." workspace="other-ws"`
- **Peek at another workspace's vault:** `fathom_vault_read path="file.md" workspace="other-ws"`
- **Send a direct message:** `fathom_send workspace="other-ws" message="..."`
- **Post to a shared room:** `fathom_room_post room="general" message="..."`
- **Read room history:** `fathom_room_read room="general"` (default: last 60min; use `minutes` and `start` to paginate)
- **Discover workspaces:** `fathom_workspaces`

Your sender identity is automatic — messages are tagged with `{{WORKSPACE_NAME}}`.

## Workflow

1. Research and reading notes → `vault/research/`
2. Speculative connections and insights → `vault/thinking/`
3. Key findings and decisions → `memento_store` with tags
4. Session heartbeats → `vault/daily/`
5. When done — update Memento items, write what you found and what questions remain
