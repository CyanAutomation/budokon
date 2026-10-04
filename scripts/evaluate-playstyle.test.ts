import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PLAYSTYLE_OPTIONS, type PlaystyleFacet } from "../src/domain/playstyle.js";
import type { PlaystyleClassification, PlaystyleClassificationResult } from "../src/jev/playstyle-classification-contracts.js";
import {
  runPlaystyleEvaluation,
  scorePlaystyleEvaluation,
  type PlaystyleEvaluationFixture,
} from "./evaluate-playstyle.js";

function resultFor(fixture: PlaystyleEvaluationFixture): PlaystyleClassificationResult {
  const classification = {} as PlaystyleClassification;
  for (const facet of Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[]) {
    const proposed = fixture.expected[facet];
    classification[facet] = {
      proposed,
      confidence: 0.9,
      policyAccepted: proposed === "insufficient_evidence" ? null : proposed as never,
    } as never;
  }
  return {
    judokaId: fixture.record.id,
    judokaSlug: fixture.record.slug,
    classification,
    confidenceThreshold: 0.78,
    requiresHumanApproval: true,
    model: "typesafe/jev-evaluation-fake",
    usage: { input_tokens: 20, output_tokens: 8, cost: 0.0002 },
  };
}

test("playstyle evaluation reports per-facet accuracy and abstention accuracy", () => {
  const fixtures = [
    {
      id: "clear",
      record: { id: "clear", slug: "clear", signatureMoveIds: [] },
      evidence: [],
      expected: { tacticalStyle: "pressure", tempo: "aggressive", gripStyle: "dominant", newazaEmphasis: "low", standingPreference: "ashi_waza" },
    },
    {
      id: "unknown",
      record: { id: "unknown", slug: "unknown", signatureMoveIds: [] },
      evidence: [],
      expected: { tacticalStyle: "insufficient_evidence", tempo: "insufficient_evidence", gripStyle: "insufficient_evidence", newazaEmphasis: "insufficient_evidence", standingPreference: "insufficient_evidence" },
    },
  ] as unknown as PlaystyleEvaluationFixture[];
  const results = fixtures.map(resultFor);
  const score = scorePlaystyleEvaluation(fixtures, results);
  assert.equal(score.facets.tacticalStyle.accuracy, 1);
  assert.equal(score.facets.standingPreference.accuracy, 1);
  assert.deepEqual(score.abstention, { correct: 10, total: 10, accuracy: 1 });
  assert.throws(() => scorePlaystyleEvaluation(fixtures, results.slice(1)), /counts must match/u);
});

test("live playstyle evaluation is injectable for offline tests and reports model usage without gating", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../tests/fixtures/playstyle-evaluation.json", import.meta.url), "utf8")) as PlaystyleEvaluationFixture[];
  const expectedBySlug = new Map(fixtures.map(fixture => [fixture.record.slug, fixture]));
  let report = "";
  let calls = 0;
  await runPlaystyleEvaluation({
    environment: {
      JEV_OPENROUTER_API_KEY: "test-placeholder",
      JEV_MODEL: "typesafe/jev-configured-test",
      JEV_PLAYSTYLE_THRESHOLD: "0.78",
    },
    createClassifier: () => ({
      async classify(input) {
        calls += 1;
        const fixture = expectedBySlug.get(input.record.slug);
        assert.ok(fixture, `fixture exists for ${input.record.slug}`);
        return resultFor(fixture!);
      },
    }),
    writeOutput: value => { report = value; },
  });
  assert.equal(calls, fixtures.length);
  assert.match(report, /Requested model: typesafe\/jev-configured-test/u);
  assert.match(report, /Resolved model\(s\): typesafe\/jev-evaluation-fake/u);
  assert.match(report, /tacticalStyle \| 4 \| 4 \| 100\.0%/u);
  assert.match(report, /Abstention \| 20 \| 20 \| 100\.0%/u);
  assert.match(report, /80 input tokens, 32 output tokens/u);
  assert.match(report, /non-gating/u);
});

test("playstyle evaluation requires credentials before loading fixtures", async () => {
  await assert.rejects(runPlaystyleEvaluation({ environment: {} }), /JEV_OPENROUTER_API_KEY is required/u);
});
