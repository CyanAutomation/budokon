import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PLAYSTYLE_OPTIONS, type PlaystyleFacet } from "../src/domain/playstyle.js";
import type { PlaystyleClassification, PlaystyleClassificationResult } from "../src/jev/playstyle-classification-contracts.js";
import {
  formatPlaystyleEvaluationReport,
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
  results[0].classification.tacticalStyle.proposed = "counter";
  results[0].classification.tacticalStyle.policyAccepted = "counter";
  results[1].classification.tempo.proposed = "aggressive";
  results[1].classification.tempo.policyAccepted = "aggressive";
  const score = scorePlaystyleEvaluation(fixtures, results);
  assert.deepEqual(score.facets, {
    tacticalStyle: { correct: 1, total: 2, accuracy: 0.5 },
    tempo: { correct: 1, total: 2, accuracy: 0.5 },
    gripStyle: { correct: 2, total: 2, accuracy: 1 },
    newazaEmphasis: { correct: 2, total: 2, accuracy: 1 },
    standingPreference: { correct: 2, total: 2, accuracy: 1 },
  });
  assert.deepEqual(score.abstention, { correct: 9, total: 10, accuracy: 0.9 });
  assert.throws(() => scorePlaystyleEvaluation(fixtures, results.slice(1)), /counts must match/u);
});

test("playstyle report summarizes model, per-facet accuracy, usage, and non-gating status", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../tests/fixtures/playstyle-evaluation.json", import.meta.url), "utf8")) as PlaystyleEvaluationFixture[];
  const results = fixtures.map(resultFor);
  const first = fixtures[0];
  assert.ok(first);
  results[0].classification.tacticalStyle.proposed = first.expected.tacticalStyle === "pressure" ? "counter" : "pressure";
  results[0].classification.tacticalStyle.policyAccepted = results[0].classification.tacticalStyle.proposed;

  const report = formatPlaystyleEvaluationReport(fixtures, results, "typesafe/jev-configured-test");

  assert.match(report, /^## JEV playstyle classification evaluation/mu);
  assert.match(report, /Requested model: typesafe\/jev-configured-test/u);
  assert.match(report, /Resolved model\(s\): typesafe\/jev-evaluation-fake/u);
  assert.match(report, /tacticalStyle \| 3 \| 4 \| 75\.0%/u);
  assert.match(report, /80 input tokens, 32 output tokens/u);
  assert.match(report, /non-gating/u);
});

test("injected playstyle evaluation classifies every fixture and writes one report", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../tests/fixtures/playstyle-evaluation.json", import.meta.url), "utf8")) as PlaystyleEvaluationFixture[];
  const expectedBySlug = new Map(fixtures.map(fixture => [fixture.record.slug, fixture]));
  const reports: string[] = [];
  let calls = 0;
  let threshold: number | undefined;
  await runPlaystyleEvaluation({
    environment: {
      JEV_OPENROUTER_API_KEY: "test-placeholder",
      JEV_MODEL: "typesafe/jev-configured-test",
      JEV_PLAYSTYLE_THRESHOLD: "0.78",
    },
    createClassifier: options => {
      threshold = options.confidenceThreshold;
      return {
        async classify(input) {
          calls += 1;
          const fixture = expectedBySlug.get(input.record.slug);
          assert.ok(fixture, `fixture exists for ${input.record.slug}`);
          return resultFor(fixture!);
        },
      };
    },
    writeOutput: value => { reports.push(value); },
  });
  assert.equal(calls, fixtures.length);
  assert.equal(threshold, 0.78);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /^## JEV playstyle classification evaluation/mu);
});

test("playstyle evaluation requires credentials before loading fixtures", async () => {
  let fixtureReads = 0;
  let classifierCreations = 0;
  await assert.rejects(runPlaystyleEvaluation({
    environment: {},
    async readText() {
      fixtureReads += 1;
      return "[]";
    },
    createClassifier() {
      classifierCreations += 1;
      throw new Error("classifier must not be created without credentials");
    },
  }), /JEV_OPENROUTER_API_KEY is required/u);
  assert.equal(fixtureReads, 0);
  assert.equal(classifierCreations, 0);
});
