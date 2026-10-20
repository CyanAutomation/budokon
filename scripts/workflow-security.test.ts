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
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  "continue-on-error"?: boolean;
  permissions?: Record<string, string>;
  environment?: string | { name?: string; url?: string };
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

function runOf(job: WorkflowJob, stepName: string): string {
  const step = job.steps.find(candidate => candidate.name === stepName);
  assert.ok(step, `workflow is missing the ${stepName} step`);
  return step.run ?? "";
}

function containsRetryAllErrorsOption(run: string): boolean {
  return /--retry-all-errors/u.test(run);
}

test("Node 24 is the supported runtime and every workflow uses it", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
    engines: { node: string };
  };
  const packageLock = JSON.parse(await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8")) as {
    packages: { "": { engines: { node: string } } };
  };

  assert.equal(packageJson.engines.node, "^24.10.0");
  assert.equal(packageLock.packages[""].engines.node, packageJson.engines.node);

  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDirectory)).filter(file => /\.ya?ml$/u.test(file));
  for (const fileName of workflowFiles) {
    const { document } = await readWorkflow(fileName);
    for (const job of Object.values(document.jobs)) {
      for (const step of job.steps.filter(candidate => candidate.uses?.startsWith("actions/setup-node@"))) {
        assert.equal(String(step.with?.["node-version"]), "24", `${fileName} must use Node 24`);
      }
    }
  }
});

test("Kaseki DRY dispatch is default-branch-only and pins the token destination", async () => {
  const { document, source } = await readWorkflow("kaseki-dry.yaml");
  const job = document.jobs.dry_sweep;

  assert.equal(job.if, "github.ref == 'refs/heads/main' && github.ref_protected");
  assert.match(source, /KASEKI_BASE_URL" != "https:\/\/kaseki-tunnel\.scheimann\.xyz"/u);
  assert.equal(job.env?.KASEKI_API_TOKEN, undefined);
  const tokenSteps = job.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN"));
  assert.equal(tokenSteps.length, 3);
});

test("every Kaseki Docs job is restricted to main", async () => {
  const { document } = await readWorkflow("kaseki-docs.yaml");
  assert.ok(Object.keys(document.jobs).length > 0);
  for (const [jobName, job] of Object.entries(document.jobs)) {
    assert.equal(job.if, "github.ref == 'refs/heads/main' && github.ref_protected", jobName);
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

test("production deployment requires the protected default branch", async () => {
  const { document } = await readWorkflow("deploy-cloudflare.yml");
  const deploy = document.jobs.deploy;

  assert.match(deploy.if ?? "", /github\.event\.repository\.default_branch/u);
  assert.match(deploy.if ?? "", /github\.ref_protected/u);
  assert.equal(typeof deploy.environment === "object" ? deploy.environment.name : deploy.environment, "production");
});

test("production deployment validates and uploads artifacts before entering the production environment", async () => {
  const { document } = await readWorkflow("deploy-cloudflare.yml");
  const build = document.jobs.build;
  const deploy = document.jobs.deploy;

  assert.equal(build.environment, undefined);
  assert.equal(deploy.needs, "build");
  assert.equal(typeof deploy.environment === "object" ? deploy.environment.name : deploy.environment, "production");
  assert.ok(build.steps.some(step => step.run === "npm run test"));
  assert.ok(build.steps.some(step => step.run === "npm run build:data"));
  assert.ok(build.steps.some(step => step.run === "npm run check-artifacts"));
  const upload = build.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
  const download = deploy.steps.find(step => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(upload?.with?.name, "cloudflare-deployment-dataset");
  assert.equal(upload?.with?.path, "dist/*.json");
  assert.equal(download?.with?.name, upload?.with?.name);
  assert.ok(deploy.steps.some(step => step.run === "npm run check-artifacts"));
  assert.equal(deploy.steps.some(step => step.run === "npm run test"), false);
});

test("credential-bearing manual workflows require the protected default branch", async () => {
  const jev = await readWorkflow("jev-advisory.yaml");
  const release = await readWorkflow("release.yaml");

  assert.match(jev.document.jobs["evaluate-search"].if ?? "", /github\.ref_protected/u);
  assert.match(release.document.jobs.prepare.if ?? "", /github\.ref_protected/u);
});

test("dataset release passes the default branch through the environment", async () => {
  const { document } = await readWorkflow("dataset-release.yml");
  const step = document.jobs.build.steps.find(candidate => candidate.name === "Associate dataset version, tag, and commit");

  assert.ok(step);
  assert.equal(step.env?.DEFAULT_BRANCH, "${{ github.event.repository.default_branch }}");
  assert.match(step.run ?? "", /"origin\/\$DEFAULT_BRANCH"/u);
  assert.doesNotMatch(step.run ?? "", /github\.event\.repository\.default_branch/u);
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

test("Kaseki sweeps use the versioned API base for checks and submissions", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  const expectedApiBase = "${{ vars.KASEKI_BASE_URL }}/api/v1";
  assert.equal(docs.document.jobs.api_connection.env?.KASEKI_API_BASE_URL, expectedApiBase);
  assert.equal(docs.document.jobs.dispatch.env?.KASEKI_API_BASE_URL, expectedApiBase);
  assert.equal(dry.document.jobs.dry_sweep.env?.KASEKI_API_BASE_URL, expectedApiBase);

  const workflows = [
    {
      name: "Kaseki Docs",
      readiness: runOf(docs.document.jobs.readiness, "Verify controller readiness"),
      api: runOf(docs.document.jobs.api_connection, "Verify Kaseki API readiness"),
      submit: runOf(docs.document.jobs.dispatch, "Submit documentation sweep"),
    },
    {
      name: "Kaseki DRY",
      readiness: runOf(dry.document.jobs.dry_sweep, "Verify controller readiness"),
      api: runOf(dry.document.jobs.dry_sweep, "Verify Kaseki API readiness"),
      submit: runOf(dry.document.jobs.dry_sweep, "Submit DRY sweep"),
    },
  ];

  for (const workflow of workflows) {
    assert.equal(workflow.readiness, "node scripts/check-kaseki.ts readiness", workflow.name);
    assert.equal(workflow.api, "node scripts/check-kaseki.ts api", workflow.name);
    assert.match(workflow.submit, /--request POST "\$KASEKI_API_BASE_URL\/runs"/u, workflow.name);
    assert.doesNotMatch(workflow.api, /curl/u, workflow.name);
  }

  assert.equal(docs.document.jobs.api_connection.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN")).length, 1);
  assert.equal(dry.document.jobs.dry_sweep.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN")).length, 3);
});

test("retry flag detection finds options embedded in quoted shell arguments", () => {
  for (const command of [
    'FLAGS="--retry-all-errors" curl "$URL"',
    'curl "$URL" "--retry-all-errors"',
  ]) {
    assert.equal(containsRetryAllErrorsOption(command), true, command);
  }

  assert.equal(containsRetryAllErrorsOption('curl --retry 3 "$URL"'), false);
});

test("Kaseki workflows do not retry permanent HTTP errors", async () => {
  for (const fileName of ["kaseki-docs.yaml", "kaseki-dry.yaml"]) {
    const { document } = await readWorkflow(fileName);
    const curlSteps = Object.entries(document.jobs).flatMap(([jobName, job]) =>
      job.steps
        .filter(step => step.run?.split(/\s+/u).includes("curl"))
        .map(step => ({ jobName, step })));

    assert.ok(curlSteps.length > 0, `${fileName} must inspect its Kaseki HTTP commands`);
    for (const { jobName, step } of curlSteps) {
      assert.equal(
        containsRetryAllErrorsOption(step.run ?? ""),
        false,
        `${fileName}:${jobName} must not retry permanent HTTP errors`,
      );
    }
  }
});

test("Kaseki Docs API credentials are limited to request steps", async () => {
  const { document } = await readWorkflow("kaseki-docs.yaml");
  const apiConnection = document.jobs.api_connection;
  const dispatch = document.jobs.dispatch;

  assert.equal(apiConnection.env?.KASEKI_API_TOKEN, undefined);
  assert.equal(apiConnection.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN")).length, 1);
  assert.equal(dispatch.env?.KASEKI_API_TOKEN, undefined);
  assert.equal(dispatch.steps.filter(step => Object.hasOwn(step.env ?? {}, "KASEKI_API_TOKEN")).length, 2);
});

test("Kaseki sweep workflows invoke the shared polling helper with run credentials", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  const docsWait = docs.document.jobs.dispatch.steps.find(step => step.name === "Wait for Kaseki completion");
  const dryWait = dry.document.jobs.dry_sweep.steps.find(step => step.name === "Wait for Kaseki completion");

  for (const [fileName, step, expectedRunId] of [
    ["kaseki-docs.yaml", docsWait, "${{ steps.submit.outputs.run_id }}"],
    ["kaseki-dry.yaml", dryWait, "${{ steps.submit.outputs.run_id }}"],
  ] as const) {
    assert.ok(step, `${fileName} must wait for Kaseki completion`);
    assert.equal(step.run, "node scripts/wait-for-kaseki.ts", fileName);
    assert.equal(step.env?.RUN_ID, expectedRunId, fileName);
    assert.equal(step.env?.KASEKI_API_TOKEN, "${{ secrets.KASEKI_API_TOKEN }}", fileName);
  }
});

test("Kaseki sweeps do not persist checkout credentials", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  for (const [fileName, jobs] of [
    ["kaseki-docs.yaml", docs.document.jobs],
    ["kaseki-dry.yaml", dry.document.jobs],
  ] as const) {
    for (const [jobName, job] of Object.entries(jobs)) {
      const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
      if (checkout) assert.equal(checkout.with?.["persist-credentials"], false, `${fileName}:${jobName}`);
    }
  }

  for (const [jobName, job] of [
    ["readiness", docs.document.jobs.readiness],
    ["api_connection", docs.document.jobs.api_connection],
  ] as const) {
    assert.ok(job.steps.some(step => step.uses?.startsWith("actions/checkout@")), `kaseki-docs:${jobName}`);
    assert.ok(job.steps.some(step => step.uses?.startsWith("actions/setup-node@")), `kaseki-docs:${jobName}`);
  }
});

test("Kaseki sweep validation checks the supported Node runtime before repository checks", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");
  for (const command of [
    String(docs.document.env?.VALIDATION_COMMAND),
    String(dry.document.jobs.dry_sweep.env?.VALIDATION_COMMAND),
  ]) {
    assert.match(command, /major !== 24/u);
    assert.match(command, /minor < 10/u);
    assert.match(command, /npm run check/u);
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
  const build = document.jobs.build;
  const testStepIndex = build.steps.findIndex(step => step.run === "npm run test");
  const artifactBuildIndex = build.steps.findIndex(step => step.run === "npm run build");
  const uploadIndex = build.steps.findIndex(step => step.uses?.startsWith("actions/upload-artifact@"));

  assert.ok(testStepIndex >= 0, "dataset release must run the test suite");
  assert.ok(artifactBuildIndex > testStepIndex, "release artifacts must be built only after tests pass");
  assert.ok(uploadIndex > testStepIndex, "release artifacts must be uploaded only after tests pass");
  assert.notEqual(build.steps[testStepIndex]["continue-on-error"], true, "test failures must fail the build job");
  assert.notEqual(build["continue-on-error"], true, "build failures must block publication");
  assert.equal(document.jobs.release.needs, "build", "publishing must depend on the successful build job");
});
