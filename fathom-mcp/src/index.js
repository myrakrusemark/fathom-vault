#!/usr/bin/env node

/**
 * fathom-mcp — MCP server for Fathom vault operations.
 *
 * Dispatches tools to either:
 *   - vault-ops.js (direct file I/O — fast, no network hop)
 *   - server-client.js (HTTP to fathom-server — search, rooms, workspaces)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { resolveConfig } from "./config.js";
import { createClient } from "./server-client.js";
import {
  handleVaultWrite,
  handleVaultAppend,
  handleVaultRead,
  handleVaultList,
  handleVaultFolder,
  handleVaultImage,
  handleVaultWriteAsset,
} from "./vault-ops.js";

const config = resolveConfig();
const client = createClient(config);

// --- Tool definitions --------------------------------------------------------

const WORKSPACE_PROP = {
  type: "string",
  description: "Workspace name (e.g. 'fathom', 'navier-stokes'). If omitted, uses default workspace.",
};

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
        path: { type: "string", description: "Relative path within vault, e.g. 'reflections/my-note.md'" },
        content: { type: "string", description: "Full file content (optionally with YAML frontmatter)" },
        workspace: WORKSPACE_PROP,
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
        path: { type: "string", description: "Relative path within vault, e.g. 'daily/2026-02-19.md'" },
        content: { type: "string", description: "Content block to append (markdown)" },
        workspace: WORKSPACE_PROP,
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fathom_vault_read",
    description:
      "Read a vault file by path. Returns content, parsed frontmatter, body, size, and modification time. " +
      "Use fathom_vault_list and fathom_vault_folder to browse available files if you don't know the path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within vault, e.g. 'reflections/on-identity.md'" },
        workspace: WORKSPACE_PROP,
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
        include_root_files: { type: "boolean", description: "Reserved for future use. Default: false." },
        workspace: WORKSPACE_PROP,
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
        folder: { type: "string", description: "Relative folder path, e.g. 'thinking' or 'research/navier-stokes'. Use empty string for vault root." },
        limit: { type: "integer", description: "Max files to return. Default: 50." },
        sort: { type: "string", enum: ["modified", "name"], description: "Sort order. Default: 'modified' (newest first)." },
        recursive: { type: "boolean", description: "Include files from subfolders. Default: false." },
        tag: { type: "string", description: "Filter by tag (frontmatter tags array). Optional." },
        workspace: WORKSPACE_PROP,
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
        path: { type: "string", description: "Relative path to the image within the vault, e.g. 'assets/aurora.jpg'" },
        workspace: WORKSPACE_PROP,
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
        folder: { type: "string", description: "Vault folder this asset belongs to, e.g. 'research', 'daily'. Use empty string for vault root." },
        filename: { type: "string", description: "Filename with extension, e.g. 'chart.png', 'aurora-2026-02-03.jpg'" },
        data: { type: "string", description: "Base64-encoded image data" },
        mimeType: { type: "string", description: "MIME type, e.g. 'image/png'. If omitted, inferred from filename extension." },
        workspace: WORKSPACE_PROP,
      },
      required: ["folder", "filename", "data"],
    },
  },
  {
    name: "fathom_vault_search",
    description:
      "Keyword search (BM25) across vault files — start here for most searches. Fast, " +
      "exact-match oriented. Best for specific terms, file names, or known phrases. " +
      "If results miss conceptually related content, follow up with fathom_vault_vsearch.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (keywords)" },
        workspace: WORKSPACE_PROP,
        limit: { type: "integer", description: "Max results to return (default: from settings, typically 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fathom_vault_vsearch",
    description:
      "Semantic/vector search across vault files — use when keyword search misses or when " +
      "exploring ideas by meaning rather than exact terms. Finds conceptually similar content " +
      "even without keyword overlap. Slower than fathom_vault_search. " +
      "For the most thorough results, use fathom_vault_query instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (natural language, conceptual)" },
        workspace: WORKSPACE_PROP,
        limit: { type: "integer", description: "Max results to return (default: from settings, typically 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fathom_vault_query",
    description:
      "Hybrid search combining BM25 keyword matching, vector similarity, and reranking — " +
      "the most thorough search mode. Use when completeness matters more than speed " +
      "(e.g. 'find everything related to X'). Slowest of the three search tools. " +
      "For quick lookups, start with fathom_vault_search instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (keywords or natural language)" },
        workspace: WORKSPACE_PROP,
        limit: { type: "integer", description: "Max results to return (default: from settings, typically 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fathom_room_post",
    description:
      "Post a message to a shared room. Rooms are created implicitly on first post. " +
      "Use this for ambient, multilateral communication — unlike fathom_send (point-to-point DM), " +
      "room messages are visible to all participants. Responding is optional — use `<...>` for active silence. " +
      "Supports @workspace mentions (e.g. @fathom, @navier-stokes) — mentioned workspaces get the message " +
      "injected into their Claude session, same mechanism as fathom_send. Use @all to notify every workspace except sender.",
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room name, e.g. 'general', 'navier-stokes'. Created on first post." },
        message: { type: "string", description: "Message to post. Use @workspace to mention and notify specific workspaces (e.g. '@fathom check this'), or @all for everyone." },
      },
      required: ["room", "message"],
    },
  },
  {
    name: "fathom_room_read",
    description:
      "Read recent messages from a shared room. Returns messages from the last N hours " +
      "(default 24). Use during orient phase to catch up on cross-workspace conversation.",
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room name to read from" },
        hours: { type: "number", description: "How many hours of history to return. Default: 24." },
      },
      required: ["room"],
    },
  },
  {
    name: "fathom_room_list",
    description:
      "List all rooms with activity summary — message count, last activity time, last sender, and description. " +
      "Use to discover active rooms.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "fathom_room_describe",
    description:
      "Set or update the description/topic for a room. Descriptions help participants " +
      "understand what a room is for. Pass an empty string to clear.",
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room name to set description for" },
        description: { type: "string", description: "Room description/topic — what this room is about" },
      },
      required: ["room", "description"],
    },
  },
  {
    name: "fathom_workspaces",
    description:
      "List all configured workspaces — use this to discover valid workspace names before " +
      "calling fathom_send. Returns each workspace's name, running status, model, and role.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "fathom_send",
    description:
      "Send a message to another workspace's Claude instance — for cross-workspace coordination, " +
      "sharing findings, or requesting action. Use fathom_workspaces first to discover valid " +
      "targets. The target agent sees: 'Message from workspace ({from}): {message}'",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Target workspace name — run fathom_workspaces to see available options" },
        message: { type: "string", description: "Message to send to the target workspace's agent instance" },
      },
      required: ["workspace", "message"],
    },
  },
];

// --- Vault path resolution for cross-workspace reads -------------------------

/**
 * Resolve vault path for a tool call. If workspace param differs from config
 * workspace, we delegate to the server instead of local I/O.
 */
function resolveVault(args) {
  const ws = args.workspace;
  if (!ws || ws === config.workspace) {
    return { vaultPath: config.vault, local: true };
  }
  // Cross-workspace — delegate to server
  return { vaultPath: null, local: false, workspace: ws };
}

// --- Server setup & dispatch -------------------------------------------------

const server = new Server(
  { name: "fathom-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  let result;

  switch (name) {
    // --- Local file I/O tools ---
    case "fathom_vault_write": {
      const { vaultPath, local } = resolveVault(args);
      if (!local) {
        result = { error: "Cross-workspace writes not supported via MCP. Use the server API." };
      } else {
        result = handleVaultWrite(args, vaultPath);
        if (result.ok) {
          // Fire-and-forget: notify server for access tracking
          client.notifyAccess(args.path, args.workspace).catch(() => {});
        }
      }
      break;
    }
    case "fathom_vault_append": {
      const { vaultPath, local } = resolveVault(args);
      if (!local) {
        result = { error: "Cross-workspace appends not supported via MCP. Use the server API." };
      } else {
        result = handleVaultAppend(args, vaultPath);
        if (result.ok) {
          client.notifyAccess(args.path, args.workspace).catch(() => {});
        }
      }
      break;
    }
    case "fathom_vault_read": {
      const { vaultPath, local } = resolveVault(args);
      if (!local) {
        // Cross-workspace reads go through server
        result = { error: "Cross-workspace reads: use fathom_vault_search or the server API." };
      } else {
        result = handleVaultRead(args, vaultPath);
        if (!result.error) {
          client.notifyAccess(args.path, args.workspace).catch(() => {});
        }
      }
      break;
    }
    case "fathom_vault_image": {
      const { vaultPath, local } = resolveVault(args);
      if (!local) {
        result = { error: "Cross-workspace image reads not supported via MCP." };
      } else {
        result = handleVaultImage(args, vaultPath);
      }
      break;
    }
    case "fathom_vault_write_asset": {
      const { vaultPath, local } = resolveVault(args);
      if (!local) {
        result = { error: "Cross-workspace asset writes not supported via MCP." };
      } else {
        result = handleVaultWriteAsset(args, vaultPath);
      }
      break;
    }

    // --- Local listing with server fallback ---
    case "fathom_vault_list": {
      const { vaultPath, local } = resolveVault(args);
      if (local) {
        // Try server first for activity-enriched data, fall back to local
        result = await client.vaultList(args.workspace);
        if (result.error) {
          result = handleVaultList(vaultPath);
        }
      } else {
        result = await client.vaultList(args.workspace);
      }
      break;
    }
    case "fathom_vault_folder": {
      const { vaultPath, local } = resolveVault(args);
      if (local) {
        result = await client.vaultFolder(args.folder, args.workspace);
        if (result.error) {
          result = handleVaultFolder(args, vaultPath);
        }
      } else {
        result = await client.vaultFolder(args.folder, args.workspace);
      }
      break;
    }

    // --- Server-only tools ---
    case "fathom_vault_search":
      result = await client.search(args.query, { mode: "bm25", limit: args.limit, ws: args.workspace });
      break;
    case "fathom_vault_vsearch":
      result = await client.vsearch(args.query, { limit: args.limit, ws: args.workspace });
      break;
    case "fathom_vault_query":
      result = await client.hybridSearch(args.query, { limit: args.limit, ws: args.workspace });
      break;
    case "fathom_room_post":
      result = await client.roomPost(args.room, args.message, config.workspace);
      break;
    case "fathom_room_read":
      result = await client.roomRead(args.room, args.hours);
      break;
    case "fathom_room_list":
      result = await client.roomList();
      break;
    case "fathom_room_describe":
      result = await client.roomDescribe(args.room, args.description);
      break;
    case "fathom_workspaces":
      result = await client.listWorkspaces();
      break;
    case "fathom_send":
      // Send is implemented server-side (it manages tmux sessions)
      result = await client.request?.("POST", `/api/room/${encodeURIComponent("__dm__")}`, {
        body: { message: `Message from workspace (${config.workspace}): ${args.message}`, sender: config.workspace },
      });
      // For now, fall back to error until server implements /api/send
      if (!result || result.error) {
        result = { error: "fathom_send requires a running fathom-server with session management. This feature is being migrated." };
      }
      break;
    default:
      result = { error: `Unknown tool: ${name}` };
  }

  // Image tool returns a special content block
  if (result?._image) {
    return {
      content: [{ type: "image", data: result.data, mimeType: result.mimeType }],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !!result?.error,
  };
});

async function main() {
  // Auto-register workspace with server (fire-and-forget)
  if (config.server && config.workspace) {
    client.registerWorkspace(config.workspace, config._projectDir, {
      vault: config._rawVault,
      description: config.description,
      agents: config.agents,
    }).catch(() => {});
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
