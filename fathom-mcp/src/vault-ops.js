/**
 * Direct file I/O vault operations — read, write, append, frontmatter, images.
 *
 * These run locally (no network hop) for speed. The server is only notified
 * after writes for access tracking / indexing.
 */

import fs from "fs";
import path from "path";

// --- Constants ---------------------------------------------------------------

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

// --- Path safety -------------------------------------------------------------

/**
 * Resolve and validate a relative path within a vault directory.
 * Returns { abs, vaultPath } on success, { error } on failure.
 */
export function safePath(relPath, vaultPath) {
  if (!vaultPath || typeof vaultPath !== "string") {
    return { error: "Vault path not configured" };
  }
  const abs = path.resolve(vaultPath, relPath);
  if (abs !== vaultPath && !abs.startsWith(vaultPath + path.sep)) {
    return { error: "Path traversal detected" };
  }
  return { abs, vaultPath };
}

// --- Frontmatter -------------------------------------------------------------

export function parseFrontmatter(content) {
  if (!content.startsWith("---")) return { fm: {}, body: content };
  const lines = content.split("\n");
  let endIdx = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { endIdx = i; break; }
  }
  if (endIdx === null) return { fm: {}, body: content };
  try {
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

export function validateFrontmatter(fm) {
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

// --- File handlers -----------------------------------------------------------

export function handleVaultWrite({ path: relPath, content }, vaultPath) {
  if (!relPath) return { error: "path is required" };
  if (typeof content !== "string") return { error: "content must be a string" };

  const { abs, error } = safePath(relPath, vaultPath);
  if (error) return { error };

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

export function handleVaultAppend({ path: relPath, content }, vaultPath) {
  if (!relPath) return { error: "path is required" };
  if (typeof content !== "string") return { error: "content must be a string" };

  const { abs, error } = safePath(relPath, vaultPath);
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

export function handleVaultRead({ path: relPath }, vaultPath) {
  if (!relPath) return { error: "path is required" };

  const { abs, error } = safePath(relPath, vaultPath);
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

// --- List/folder handlers ----------------------------------------------------

export function handleVaultList(vaultPath) {
  if (!vaultPath) return { error: "Vault path not configured" };

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

export function handleVaultFolder({ folder = "", limit = 50, sort = "modified", recursive = false, tag } = {}, vaultPath) {
  if (!vaultPath) return { error: "Vault path not configured" };

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

// --- Image handlers ----------------------------------------------------------

export function handleVaultImage({ path: relPath }, vaultPath) {
  if (!relPath) return { error: "path is required" };

  const { abs, error } = safePath(relPath, vaultPath);
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

export function handleVaultWriteAsset({ folder, filename, data }, vaultPath) {
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

  const { abs, error } = safePath(relPath, vaultPath);
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
