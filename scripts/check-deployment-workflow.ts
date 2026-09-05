import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workflowRelativePath = ".github/workflows/deploy-cloudflare.yml";
const packageRelativePath = "package.json";
const requiredScriptNames = ["validate:deployment-target", "smoke:deployment"] as const;
const releaseWorkflowRelativePath = ".github/workflows/release.yml";
export const requiredReleaseArtifacts = [
  "budokon.json",
  "countries.json",
  "events.json",
  "judoka.json",
  "manifest.json",
  "techniques.json",
  "weight-categories.json",
] as const;

type RequiredScriptName = (typeof requiredScriptNames)[number];

export type DeploymentWorkflowValidationErrorCode =
  | "stale-helper-reference"
  | "missing-npm-script"
  | "missing-workflow-command"
  | "invalid-entry-point"
  | "missing-entry-point"
  | "missing-artifact-check"
  | "missing-release-upload"
  | "missing-release-artifact";

export class DeploymentWorkflowValidationError extends Error {
  constructor(
    readonly code: DeploymentWorkflowValidationErrorCode,
    message: string,
    readonly details: {
      scriptName?: RequiredScriptName;
      entryPoint?: string;
      staleHelpers?: string[];
      workflowPath?: string;
      artifactName?: string;
    } = {},
  ) {
    super(message);
    this.name = "DeploymentWorkflowValidationError";
  }
}

function jobBody(workflow: string, jobName: string): string | undefined {
  const lines = workflow.split(/\r?\n/);
  const jobsIndex = lines.findIndex(line => /^jobs:\s*(?:#.*)?$/.test(line));
  if (jobsIndex < 0) return undefined;

  const jobPattern = new RegExp(`^(\\s{2})${jobName}:\\s*(?:#.*)?$`);
  const start = lines.findIndex((line, index) => index > jobsIndex && jobPattern.test(line));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}\S/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function invokesNpmScript(job: string, scriptName: string): boolean {
  const escapedName = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[;&|\\s])npm\\s+run\\s+${escapedName}(?=$|[;&|\\s])`, "m").test(job);
}

function releaseUploadFiles(job: string): string[] | undefined {
  const lines = job.split(/\r?\n/);
  const uploadIndex = lines.findIndex(line => /^\s*-\s+uses:\s*softprops\/action-gh-release@/.test(line));
  if (uploadIndex < 0) return undefined;
  const stepIndent = lines[uploadIndex].match(/^\s*/)?.[0].length ?? 0;
  const end = lines.findIndex(
    (line, index) => index > uploadIndex && new RegExp(`^\\s{${stepIndent}}-\\s`).test(line),
  );
  const step = lines.slice(uploadIndex, end < 0 ? undefined : end);
  const filesIndex = step.findIndex(line => /^\s+files:\s*(?:[|>][-+]?\s*)?$/.test(line));
  if (filesIndex < 0) return [];
  const filesIndent = step[filesIndex].match(/^\s*/)?.[0].length ?? 0;
  return step
    .slice(filesIndex + 1)
    .filter(line => (line.match(/^\s*/)?.[0].length ?? 0) > filesIndent)
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"));
}

/** Validate commands and upload inputs in their intended jobs, rather than anywhere in the YAML text. */
export async function checkDeploymentReleaseArtifacts(repositoryRoot: string): Promise<void> {
  const deploymentPath = path.resolve(repositoryRoot, workflowRelativePath);
  const releasePath = path.resolve(repositoryRoot, releaseWorkflowRelativePath);
  const [deploymentWorkflow, releaseWorkflow] = await Promise.all([
    readFile(deploymentPath, "utf8"),
    readFile(releasePath, "utf8"),
  ]);

  for (const [workflowPath, jobName, workflow] of [
    [deploymentPath, "deploy", deploymentWorkflow],
    [releasePath, "release", releaseWorkflow],
  ] as const) {
    const job = jobBody(workflow, jobName);
    if (!job || !invokesNpmScript(job, "check-artifacts")) {
      throw new DeploymentWorkflowValidationError(
        "missing-artifact-check",
        `${path.basename(workflowPath)} job ${jobName} does not invoke npm run check-artifacts`,
        { workflowPath },
      );
    }
  }

  const releaseJob = jobBody(releaseWorkflow, "release")!;
  const uploadedFiles = releaseUploadFiles(releaseJob);
  if (!uploadedFiles) {
    throw new DeploymentWorkflowValidationError(
      "missing-release-upload",
      "Release job does not contain a softprops/action-gh-release upload step",
      { workflowPath: releasePath },
    );
  }
  for (const artifactName of requiredReleaseArtifacts) {
    if (!uploadedFiles.includes(`dist/${artifactName}`) && !uploadedFiles.includes("dist/*.json")) {
      throw new DeploymentWorkflowValidationError(
        "missing-release-artifact",
        `Release upload does not include dist/${artifactName}`,
        { workflowPath: releasePath, artifactName },
      );
    }
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
    await checkDeploymentReleaseArtifacts(process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
