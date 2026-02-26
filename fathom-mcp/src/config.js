/**
 * Config resolution for fathom-mcp.
 *
 * Precedence (highest wins):
 *   1. Environment variables (FATHOM_SERVER_URL, FATHOM_API_KEY, FATHOM_WORKSPACE, FATHOM_VAULT_DIR)
 *   2. .fathom.json (walked up from cwd to filesystem root)
 *   3. Built-in defaults
 */

import fs from "fs";
import path from "path";

const CONFIG_FILENAME = ".fathom.json";

const DEFAULTS = {
  workspace: "",
  vault: "vault",
  server: "http://localhost:4243",
  apiKey: "",
  description: "",
  agents: [],
  hooks: {
    "context-inject": { enabled: true },
    "precompact-snapshot": { enabled: true },
  },
};

/**
 * Walk up from startDir looking for .fathom.json.
 * Returns the parsed config and the directory it was found in, or null.
 */
export function findConfigFile(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    try {
      const content = fs.readFileSync(candidate, "utf-8");
      const config = JSON.parse(content);
      return { config, dir, path: candidate };
    } catch {
      // Not found or invalid — keep walking up
    }

    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }

  return null;
}

/**
 * Resolve final config by merging: defaults → .fathom.json → env vars.
 */
export function resolveConfig(startDir = process.cwd()) {
  const result = { ...DEFAULTS, hooks: { ...DEFAULTS.hooks } };
  let projectDir = startDir;

  // Layer 2: .fathom.json
  const found = findConfigFile(startDir);
  if (found) {
    projectDir = found.dir;
    const { config } = found;
    if (config.workspace) result.workspace = config.workspace;
    if (config.vault) result.vault = config.vault;
    if (config.server) result.server = config.server;
    if (config.apiKey) result.apiKey = config.apiKey;
    if (config.description) result.description = config.description;
    // Backward compat: migrate legacy `architecture` string to `agents` array
    if (config.agents && Array.isArray(config.agents)) {
      result.agents = config.agents;
    } else if (config.architecture) {
      result.agents = [config.architecture];
    }
    if (config.hooks) {
      result.hooks = { ...result.hooks, ...config.hooks };
    }
  }

  // Layer 1: Environment variables (highest priority)
  if (process.env.FATHOM_SERVER_URL) result.server = process.env.FATHOM_SERVER_URL;
  if (process.env.FATHOM_API_KEY) result.apiKey = process.env.FATHOM_API_KEY;
  if (process.env.FATHOM_WORKSPACE) result.workspace = process.env.FATHOM_WORKSPACE;
  if (process.env.FATHOM_VAULT_DIR) result.vault = process.env.FATHOM_VAULT_DIR;

  // Derive workspace name from directory if still empty
  if (!result.workspace) {
    result.workspace = path.basename(projectDir);
  }

  // Preserve raw vault name before resolving to absolute (for registration)
  result._rawVault = result.vault;

  // Resolve vault to absolute path
  if (!path.isAbsolute(result.vault)) {
    result.vault = path.join(projectDir, result.vault);
  }

  // Normalize server URL — strip trailing slash
  result.server = result.server.replace(/\/+$/, "");

  result._projectDir = projectDir;
  result._configPath = found?.path || null;

  return result;
}

/**
 * Write a .fathom.json config file.
 */
export function writeConfig(dir, config) {
  const filePath = path.join(dir, CONFIG_FILENAME);
  const data = {
    workspace: config.workspace,
    vault: config.vault || "vault",
    server: config.server || DEFAULTS.server,
    apiKey: config.apiKey || "",
    description: config.description || "",
    agents: config.agents || [],
    hooks: config.hooks || DEFAULTS.hooks,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  return filePath;
}
