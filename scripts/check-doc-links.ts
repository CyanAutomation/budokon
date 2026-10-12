import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrokenLocalMarkdownLinks } from "./doc-links.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "build", "coverage", "dist"]);

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : markdownFiles(file);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [file] : [];
  }));
  return files.flat();
}

const sourceDirectories = ["README.md", "docs", "data/judoka", "migrations"];
const files = (await Promise.all(sourceDirectories.map(async source => {
  const absolute = path.join(root, source);
  return source.endsWith(".md") ? [absolute] : markdownFiles(absolute);
}))).flat();
const errors = (await Promise.all(files.map(async file =>
  findBrokenLocalMarkdownLinks(await readFile(file, "utf8"), file),
))).flat();

if (errors.length > 0) {
  console.error(`Broken local Markdown links:\n${errors.map(error =>
    `- ${path.relative(root, error.slice(0, error.indexOf(":")))}${error.slice(error.indexOf(":"))}`,
  ).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Checked local Markdown links in ${files.length} files.`);
}
