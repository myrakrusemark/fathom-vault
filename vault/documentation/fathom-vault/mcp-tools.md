---
title: MCP tools reference
date: 2026-02-21
tags:
  - documentation
  - fathom-vault
  - mcp
  - reference
status: published
---

# MCP tools reference

The fathom-vault MCP server exposes seven tools under the `fathom_vault_*` prefix. Register it in your MCP config:

```json
{
  "fathom-vault": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/fathom-vault/mcp/index.js"]
  }
}
```

All paths are relative to the vault root (`VAULT_PATH` in `mcp/index.js`). Path traversal is blocked — attempts to escape the vault root return an error.

Every successful read or write records the file in `data/access.db` for activity tracking.

---

## fathom_vault_read

Read a vault file. Returns content, parsed frontmatter, body, size, and modification time.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Relative path, e.g. `thinking/my-note.md` |

**Returns**

```json
{
  "path": "thinking/my-note.md",
  "content": "---\ntitle: ...\n---\n\nBody text",
  "frontmatter": { "title": "...", "date": "2026-02-21", "tags": [] },
  "body": "\nBody text",
  "modified": "2026-02-21T19:49:54.794Z",
  "size": 1234
}
```

---

## fathom_vault_write

Write (create or overwrite) a vault file. Validates YAML frontmatter before writing.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Relative path |
| `content` | string | yes | Full file content, optionally with frontmatter |

**Frontmatter validation** (when `---` block is present)

| Field | Type | Required |
|-------|------|----------|
| `title` | string | yes |
| `date` | string (YYYY-MM-DD) | yes |
| `tags` | list | no |
| `status` | `draft` \| `published` \| `archived` | no |
| `project` | string | no |
| `aliases` | list | no |

**Returns**

```json
{ "ok": true, "path": "thinking/my-note.md" }
```

---

## fathom_vault_append

Append a content block to a file. Creates the file with auto-generated frontmatter if it doesn't exist.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Relative path |
| `content` | string | yes | Markdown block to append |

**Returns**

```json
{ "ok": true, "path": "daily/2026-02-21.md", "created": false }
```

`created: true` when the file was new.

---

## fathom_vault_list

List all vault folders with file counts and last-modified signals. Sorted by most recently active.

**Parameters**

None required. `include_root_files` (boolean) reserved for future use.

**Returns**

Array of folder objects:

```json
[
  {
    "name": "thinking",
    "path": "thinking",
    "file_count": 30,
    "last_modified": "2026-02-20T20:31:37.691Z",
    "last_modified_file": "unstable-singularities.md",
    "children": []
  }
]
```

---

## fathom_vault_folder

List files in a folder with frontmatter metadata and content previews.

**Parameters**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `folder` | string | `""` | Relative folder path. Empty string = vault root |
| `limit` | integer | 50 | Max files to return |
| `sort` | `modified` \| `name` | `modified` | Sort order |
| `recursive` | boolean | false | Include subfolders |
| `tag` | string | — | Filter by tag (case-insensitive) |

**Returns**

```json
{
  "folder": "thinking",
  "total": 30,
  "files": [
    {
      "path": "thinking/my-note.md",
      "title": "My Note",
      "date": "2026-02-20",
      "tags": ["research"],
      "status": "draft",
      "preview": "First 200 chars of body...",
      "modified": "2026-02-20T20:31:37.691Z",
      "size_bytes": 2048
    }
  ]
}
```

---

## fathom_vault_image

Read a vault image as base64 so Claude can perceive it. Max 5 MB.

**Supported formats:** jpg, jpeg, png, gif, webp, svg

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Relative path to image |

**Returns** an MCP image content block (base64 + mimeType).

---

## fathom_vault_write_asset

Save a base64-encoded image into a folder's `assets/` subdirectory.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `folder` | string | yes | Vault folder. Empty string = vault root |
| `filename` | string | yes | Filename with extension |
| `data` | string | yes | Base64-encoded image data |
| `mimeType` | string | no | Inferred from extension if omitted |

**Returns**

```json
{
  "saved": true,
  "path": "thinking/assets/chart.png",
  "markdown": "![](assets/chart.png)",
  "fullPath": "/path/to/vault/thinking/assets/chart.png"
}
```
