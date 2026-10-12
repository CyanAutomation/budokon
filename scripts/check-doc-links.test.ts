import assert from "node:assert/strict";
import test from "node:test";
import { findBrokenLocalMarkdownLinks } from "./doc-links.js";

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
