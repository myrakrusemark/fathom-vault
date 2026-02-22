#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const VAULT_PATH = "/data/Dropbox/Work/vault";

// Access tracking — same SQLite DB as services/access.py
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "access.db");

function recordAccess(relPath) {
  try {
    const db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_access (
        path         TEXT PRIMARY KEY,
        open_count   INTEGER NOT NULL DEFAULT 0,
        last_opened  REAL    NOT NULL,
        first_opened REAL    NOT NULL
      )
    `);
    const now = Date.now() / 1000;
    db.prepare(`
      INSERT INTO file_access (path, open_count, last_opened, first_opened)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        open_count  = open_count + 1,
        last_opened = excluded.last_opened
    `).run(relPath, now, now);
    db.close();
  } catch (e) {
    // never crash the MCP over a tracking failure
  }
}

const VALID_STATUSES = new Set(["draft", "published", "archived"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);
const IMAGE_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const VAULT_SCHEMA = {
  title:   { required: true,  type: "string" },
  date:    { required: true,  type: "string" },
  tags:    { required: false, type: "array"  },
  status:  { required: false, type: "string" },
  project: { required: false, type: "string" },
  aliases: { required: false, type: "array"  },
};

// --- Path safety -----------------------------------------------------------

function safePath(relPath) {
  const abs = path.resolve(VAULT_PATH, relPath);
  if (abs !== VAULT_PATH && !abs.startsWith(VAULT_PATH + path.sep)) {
    return { error: "Path traversal detected" };
  }
  return { abs };
}

// --- Frontmatter -----------------------------------------------------------

function parseFrontmatter(content) {
  if (!content.startsWith("---")) return { fm: {}, body: content };
  const lines = content.split("\n");
  let endIdx = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { endIdx = i; break; }
  }
  if (endIdx === null) return { fm: {}, body: content };
  try {
    // Minimal YAML parsing for key: value and list items
    const fmLines = lines.slice(1, endIdx);
    const fm = {};
    let currentKey = null;
    for (const line of fmLines) {
      const listMatch = line.match(/^  - (.+)$/);
      const kvMatch = line.match(/^(\w+):\s*(.*)$/);
      if (listMatch && currentKey) {
        fm[currentKey].push(listMatch[1].trim());
      } else if (kvMatch) {
        currentKey = kvMatch[1];
        const val = kvMatch[2].trim();
        if (val === "") {
          fm[currentKey] = [];
        } else {
          fm[currentKey] = val;
        }
      }
    }
    const body = lines.slice(endIdx + 1).join("\n");
    return { fm, body };
  } catch {
    return { fm: {}, body: content };
  }
}

function validateFrontmatter(fm) {
  const errors = [];
  for (const [field, spec] of Object.entries(VAULT_SCHEMA)) {
    const val = fm[field];
    if (spec.required && val == null) {
      errors.push(`Missing required field: '${field}'`);
      continue;
    }
    if (val != null) {
      const actualType = Array.isArray(val) ? "array" : typeof val;
      if (actualType !== spec.type) {
        errors.push(`Field '${field}' must be ${spec.type}, got ${actualType}`);
      }
    }
  }
  const status = fm["status"];
  if (status != null && !VALID_STATUSES.has(status)) {
    errors.push(`Field 'status' must be one of [${[...VALID_STATUSES].join(", ")}], got '${status}'`);
  }
  return errors;
}

// --- Tool handlers ---------------------------------------------------------

function handleVaultWrite({ path: relPath, content }) {
  if (!relPath) return { error: "path is required" };
  if (typeof content !== "string") return { error: "content must be a string" };

  const { abs, error } = safePath(relPath);
  if (error) return { error };

  // Validate frontmatter if present
  if (content.startsWith("---")) {
    const { fm } = parseFrontmatter(content);
    if (Object.keys(fm).length > 0) {
      const errors = validateFrontmatter(fm);
      if (errors.length > 0) {
        return { error: "Frontmatter validation failed", validation_errors: errors };
      }
    }
  }

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
    recordAccess(relPath);
    return { ok: true, path: relPath };
  } catch (e) {
    return { error: e.message };
  }
}

function handleVaultAppend({ path: relPath, content }) {
  if (!relPath) return { error: "path is required" };
  if (typeof content !== "string") return { error: "content must be a string" };

  const { abs, error } = safePath(relPath);
  if (error) return { error };

  const created = !fs.existsSync(abs);

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (created) {
      const today = new Date().toISOString().slice(0, 10);
      const title = path.basename(relPath, path.extname(relPath))
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
      const initial = `---\ntitle: ${title}\ndate: ${today}\n---\n\n${content}\n`;
      fs.writeFileSync(abs, initial, "utf-8");
    } else {
      fs.appendFileSync(abs, "\n" + content + "\n", "utf-8");
    }
    recordAccess(relPath);
    return { ok: true, path: relPath, created };
  } catch (e) {
    return { error: e.message };
  }
}

function handleVaultRead({ path: relPath }) {
  if (!relPath) return { error: "path is required" };

  const { abs, error } = safePath(relPath);
  if (error) return { error };

  if (!fs.existsSync(abs)) return { error: "File not found" };

  try {
    const content = fs.readFileSync(abs, "utf-8");
    const stat = fs.statSync(abs);
    const { fm, body } = parseFrontmatter(content);
    recordAccess(relPath);
    return {
      path: relPath,
      content,
      frontmatter: fm,
      body,
      modified: stat.mtime.toISOString(),
      size: stat.size,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// --- List/folder handlers --------------------------------------------------

function handleVaultList({ include_root_files = false } = {}) {
  void include_root_files; // reserved for future use
  const allFolders = [];

  function scanDir(dirAbs, relPath) {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return { totalMdCount: 0, maxMtime: null, maxMtimeFile: null };
    }

    const childDirNames = entries
      .filter(e => e.isDirectory() && !e.name.startsWith("."))
      .map(e => e.name);
    const mdFiles = entries
      .filter(e => e.isFile() && e.name.endsWith(".md"))
      .map(e => e.name);

    let maxMtime = null;
    let maxMtimeFile = null;
    let totalMdCount = mdFiles.length;

    for (const fname of mdFiles) {
      try {
        const mtime = fs.statSync(path.join(dirAbs, fname)).mtime;
        if (!maxMtime || mtime > maxMtime) {
          maxMtime = mtime;
          maxMtimeFile = fname;
        }
      } catch { /* skip */ }
    }

    for (const childName of childDirNames) {
      const childAbs = path.join(dirAbs, childName);
      const childRel = relPath ? `${relPath}/${childName}` : childName;
      const child = scanDir(childAbs, childRel);
      totalMdCount += child.totalMdCount;
      if (child.maxMtime && (!maxMtime || child.maxMtime > maxMtime)) {
        maxMtime = child.maxMtime;
        maxMtimeFile = child.maxMtimeFile;
      }
    }

    if (relPath) {
      allFolders.push({
        name: path.basename(dirAbs),
        path: relPath,
        file_count: totalMdCount,
        last_modified: maxMtime ? maxMtime.toISOString() : null,
        last_modified_file: maxMtimeFile,
        children: childDirNames,
      });
    }

    return { totalMdCount, maxMtime, maxMtimeFile };
  }

  try {
    scanDir(VAULT_PATH, "");
    allFolders.sort((a, b) => {
      if (!a.last_modified && !b.last_modified) return 0;
      if (!a.last_modified) return 1;
      if (!b.last_modified) return -1;
      return b.last_modified.localeCompare(a.last_modified);
    });
    return allFolders;
  } catch (e) {
    return { error: e.message };
  }
}

function handleVaultFolder({ folder = "", limit = 50, sort = "modified", recursive = false, tag } = {}) {
  const targetAbs = folder ? path.resolve(VAULT_PATH, folder) : VAULT_PATH;
  if (targetAbs !== VAULT_PATH && !targetAbs.startsWith(VAULT_PATH + path.sep)) {
    return { error: "Path traversal detected" };
  }
  if (!fs.existsSync(targetAbs)) return { error: `Folder not found: ${folder || "(root)"}` };
  if (!fs.statSync(targetAbs).isDirectory()) return { error: `Not a directory: ${folder}` };

  const items = [];
  const tagLower = tag ? tag.toLowerCase() : null;

  function collect(dirAbs) {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const absPath = path.join(dirAbs, e.name);
      if (e.isDirectory() && recursive && !e.name.startsWith(".")) {
        collect(absPath);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        try {
          const stat = fs.statSync(absPath);
          const content = fs.readFileSync(absPath, "utf-8");
          const { fm, body } = parseFrontmatter(content);

          if (tagLower) {
            const fmTags = Array.isArray(fm.tags) ? fm.tags : [];
            if (!fmTags.some(t => String(t).toLowerCase() === tagLower)) continue;
          }

          items.push({
            path: path.relative(VAULT_PATH, absPath),
            title: fm.title || null,
            date: fm.date || null,
            tags: Array.isArray(fm.tags) ? fm.tags : [],
            status: fm.status || null,
            project: fm.project || null,
            preview: body.trim().slice(0, 200),
            modified: stat.mtime.toISOString(),
            size_bytes: stat.size,
          });
        } catch { /* skip */ }
      }
    }
  }

  try {
    collect(targetAbs);
    if (sort === "name") {
      items.sort((a, b) => a.path.localeCompare(b.path));
    } else {
      items.sort((a, b) => b.modified.localeCompare(a.modified));
    }
    return { folder: folder || "", total: items.length, files: items.slice(0, limit) };
  } catch (e) {
    return { error: e.message };
  }
}

// --- Image handlers --------------------------------------------------------

function handleVaultImage({ path: relPath }) {
  if (!relPath) return { error: "path is required" };

  const { abs, error } = safePath(relPath);
  if (error) return { error };

  const ext = path.extname(abs).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return {
      error: `Not an allowed image extension: ${ext}. Allowed: ${[...ALLOWED_IMAGE_EXTENSIONS].join(", ")}`,
    };
  }

  if (!fs.existsSync(abs)) return { error: `File not found: ${relPath}` };

  const stat = fs.statSync(abs);
  if (stat.size > MAX_IMAGE_BYTES) {
    return { error: `Image too large (${stat.size} bytes, max 5MB)` };
  }

  const mimeType = IMAGE_MIME_TYPES[ext];
  const data = fs.readFileSync(abs).toString("base64");
  return { _image: true, data, mimeType };
}

function handleVaultWriteAsset({ folder, filename, data }) {
  if (typeof folder !== "string") return { error: "folder is required (use empty string for root)" };
  if (!filename) return { error: "filename is required" };
  if (!data) return { error: "data is required" };

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return {
      error: `Not an allowed image extension: ${ext}. Allowed: ${[...ALLOWED_IMAGE_EXTENSIONS].join(", ")}`,
    };
  }

  const relPath = folder
    ? path.join(folder, "assets", filename)
    : path.join("assets", filename);

  const { abs, error } = safePath(relPath);
  if (error) return { error };

  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const buffer = Buffer.from(data, "base64");
    fs.writeFileSync(abs, buffer);
    return {
      saved: true,
      path: relPath,
      markdown: `![](assets/${filename})`,
      fullPath: abs,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// --- Server setup ----------------------------------------------------------

const server = new Server(
  { name: "fathom-vault", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const tools = [
  {
    name: "fathom_vault_write",
    description:
      "Write (create or overwrite) a vault file at the given path. If the content includes YAML " +
      "frontmatter (---), it is validated against the vault schema before writing. " +
      "Required frontmatter fields: title (string), date (string, YYYY-MM-DD). " +
      "Optional: tags (list), status (draft|published|archived), project (string), aliases (list).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within vault, e.g. 'reflections/my-note.md'",
        },
        content: {
          type: "string",
          description: "Full file content (optionally with YAML frontmatter)",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fathom_vault_append",
    description:
      "Append a content block to a vault file. If the file does not exist, creates it with " +
      "auto-generated minimal frontmatter (title derived from filename, today's date). " +
      "Useful for adding new sections, log entries, or thoughts to existing files.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within vault, e.g. 'daily/2026-02-19.md'",
        },
        content: {
          type: "string",
          description: "Content block to append (markdown)",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fathom_vault_read",
    description:
      "Read a vault file by path. Returns content, parsed frontmatter, body, size, and modification time. " +
      "Use fathom_vault_list (via fathom MCP) to browse available files first.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within vault, e.g. 'reflections/on-identity.md'",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "fathom_vault_list",
    description:
      "List all vault folders with file counts and activity signals (last modified file per " +
      "folder). Sorted by most recently active. Use this first to orient in the vault before " +
      "diving into a specific folder.",
    inputSchema: {
      type: "object",
      properties: {
        include_root_files: {
          type: "boolean",
          description: "Reserved for future use. Default: false.",
        },
      },
      required: [],
    },
  },
  {
    name: "fathom_vault_folder",
    description:
      "List files in a vault folder with frontmatter metadata (title, date, tags, status) and " +
      "content previews. Sorted by modification time by default (newest first). Supports limit, " +
      "recursive listing, and tag filtering. Use fathom_vault_list first to find the right folder.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description:
            "Relative folder path, e.g. 'thinking' or 'research/navier-stokes'. " +
            "Use empty string for vault root.",
        },
        limit: {
          type: "integer",
          description: "Max files to return. Default: 50.",
        },
        sort: {
          type: "string",
          enum: ["modified", "name"],
          description: "Sort order. Default: 'modified' (newest first).",
        },
        recursive: {
          type: "boolean",
          description: "Include files from subfolders. Default: false.",
        },
        tag: {
          type: "string",
          description: "Filter by tag (frontmatter tags array). Optional.",
        },
      },
      required: [],
    },
  },
  {
    name: "fathom_vault_image",
    description:
      "Read a vault image file and return it as base64 so Claude can perceive it. " +
      "Supports jpg, jpeg, png, gif, webp, svg. Max 5MB.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path to the image within the vault, e.g. 'assets/aurora.jpg' or 'research/assets/chart.png'",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "fathom_vault_write_asset",
    description:
      "Save a base64-encoded image into a vault folder's assets/ subdirectory. " +
      "Creates the assets/ directory if needed. Returns the saved path and a markdown embed string.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description:
            "Vault folder this asset belongs to, e.g. 'research', 'daily'. Use empty string for vault root.",
        },
        filename: {
          type: "string",
          description: "Filename with extension, e.g. 'chart.png', 'aurora-2026-02-03.jpg'",
        },
        data: {
          type: "string",
          description: "Base64-encoded image data",
        },
        mimeType: {
          type: "string",
          description:
            "MIME type, e.g. 'image/png'. If omitted, inferred from filename extension.",
        },
      },
      required: ["folder", "filename", "data"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  let result;

  switch (name) {
    case "fathom_vault_write":
      result = handleVaultWrite(args);
      break;
    case "fathom_vault_append":
      result = handleVaultAppend(args);
      break;
    case "fathom_vault_read":
      result = handleVaultRead(args);
      break;
    case "fathom_vault_list":
      result = handleVaultList(args);
      break;
    case "fathom_vault_folder":
      result = handleVaultFolder(args);
      break;
    case "fathom_vault_image":
      result = handleVaultImage(args);
      break;
    case "fathom_vault_write_asset":
      result = handleVaultWriteAsset(args);
      break;
    default:
      result = { error: `Unknown tool: ${name}` };
  }

  // Image tool returns a special content block
  if (result._image) {
    return {
      content: [{ type: "image", data: result.data, mimeType: result.mimeType }],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !!result.error,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
