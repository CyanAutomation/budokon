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
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  env?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

const repositoryRoot = process.cwd();

async function readWorkflow(fileName: string): Promise<{ document: Workflow; source: string }> {
  const source = await readFile(path.join(repositoryRoot, ".github", "workflows", fileName), "utf8");
  return { document: parse(source) as Workflow, source };
}

test("Node 26 is the supported runtime and every workflow uses the shared version file", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
    engines: { node: string };
  };
  const packageLock = JSON.parse(await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8")) as {
    packages: { "": { engines: { node: string } } };
  };
  const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");

  assert.equal(packageJson.engines.node, "^26.0.0");
  assert.equal(packageLock.packages[""].engines.node, packageJson.engines.node);
  assert.equal((await readFile(path.join(repositoryRoot, ".nvmrc"), "utf8")).trim(), "26");
  assert.match(readme, /Prerequisites: Node\.js 26 .*\.nvmrc.* and npm/u);

  const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDirectory)).filter(file => /\.ya?ml$/u.test(file));
  for (const fileName of workflowFiles) {
    const { document } = await readWorkflow(fileName);
    for (const job of Object.values(document.jobs)) {
      for (const step of job.steps.filter(candidate => candidate.uses?.startsWith("actions/setup-node@"))) {
        assert.equal(String(step.with?.["node-version-file"]), ".nvmrc", `${fileName} must use .nvmrc`);
        assert.equal(step.with?.["node-version"], undefined, `${fileName} must not duplicate the Node version`);
      }
    }
  }
});

test("Soyuz sweeps run only from protected main in the soyuz environment", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  for (const [fileName, job] of [
    ["kaseki-docs.yaml", docs.document.jobs.docs_sweep],
    ["kaseki-dry.yaml", dry.document.jobs.dry_sweep],
  ] as const) {
    assert.equal(job.if, "github.ref == 'refs/heads/main' && github.ref_protected", fileName);
    assert.equal(job.environment, "soyuz", fileName);
    assert.equal(job.env?.SOYUZ_BASE_URL, "${{ vars.SOYUZ_BASE_URL }}", fileName);
    assert.equal(job.env?.SOYUZ_SUBMISSION_API_TOKEN, undefined, fileName);
    assert.equal(job.env?.KASEKI_BASE_URL, undefined, fileName);
    assert.equal(job.env?.KASEKI_API_TOKEN, undefined, fileName);
  }

  assert.equal(docs.document.permissions?.contents, "read");
  assert.equal(dry.document.permissions?.contents, "read");
});

test("Soyuz environment setup documents the main-only deployment policy and credentials", async () => {
  const guide = await readFile(path.join(repositoryRoot, "docs", "DEPLOYMENT.md"), "utf8");

  assert.match(guide, /environment named `soyuz`/u);
  assert.match(guide, /deployment branch\s+policy to `main`/u);
  assert.match(guide, /`SOYUZ_BASE_URL` \| Variable/u);
  assert.match(guide, /`SOYUZ_SUBMISSION_API_TOKEN` \| Secret/u);
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

test("Cloudflare deployment requires the protected default branch and cloudflare environment", async () => {
  const { document } = await readWorkflow("deploy-cloudflare.yml");
  const deploy = document.jobs.deploy;

  assert.match(deploy.if ?? "", /github\.event\.repository\.default_branch/u);
  assert.match(deploy.if ?? "", /github\.ref_protected/u);
  assert.equal(typeof deploy.environment === "object" ? deploy.environment.name : deploy.environment, "cloudflare");

  const deploymentGuide = await readFile(path.join(repositoryRoot, "docs", "DEPLOYMENT.md"), "utf8");
  assert.match(deploymentGuide, /environment named `cloudflare`/u);
  assert.match(deploymentGuide, /deployment branch policy to allow only `main`/u);
});

test("Cloudflare deployment validates and uploads artifacts before entering its environment", async () => {
  const { document } = await readWorkflow("deploy-cloudflare.yml");
  const build = document.jobs.build;
  const deploy = document.jobs.deploy;

  assert.equal(build.environment, undefined);
  assert.equal(deploy.needs, "build");
  assert.equal(typeof deploy.environment === "object" ? deploy.environment.name : deploy.environment, "cloudflare");
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

test("Cloudflare deployment credentials use the cloudflare environment secret and variable", async () => {
  const { document } = await readWorkflow("deploy-cloudflare.yml");
  const deploy = document.jobs.deploy;
  const deployStep = deploy.steps.find(step => step.name === "Deploy Worker");
  const validateStep = deploy.steps.find(step => step.name === "Validate and identify deployed public target");

  assert.ok(deployStep);
  assert.ok(validateStep);
  for (const step of [deployStep, validateStep]) {
    assert.equal(step.env?.CLOUDFLARE_API_TOKEN, "${{ secrets.CLOUDFLARE_API_TOKEN }}");
    assert.equal(step.env?.CLOUDFLARE_ACCOUNT_ID, "${{ vars.CLOUDFLARE_ACCOUNT_ID }}");
  }
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

test("CodeQL manual dispatch is limited to the protected default branch", async () => {
  const { document } = await readWorkflow("codeql.yml");
  const job = document.jobs.analyze;

  assert.equal(
    job.if,
    "github.event_name != 'workflow_dispatch' || (github.ref == format('refs/heads/{0}', github.event.repository.default_branch) && github.ref_protected)",
  );
  assert.equal(document.permissions?.["security-events"], undefined);
  assert.equal(job.permissions?.actions, "read");
  assert.equal(job.permissions?.contents, "read");
  assert.equal(job.permissions?.["security-events"], "write");
});

test("validation and CodeQL run for merge queue checks", async () => {
  for (const fileName of ["validate.yml", "codeql.yml"]) {
    const { document } = await readWorkflow(fileName);
    assert.ok(Object.hasOwn(document.on ?? {}, "merge_group"), `${fileName} must run for merge queue checks`);
  }
});

test("release dry-run input is passed through the environment", async () => {
  const { document } = await readWorkflow("release.yaml");
  const plan = document.jobs.prepare.steps.find(step => step.name === "Plan release");

  assert.ok(plan);
  assert.equal(plan.env?.DRY_RUN, "${{ inputs.dry_run }}");
  assert.match(plan.run ?? "", /\$DRY_RUN/u);
  assert.doesNotMatch(plan.run ?? "", /\$\{\{\s*inputs\.dry_run/u);
});

test("pull requests receive dependency review", async () => {
  const { document } = await readWorkflow("validate.yml");
  const job = document.jobs["dependency-review"];
  assert.ok(job, "validation must include dependency review");
  assert.equal(job.if, "github.event_name == 'pull_request'");
  assert.equal(job.permissions?.contents, "read");
  assert.equal(job.permissions?.["pull-requests"], "read");

  const review = job.steps.find(step => step.uses?.startsWith("actions/dependency-review-action@"));
  assert.ok(review);
  assert.equal(review.with?.["fail-on-severity"], "high");
  assert.match(review.uses ?? "", /@[0-9a-f]{40}$/u);
});

test("workflow lint job runs zizmor without requiring security-event write access", async () => {
  const { document } = await readWorkflow("validate.yml");
  const lint = document.jobs["lint-workflows"];
  const scan = lint.steps.find(step => step.uses?.startsWith("zizmorcore/zizmor-action@"));

  assert.ok(scan);
  assert.match(scan.uses ?? "", /@[0-9a-f]{40}$/u);
  assert.equal(scan.with?.version, "v1.32.0");
  assert.equal(scan.with?.["advanced-security"], "false");
  assert.equal(scan.with?.annotations, "true");
});

test("dataset release attests artifacts and verifies provenance before publishing", async () => {
  const { document } = await readWorkflow("dataset-release.yml");
  const build = document.jobs.build;
  const publish = document.jobs.release;
  const attest = build.steps.find(step => step.uses?.startsWith("actions/attest-build-provenance@"));
  const verify = publish.steps.find(step => step.name === "Verify release artifact provenance");
  const releaseIndex = publish.steps.findIndex(step => step.name === "Create GitHub release");
  const verifyIndex = publish.steps.findIndex(step => step.name === "Verify release artifact provenance");

  assert.ok(attest);
  assert.match(attest.uses ?? "", /@[0-9a-f]{40}$/u);
  assert.equal(attest.with?.["subject-path"], "dist/*.json");
  assert.equal(build.permissions?.contents, "read");
  assert.equal(build.permissions?.["id-token"], "write");
  assert.equal(build.permissions?.attestations, "write");

  assert.ok(verify);
  assert.match(verify.run ?? "", /gh attestation verify/u);
  assert.match(verify.run ?? "", /--signer-workflow.*dataset-release\.yml/u);
  assert.equal(verify.env?.RELEASE_TAG, "${{ github.ref_name }}");
  assert.match(verify.run ?? "", /--source-ref\s+"refs\/tags\/\$RELEASE_TAG"/u);
  assert.equal(publish.permissions?.attestations, "read");
  assert.ok(verifyIndex >= 0 && releaseIndex > verifyIndex, "provenance must be verified before release publication");
});

test("Cloudflare deployment attests its dataset and verifies it before deploy", async () => {
  const { document } = await readWorkflow("deploy-cloudflare.yml");
  const build = document.jobs.build;
  const deploy = document.jobs.deploy;
  const attest = build.steps.find(step => step.uses?.startsWith("actions/attest-build-provenance@"));
  const attestIndex = build.steps.findIndex(step => step.uses?.startsWith("actions/attest-build-provenance@"));
  const testIndex = build.steps.findIndex(step => step.name === "Run tests");
  const verify = deploy.steps.find(step => step.name === "Verify deployment artifact provenance");
  const deployIndex = deploy.steps.findIndex(step => step.name === "Deploy Worker");
  const verifyIndex = deploy.steps.findIndex(step => step.name === "Verify deployment artifact provenance");

  assert.ok(attest);
  assert.match(attest.uses ?? "", /@[0-9a-f]{40}$/u);
  assert.equal(attest.with?.["subject-path"], "dist/*.json");
  assert.equal(build.permissions?.contents, "read");
  assert.equal(build.permissions?.["id-token"], "write");
  assert.equal(build.permissions?.attestations, "write");
  assert.ok(testIndex >= 0 && attestIndex > testIndex, "provenance must be attested only after tests pass");

  assert.ok(verify);
  assert.match(verify.run ?? "", /gh attestation verify/u);
  assert.match(verify.run ?? "", /--signer-workflow.*deploy-cloudflare\.yml/u);
  assert.equal(verify.env?.DEFAULT_BRANCH, "${{ github.event.repository.default_branch }}");
  assert.match(verify.run ?? "", /--source-ref\s+"refs\/heads\/\$DEFAULT_BRANCH"/u);
  assert.equal(deploy.permissions?.attestations, "read");
  assert.ok(verifyIndex >= 0 && deployIndex > verifyIndex, "provenance must be verified before deployment");
});

test("Soyuz sweeps keep their repository-specific trigger, allowlist, and validation", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  assert.deepEqual(docs.document.on?.schedule, [{ cron: "0 1 * * 5" }]);
  assert.deepEqual(dry.document.on?.schedule, [{ cron: "0 2 * * 0" }]);
  assert.ok(Object.hasOwn(docs.document.on ?? {}, "workflow_dispatch"));
  assert.ok(Object.hasOwn(dry.document.on ?? {}, "workflow_dispatch"));
  assert.equal(docs.document.jobs.docs_sweep.env?.REF, "main");
  assert.equal(dry.document.jobs.dry_sweep.env?.REF, "main");
  assert.equal(docs.document.jobs.docs_sweep.env?.ALLOWLIST, "README.md,docs/**/*.md");
  assert.match(String(dry.document.jobs.dry_sweep.env?.ALLOWLIST), /src\/\*\*\/\*,scripts\/\*\*\//u);
  assert.match(String(docs.document.jobs.docs_sweep.env?.VALIDATION_COMMAND), /npm run check/u);
  assert.match(String(dry.document.jobs.dry_sweep.env?.VALIDATION_COMMAND), /npm run check/u);
  assert.match(docs.source, /publishMode: "pr"/u);
  assert.match(dry.source, /publishMode: "pr"/u);
  assert.doesNotMatch(docs.source + dry.source, /github\.event\.repository\.default_branch/u);
});

test("Soyuz sweeps validate the destination before exposing the submission token", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  for (const [fileName, job] of [
    ["kaseki-docs.yaml", docs.document.jobs.docs_sweep],
    ["kaseki-dry.yaml", dry.document.jobs.dry_sweep],
  ] as const) {
    const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
    const setupNode = job.steps.find(step => step.uses?.startsWith("actions/setup-node@"));
    const validateIndex = job.steps.findIndex(step => step.name === "Validate Soyuz URL");
    const submitIndex = job.steps.findIndex(step => step.name?.startsWith("Submit "));
    const validate = job.steps[validateIndex];

    assert.ok(checkout, `${fileName} must check out trusted main content`);
    assert.equal(checkout.with?.ref, "${{ github.sha }}", fileName);
    assert.equal(checkout.with?.["persist-credentials"], false, fileName);
    assert.ok(setupNode, `${fileName} must set up Node`);
    assert.equal(setupNode.with?.["node-version-file"], ".nvmrc", fileName);
    assert.equal(validate?.run, "node --experimental-strip-types scripts/validate-soyuz-url.ts", fileName);
    assert.ok(validateIndex >= 0 && submitIndex > validateIndex, `${fileName} must validate URL before submission`);

    const tokenSteps = job.steps.filter(step => Object.hasOwn(step.env ?? {}, "SOYUZ_SUBMISSION_API_TOKEN"));
    assert.equal(tokenSteps.length, 1, `${fileName} should expose the token to only one step`);
    assert.equal(tokenSteps[0].env?.SOYUZ_SUBMISSION_API_TOKEN, "${{ secrets.SOYUZ_SUBMISSION_API_TOKEN }}", fileName);
    assert.equal(job.steps.some(step => step.name?.startsWith("Wait for ")), false, fileName);
  }
});

test("Soyuz submissions use idempotent HTTPS requests and validate accepted responses", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  for (const [fileName, job, expectedName] of [
    ["kaseki-docs.yaml", docs.document.jobs.docs_sweep, "Submit documentation sweep to Soyuz"],
    ["kaseki-dry.yaml", dry.document.jobs.dry_sweep, "Submit DRY sweep to Soyuz"],
  ] as const) {
    const submit = job.steps.find(step => step.name === expectedName);
    const run = submit?.run ?? "";
    assert.ok(submit, `${fileName} must contain a Soyuz submission step`);
    assert.match(run, /--request POST "\$SOYUZ_BASE_URL\/v1\/runs"/u, fileName);
    assert.match(run, /curl --config "\$curl_config"/u, fileName);
    assert.match(run, /Authorization: Bearer %s/u, fileName);
    assert.doesNotMatch(run, /--header "Authorization: Bearer \$SOYUZ_SUBMISSION_API_TOKEN"/u, fileName);
    assert.match(run, /--header "Idempotency-Key: \$idempotency_key"/u, fileName);
    assert.match(run, /--arg idempotencyKey "\$idempotency_key"/u, fileName);
    assert.match(run, /\[\[ "\$SOYUZ_SUBMISSION_API_TOKEN" =~ \[\[:cntrl:\]\] \]\]/u, fileName);
    assert.match(run, /--proto '=https' --tlsv1\.2 --fail-with-body/u, fileName);
    assert.match(run, /--max-filesize 1048576/u, fileName);
    assert.match(run, /\^\(200\|202\)\$/u, fileName);
    assert.match(run, /\.data\.id/u, fileName);
    assert.match(run, /\.data\.displayId/u, fileName);
    assert.match(run, /\.data\.status/u, fileName);
    assert.match(run, /scripts\/validate-soyuz-run-id\.ts/u, fileName);
    assert.doesNotMatch(run, /--retry-all-errors/u, fileName);
    assert.doesNotMatch(run, /cat "\$response_file"/u, fileName);
  }
});

test("Soyuz summaries report admission without claiming task completion", async () => {
  const docs = await readWorkflow("kaseki-docs.yaml");
  const dry = await readWorkflow("kaseki-dry.yaml");

  for (const [fileName, job, expectedHeading] of [
    ["kaseki-docs.yaml", docs.document.jobs.docs_sweep, "## Soyuz documentation submission"],
    ["kaseki-dry.yaml", dry.document.jobs.dry_sweep, "## Soyuz DRY submission"],
  ] as const) {
    const summary = job.steps.find(step => step.name?.startsWith("Publish Soyuz submission details"));
    assert.ok(summary, `${fileName} must publish the accepted submission details`);
    assert.match(summary.run ?? "", new RegExp(expectedHeading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(summary.run ?? "", /Accepted means Soyuz admitted the task; it does not confirm execution completion/u);
    assert.match(summary.run ?? "", /DISPLAY_ID/u);
    assert.match(summary.run ?? "", /RUN_STATUS/u);
    assert.equal(summary["continue-on-error"], undefined);
    assert.equal(job.steps.some(step => step.name?.includes("Kaseki")), false, fileName);
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

test("tag releases do not consume a shared npm cache", async () => {
  const { document } = await readWorkflow("dataset-release.yml");
  const setupNode = document.jobs.build.steps.find(step => step.uses?.startsWith("actions/setup-node@"));

  assert.ok(setupNode);
  assert.equal(setupNode.with?.cache, undefined);
  assert.equal(setupNode.with?.["package-manager-cache"], false);
});

test("dataset release uses the runner GitHub CLI after provenance verification", async () => {
  const { document } = await readWorkflow("dataset-release.yml");
  const publish = document.jobs.release;
  const verifyIndex = publish.steps.findIndex(step => step.name === "Verify release artifact provenance");
  const createRelease = publish.steps.find(step => step.name === "Create GitHub release");

  assert.ok(createRelease);
  assert.match(createRelease.run ?? "", /gh release create/u);
  assert.equal(createRelease.env?.GH_TOKEN, "${{ github.token }}");
  assert.equal(createRelease.env?.RELEASE_TAG, "${{ github.ref_name }}");
  assert.equal(publish.steps.some(step => step.uses?.startsWith("softprops/action-gh-release@")), false);
  assert.ok(publish.steps.indexOf(createRelease) > verifyIndex, "verify provenance before creating the release");
});

test("Dependabot applies a seven-day cooldown to npm and GitHub Actions updates", async () => {
  const source = await readFile(path.join(repositoryRoot, ".github", "dependabot.yml"), "utf8");
  const document = parse(source) as {
    updates: Array<{
      "package-ecosystem": string;
      cooldown?: { "default-days"?: number };
    }>;
  };

  for (const ecosystem of ["npm", "github-actions"]) {
    const update = document.updates.find(candidate => candidate["package-ecosystem"] === ecosystem);
    assert.ok(update, `missing Dependabot config for ${ecosystem}`);
    assert.ok((update.cooldown?.["default-days"] ?? 0) >= 7, `${ecosystem} needs at least a seven-day cooldown`);
  }
});
