import { readdir } from "node:fs/promises";
import path from "node:path";

const sourceRoots = ["src", "worker", "scripts", "tests"];
const javascriptExtensions = new Set([".js", ".mjs", ".cjs"]);

async function findJavaScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.map(async entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return findJavaScriptFiles(file);
    return javascriptExtensions.has(path.extname(entry.name)) ? [file] : [];
  }));
  return results.flat();
}

const javascriptFiles = (await Promise.all(sourceRoots.map(findJavaScriptFiles))).flat();
if (javascriptFiles.length > 0) {
  throw new Error(`TypeScript-only source policy violated:\n${javascriptFiles.map(file => `- ${file}`).join("\n")}`);
}
