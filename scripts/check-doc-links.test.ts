import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkMarkdownLinks, collectMarkdownFiles } from "./check-doc-links.js";
import { findBrokenLocalMarkdownLinks } from "./doc-links.js";

test("collects Markdown recursively and excludes generated directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "budokon-doc-links-"));
  try {
    await mkdir(path.join(root, "docs", "nested"), { recursive: true });
    await mkdir(path.join(root, "docs", "coverage"), { recursive: true });
    await mkdir(path.join(root, "docs", "node_modules"), { recursive: true });
    await writeFile(path.join(root, "README.md"), "# Project\n");
    await writeFile(path.join(root, "docs", "guide.md"), "# Guide\n");
    await writeFile(path.join(root, "docs", "nested", "Reference.MD"), "# Reference\n");
    await writeFile(path.join(root, "docs", "coverage", "generated.md"), "# Generated\n");
    await writeFile(path.join(root, "docs", "node_modules", "package.md"), "# Vendor\n");

    const files = await collectMarkdownFiles(root, ["README.md", "docs"]);
    assert.deepEqual(files.map(file => path.relative(root, file)).sort(), [
      "README.md",
      "docs/guide.md",
      path.join("docs", "nested", "Reference.MD"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checks collected Markdown files and returns broken-link details", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "budokon-doc-links-"));
  try {
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(path.join(root, "README.md"), "[Missing](missing.md)\n");
    await writeFile(path.join(root, "docs", "guide.md"), "[README](../README.md)\n");

    const result = await checkMarkdownLinks(root, ["README.md", "docs"]);
    assert.equal(result.files.length, 2);
    assert.deepEqual(result.errors, [
      `${path.join(root, "README.md")}:1: local link target does not exist: missing.md`,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local Markdown links resolve relative to the document", () => {
  const existing = new Set(["/repo/docs/API.md"]);
  const errors = findBrokenLocalMarkdownLinks(
    "[API](docs/API.md)\n[Missing](docs/MISSING.md)\n[Web](https://example.com)\n[Section](#start)",
    "/repo/README.md",
    file => existing.has(file),
  );

  assert.deepEqual(errors, ["/repo/README.md:2: local link target does not exist: docs/MISSING.md"]);
});

test("link checker ignores Markdown examples inside fenced code blocks", () => {
  const errors = findBrokenLocalMarkdownLinks(
    "```md\n[Example](not-a-real-file.md)\n```\n[Real](docs/API.md)",
    "/repo/README.md",
    file => file === "/repo/docs/API.md",
  );

  assert.deepEqual(errors, []);
});

test("fenced blocks require a matching marker and a closing fence at least as long", () => {
  const errors = findBrokenLocalMarkdownLinks(
    "~~~~md\n[Hidden](hidden.md)\n~~~\n[Still hidden](still-hidden.md)\n```\n[Still hidden](wrong-marker.md)\n~~~~\n[Missing](missing.md)",
    "/repo/README.md",
    () => false,
  );

  assert.deepEqual(errors, [
    "/repo/README.md:8: local link target does not exist: missing.md",
  ]);
});

test("local destinations decode paths and ignore external URLs, queries, and fragments", () => {
  const checkedPaths: string[] = [];
  const errors = findBrokenLocalMarkdownLinks(
    "[Encoded](../assets/my%20image.svg?size=1#preview)\n[Spaced](<../assets/source map.md>)\n[Bad escape](bad%ZZ.md)\n[Web](https://example.com)\n[Mail](mailto:hello@example.com)\n[Protocol relative](//cdn.example.com/file)\n[Anchor](#section)",
    "/repo/docs/guide.md",
    target => {
      checkedPaths.push(target);
      return target === "/repo/assets/my image.svg" || target === "/repo/assets/source map.md";
    },
  );

  assert.deepEqual(checkedPaths, [
    "/repo/assets/my image.svg",
    "/repo/assets/source map.md",
    "/repo/docs/bad%ZZ.md",
  ]);
  assert.deepEqual(errors, [
    "/repo/docs/guide.md:3: local link target does not exist: bad%ZZ.md",
  ]);
});
