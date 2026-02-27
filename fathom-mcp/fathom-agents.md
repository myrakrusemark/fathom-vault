# {{WORKSPACE_NAME}}

{{DESCRIPTION}}

## Vault

Local files live in `{{VAULT_DIR}}/`. The vault is for long-form content — things that need to breathe, not be queried.

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

- **Peek at another workspace's vault:** `fathom_vault_read path="file.md" workspace="other-ws"`
- **Send a direct message:** `fathom_send workspace="other-ws" message="..."`
- **Post to a shared room:** `fathom_room_post room="general" message="..."`
- **Read room history:** `fathom_room_read room="general"`
- **Discover workspaces:** `fathom_workspaces`

Your sender identity is automatic — messages are tagged with `{{WORKSPACE_NAME}}`.

## Workflow

1. Research and reading notes → `vault/research/`
2. Speculative connections and insights → `vault/thinking/`
3. Session heartbeats → `vault/daily/`
4. When done — write what you found and what questions remain
