import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scoreEvaluationCases } from "./evaluate-jev.js";
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
