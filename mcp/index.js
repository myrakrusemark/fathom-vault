#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

// --- Workspace resolution ----------------------------------------------------

const SETTINGS_PATH = path.join(os.homedir(), ".config/fathom-vault/settings.json");
const DEFAULT_VAULT_PATH = "/data/Dropbox/Work/vault";

let _settings = null;
let _settingsMtime = 0;

function loadSettings() {
  try {
    const stat = fs.statSync(SETTINGS_PATH);
    if (!_settings || stat.mtimeMs !== _settingsMtime) {
      _settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      _settingsMtime = stat.mtimeMs;
    }
  } catch {
    if (!_settings) _settings = {};
  }
  return _settings;
}

function resolveVaultPath(workspace) {
  const settings = loadSettings();
  const workspaces = settings.workspaces || {};

  let projectRoot;
  if (!workspace) {
    const defaultWs = settings.default_workspace;
    if (defaultWs && workspaces[defaultWs]) {
      projectRoot = workspaces[defaultWs];
    } else {
      return DEFAULT_VAULT_PATH;
    }
  } else {
    projectRoot = workspaces[workspace];
    if (!projectRoot) {
      return { error: `Unknown workspace: "${workspace}". Available: ${Object.keys(workspaces).join(", ") || "(none configured)"}` };
    }
  }

  // Project root + /vault = vault path. Handle both pre- and post-migration formats.
  const withVault = path.join(projectRoot, "vault");
  try {
    if (fs.existsSync(withVault) && fs.statSync(withVault).isDirectory()) {
      return withVault;
    }
  } catch { /* fall through */ }

  // Fallback: stored path might already be a vault path (pre-migration compat)
  return projectRoot;
}

// Access tracking — same SQLite DB as services/access.py
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "access.db");

function recordAccess(relPath, workspace) {
  try {
    const db = new Database(DB_PATH);
    // Create v2 table with workspace-scoped primary key
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_access_v2 (
        path         TEXT NOT NULL,
        workspace    TEXT NOT NULL DEFAULT 'fathom',
        open_count   INTEGER NOT NULL DEFAULT 0,
        last_opened  REAL    NOT NULL,
        first_opened REAL    NOT NULL,
        PRIMARY KEY (path, workspace)
      )
    `);
    // Migrate old data if old table exists and new one is empty
    try {
      const oldCount = db.prepare("SELECT COUNT(*) as c FROM file_access").get();
      const newCount = db.prepare("SELECT COUNT(*) as c FROM file_access_v2").get();
      if (oldCount.c > 0 && newCount.c === 0) {
        db.exec("INSERT INTO file_access_v2 (path, workspace, open_count, last_opened, first_opened) SELECT path, 'fathom', open_count, last_opened, first_opened FROM file_access");
      }
    } catch { /* old table might not exist */ }

    const now = Date.now() / 1000;
    const ws = workspace || "fathom";
    db.prepare(`
      INSERT INTO file_access_v2 (path, workspace, open_count, last_opened, first_opened)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(path, workspace) DO UPDATE SET
        open_count  = open_count + 1,
        last_opened = excluded.last_opened
    `).run(relPath, ws, now, now);
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

function safePath(relPath, workspace) {
  const vaultPath = resolveVaultPath(workspace);
  if (typeof vaultPath === "object" && vaultPath.error) {
    return vaultPath;
  }
  const abs = path.resolve(vaultPath, relPath);
  if (abs !== vaultPath && !abs.startsWith(vaultPath + path.sep)) {
    return { error: "Path traversal detected" };
  }
  return { abs, vaultPath };
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

function handleVaultWrite({ path: relPath, content, workspace }) {
  if (!relPath) return { error: "path is required" };
  if (typeof content !== "string") return { error: "content must be a string" };

  const { abs, error } = safePath(relPath, workspace);
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
    recordAccess(relPath, workspace);
    return { ok: true, path: relPath };
  } catch (e) {
    return { error: e.message };
  }
}

function handleVaultAppend({ path: relPath, content, workspace }) {
  if (!relPath) return { error: "path is required" };
  if (typeof content !== "string") return { error: "content must be a string" };

  const { abs, error } = safePath(relPath, workspace);
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
    recordAccess(relPath, workspace);
    return { ok: true, path: relPath, created };
  } catch (e) {
    return { error: e.message };
  }
}

function handleVaultRead({ path: relPath, workspace }) {
  if (!relPath) return { error: "path is required" };

  const { abs, error } = safePath(relPath, workspace);
  if (error) return { error };

  if (!fs.existsSync(abs)) return { error: "File not found" };

  try {
    const content = fs.readFileSync(abs, "utf-8");
    const stat = fs.statSync(abs);
    const { fm, body } = parseFrontmatter(content);
    recordAccess(relPath, workspace);
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

function handleVaultList({ include_root_files, workspace } = {}) {
  void include_root_files; // reserved for future use
  const vaultPath = resolveVaultPath(workspace);
  if (typeof vaultPath === "object" && vaultPath.error) return vaultPath;

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
    scanDir(vaultPath, "");
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

function handleVaultFolder({ folder = "", limit = 50, sort = "modified", recursive = false, tag, workspace } = {}) {
  const vaultPath = resolveVaultPath(workspace);
  if (typeof vaultPath === "object" && vaultPath.error) return vaultPath;

  const targetAbs = folder ? path.resolve(vaultPath, folder) : vaultPath;
  if (targetAbs !== vaultPath && !targetAbs.startsWith(vaultPath + path.sep)) {
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
            path: path.relative(vaultPath, absPath),
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

function handleVaultImage({ path: relPath, workspace }) {
  if (!relPath) return { error: "path is required" };

  const { abs, error } = safePath(relPath, workspace);
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

function handleVaultWriteAsset({ folder, filename, data, workspace }) {
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

  const { abs, error } = safePath(relPath, workspace);
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

// --- Communication handlers ------------------------------------------------

function handleWorkspaces() {
  const settings = loadSettings();
  const workspaces = settings.workspaces || {};
  const defaultWs = settings.default_workspace;

  const result = [];
  for (const [name, projectPath] of Object.entries(workspaces)) {
    const sessionName = `${name}_fathom-session`;
    let running = false;
    try {
      execFileSync("tmux", ["has-session", "-t", sessionName], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      running = true;
    } catch {
      running = false;
    }

    let paneId = null;
    const paneFile = path.join(os.homedir(), ".config", "fathom", `${name}-pane-id`);
    try {
      paneId = fs.readFileSync(paneFile, "utf-8").trim() || null;
    } catch { /* no pane-id file */ }

    result.push({
      name,
      project_path: projectPath,
      vault_path: path.join(projectPath, "vault"),
      session: sessionName,
      running,
      pane_id: paneId,
      is_default: name === defaultWs,
    });
  }

  return { workspaces: result, count: result.length };
}

/**
 * Inject a formatted message into a tmux target via load-buffer + paste-buffer.
 * Returns true on success, throws on failure.
 */
function injectMessage(target, formattedMessage, workspace) {
  const tmpFile = `/tmp/fathom-send-${workspace}-${Date.now()}.txt`;
  try {
    fs.writeFileSync(tmpFile, formattedMessage);
    execFileSync("tmux", ["load-buffer", tmpFile], { stdio: ["pipe", "pipe", "pipe"] });
    execFileSync("tmux", ["paste-buffer", "-t", target], { stdio: ["pipe", "pipe", "pipe"] });
    try { fs.unlinkSync(tmpFile); } catch { /* cleanup best-effort */ }
    // Brief pause then Enter to submit
    execFileSync("sleep", ["0.5"], { stdio: ["pipe", "pipe", "pipe"] });
    execFileSync("tmux", ["send-keys", "-t", target, "", "Enter"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch { /* cleanup */ }
    throw e;
  }
}

/**
 * Background delivery — starts a session, polls for readiness, then injects.
 * Fire-and-forget: errors are logged but not propagated.
 */
async function deliverMessage(workspace, formattedMessage, sessionName, projectPath, paneFile) {
  try {
    // Start a new session with Claude in the workspace's project dir
    const env = { ...process.env };
    delete env.CLAUDECODE; // prevent nested session detection
    execFileSync(
      "tmux",
      [
        "new-session", "-d", "-s", sessionName,
        "/home/myra/.local/bin/claude",
        "--model", "opus",
        "--permission-mode", "bypassPermissions",
      ],
      { cwd: projectPath, env, stdio: ["pipe", "pipe", "pipe"] },
    );

    // Poll for Claude readiness — look for ❯ prompt
    const maxWaitMs = 60000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();
    let ready = false;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      try {
        const output = execFileSync(
          "tmux",
          ["capture-pane", "-t", sessionName, "-p", "-S", "-10"],
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        );
        if (output.includes("\u276F")) {
          ready = true;
          break;
        }
      } catch { /* session might not be ready yet */ }
    }

    if (!ready) {
      console.error(`[fathom_send] Session ${sessionName} started but Claude not ready within 60s`);
      return;
    }

    // Save pane ID for future targeting
    try {
      const paneOutput = execFileSync(
        "tmux",
        ["list-panes", "-t", sessionName, "-F", "#{pane_id}"],
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const newPaneId = paneOutput.trim().split("\n")[0];
      if (newPaneId) {
        const paneDir = path.dirname(paneFile);
        fs.mkdirSync(paneDir, { recursive: true });
        fs.writeFileSync(paneFile, newPaneId);
      }
    } catch { /* pane-id save is best-effort */ }

    // Resolve target pane
    let target = sessionName;
    try {
      const savedPaneId = fs.readFileSync(paneFile, "utf-8").trim();
      if (savedPaneId) target = savedPaneId;
    } catch { /* fall back to session name */ }

    // Inject
    injectMessage(target, formattedMessage, workspace);
  } catch (e) {
    console.error(`[fathom_send] Background delivery to ${workspace} failed: ${e.message}`);
  }
}

/**
 * Shared injection primitive — resolves a workspace, checks if its session is
 * running, and either injects immediately or queues background delivery.
 * @param {string} workspace  - target workspace name
 * @param {string} formattedMessage - fully formatted message string (ready to paste)
 * @returns {{ ok: boolean, delivered?: boolean, queued?: boolean, workspace: string } | { error: string, workspace: string }}
 */
function injectToWorkspace(workspace, formattedMessage) {
  const settings = loadSettings();
  const workspaces = settings.workspaces || {};
  const projectPath = workspaces[workspace];

  if (!projectPath) {
    return { error: `Unknown workspace: "${workspace}"`, workspace };
  }

  const sessionName = `${workspace}_fathom-session`;
  const paneFile = path.join(os.homedir(), ".config", "fathom", `${workspace}-pane-id`);

  // Check if session is running
  let running = false;
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    running = true;
  } catch { /* not running */ }

  if (running) {
    let target = sessionName;
    try {
      const savedPaneId = fs.readFileSync(paneFile, "utf-8").trim();
      if (savedPaneId) target = savedPaneId;
    } catch { /* fall back to session name */ }

    try {
      injectMessage(target, formattedMessage, workspace);
      return { ok: true, delivered: true, workspace };
    } catch (e) {
      return { error: `Failed to inject message: ${e.message}`, workspace };
    }
  }

  // Session not running — fire-and-forget background delivery
  deliverMessage(workspace, formattedMessage, sessionName, projectPath, paneFile);
  return { ok: true, delivered: false, queued: true, workspace };
}

function handleSend({ workspace, message, from }) {
  if (!workspace) return { error: "workspace is required" };
  if (!message) return { error: "message is required" };

  const sender = from || "unknown";
  const formattedMessage = `Message from workspace (${sender}): ${message}`;

  const result = injectToWorkspace(workspace, formattedMessage);
  if (result.error) return result;

  return {
    ...result,
    session: `${workspace}_fathom-session`,
    message_length: message.length,
  };
}

// --- Room handlers ---------------------------------------------------------

function getRoomDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      room      TEXT NOT NULL,
      sender    TEXT NOT NULL,
      message   TEXT NOT NULL,
      timestamp REAL NOT NULL
    )
  `);
  // Index may already exist — safe to re-run
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_room_messages_room_ts
      ON room_messages(room, timestamp)
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_metadata (
      room        TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT ''
    )
  `);
  return db;
}

function formatTimeAgo(timestampSec) {
  const diffSec = Date.now() / 1000 - timestampSec;
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Extract @workspace mentions from a message. Deduplicates via Set.
 * @param {string} message
 * @returns {string[]} unique mention tokens (lowercase)
 */
function parseMentions(message) {
  const matches = message.match(/@([\w][\w-]*)/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}

/**
 * Expand mention tokens into target workspace names.
 * - @all expands to every configured workspace except sender.
 * - Self-mentions (sender mentioning themselves) are filtered out.
 * - Unknown workspace names are silently ignored.
 * @param {string[]} tokens - from parseMentions
 * @param {string} sender - who posted, so we can filter self-mentions
 * @returns {string[]} validated workspace names to notify
 */
function resolveMentions(tokens, sender) {
  const settings = loadSettings();
  const allWorkspaces = Object.keys(settings.workspaces || {});
  const senderLower = sender.toLowerCase();

  let targets = new Set();
  for (const token of tokens) {
    if (token === "all") {
      for (const ws of allWorkspaces) targets.add(ws);
    } else if (allWorkspaces.some(ws => ws.toLowerCase() === token)) {
      // Find the canonical-case workspace name
      targets.add(allWorkspaces.find(ws => ws.toLowerCase() === token));
    }
    // unknown mentions silently ignored
  }

  // Filter out self-mentions
  targets.delete(allWorkspaces.find(ws => ws.toLowerCase() === senderLower) || sender);

  return [...targets];
}

function handleRoomPost({ room, message, sender }) {
  if (!room) return { error: "room is required" };
  if (!message) return { error: "message is required" };
  const who = sender || "unknown";
  const timestamp = Date.now() / 1000;

  // Phase 1: Store in room (unchanged)
  const db = getRoomDb();
  try {
    db.prepare(
      "INSERT INTO room_messages (room, sender, message, timestamp) VALUES (?, ?, ?, ?)"
    ).run(room, who, message, timestamp);
  } finally {
    db.close();
  }

  const result = { ok: true, room, sender: who, timestamp, message_length: message.length };

  // Phase 2: Parse mentions and inject into targeted workspaces
  const tokens = parseMentions(message);
  const targets = resolveMentions(tokens, who);

  if (targets.length > 0) {
    const notified = targets.map(ws => {
      const formatted = `Room message from ${who} in #${room} (@${ws}): ${message}\n(Read the room with fathom_room_read before replying — this is one message without context.)`;
      const injection = injectToWorkspace(ws, formatted);
      if (injection.error) {
        return { workspace: ws, delivered: false, error: injection.error };
      }
      return { workspace: ws, delivered: !!injection.delivered, queued: !!injection.queued };
    });

    result.mentions = {
      parsed: tokens,
      notified,
    };
  }

  return result;
}

function handleRoomRead({ room, hours }) {
  if (!room) return { error: "room is required" };
  const windowHours = hours || 24;
  const cutoff = Date.now() / 1000 - windowHours * 3600;

  const db = getRoomDb();
  try {
    const rows = db.prepare(
      "SELECT id, sender, message, timestamp FROM room_messages WHERE room = ? AND timestamp > ? ORDER BY timestamp ASC"
    ).all(room, cutoff);

    const messages = rows.map(r => ({
      id: r.id,
      sender: r.sender,
      message: r.message,
      timestamp: r.timestamp,
      time_ago: formatTimeAgo(r.timestamp),
    }));

    return { room, messages, count: messages.length, window_hours: windowHours };
  } finally {
    db.close();
  }
}

function handleRoomList() {
  const db = getRoomDb();
  try {
    const rows = db.prepare(`
      SELECT
        room,
        COUNT(*) as message_count,
        MAX(timestamp) as last_activity,
        (SELECT sender FROM room_messages r2
         WHERE r2.room = r1.room ORDER BY timestamp DESC LIMIT 1) as last_sender,
        COALESCE((SELECT description FROM room_metadata m
         WHERE m.room = r1.room), '') as description
      FROM room_messages r1
      GROUP BY room
      ORDER BY last_activity DESC
    `).all();

    const rooms = rows.map(r => ({
      name: r.room,
      message_count: r.message_count,
      last_activity: r.last_activity,
      last_sender: r.last_sender,
      description: r.description,
    }));

    return { rooms, count: rooms.length };
  } finally {
    db.close();
  }
}

function handleRoomDescribe({ room, description }) {
  if (!room) return { error: "room is required" };
  const desc = (description || "").trim();

  const db = getRoomDb();
  try {
    db.prepare(
      "INSERT INTO room_metadata (room, description) VALUES (?, ?) " +
      "ON CONFLICT(room) DO UPDATE SET description = excluded.description"
    ).run(room, desc);
    return { ok: true, room, description: desc };
  } finally {
    db.close();
  }
}

// --- Search handlers -------------------------------------------------------

/**
 * Extract a JSON array from mixed output. vsearch/query may emit build noise
 * (cmake, node-llama-cpp) to stdout before the actual JSON results.
 */
function extractJsonArray(text) {
  const start = text.lastIndexOf("\n[");
  if (start !== -1) {
    try { return JSON.parse(text.slice(start + 1)); } catch { /* fall through */ }
  }
  // Try from the very beginning (clean output)
  if (text.trimStart().startsWith("[")) {
    return JSON.parse(text.trim());
  }
  return null;
}

function parseQmdResults(raw, collection) {
  const results = extractJsonArray(raw);
  if (!results) return null;
  const prefix = `qmd://${collection}/`;
  return results.map(r => ({
    title: r.title || null,
    score: r.score,
    path: r.file.startsWith(prefix) ? r.file.slice(prefix.length) : r.file,
    snippet: r.snippet || "",
  }));
}

function runQmd(subcommand, query, collection, limit, timeoutMs) {
  const args = [subcommand, query, "-c", collection, "-n", String(limit), "--json"];
  try {
    const stdout = execFileSync("qmd", args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = parseQmdResults(stdout, collection);
    if (parsed) return parsed;
    return { error: "Search returned no parseable results" };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { error: "qmd not found. Install: npm install -g @tobilu/qmd" };
    }
    if (err.killed) {
      return { error: `Search timed out after ${timeoutMs / 1000}s` };
    }
    const stderr = err.stderr || "";
    if (stderr.includes("collection") && stderr.includes("not found")) {
      return { error: `Collection '${collection}' not found. Run: qmd collection add /path/to/vault --name ${collection}` };
    }
    // qmd may output JSON to stdout even when exit code is non-zero (build warnings)
    if (err.stdout) {
      const parsed = parseQmdResults(err.stdout, collection);
      if (parsed) return parsed;
    }
    return { error: `Search failed: ${err.message}` };
  }
}

function handleSearch(subcommand, args) {
  const { query, workspace, limit: userLimit } = args;
  if (!query) return { error: "query is required" };

  const settings = loadSettings();
  const workspaces = settings.workspaces || {};
  const defaultWs = settings.default_workspace || "fathom";
  const collection = workspace || defaultWs;

  // Validate workspace exists in config
  if (!workspaces[collection]) {
    const available = Object.keys(workspaces).join(", ") || "(none configured)";
    return { error: `Unknown workspace: "${collection}". Available: ${available}` };
  }

  const limit = userLimit || settings.mcp?.search_results || 10;
  const timeoutMs = (settings.mcp?.query_timeout_seconds || 120) * 1000;

  const results = runQmd(subcommand, query, collection, limit, timeoutMs);

  if (results.error) return results;

  return {
    query,
    workspace: collection,
    count: results.length,
    results,
  };
}

// --- Server setup ----------------------------------------------------------

const server = new Server(
  { name: "fathom-vault", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

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
        path: {
          type: "string",
          description: "Relative path within vault, e.g. 'reflections/my-note.md'",
        },
        content: {
          type: "string",
          description: "Full file content (optionally with YAML frontmatter)",
        },
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
        path: {
          type: "string",
          description: "Relative path within vault, e.g. 'daily/2026-02-19.md'",
        },
        content: {
          type: "string",
          description: "Content block to append (markdown)",
        },
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
        path: {
          type: "string",
          description: "Relative path within vault, e.g. 'reflections/on-identity.md'",
        },
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
        include_root_files: {
          type: "boolean",
          description: "Reserved for future use. Default: false.",
        },
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
        path: {
          type: "string",
          description:
            "Relative path to the image within the vault, e.g. 'assets/aurora.jpg' or 'research/assets/chart.png'",
        },
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
        workspace: WORKSPACE_PROP,
      },
      required: ["folder", "filename", "data"],
    },
  },
  {
    name: "fathom_workspaces",
    description:
      "List all configured workspaces — use this to discover valid workspace names before " +
      "calling fathom_send. Returns each workspace's name, project path, vault path, tmux " +
      "session name, running status (whether its Claude instance is currently active), saved " +
      "pane ID, and whether it's the default workspace.",
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
      "targets. If the target session is running, the message is injected immediately " +
      "(delivered: true). If not running, the session is started in the background and the " +
      "message is delivered once Claude is ready — the tool returns immediately either way " +
      "(queued: true for offline sessions). The target agent sees: " +
      "'Message from workspace ({from}): {message}'",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Target workspace name — run fathom_workspaces to see available options",
        },
        message: {
          type: "string",
          description: "Message to send to the target workspace's Claude instance",
        },
        from: {
          type: "string",
          description: "Your workspace name so the recipient knows who sent it (defaults to 'unknown')",
        },
      },
      required: ["workspace", "message"],
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
        room: {
          type: "string",
          description: "Room name, e.g. 'general', 'navier-stokes'. Created on first post.",
        },
        message: {
          type: "string",
          description: "Message to post. Use @workspace to mention and notify specific workspaces (e.g. '@fathom check this'), or @all for everyone.",
        },
        sender: {
          type: "string",
          description: "Who is posting — workspace name or 'myra'",
        },
      },
      required: ["room", "message", "sender"],
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
        room: {
          type: "string",
          description: "Room name to read from",
        },
        hours: {
          type: "number",
          description: "How many hours of history to return. Default: 24.",
        },
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
        room: {
          type: "string",
          description: "Room name to set description for",
        },
        description: {
          type: "string",
          description: "Room description/topic — what this room is about",
        },
      },
      required: ["room", "description"],
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
        query: {
          type: "string",
          description: "Search query (keywords)",
        },
        workspace: WORKSPACE_PROP,
        limit: {
          type: "integer",
          description: "Max results to return (default: from settings, typically 10)",
        },
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
        query: {
          type: "string",
          description: "Search query (natural language, conceptual)",
        },
        workspace: WORKSPACE_PROP,
        limit: {
          type: "integer",
          description: "Max results to return (default: from settings, typically 10)",
        },
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
        query: {
          type: "string",
          description: "Search query (keywords or natural language)",
        },
        workspace: WORKSPACE_PROP,
        limit: {
          type: "integer",
          description: "Max results to return (default: from settings, typically 10)",
        },
      },
      required: ["query"],
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
    case "fathom_workspaces":
      result = handleWorkspaces();
      break;
    case "fathom_send":
      result = handleSend(args);
      break;
    case "fathom_room_post":
      result = handleRoomPost(args);
      break;
    case "fathom_room_read":
      result = handleRoomRead(args);
      break;
    case "fathom_room_list":
      result = handleRoomList();
      break;
    case "fathom_room_describe":
      result = handleRoomDescribe(args);
      break;
    case "fathom_vault_search":
      result = handleSearch("search", args);
      break;
    case "fathom_vault_vsearch":
      result = handleSearch("vsearch", args);
      break;
    case "fathom_vault_query":
      result = handleSearch("query", args);
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
