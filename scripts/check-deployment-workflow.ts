import { access, readFile } from "node:fs/promises";

const workflowPath = ".github/workflows/deploy-cloudflare.yml";
const packagePath = "package.json";

const workflow = await readFile(workflowPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
  scripts?: Record<string, string>;
};

const staleHelpers = workflow.match(/scripts\/[\w./-]+\.mjs\b/g) ?? [];
if (staleHelpers.length > 0) {
  throw new Error(
    `Deployment workflow contains stale JavaScript helper references:\n${staleHelpers.map(path => `- ${path}`).join("\n")}`,
  );
}

const requiredScripts = ["validate:deployment-target", "smoke:deployment"];
for (const scriptName of requiredScripts) {
  const command = packageJson.scripts?.[scriptName];
  if (!command) {
    throw new Error(`Missing npm script: ${scriptName}`);
  }
  if (!workflow.includes(`npm run ${scriptName}`)) {
    throw new Error(`Deployment workflow does not invoke npm script: ${scriptName}`);
  }

  const entryPoint = command.match(/^tsx\s+(scripts\/[\w./-]+\.ts)$/)?.[1];
  if (!entryPoint) {
    throw new Error(`npm script ${scriptName} must run a tracked TypeScript entry point with tsx`);
  }
  await access(entryPoint);
}
