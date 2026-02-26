#!/usr/bin/env node

/**
 * fathom-mcp CLI
 *
 * Usage:
 *   npx fathom-mcp          — Start MCP server (stdio, for .mcp.json)
 *   npx fathom-mcp init     — Interactive setup wizard
 *   npx fathom-mcp status   — Check server connection + workspace status
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

import { resolveConfig, writeConfig, findConfigFile } from "./config.js";
import { createClient } from "./server-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");

// --- Helpers -----------------------------------------------------------------

function ask(rl, question, defaultVal = "") {
  const suffix = defaultVal ? ` (${defaultVal})` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askYesNo(rl, question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`${question} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === "y" || a === "yes");
    });
  });
}

/**
 * Deep merge obj2 into obj1 (mutates obj1). Arrays are replaced, not merged.
 */
function deepMerge(obj1, obj2) {
  for (const key of Object.keys(obj2)) {
    if (
      obj1[key] &&
      typeof obj1[key] === "object" &&
      !Array.isArray(obj1[key]) &&
      typeof obj2[key] === "object" &&
      !Array.isArray(obj2[key])
    ) {
      deepMerge(obj1[key], obj2[key]);
    } else {
      obj1[key] = obj2[key];
    }
  }
  return obj1;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function appendToGitignore(dir, patterns) {
  const gitignorePath = path.join(dir, ".gitignore");
  let existing = "";
  try {
    existing = fs.readFileSync(gitignorePath, "utf-8");
  } catch { /* file doesn't exist */ }

  const missing = patterns.filter((p) => !existing.includes(p));
  if (missing.length > 0) {
    const suffix = existing.endsWith("\n") || !existing ? "" : "\n";
    fs.appendFileSync(gitignorePath, suffix + missing.join("\n") + "\n");
  }
}

function copyScripts(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    const files = fs.readdirSync(SCRIPTS_DIR);
    for (const file of files) {
      const src = path.join(SCRIPTS_DIR, file);
      const dest = path.join(targetDir, file);
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
    return files;
  } catch {
    return [];
  }
}

// --- Init wizard -------------------------------------------------------------

async function runInit() {
  const cwd = process.cwd();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`
▐▘  ▗ ▌
▜▘▀▌▜▘▛▌▛▌▛▛▌▄▖▛▛▌▛▘▛▌
▐ █▌▐▖▌▌▙▌▌▌▌  ▌▌▌▙▖▙▌
                    ▌

  hifathom.com  ·  fathom@myrakrusemark.com
`);

  // Check for existing config
  const existing = findConfigFile(cwd);
  if (existing) {
    console.log(`  Found existing config at: ${existing.path}`);
    const proceed = await askYesNo(rl, "  Overwrite?", false);
    if (!proceed) {
      console.log("  Aborted.");
      rl.close();
      process.exit(0);
    }
  }

  // 1. Workspace name
  const defaultName = path.basename(cwd);
  const workspace = await ask(rl, "  Workspace name", defaultName);

  // 2. Vault subdirectory
  const vault = await ask(rl, "  Vault subdirectory", "vault");

  // 3. Server URL
  const serverUrl = await ask(rl, "  Fathom server URL", "http://localhost:4243");

  // 4. API key
  let apiKey = "";
  const tryFetch = await askYesNo(rl, "  Fetch API key from server?", true);
  if (tryFetch) {
    console.log("  Connecting to server...");
    const tmpClient = createClient({ server: serverUrl, apiKey: "", workspace });
    const isUp = await tmpClient.healthCheck();
    if (isUp) {
      const keyResp = await tmpClient.getApiKey();
      if (keyResp.api_key) {
        apiKey = keyResp.api_key;
        console.log(`  Got API key: ${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`);
      } else {
        console.log("  Could not fetch key (auth may not be configured yet).");
      }
    } else {
      console.log("  Server not reachable. You can add the API key to .fathom.json later.");
    }
  }
  if (!apiKey) {
    apiKey = await ask(rl, "  API key (or leave blank)", "");
  }

  // 5. Hooks
  const enableContextHook = await askYesNo(rl, "  Enable SessionStart context injection hook?", true);
  const enablePrecompactHook = await askYesNo(rl, "  Enable PreCompact vault snapshot hook?", true);

  rl.close();

  // --- Write files ---

  console.log("\n  Creating files...\n");

  // .fathom.json
  const configData = {
    workspace,
    vault,
    server: serverUrl,
    apiKey,
    hooks: {
      "context-inject": { enabled: enableContextHook },
      "precompact-snapshot": { enabled: enablePrecompactHook },
    },
  };
  const configPath = writeConfig(cwd, configData);
  console.log(`  ✓ ${path.relative(cwd, configPath)}`);

  // .fathom/scripts/
  const scriptsDir = path.join(cwd, ".fathom", "scripts");
  const copiedScripts = copyScripts(scriptsDir);
  if (copiedScripts.length > 0) {
    console.log(`  ✓ .fathom/scripts/ (${copiedScripts.length} scripts)`);
  }

  // vault/ directory
  const vaultDir = path.join(cwd, vault);
  if (!fs.existsSync(vaultDir)) {
    fs.mkdirSync(vaultDir, { recursive: true });
    console.log(`  ✓ ${vault}/ (created)`);
  } else {
    console.log(`  · ${vault}/ (already exists)`);
  }

  // .mcp.json
  const mcpJsonPath = path.join(cwd, ".mcp.json");
  const mcpJson = readJsonFile(mcpJsonPath) || {};
  deepMerge(mcpJson, {
    mcpServers: {
      "fathom-vault": {
        command: "npx",
        args: ["-y", "fathom-mcp"],
      },
    },
  });
  writeJsonFile(mcpJsonPath, mcpJson);
  console.log("  ✓ .mcp.json");

  // .claude/settings.local.json — hook registrations
  const claudeSettingsPath = path.join(cwd, ".claude", "settings.local.json");
  const claudeSettings = readJsonFile(claudeSettingsPath) || {};

  // Claude Code hooks use matcher + hooks array format:
  // { hooks: [{ type: "command", command: "...", timeout: N }] }
  const hooks = {};
  if (enableContextHook) {
    hooks["UserPromptSubmit"] = [
      ...(claudeSettings.hooks?.["UserPromptSubmit"] || []),
    ];
    const contextCmd = "bash .fathom/scripts/fathom-context.sh";
    const hasFathomContext = hooks["UserPromptSubmit"].some((entry) =>
      entry.hooks?.some((h) => h.command === contextCmd)
    );
    if (!hasFathomContext) {
      hooks["UserPromptSubmit"].push({
        hooks: [{ type: "command", command: contextCmd, timeout: 10000 }],
      });
    }
  }
  if (enablePrecompactHook) {
    hooks["PreCompact"] = [
      ...(claudeSettings.hooks?.["PreCompact"] || []),
    ];
    const precompactCmd = "bash .fathom/scripts/fathom-precompact.sh";
    const hasFathomPrecompact = hooks["PreCompact"].some((entry) =>
      entry.hooks?.some((h) => h.command === precompactCmd)
    );
    if (!hasFathomPrecompact) {
      hooks["PreCompact"].push({
        hooks: [{ type: "command", command: precompactCmd, timeout: 30000 }],
      });
    }
  }

  if (Object.keys(hooks).length > 0) {
    claudeSettings.hooks = { ...(claudeSettings.hooks || {}), ...hooks };
    writeJsonFile(claudeSettingsPath, claudeSettings);
    console.log("  ✓ .claude/settings.local.json (hooks)");
  }

  // .gitignore
  appendToGitignore(cwd, [".fathom.json", ".fathom/scripts/"]);
  console.log("  ✓ .gitignore");

  // Register with server (best-effort)
  if (serverUrl) {
    const regClient = createClient({ server: serverUrl, apiKey, workspace });
    const isUp = await regClient.healthCheck();
    if (isUp) {
      const regResult = await regClient.registerWorkspace(workspace, cwd);
      if (regResult.ok) {
        console.log(`  ✓ Registered workspace "${workspace}" with server`);
      } else if (regResult.error) {
        console.log(`  · Server: ${regResult.error}`);
      }
    }
  }

  console.log(`
  Done! Fathom MCP is configured for workspace "${workspace}".

  Next steps:
    1. Start the server:  cd fathom-server && python app.py
    2. Open Claude Code in this directory — fathom tools will be available.
    3. Add the following to your CLAUDE.md:

       ## Fathom Vault
       Load fathom tools on startup: \`ToolSearch query="+fathom" max_results=20\`
`);
}

// --- Status command ----------------------------------------------------------

async function runStatus() {
  const config = resolveConfig();
  const client = createClient(config);

  console.log("\n  Fathom MCP Status\n");
  console.log(`  Config:    ${config._configPath || "(not found — using defaults)"}`);
  console.log(`  Workspace: ${config.workspace}`);
  console.log(`  Vault:     ${config.vault}`);
  console.log(`  Server:    ${config.server}`);
  console.log(`  API Key:   ${config.apiKey ? config.apiKey.slice(0, 7) + "..." + config.apiKey.slice(-4) : "(not set)"}`);

  // Check vault directory
  const vaultExists = fs.existsSync(config.vault);
  console.log(`\n  Vault dir: ${vaultExists ? "✓ exists" : "✗ not found"}`);

  // Check server
  const isUp = await client.healthCheck();
  console.log(`  Server:    ${isUp ? "✓ reachable" : "✗ not reachable"}`);

  if (isUp) {
    const wsResult = await client.listWorkspaces();
    if (wsResult.profiles) {
      const names = Object.keys(wsResult.profiles);
      console.log(`  Workspaces: ${names.join(", ") || "(none)"}`);
      for (const [name, profile] of Object.entries(wsResult.profiles)) {
        const status = profile.running ? "running" : "stopped";
        console.log(`    ${name}: ${status}${profile.model ? ` (${profile.model})` : ""}`);
      }
    }
  }

  console.log();
}

// --- Main --------------------------------------------------------------------

const command = process.argv[2];

if (command === "init") {
  runInit().catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
} else if (command === "status") {
  runStatus().catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
} else if (!command || command === "serve") {
  // Default: start MCP server
  import("./index.js");
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: fathom-mcp [init|status|serve]");
  process.exit(1);
}
