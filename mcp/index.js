#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const VAULT_PATH = "/data/Dropbox/Work/fathom/vault";
const VALID_STATUSES = new Set(["draft", "published", "archived"]);
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
    default:
      result = { error: `Unknown tool: ${name}` };
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
