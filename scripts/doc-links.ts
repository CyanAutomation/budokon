import { existsSync } from "node:fs";
import path from "node:path";

type MarkdownLinkDestination = { destination: string; lineNumber: number };

function stripFencedCode(markdown: string): string {
  const lines = markdown.split("\n");
  let fence: { marker: string; length: number } | undefined;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      lines[lineIndex] = "";
      const marker = fenceMatch?.[1];
      if (marker && marker[0] === fence.marker && marker.length >= fence.length) fence = undefined;
      continue;
    }
    const marker = fenceMatch?.[1];
    if (!marker) continue;
    fence = { marker: marker[0]!, length: marker.length };
    lines[lineIndex] = "";
  }

  return lines.join("\n");
}

function findLinkDestinations(prose: string): MarkdownLinkDestination[] {
  const destinations: MarkdownLinkDestination[] = [];
  const markdownLink = /!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
  for (const match of prose.matchAll(markdownLink)) {
    const destination = match[1] ?? match[2] ?? "";
    if (!destination) continue;
    destinations.push({
      destination,
      lineNumber: prose.slice(0, match.index).split("\n").length,
    });
  }
  return destinations;
}

function localTargetPath(destination: string, sourceFile: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) return undefined;
  const [encodedPath] = destination.split(/[?#]/, 1);
  if (!encodedPath) return undefined;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    decodedPath = encodedPath;
  }
  return path.resolve(path.dirname(sourceFile), decodedPath);
}

export function findBrokenLocalMarkdownLinks(
  markdown: string,
  sourceFile: string,
  fileExists: (target: string) => boolean = existsSync,
): string[] {
  const errors: string[] = [];
  const prose = stripFencedCode(markdown);
  for (const { destination, lineNumber } of findLinkDestinations(prose)) {
    const targetPath = localTargetPath(destination, sourceFile);
    if (!targetPath || fileExists(targetPath)) continue;
    errors.push(`${sourceFile}:${lineNumber}: local link target does not exist: ${destination}`);
  }

  return errors;
}
