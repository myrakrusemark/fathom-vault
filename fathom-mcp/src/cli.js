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

// --- Agent registry ----------------------------------------------------------

const MCP_SERVER_ENTRY = {
  command: "npx",
  args: ["-y", "fathom-mcp"],
};

/**
 * Per-agent config writers. Each writes the appropriate MCP config file
 * for that agent, merging with existing config if present.
 */

function writeMcpJson(cwd) {
  const filePath = path.join(cwd, ".mcp.json");
  const existing = readJsonFile(filePath) || {};
  deepMerge(existing, { mcpServers: { "fathom-vault": MCP_SERVER_ENTRY } });
  writeJsonFile(filePath, existing);
  return ".mcp.json";
}

function writeCodexToml(cwd) {
  const dir = path.join(cwd, ".codex");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "config.toml");

  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch { /* file doesn't exist */ }

  // Check if fathom-vault section already exists
  if (/\[mcp_servers\.fathom-vault\]/.test(content)) {
    return ".codex/config.toml (already configured)";
  }

  const section = `\n[mcp_servers.fathom-vault]\ncommand = "npx"\nargs = ["-y", "fathom-mcp"]\n`;
  const separator = content && !content.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(filePath, content + separator + section);
  return ".codex/config.toml";
}

function writeGeminiJson(cwd) {
  const dir = path.join(cwd, ".gemini");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "settings.json");
  const existing = readJsonFile(filePath) || {};
  deepMerge(existing, { mcpServers: { "fathom-vault": MCP_SERVER_ENTRY } });
  writeJsonFile(filePath, existing);
  return ".gemini/settings.json";
}

function writeOpencodeJson(cwd) {
  const filePath = path.join(cwd, "opencode.json");
  const existing = readJsonFile(filePath) || {};
  deepMerge(existing, {
    mcp: {
      "fathom-vault": {
        type: "local",
        command: ["npx", "-y", "fathom-mcp"],
        enabled: true,
      },
    },
  });
  writeJsonFile(filePath, existing);
  return "opencode.json";
}

const AGENTS = {
  "claude-code": {
    name: "Claude Code",
    detect: (cwd) => fs.existsSync(path.join(cwd, ".claude")),
    configWriter: writeMcpJson,
    hasHooks: true,
    nextSteps: 'Add to CLAUDE.md: `ToolSearch query="+fathom" max_results=20`',
  },
  "codex": {
    name: "OpenAI Codex",
    detect: (cwd) => fs.existsSync(path.join(cwd, ".codex")),
    configWriter: writeCodexToml,
    hasHooks: false,
    nextSteps: "Run `codex` in this directory — fathom tools load automatically.",
  },
  "gemini": {
    name: "Gemini CLI",
    detect: (cwd) => fs.existsSync(path.join(cwd, ".gemini")),
    configWriter: writeGeminiJson,
    hasHooks: false,
    nextSteps: "Run `gemini` in this directory — fathom tools load automatically.",
  },
  "opencode": {
    name: "OpenCode",
    detect: (cwd) => fs.existsSync(path.join(cwd, "opencode.json")),
    configWriter: writeOpencodeJson,
    hasHooks: false,
    nextSteps: "Run `opencode` in this directory — fathom tools load automatically.",
  },
};

// Exported for testing
export { AGENTS, writeMcpJson, writeCodexToml, writeGeminiJson, writeOpencodeJson };

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

  // Check for existing config in *this* directory only (don't walk up —
  // a parent's .fathom.json belongs to a different workspace)
  const localConfigPath = path.join(cwd, ".fathom.json");
  if (fs.existsSync(localConfigPath)) {
    console.log(`  Found existing config at: ${localConfigPath}`);
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

  // 3. Description (optional)
  const description = await ask(rl, "  Workspace description (optional)", "");

  // 4. Agent selection — auto-detect and let user choose
  const agentKeys = Object.keys(AGENTS);
  const detected = agentKeys.filter((key) => AGENTS[key].detect(cwd));

  console.log("\n  Detected agents:");
  for (const key of agentKeys) {
    const agent = AGENTS[key];
    const isDetected = detected.includes(key);
    const mark = isDetected ? "✓" : " ";
    const hint = isDetected ? ` (${key === "windsurf" ? "~/.codeium/windsurf/ found" : `.${key === "claude-code" ? "claude" : key === "vscode" ? "vscode" : key}/ found`})` : "";
    console.log(`    ${mark} ${agent.name}${hint}`);
  }

  console.log("\n  Configure for which agents?");
  agentKeys.forEach((key, i) => {
    const agent = AGENTS[key];
    const mark = detected.includes(key) ? " ✓" : "";
    console.log(`    ${i + 1}. ${agent.name}${mark}`);
  });

  const defaultSelection = detected.length > 0
    ? detected.map((key) => agentKeys.indexOf(key) + 1).join(",")
    : "1";
  const selectionStr = await ask(rl, "\n  Enter numbers, comma-separated", defaultSelection);

  const selectedIndices = selectionStr
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n >= 1 && n <= agentKeys.length);
  const selectedAgents = [...new Set(selectedIndices.map((i) => agentKeys[i - 1]))];

  if (selectedAgents.length === 0) {
    console.log("  No agents selected. Defaulting to Claude Code.");
    selectedAgents.push("claude-code");
  }

  // 5. Server URL
  const serverUrl = await ask(rl, "\n  Fathom server URL", "http://localhost:4243");

  // 6. API key
  const apiKey = await ask(rl, "  API key (from dashboard or server first-run output)", "");

  // 7. Hooks — only ask if Claude Code is selected
  const hasClaude = selectedAgents.includes("claude-code");
  let enableRecallHook = false;
  let enablePrecompactHook = false;
  if (hasClaude) {
    console.log();
    enableRecallHook = await askYesNo(rl, "  Enable vault recall on every message (UserPromptSubmit)?", true);
    enablePrecompactHook = await askYesNo(rl, "  Enable PreCompact vault snapshot hook?", true);
  }

  rl.close();

  // --- Write files ---

  console.log("\n  Creating files...\n");

  // .fathom.json
  const configData = {
    workspace,
    vault,
    server: serverUrl,
    apiKey,
    description,
    agents: selectedAgents,
    hooks: {
      "vault-recall": { enabled: enableRecallHook },
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

  // fathom-agents.md — boilerplate agent instructions
  const agentMdSrc = path.join(__dirname, "..", "fathom-agents.md");
  const agentMdDest = path.join(cwd, ".fathom", "fathom-agents.md");
  try {
    let template = fs.readFileSync(agentMdSrc, "utf-8");
    template = template
      .replace(/\{\{WORKSPACE_NAME\}\}/g, workspace)
      .replace(/\{\{VAULT_DIR\}\}/g, vault)
      .replace(/\{\{DESCRIPTION\}\}/g, description || `${workspace} workspace`);
    fs.mkdirSync(path.dirname(agentMdDest), { recursive: true });
    fs.writeFileSync(agentMdDest, template);
    console.log("  ✓ .fathom/fathom-agents.md");
  } catch { /* template not found — skip silently */ }

  // Per-agent config files
  for (const agentKey of selectedAgents) {
    const agent = AGENTS[agentKey];
    const result = agent.configWriter(cwd);
    console.log(`  ✓ ${result}`);
  }

  // Claude Code hooks — only if claude-code is selected
  if (hasClaude && (enableRecallHook || enablePrecompactHook)) {
    const claudeSettingsPath = path.join(cwd, ".claude", "settings.local.json");
    const claudeSettings = readJsonFile(claudeSettingsPath) || {};

    const hooks = {};
    if (enableRecallHook) {
      hooks["UserPromptSubmit"] = [
        ...(claudeSettings.hooks?.["UserPromptSubmit"] || []),
      ];
      const recallCmd = "bash .fathom/scripts/fathom-recall.sh";
      const hasFathomRecall = hooks["UserPromptSubmit"].some((entry) =>
        entry.hooks?.some((h) => h.command === recallCmd)
      );
      if (!hasFathomRecall) {
        hooks["UserPromptSubmit"].push({
          hooks: [{ type: "command", command: recallCmd, timeout: 10000 }],
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
  }

  // .gitignore
  appendToGitignore(cwd, [".fathom.json", ".fathom/scripts/"]);
  console.log("  ✓ .gitignore");

  // Register with server (best-effort)
  if (serverUrl) {
    const regClient = createClient({ server: serverUrl, apiKey, workspace });
    const isUp = await regClient.healthCheck();
    if (isUp) {
      const regResult = await regClient.registerWorkspace(workspace, cwd, {
        vault,
        description,
        agents: selectedAgents,
      });
      if (regResult.ok) {
        console.log(`  ✓ Registered workspace "${workspace}" with server`);
      } else if (regResult.error) {
        console.log(`  · Server: ${regResult.error}`);
      }
    }
  }

  // Per-agent next steps
  console.log(`\n  Done! Fathom MCP is configured for workspace "${workspace}".`);
  console.log("\n  Next steps:");
  console.log("    1. Start the server:  cd fathom-server && python app.py");
  for (const agentKey of selectedAgents) {
    const agent = AGENTS[agentKey];
    console.log(`    · ${agent.name}: ${agent.nextSteps}`);
  }
  console.log(`
  Agent instructions:
    Some instructions are needed for your agent to use Fathom + Memento
    effectively (memory discipline, vault conventions, cross-workspace
    communication). Saved to: .fathom/fathom-agents.md

    Paste it into your CLAUDE.md, AGENTS.md, or equivalent — or point
    your agent at the file and ask it to integrate the instructions.
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
  console.log(`  Agents:    ${config.agents.length > 0 ? config.agents.join(", ") : "(none)"}`);

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
        if (profile.type === "human") {
          console.log(`    ${name}: human`);
        } else {
          const agentLabel = profile.agents?.length > 0
            ? ` [${profile.agents.join(", ")}]`
            : profile.architecture ? ` [${profile.architecture}]` : "";
          const runStatus = profile.running ? "running" : "stopped";
          console.log(`    ${name}: ${runStatus}${agentLabel}`);
        }
      }
    }
  }

  console.log();
}

// --- Main --------------------------------------------------------------------

// Guard: only run CLI when this module is the entry point (not when imported by tests)
const isMain = process.argv[1] && (
  process.argv[1].endsWith("/cli.js") || process.argv[1].endsWith("fathom-mcp")
);

if (isMain) {
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
}
