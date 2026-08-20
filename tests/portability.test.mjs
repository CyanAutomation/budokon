import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const coreDirectories = ["domain", "draw", "repository", "api", "mcp"];
test("runtime-neutral core does not import Node built-ins", async () => {
  const files = (await Promise.all(coreDirectories.map(async directory =>
    (await readdir(new URL(`../src/${directory}/`, import.meta.url))).filter(name => name.endsWith(".ts")).map(name => join("src", directory, name))
  ))).flat();
  const violations = [];
  for (const file of files) if (/from\s+["']node:|import\s*\(["']node:/.test(await readFile(file, "utf8"))) violations.push(file);
  assert.deepEqual(violations, []);
});
