import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, join } from "node:path";
import test from "node:test";
import ts from "typescript";
import packageBoundaries from "../package-boundaries.json" with { type: "json" };

async function sourceFilesBelow(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(child);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [child] : [];
  }))).flat();
}

function importedSpecifiers(source: string, file: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const add = (node: ts.Expression | undefined) => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) specifiers.push(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

test("runtime-neutral core does not import Node built-ins", async () => {
  const files = [
    ...packageBoundaries.runtimeNeutralFiles,
    ...(await Promise.all(packageBoundaries.runtimeNeutralRoots.map(sourceFilesBelow))).flat(),
  ];
  const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, "")));
  const violations: string[] = [];
  for (const file of files) {
    const specifiers = importedSpecifiers(await readFile(file, "utf8"), file);
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:") || builtins.has(specifier)) violations.push(`${file}: ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("every source package has an explicit runtime boundary", async () => {
  const configuredRoots = new Set([
    ...packageBoundaries.runtimeNeutralRoots,
    ...packageBoundaries.runtimeSpecificRoots,
  ].map(root => basename(root)));
  const sourcePackages = (await readdir("src", { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  assert.deepEqual(sourcePackages.filter(name => !configuredRoots.has(name)), []);
});
