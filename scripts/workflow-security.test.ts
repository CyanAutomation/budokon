import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

interface WorkflowStep {
  name?: string;
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
  env?: Record<string, unknown>;
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
  assert.equal(tokenSteps.length, 5);
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

test("Dependabot checks npm and GitHub Actions weekly", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "dependabot.yml"), "utf8");
  const document = parse(source) as { version: number; updates: Array<{ "package-ecosystem": string; directory: string; schedule: { interval: string } }> };

  assert.equal(document.version, 2);
  assert.ok(document.updates.some(update =>
    update["package-ecosystem"] === "github-actions" && update.directory === "/" && update.schedule.interval === "weekly"));
  assert.ok(document.updates.some(update =>
    update["package-ecosystem"] === "npm" && update.directory === "/" && update.schedule.interval === "weekly"));
});

test("external workflow actions are pinned to full commit SHAs", async () => {
  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDirectory)).filter(file => /\.ya?ml$/u.test(file));
  let externalActionCount = 0;

  for (const fileName of workflowFiles) {
    const { document } = await readWorkflow(fileName);
    for (const [jobName, job] of Object.entries(document.jobs)) {
      for (const step of job.steps) {
        if (!step.uses || step.uses.startsWith("./")) continue;
        externalActionCount += 1;
        const revision = step.uses.slice(step.uses.lastIndexOf("@") + 1);
        assert.match(revision, /^[0-9a-f]{40}$/u, `${fileName}:${jobName} action ${step.uses} must use a full commit SHA`);
      }
    }
  }

  assert.ok(externalActionCount > 0, "the pinning check must inspect at least one external workflow action");
});

test("Kaseki sweeps always target main and request regular pull requests", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  assert.equal(docs.document.env?.REF, "main");
  assert.equal(dry.document.jobs.dry_sweep.env?.REF, "main");

  for (const source of [docs.source, dry.source]) {
    assert.match(source, /publishMode: "pr"/u);
    assert.doesNotMatch(source, /draft_pr/u);
    assert.doesNotMatch(source, /github\.event\.repository\.default_branch/u);
  }
});

test("Kaseki sweeps check API capabilities and runner preflight before submission", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  const docsApiChecks = docs.document.jobs.api_connection.steps.map(step => step.run ?? "").join("\n");
  const drySteps = dry.document.jobs.dry_sweep.steps.map(step => step.run ?? "").join("\n");

  for (const workflowText of [docsApiChecks, drySteps]) {
    assert.match(workflowText, /\/api\/capabilities/u);
    assert.match(workflowText, /\/api\/preflight/u);
    assert.match(workflowText, /publishModes[\s\S]{0,120}pr/u);
  }
});

test("Kaseki Docs API credentials are limited to request steps", async () => {
  const { document } = await readWorkflow("kaseki-docs.yaml");
  const apiConnection = document.jobs.api_connection;
  const dispatch = document.jobs.dispatch;

  assert.equal(apiConnection.env?.KASEKI_API_TOKEN, undefined);
  assert.equal(apiConnection.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN")).length, 3);
  assert.equal(dispatch.env?.KASEKI_API_TOKEN, undefined);
  assert.equal(dispatch.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN")).length, 2);
});

test("Kaseki sweeps treat an empty diff as a successful no-op", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  const docsWait = docs.document.jobs.dispatch.steps.find(step => step.name === "Wait for Kaseki completion");
  const dryWait = dry.document.jobs.dry_sweep.steps.find(step => step.name === "Wait for Kaseki completion");

  for (const step of [docsWait, dryWait]) {
    assert.ok(step?.run);
    assert.match(step.run, /failureClass/u);
    assert.match(step.run, /empty-diff/u);
    assert.match(step.run, /no_changes/u);
  }
});

test("JEV API credentials are limited to the evaluation steps", async () => {
  const { document } = await readWorkflow("jev-advisory.yaml");
  const job = document.jobs["evaluate-search"];

  assert.equal(job.env?.JEV_OPENROUTER_API_KEY, undefined);
  const evaluationSteps = job.steps.filter(step => /npm run jev:evaluate/u.test(step.run ?? ""));
  assert.equal(evaluationSteps.length, 2);
  for (const step of evaluationSteps) assert.ok(Object.hasOwn(step.env ?? {}, "JEV_OPENROUTER_API_KEY"));
  for (const step of job.steps.filter(step => !evaluationSteps.includes(step))) {
    assert.equal(Object.hasOwn(step.env ?? {}, "JEV_OPENROUTER_API_KEY"), false);
  }
});

test("dataset releases run the repository test suite before publishing artifacts", async () => {
  const { document } = await readWorkflow("dataset-release.yml");
  assert.ok(document.jobs.build.steps.some(step => step.run === "npm run test"));
});
