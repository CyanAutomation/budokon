import { existsSync } from "node:fs";
import path from "node:path";

export function findBrokenLocalMarkdownLinks(
  markdown: string,
  sourceFile: string,
  fileExists: (target: string) => boolean = existsSync,
): string[] {
  const errors: string[] = [];
  const lines = markdown.split("\n");
  let fence: { marker: string; length: number } | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      lines[lineIndex] = "";
      if (fenceMatch && fenceMatch[1]![0] === fence.marker && fenceMatch[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      lines[lineIndex] = "";
    }
  }

  const prose = lines.join("\n");
  const markdownLink = /!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
  for (const match of prose.matchAll(markdownLink)) {
    const destination = match[1] ?? match[2] ?? "";
    if (!destination || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue;
    const [encodedPath] = destination.split(/[?#]/, 1);
    if (!encodedPath) continue;

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(encodedPath);
    } catch {
      decodedPath = encodedPath;
    }
    const targetPath = path.resolve(path.dirname(sourceFile), decodedPath);
    if (fileExists(targetPath)) continue;

    const lineNumber = prose.slice(0, match.index).split("\n").length;
    errors.push(`${sourceFile}:${lineNumber}: local link target does not exist: ${destination}`);
  }

  return errors;
}
