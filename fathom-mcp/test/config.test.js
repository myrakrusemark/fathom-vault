import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import { findConfigFile, resolveConfig, writeConfig } from "../src/config.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fathom-mcp-test-"));
}

describe("findConfigFile", () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTempDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no config file exists", () => {
    const result = findConfigFile(tmpDir);
    assert.equal(result, null);
  });

  it("finds config in current directory", () => {
    const configPath = path.join(tmpDir, ".fathom.json");
    fs.writeFileSync(configPath, JSON.stringify({ workspace: "test" }));
    const result = findConfigFile(tmpDir);
    assert.notEqual(result, null);
    assert.equal(result.config.workspace, "test");
    assert.equal(result.dir, tmpDir);
    fs.unlinkSync(configPath);
  });

  it("finds config in parent directory", () => {
    const childDir = path.join(tmpDir, "child");
    fs.mkdirSync(childDir);
    const configPath = path.join(tmpDir, ".fathom.json");
    fs.writeFileSync(configPath, JSON.stringify({ workspace: "parent" }));

    const result = findConfigFile(childDir);
    assert.notEqual(result, null);
    assert.equal(result.config.workspace, "parent");
    assert.equal(result.dir, tmpDir);

    fs.unlinkSync(configPath);
    fs.rmdirSync(childDir);
  });
});

describe("resolveConfig", () => {
  let tmpDir;
  let savedEnv;

  before(() => {
    tmpDir = makeTempDir();
    savedEnv = { ...process.env };
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Restore env
    for (const key of ["FATHOM_SERVER_URL", "FATHOM_API_KEY", "FATHOM_WORKSPACE", "FATHOM_VAULT_DIR"]) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("uses defaults when no config file and no env vars", () => {
    delete process.env.FATHOM_SERVER_URL;
    delete process.env.FATHOM_API_KEY;
    delete process.env.FATHOM_WORKSPACE;
    delete process.env.FATHOM_VAULT_DIR;

    const config = resolveConfig(tmpDir);
    assert.equal(config.server, "http://localhost:4243");
    assert.equal(config.apiKey, "");
    assert.equal(config.workspace, path.basename(tmpDir)); // derived from dir name
    assert.equal(config.vault, path.join(tmpDir, "vault"));
    assert.deepEqual(config.agents, []);
  });

  it("config file values override defaults", () => {
    delete process.env.FATHOM_SERVER_URL;
    delete process.env.FATHOM_API_KEY;
    delete process.env.FATHOM_WORKSPACE;
    delete process.env.FATHOM_VAULT_DIR;

    fs.writeFileSync(
      path.join(tmpDir, ".fathom.json"),
      JSON.stringify({
        workspace: "my-ws",
        server: "http://myserver:9999",
        apiKey: "fv_test123",
        vault: "my-vault",
        agents: ["claude-code", "gemini"],
      }),
    );

    const config = resolveConfig(tmpDir);
    assert.equal(config.workspace, "my-ws");
    assert.equal(config.server, "http://myserver:9999");
    assert.equal(config.apiKey, "fv_test123");
    assert.equal(config.vault, path.join(tmpDir, "my-vault"));
    assert.deepEqual(config.agents, ["claude-code", "gemini"]);

    fs.unlinkSync(path.join(tmpDir, ".fathom.json"));
  });

  it("env vars override config file", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".fathom.json"),
      JSON.stringify({
        workspace: "file-ws",
        server: "http://file:1234",
        apiKey: "fv_file_key",
      }),
    );

    process.env.FATHOM_SERVER_URL = "http://env:5678";
    process.env.FATHOM_API_KEY = "fv_env_key";
    process.env.FATHOM_WORKSPACE = "env-ws";

    const config = resolveConfig(tmpDir);
    assert.equal(config.workspace, "env-ws");
    assert.equal(config.server, "http://env:5678");
    assert.equal(config.apiKey, "fv_env_key");

    delete process.env.FATHOM_SERVER_URL;
    delete process.env.FATHOM_API_KEY;
    delete process.env.FATHOM_WORKSPACE;
    fs.unlinkSync(path.join(tmpDir, ".fathom.json"));
  });

  it("strips trailing slash from server URL", () => {
    delete process.env.FATHOM_SERVER_URL;
    delete process.env.FATHOM_API_KEY;
    delete process.env.FATHOM_WORKSPACE;
    delete process.env.FATHOM_VAULT_DIR;

    fs.writeFileSync(
      path.join(tmpDir, ".fathom.json"),
      JSON.stringify({ server: "http://example.com//" }),
    );

    const config = resolveConfig(tmpDir);
    assert.equal(config.server, "http://example.com");

    fs.unlinkSync(path.join(tmpDir, ".fathom.json"));
  });

  it("migrates legacy architecture string to agents array", () => {
    delete process.env.FATHOM_SERVER_URL;
    delete process.env.FATHOM_API_KEY;
    delete process.env.FATHOM_WORKSPACE;
    delete process.env.FATHOM_VAULT_DIR;

    fs.writeFileSync(
      path.join(tmpDir, ".fathom.json"),
      JSON.stringify({ architecture: "claude-code" }),
    );

    const config = resolveConfig(tmpDir);
    assert.deepEqual(config.agents, ["claude-code"]);

    fs.unlinkSync(path.join(tmpDir, ".fathom.json"));
  });

  it("prefers agents array over legacy architecture string", () => {
    delete process.env.FATHOM_SERVER_URL;
    delete process.env.FATHOM_API_KEY;
    delete process.env.FATHOM_WORKSPACE;
    delete process.env.FATHOM_VAULT_DIR;

    fs.writeFileSync(
      path.join(tmpDir, ".fathom.json"),
      JSON.stringify({
        agents: ["codex", "gemini"],
        architecture: "claude-code",
      }),
    );

    const config = resolveConfig(tmpDir);
    assert.deepEqual(config.agents, ["codex", "gemini"]);

    fs.unlinkSync(path.join(tmpDir, ".fathom.json"));
  });
});

describe("writeConfig", () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTempDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a valid .fathom.json", () => {
    const configPath = writeConfig(tmpDir, {
      workspace: "test-ws",
      vault: "vault",
      server: "http://localhost:4243",
      apiKey: "fv_abc",
    });

    assert.ok(fs.existsSync(configPath));
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(parsed.workspace, "test-ws");
    assert.equal(parsed.apiKey, "fv_abc");
  });

  it("writes agents array to config", () => {
    const configPath = writeConfig(tmpDir, {
      workspace: "multi-agent-ws",
      agents: ["claude-code", "codex", "gemini"],
    });

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.deepEqual(parsed.agents, ["claude-code", "codex", "gemini"]);
    assert.equal(parsed.architecture, undefined);
  });

  it("writes empty agents array when none specified", () => {
    const configPath = writeConfig(tmpDir, {
      workspace: "no-agents-ws",
    });

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.deepEqual(parsed.agents, []);
  });
});

describe("agent detection heuristics", () => {
  let tmpDir;

  before(() => {
    tmpDir = makeTempDir();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects agents from directory markers", async () => {
    // Dynamically import AGENTS from cli.js
    const { AGENTS } = await import("../src/cli.js");

    // Create directory markers
    fs.mkdirSync(path.join(tmpDir, ".claude"));
    fs.mkdirSync(path.join(tmpDir, ".gemini"));

    assert.equal(AGENTS["claude-code"].detect(tmpDir), true);
    assert.equal(AGENTS["gemini"].detect(tmpDir), true);
    assert.equal(AGENTS["codex"].detect(tmpDir), false);
    assert.equal(AGENTS["opencode"].detect(tmpDir), false);
  });
});
