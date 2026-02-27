import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import {
  safePath,
  parseFrontmatter,
  validateFrontmatter,
  handleVaultWrite,
  handleVaultAppend,
  handleVaultRead,
  handleVaultList,
  handleVaultFolder,
  handleVaultImage,
  handleVaultWriteAsset,
} from "../src/vault-ops.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fathom-vault-ops-test-"));
}

describe("safePath", () => {
  it("resolves a valid relative path", () => {
    const result = safePath("notes/test.md", "/vault");
    assert.equal(result.abs, "/vault/notes/test.md");
    assert.equal(result.vaultPath, "/vault");
  });

  it("rejects path traversal", () => {
    const result = safePath("../../etc/passwd", "/vault");
    assert.ok(result.error);
    assert.match(result.error, /traversal/i);
  });

  it("rejects when vault path is empty", () => {
    const result = safePath("test.md", "");
    assert.ok(result.error);
  });
});

describe("parseFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const content = "---\ntitle: Test\ndate: 2026-01-01\ntags:\n  - foo\n  - bar\n---\n\nBody text";
    const { fm, body } = parseFrontmatter(content);
    assert.equal(fm.title, "Test");
    assert.equal(fm.date, "2026-01-01");
    assert.deepEqual(fm.tags, ["foo", "bar"]);
    assert.match(body, /Body text/);
  });

  it("returns empty fm for no frontmatter", () => {
    const { fm, body } = parseFrontmatter("Just plain text");
    assert.deepEqual(fm, {});
    assert.equal(body, "Just plain text");
  });

  it("returns empty fm for unclosed frontmatter", () => {
    const { fm } = parseFrontmatter("---\ntitle: Oops\nno closing");
    assert.deepEqual(fm, {});
  });
});

describe("validateFrontmatter", () => {
  it("passes valid frontmatter", () => {
    const errors = validateFrontmatter({ title: "Test", date: "2026-01-01" });
    assert.equal(errors.length, 0);
  });

  it("reports missing required fields", () => {
    const errors = validateFrontmatter({});
    assert.ok(errors.some((e) => e.includes("title")));
    assert.ok(errors.some((e) => e.includes("date")));
  });

  it("reports invalid status", () => {
    const errors = validateFrontmatter({ title: "T", date: "D", status: "bogus" });
    assert.ok(errors.some((e) => e.includes("status")));
  });

  it("accepts valid statuses", () => {
    for (const s of ["draft", "published", "archived"]) {
      const errors = validateFrontmatter({ title: "T", date: "D", status: s });
      assert.equal(errors.length, 0);
    }
  });
});

describe("handleVaultWrite", () => {
  let vaultDir;

  before(() => {
    vaultDir = makeTempDir();
  });

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("writes a file with valid frontmatter", () => {
    const content = "---\ntitle: Hello\ndate: 2026-02-25\n---\n\nContent here.";
    const result = handleVaultWrite({ path: "test/hello.md", content }, vaultDir);
    assert.ok(result.ok);
    assert.equal(result.path, "test/hello.md");
    assert.ok(fs.existsSync(path.join(vaultDir, "test", "hello.md")));
  });

  it("rejects invalid frontmatter", () => {
    const content = "---\ntitle: 123\n---\nBad type";
    const result = handleVaultWrite({ path: "bad.md", content }, vaultDir);
    assert.ok(result.error);
    assert.ok(result.validation_errors);
  });

  it("allows files without frontmatter", () => {
    const result = handleVaultWrite({ path: "plain.md", content: "No frontmatter" }, vaultDir);
    assert.ok(result.ok);
  });

  it("rejects path traversal", () => {
    const result = handleVaultWrite({ path: "../../evil.md", content: "x" }, vaultDir);
    assert.ok(result.error);
  });
});

describe("handleVaultAppend", () => {
  let vaultDir;

  before(() => {
    vaultDir = makeTempDir();
  });

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("creates new file with auto-frontmatter", () => {
    const result = handleVaultAppend({ path: "new-note.md", content: "First entry" }, vaultDir);
    assert.ok(result.ok);
    assert.equal(result.created, true);
    const content = fs.readFileSync(path.join(vaultDir, "new-note.md"), "utf-8");
    assert.match(content, /title: New Note/);
    assert.match(content, /First entry/);
  });

  it("appends to existing file", () => {
    fs.writeFileSync(path.join(vaultDir, "existing.md"), "---\ntitle: Existing\ndate: 2026-01-01\n---\n\nOriginal");
    const result = handleVaultAppend({ path: "existing.md", content: "Appended" }, vaultDir);
    assert.ok(result.ok);
    assert.equal(result.created, false);
    const content = fs.readFileSync(path.join(vaultDir, "existing.md"), "utf-8");
    assert.match(content, /Original/);
    assert.match(content, /Appended/);
  });
});

describe("handleVaultRead", () => {
  let vaultDir;

  before(() => {
    vaultDir = makeTempDir();
    fs.writeFileSync(
      path.join(vaultDir, "readable.md"),
      "---\ntitle: Read Me\ndate: 2026-02-25\n---\n\nBody here.",
    );
  });

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("reads existing file with parsed frontmatter", () => {
    const result = handleVaultRead({ path: "readable.md" }, vaultDir);
    assert.equal(result.frontmatter.title, "Read Me");
    assert.match(result.body, /Body here/);
    assert.ok(result.modified);
    assert.ok(result.size > 0);
  });

  it("returns error for missing file", () => {
    const result = handleVaultRead({ path: "nonexistent.md" }, vaultDir);
    assert.ok(result.error);
  });
});

describe("handleVaultList", () => {
  let vaultDir;

  before(() => {
    vaultDir = makeTempDir();
    fs.mkdirSync(path.join(vaultDir, "thinking"));
    fs.mkdirSync(path.join(vaultDir, "daily"));
    fs.writeFileSync(path.join(vaultDir, "thinking", "note.md"), "---\ntitle: T\ndate: D\n---\n");
    fs.writeFileSync(path.join(vaultDir, "daily", "today.md"), "---\ntitle: D\ndate: D\n---\n");
  });

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("lists all folders", () => {
    const result = handleVaultList(vaultDir);
    assert.ok(Array.isArray(result));
    const names = result.map((f) => f.name);
    assert.ok(names.includes("thinking"));
    assert.ok(names.includes("daily"));
  });
});

describe("handleVaultFolder", () => {
  let vaultDir;

  before(() => {
    vaultDir = makeTempDir();
    fs.mkdirSync(path.join(vaultDir, "notes"));
    fs.writeFileSync(
      path.join(vaultDir, "notes", "a.md"),
      "---\ntitle: A\ndate: 2026-01-01\ntags:\n  - test\n---\nContent A",
    );
    fs.writeFileSync(
      path.join(vaultDir, "notes", "b.md"),
      "---\ntitle: B\ndate: 2026-01-02\n---\nContent B",
    );
  });

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("lists files in folder with metadata", () => {
    const result = handleVaultFolder({ folder: "notes" }, vaultDir);
    assert.equal(result.total, 2);
    assert.ok(result.files.some((f) => f.title === "A"));
    assert.ok(result.files.some((f) => f.title === "B"));
  });

  it("filters by tag", () => {
    const result = handleVaultFolder({ folder: "notes", tag: "test" }, vaultDir);
    assert.equal(result.total, 1);
    assert.equal(result.files[0].title, "A");
  });

  it("rejects path traversal", () => {
    const result = handleVaultFolder({ folder: "../../etc" }, vaultDir);
    assert.ok(result.error);
  });
});

describe("handleVaultImage", () => {
  let vaultDir;

  before(() => {
    vaultDir = makeTempDir();
    // Write a tiny 1x1 PNG
    const pngData = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    fs.writeFileSync(path.join(vaultDir, "test.png"), pngData);
  });

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("reads a valid image as base64", () => {
    const result = handleVaultImage({ path: "test.png" }, vaultDir);
    assert.ok(result._image);
    assert.equal(result.mimeType, "image/png");
    assert.ok(result.data.length > 0);
  });

  it("rejects non-image extensions", () => {
    const result = handleVaultImage({ path: "malware.exe" }, vaultDir);
    assert.ok(result.error);
    assert.match(result.error, /extension/i);
  });
});

describe("handleVaultWriteAsset", () => {
  let vaultDir;

  before(() => {
    vaultDir = makeTempDir();
  });

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("saves a base64 image to assets/ subdirectory", () => {
    const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const result = handleVaultWriteAsset({ folder: "research", filename: "chart.png", data }, vaultDir);
    assert.ok(result.saved);
    assert.equal(result.path, "research/assets/chart.png");
    assert.ok(fs.existsSync(path.join(vaultDir, "research", "assets", "chart.png")));
  });
});
