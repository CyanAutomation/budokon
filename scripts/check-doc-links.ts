import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrokenLocalMarkdownLinks } from "./doc-links.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "build", "coverage", "dist"]);
const sourceDirectories = ["README.md", "docs", "data/judoka", "migrations"];

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : markdownFiles(file);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? [file] : [];
  }));
  return files.flat();
}

export async function collectMarkdownFiles(
  rootDirectory: string,
  sources: readonly string[] = sourceDirectories,
): Promise<string[]> {
  const files = await Promise.all(sources.map(async source => {
    const absolute = path.join(rootDirectory, source);
    return source.endsWith(".md") ? [absolute] : markdownFiles(absolute);
  }));
  return files.flat();
}

export async function checkMarkdownLinks(
  rootDirectory: string,
  sources: readonly string[] = sourceDirectories,
): Promise<{ files: string[]; errors: string[] }> {
  const files = await collectMarkdownFiles(rootDirectory, sources);
  const results = await Promise.all(files.map(async file =>
    findBrokenLocalMarkdownLinks(await readFile(file, "utf8"), file),
  ));
  return { files, errors: results.flat() };
}

async function main(): Promise<void> {
  const { files, errors } = await checkMarkdownLinks(root);
  if (errors.length === 0) {
    console.log(`Checked local Markdown links in ${files.length} files.`);
    return;
  }

  console.error(`Broken local Markdown links:\n${errors.map(error =>
    `- ${path.relative(root, error.slice(0, error.indexOf(":")))}${error.slice(error.indexOf(":"))}`,
  ).join("\n")}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
