import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runEvaluation, scoreEvaluationCases } from "./evaluate-jev.js";
import { validateCanonical } from "../src/validation/validate-canonical.js";

test("JEV evaluation metrics use unique predictions and report precision and recall", () => {
  assert.deepEqual(scoreEvaluationCases([
    { relevant: ["a", "b"], predicted: ["a", "a", "x"] },
    { relevant: ["c"], predicted: ["c"] },
  ]), {
    truePositives: 2,
    predicted: 3,
    relevant: 3,
    precision: 2 / 3,
    recall: 2 / 3,
  });
});

test("JEV evaluation metrics handle empty result sets", () => {
  assert.deepEqual(scoreEvaluationCases([{ relevant: ["a"], predicted: [] }]), {
    truePositives: 0,
    predicted: 0,
    relevant: 1,
    precision: 1,
    recall: 0,
  });
});

test("JEV evaluation cases refer to canonical records and relevant slugs are candidates", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../tests/fixtures/jev-evaluation.json", import.meta.url), "utf8")) as Array<{ candidateSlugs: string[]; relevantSlugs: string[] }>;
  const canonical = await validateCanonical();
  const known = new Set(canonical.judoka.map(record => record.slug));
  for (const fixture of fixtures) {
    for (const slug of fixture.candidateSlugs) assert.ok(known.has(slug), `missing candidate ${slug}`);
    for (const slug of fixture.relevantSlugs) assert.ok(fixture.candidateSlugs.includes(slug), `relevant judoka ${slug} is not a candidate`);
  }
});

test("JEV evaluation loads candidates, aggregates search metrics, and appends its report", async () => {
  const root = "/fixture-root";
  const fixtures = [{
    id: "one",
    query: "throw specialist",
    candidateSlugs: ["first", "second"],
    relevantSlugs: ["second"],
  }];
  const records = new Map([
    ["first", { id: "first-id", slug: "first", signatureMoveIds: [] }],
    ["second", { id: "second-id", slug: "second", signatureMoveIds: [] }],
  ]);
  const reads: string[] = [];
  const appended: Array<[string, string]> = [];
  const output: string[] = [];
  let observedThreshold: number | undefined;

  await runEvaluation({
    root,
    environment: {
      JEV_OPENROUTER_API_KEY: "test-key",
      JEV_MINIMUM_RELEVANCE: "0.7",
      GITHUB_STEP_SUMMARY: "/tmp/summary.md",
    },
    async readText(filePath) {
      reads.push(filePath);
      if (filePath === `${root}/tests/fixtures/jev-evaluation.json`) return JSON.stringify(fixtures);
      const slug = filePath.match(/\/data\/judoka\/([^/]+)\.json$/)?.[1];
      const record = slug ? records.get(slug) : undefined;
      if (!record) throw new Error(`Unexpected read: ${filePath}`);
      return JSON.stringify(record);
    },
    createSearchService(options) {
      observedThreshold = options.minimumRelevance;
      return {
        async search(_query, candidates) {
          return {
            model: "test-model",
            usage: { input_tokens: 12, output_tokens: 4, cost: 0.001 },
            results: [{ judoka: candidates[1], relevance: 0.93 }],
          };
        },
      };
    },
    async appendSummary(filePath, report) { appended.push([filePath, report]); },
    writeOutput(report) { output.push(report); },
  });

  assert.deepEqual(reads, [
    `${root}/tests/fixtures/jev-evaluation.json`,
    `${root}/data/judoka/first.json`,
    `${root}/data/judoka/second.json`,
  ]);
  assert.equal(observedThreshold, 0.7);
  assert.equal(appended.length, 1);
  assert.equal(appended[0][0], "/tmp/summary.md");
  assert.match(appended[0][1], /Threshold: 0\.7/);
  assert.match(appended[0][1], /Precision: 100\.0% \(1\/1 retrieved\)/);
  assert.match(appended[0][1], /Recall: 100\.0% \(1\/1 labeled relevant\)/);
  assert.match(appended[0][1], /second \(0\.93\)/);
  assert.deepEqual(output, []);
});

test("JEV evaluation reports missing credentials before reading fixtures", async () => {
  let read = false;
  await assert.rejects(runEvaluation({
    environment: {},
    async readText() { read = true; return "[]"; },
  }), /JEV_OPENROUTER_API_KEY is required/);
  assert.equal(read, false);
});

test("JEV evaluation reports fixture references to missing records", async () => {
  await assert.rejects(runEvaluation({
    root: "/fixture-root",
    environment: { JEV_OPENROUTER_API_KEY: "test-key" },
    async readText(filePath) {
      if (filePath.endsWith("jev-evaluation.json")) return JSON.stringify([{
        id: "broken", query: "query", candidateSlugs: ["missing"], relevantSlugs: [],
      }]);
      return JSON.stringify({ id: "other-id", slug: "other", signatureMoveIds: [] });
    },
    createSearchService() {
      return { async search() { throw new Error("search should not run for an invalid fixture"); } };
    },
  }), /Evaluation fixture broken refers to missing judoka missing/);
});

test("JEV evaluation writes to stdout when no workflow summary file is configured", async () => {
  const output: string[] = [];
  await runEvaluation({
    environment: { JEV_OPENROUTER_API_KEY: "test-key" },
    async readText() { return "[]"; },
    createSearchService() { return { async search() { return { model: "unused", usage: {}, results: [] }; } }; },
    writeOutput(report) { output.push(report); },
  });

  assert.equal(output.length, 1);
  assert.match(output[0], /Threshold: 0\.5/);
  assert.match(output[0], /Precision: 100\.0% \(0\/0 retrieved\)/);
});
