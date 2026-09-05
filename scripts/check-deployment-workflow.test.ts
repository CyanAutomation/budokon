import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  checkDeploymentReleaseArtifacts,
  checkDeploymentWorkflow,
  DeploymentWorkflowValidationError,
  type DeploymentWorkflowValidationErrorCode,
} from "./check-deployment-workflow.js";

const validWorkflow = `jobs:
  deploy:
    steps:
      - run: npm run validate:deployment-target
      - run: npm run smoke:deployment
`;

const validScripts = {
  "validate:deployment-target": "tsx scripts/validate-cloudflare-deployment-target.ts",
  "smoke:deployment": "tsx scripts/smoke-deployment.ts",
};

interface Fixture {
  name: string;
  requirementReference?: string;
  workflow?: string;
  scripts?: Record<string, string>;
  omittedEntryPoints?: string[];
  expectedError?: {
    code: DeploymentWorkflowValidationErrorCode;
    scriptName: keyof typeof validScripts;
  };
}

const fixtures: Fixture[] = [
  {
    name: "accepts a deployment workflow that runs target validation and smoke checks",
    requirementReference: ".github/workflows/validate.yml CI deployment workflow check",
  },
  {
    name: "missing validator entry point",
    omittedEntryPoints: ["scripts/validate-cloudflare-deployment-target.ts"],
    expectedError: { code: "missing-entry-point", scriptName: "validate:deployment-target" },
  },
  {
    name: "missing smoke-test entry point",
    omittedEntryPoints: ["scripts/smoke-deployment.ts"],
    expectedError: { code: "missing-entry-point", scriptName: "smoke:deployment" },
  },
  {
    name: "workflow scripts do not reference the expected commands",
    workflow: "jobs:\n  deploy:\n    steps:\n      - run: npm run deploy\n",
    expectedError: { code: "missing-workflow-command", scriptName: "validate:deployment-target" },
  },
];

async function createTemporaryRepositoryFixture(
  t: TestContext,
  fixture: Fixture,
): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "budokon-deployment-workflow-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));

  await mkdir(path.join(repositoryRoot, ".github/workflows"), { recursive: true });
  await mkdir(path.join(repositoryRoot, "scripts"));
  await writeFile(
    path.join(repositoryRoot, ".github/workflows/deploy-cloudflare.yml"),
    fixture.workflow ?? validWorkflow,
  );
  await writeFile(
    path.join(repositoryRoot, "package.json"),
    JSON.stringify({ scripts: fixture.scripts ?? validScripts }),
  );
  for (const entryPoint of Object.values(validScripts).map(command => command.replace("tsx ", ""))) {
    if (!fixture.omittedEntryPoints?.includes(entryPoint)) {
      await writeFile(path.join(repositoryRoot, entryPoint), "");
    }
  }

  return repositoryRoot;
}

for (const fixture of fixtures) {
  test(fixture.name, async t => {
    const repositoryRoot = await createTemporaryRepositoryFixture(t, fixture);

    if (!fixture.expectedError) {
      const result = await checkDeploymentWorkflow(repositoryRoot);
      assert.deepEqual(result.scripts, [
        {
          name: "validate:deployment-target",
          command: "tsx scripts/validate-cloudflare-deployment-target.ts",
          entryPoint: "scripts/validate-cloudflare-deployment-target.ts",
        },
        {
          name: "smoke:deployment",
          command: "tsx scripts/smoke-deployment.ts",
          entryPoint: "scripts/smoke-deployment.ts",
        },
      ]);
      return;
    }

    await assert.rejects(checkDeploymentWorkflow(repositoryRoot), error => {
      assert.ok(error instanceof DeploymentWorkflowValidationError);
      assert.equal(error.code, fixture.expectedError?.code);
      assert.equal(error.details.scriptName, fixture.expectedError?.scriptName);
      return true;
    });
  });
}

const artifactCheckingDeploymentWorkflow = `jobs:
  housekeeping:
    steps:
      - run: echo deploy
  deploy:
    steps:
      - run: npm run check-artifacts
`;

const completeReleaseWorkflow = `jobs:
  release:
    steps:
      - run: npm run check-artifacts
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/budokon.json
            dist/countries.json
            dist/events.json
            dist/judoka.json
            dist/manifest.json
            dist/techniques.json
            dist/weight-categories.json
`;

async function createArtifactWorkflowFixture(
  t: TestContext,
  deploymentWorkflow: string,
  releaseWorkflow: string,
): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "budokon-artifact-workflows-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await mkdir(path.join(repositoryRoot, ".github/workflows"), { recursive: true });
  await writeFile(path.join(repositoryRoot, ".github/workflows/deploy-cloudflare.yml"), deploymentWorkflow);
  await writeFile(path.join(repositoryRoot, ".github/workflows/release.yml"), releaseWorkflow);
  return repositoryRoot;
}

test("accepts artifact checks in deployment and release jobs with a complete release upload", async t => {
  const root = await createArtifactWorkflowFixture(t, artifactCheckingDeploymentWorkflow, completeReleaseWorkflow);
  await assert.doesNotReject(checkDeploymentReleaseArtifacts(root));
});

test("rejects an artifact check outside the deployment job", async t => {
  const workflow = artifactCheckingDeploymentWorkflow.replace(
    "      - run: npm run check-artifacts\n",
    "      - run: echo no artifact check\n",
  );
  const root = await createArtifactWorkflowFixture(t, workflow, completeReleaseWorkflow);
  await assert.rejects(checkDeploymentReleaseArtifacts(root), (error: unknown) => {
    assert.ok(error instanceof DeploymentWorkflowValidationError);
    assert.equal(error.code, "missing-artifact-check");
    assert.match(error.message, /job deploy/);
    return true;
  });
});

test("rejects an artifact check outside the release job", async t => {
  const workflow = completeReleaseWorkflow.replace(
    "  release:\n",
    "  checks:\n    steps:\n      - run: npm run check-artifacts\n  release:\n",
  ).replace("      - run: npm run check-artifacts\n      - uses:", "      - run: echo no artifact check\n      - uses:");
  const root = await createArtifactWorkflowFixture(t, artifactCheckingDeploymentWorkflow, workflow);
  await assert.rejects(checkDeploymentReleaseArtifacts(root), (error: unknown) => {
    assert.ok(error instanceof DeploymentWorkflowValidationError);
    assert.equal(error.code, "missing-artifact-check");
    assert.match(error.message, /job release/);
    return true;
  });
});

test("reports a validation error when the release job is missing", async t => {
  const workflow = completeReleaseWorkflow.replace("  release:\n", "  publish:\n");
  const root = await createArtifactWorkflowFixture(t, artifactCheckingDeploymentWorkflow, workflow);
  await assert.rejects(checkDeploymentReleaseArtifacts(root), (error: unknown) => {
    assert.ok(error instanceof DeploymentWorkflowValidationError);
    assert.equal(error.code, "missing-artifact-check");
    assert.match(error.message, /job release/);
    return true;
  });
});

test("rejects a release upload that omits a required JSON artifact", async t => {
  const workflow = completeReleaseWorkflow.replace("            dist/events.json\n", "");
  const root = await createArtifactWorkflowFixture(t, artifactCheckingDeploymentWorkflow, workflow);
  await assert.rejects(checkDeploymentReleaseArtifacts(root), (error: unknown) => {
    assert.ok(error instanceof DeploymentWorkflowValidationError);
    assert.equal(error.code, "missing-release-artifact");
    assert.equal(error.details.artifactName, "events.json");
    return true;
  });
});
