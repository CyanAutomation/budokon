import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("JEV advisory workflow runs both non-gating evaluations and has no pull request access", async () => {
  const workflow = await readFile(new URL("../.github/workflows/jev-advisory.yaml", import.meta.url), "utf8");
  assert.match(workflow, /run: npm run jev:evaluate/u);
  assert.match(workflow, /run: npm run jev:evaluate:playstyle/u);
  assert.doesNotMatch(workflow, /review-pr|pull_request|pull-requests|JEV_PR_NUMBER|GITHUB_TOKEN|jev:review-pr|jev-pr-review/u);
  assert.doesNotMatch(workflow, /^\s+inputs:/mu);
  assert.match(workflow, /permissions:\n  contents: read\n/u);
});
