import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Judoka } from "../src/domain/types.js";
import { findCanonicalIdentityConflicts, rankDuplicateCandidates, renderPullRequestReviewSummary } from "./jev-pr-review.js";

const workflow = await readFile(new URL("../.github/workflows/jev-advisory.yaml", import.meta.url), "utf8");

const judoka = (id: string, slug: string, firstname: string, surname: string, countryCode = "JP"): Judoka => ({
  id, slug, firstname, surname, countryCode, signatureMoveIds: ["uchi-mata"],
});

test("duplicate shortlist ranks matching identity signals and uses stable ID tie breaks", () => {
  const proposal = judoka("new", "shohei-ono-new", "Shohei", "Ono");
  const candidates = [
    judoka("z", "shohei-ono", "Shohei", "Ono"),
    judoka("a", "shohei-ono-legacy", "Shohei", "Ono"),
    judoka("other", "teddy-riner", "Teddy", "Riner", "FR"),
  ];
  assert.deepEqual(rankDuplicateCandidates(proposal, candidates, 2).map(({ id }) => id), ["a", "z"]);
  assert.deepEqual(rankDuplicateCandidates(proposal, [judoka("unrelated", "teddy-riner", "Teddy", "Riner")]), []);
});

test("PR record identity checks catch slug, legacy-slug, and normalized-name collisions", () => {
  const proposal = { ...judoka("new", "shohei-ono-new", "Shohei", "Ono"), aliases: ["The Throw"] };
  const samePerson = { ...judoka("existing", "ono-old", "Shohei", "Ono"), legacySlugs: ["shohei-ono-new"] };
  assert.deepEqual(findCanonicalIdentityConflicts(proposal, [samePerson]).map(({ id }) => id), ["existing"]);
  assert.deepEqual(findCanonicalIdentityConflicts(proposal, [judoka("other", "someone-else", "Someone", "Else", "JP")]), []);
});

test("JEV workflow is manually dispatched, read-only, and gated to the default branch", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  pull_request:/m);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /persist-credentials: false/);
});

test("PR review report marks missing source excerpts as an evidence gap", () => {
  const summary = renderPullRequestReviewSummary(42, [{
    record: judoka("new", "new-judoka", "New", "Judoka"),
    review: {
      model: "typesafe/jev-test",
      usage: { input_tokens: 300 },
      answers: {
        biography_publishable: { type: "noul", noul: 0.9 },
        factual_claims_supported: { type: "noul", noul: 0.1 },
        stats_coherent: { type: "noul", noul: 0.8 },
        rarity_appropriate: { type: "noul", noul: 0.8 },
        signature_techniques_plausible: { type: "noul", noul: 0.8 },
        duplicate_candidate: { type: "choice", choice: "none", probabilities: { none: 1, uncertain: 0 }, confidence: 1 },
        human_review_recommended: { type: "noul", noul: 0.2 },
      },
      recommendation: "needs_human_review",
      requiresHumanApproval: true,
    },
  }]);
  assert.match(summary, /PR #42/);
  assert.match(summary, /No source excerpts were supplied/);
  assert.match(summary, /advisory only/i);
  assert.match(summary, /JEV recommends human review: 20% yes/);
  assert.match(summary, /New Judoka/);
});
