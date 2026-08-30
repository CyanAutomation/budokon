import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workflowRelativePath = ".github/workflows/deploy-cloudflare.yml";
const packageRelativePath = "package.json";
const requiredScriptNames = ["validate:deployment-target", "smoke:deployment"] as const;

type RequiredScriptName = (typeof requiredScriptNames)[number];

export type DeploymentWorkflowValidationErrorCode =
  | "stale-helper-reference"
  | "missing-npm-script"
  | "missing-workflow-command"
  | "invalid-entry-point"
  | "missing-entry-point";

export class DeploymentWorkflowValidationError extends Error {
  constructor(
    readonly code: DeploymentWorkflowValidationErrorCode,
    message: string,
    readonly details: {
      scriptName?: RequiredScriptName;
      entryPoint?: string;
      staleHelpers?: string[];
    } = {},
  ) {
    super(message);
    this.name = "DeploymentWorkflowValidationError";
  }
}

export interface DeploymentWorkflowValidationResult {
  repositoryRoot: string;
  workflowPath: string;
  packagePath: string;
  scripts: Array<{
    name: RequiredScriptName;
    command: string;
    entryPoint: string;
  }>;
}

export async function checkDeploymentWorkflow(
  repositoryRoot: string,
): Promise<DeploymentWorkflowValidationResult> {
  const workflowPath = path.resolve(repositoryRoot, workflowRelativePath);
  const packagePath = path.resolve(repositoryRoot, packageRelativePath);
  const workflow = await readFile(workflowPath, "utf8");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    scripts?: Record<string, string>;
  };

  const staleHelpers = workflow.match(/scripts\/[\w./-]+\.mjs\b/g) ?? [];
  if (staleHelpers.length > 0) {
    throw new DeploymentWorkflowValidationError(
      "stale-helper-reference",
      `Deployment workflow contains stale JavaScript helper references:\n${staleHelpers.map(helper => `- ${helper}`).join("\n")}`,
      { staleHelpers },
    );
  }

  const scripts: DeploymentWorkflowValidationResult["scripts"] = [];
  for (const scriptName of requiredScriptNames) {
    const command = packageJson.scripts?.[scriptName];
    if (!command) {
      throw new DeploymentWorkflowValidationError("missing-npm-script", `Missing npm script: ${scriptName}`, {
        scriptName,
      });
    }
    if (!workflow.includes(`npm run ${scriptName}`)) {
      throw new DeploymentWorkflowValidationError(
        "missing-workflow-command",
        `Deployment workflow does not invoke npm script: ${scriptName}`,
        { scriptName },
      );
    }

    const entryPoint = command.match(/^tsx\s+(scripts\/[\w./-]+\.ts)$/)?.[1];
    if (!entryPoint) {
      throw new DeploymentWorkflowValidationError(
        "invalid-entry-point",
        `npm script ${scriptName} must run a tracked TypeScript entry point with tsx`,
        { scriptName },
      );
    }
    try {
      await access(path.resolve(repositoryRoot, entryPoint));
    } catch {
      throw new DeploymentWorkflowValidationError(
        "missing-entry-point",
        `Entry point file not found: ${entryPoint}`,
        { scriptName, entryPoint },
      );
    }
    scripts.push({ name: scriptName, command, entryPoint });
  }

  return { repositoryRoot: path.resolve(repositoryRoot), workflowPath, packagePath, scripts };
}

async function runCli(): Promise<void> {
  try {
    await checkDeploymentWorkflow(process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
