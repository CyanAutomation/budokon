import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

interface WorkflowStep {
  run?: string;
  env?: Record<string, unknown>;
}

interface AdvisoryWorkflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    if?: string;
    permissions?: Record<string, string>;
    steps: WorkflowStep[];
  }>;
}

test("JEV advisory workflow runs both evaluations on default-branch dispatch with read-only permissions", async () => {
  const source = await readFile(new URL("../.github/workflows/jev-advisory.yaml", import.meta.url), "utf8");
  const workflow = parse(source) as AdvisoryWorkflow;
  const jobs = workflow.jobs ?? {};
  const job = jobs["evaluate-search"];

  assert.deepEqual(Object.keys(workflow.on ?? {}).sort(), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(jobs), ["evaluate-search"]);
  assert.ok(job, "workflow must define its evaluation job");
  assert.match(job.if ?? "", /github\.event\.repository\.default_branch/u);
  assert.equal(job.permissions, undefined, "job must inherit read-only workflow permissions");

  const evaluationCommands = job.steps
    .map(step => step.run)
    .filter((command): command is string => command?.startsWith("npm run jev:evaluate"));
  assert.deepEqual(evaluationCommands, ["npm run jev:evaluate", "npm run jev:evaluate:playstyle"]);
});
