import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

interface WorkflowStep {
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  if?: string;
  permissions?: Record<string, string>;
  env?: Record<string, unknown>;
  steps: WorkflowStep[];
}

interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

const repositoryRoot = process.cwd();

async function readWorkflow(fileName: string): Promise<{ document: Workflow; source: string }> {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", fileName), "utf8");
  return { document: parse(source) as Workflow, source };
}

test("Kaseki DRY dispatch is default-branch-only and pins the token destination", async () => {
  const { document, source } = await readWorkflow("kaseki-dry.yaml");
  const job = document.jobs.dry_sweep;

  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.match(source, /KASEKI_BASE_URL" != "https:\/\/kaseki-tunnel\.scheimann\.xyz"/u);
  assert.equal(job.env?.KASEKI_API_TOKEN, undefined);
  const tokenSteps = job.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN"));
  assert.equal(tokenSteps.length, 3);
});

test("every Kaseki Docs job is restricted to main", async () => {
  const { document } = await readWorkflow("kaseki-docs.yaml");
  assert.ok(Object.keys(document.jobs).length > 0);
  for (const [jobName, job] of Object.entries(document.jobs)) {
    assert.equal(job.if, "github.ref == 'refs/heads/main'", jobName);
  }
});

test("application release builds read-only and publishes from a minimal write job", async () => {
  const { document } = await readWorkflow("release.yaml");
  const prepare = document.jobs.prepare;
  const publish = document.jobs.publish;
  assert.equal(document.permissions?.contents, "read");
  assert.equal(prepare.permissions?.contents, "read");
  assert.equal(publish.permissions?.contents, "write");

  const checkout = prepare.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout?.with?.["persist-credentials"], false);
  assert.equal(publish.steps.some(step => step.uses?.startsWith("actions/checkout@")), false);
  assert.equal(publish.steps.some(step => /\bnpm (?:ci|run)\b/u.test(step.run ?? "")), false);
  assert.equal(publish.steps.filter(step => Object.hasOwn(step.env ?? {}, "GITHUB_TOKEN")).length, 1);
});

test("read-only validation and deployment checkouts do not retain GitHub credentials", async () => {
  for (const fileName of ["validate.yml", "deploy-cloudflare.yml"]) {
    const { document } = await readWorkflow(fileName);
    for (const job of Object.values(document.jobs)) {
      const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
      if (checkout) assert.equal(checkout.with?.["persist-credentials"], false, fileName);
    }
  }
});

test("Dependabot keeps pinned GitHub Actions revisions on a weekly update cadence", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "dependabot.yml"), "utf8");
  const document = parse(source) as { version: number; updates: Array<{ "package-ecosystem": string; directory: string; schedule: { interval: string } }> };

  assert.equal(document.version, 2);
  assert.ok(document.updates.some(update =>
    update["package-ecosystem"] === "github-actions" && update.directory === "/" && update.schedule.interval === "weekly"));
});
