import assert from "node:assert/strict";
import test from "node:test";
import type { Judoka } from "../src/domain/types.js";
import type { JevAnswer, JevQuestion } from "../src/jev/types.js";
import { parseJevResponse } from "../src/jev/client-response.js";
import {
  createEditorialReviewQuestions,
  editorialReviewRecommendation,
  validateEditorialReviewInput,
} from "../src/jev/editorial-review-policy.js";
import {
  createSemanticSearchQuestions,
  rankSemanticSearchResults,
  validateSemanticSearchOptions,
  validateSemanticSearchRequest,
} from "../src/jev/semantic-search-policy.js";
import { validateCanonicalRules } from "../src/validation/canonical-rules.js";
import type { ValidatedCanonicalData } from "../src/validation/canonical-types.js";
import { validateSchema } from "../src/validation/schema-validator.js";
import { validateCanonical } from "../src/validation/validate-canonical.js";

function judoka(id: string): Judoka {
  return { id, slug: id, firstname: id, surname: "Judoka", signatureMoveIds: ["move"], bio: "A sufficiently detailed biography." };
}

test("semantic search policy validates bounds, creates per-candidate questions, and ranks stably", () => {
  const candidates = [judoka("b"), judoka("a")];
  assert.doesNotThrow(() => validateSemanticSearchOptions({ maxCandidates: 2, minimumRelevance: 0.5 }));
  assert.throws(() => validateSemanticSearchOptions({ maxCandidates: 101 }), /between 1 and 100/);
  assert.doesNotThrow(() => validateSemanticSearchRequest("specialist", candidates, 2));
  assert.throws(() => validateSemanticSearchRequest(" ", candidates, 2), /query must be non-empty/);
  assert.throws(() => validateSemanticSearchRequest("specialist", candidates, 1), /at most 1 candidates/);

  const questions = createSemanticSearchQuestions(candidates);
  assert.deepEqual(Object.keys(questions), ["relevance_0", "relevance_1"]);
  const ranked = rankSemanticSearchResults(candidates, {
    relevance_0: { type: "noul", noul: 0.9 },
    relevance_1: { type: "noul", noul: 0.9 },
  }, 0.5);
  assert.deepEqual(ranked.map(item => item.judoka.id), ["a", "b"]);
});

test("JEV response parser accepts exact typed answers and rejects malformed distributions", () => {
  const questions: Record<string, JevQuestion> = {
    relevance: { type: "noul", instructions: "Relevant?" },
    choice: { type: "choice", instructions: "Choose", criteria: { no: "No", yes: "Yes" } },
    score: { type: "score", instructions: "Rate", criteria: ["low", "high"] },
  };
  const valid = {
    model: "test-model",
    usage: { input_tokens: 1 },
    answers: {
      relevance: { type: "noul", noul: 0.9 },
      choice: { type: "choice", choice: "yes", probabilities: { no: 0.1, yes: 0.9 }, confidence: 0.9 },
      score: { type: "score", score: 1, legend: { "0": "low", "1": "high" }, probabilities: { "0": 0, "1": 1 }, confidence: 1 },
    },
  };
  assert.equal(parseJevResponse(valid, questions)?.model, "test-model");
  assert.equal(parseJevResponse({ ...valid, answers: { ...valid.answers, choice: { ...valid.answers.choice, probabilities: { no: 0.1, yes: 0.7 } } } }, questions), undefined);
});

test("editorial review policy validates evidence, asks about duplicate candidates, and stays conservative", () => {
  const input = {
    record: judoka("proposal"),
    evidence: [{ url: "https://example.test/profile", excerpt: "A sourced biographical detail." }],
    duplicateCandidates: [judoka("existing")],
    techniques: [{ id: "move", name: "Throw", japanese: "Throw", description: "A throw." }],
  };
  assert.doesNotThrow(() => validateEditorialReviewInput(input));
  assert.throws(() => validateEditorialReviewInput({ ...input, evidence: [{ url: "http://example.test/profile", excerpt: "Not HTTPS." }] }), /HTTPS source excerpts/);

  const questions = createEditorialReviewQuestions(input, "proposal");
  assert.equal(questions.duplicate_candidate?.type, "choice");
  const answers: Record<string, JevAnswer> = Object.fromEntries([
    "biography_publishable", "identity_supported", "nationality_supported", "weight_class_supported",
    "biography_claims_supported", "factual_claims_supported", "stats_coherent", "rarity_appropriate",
    "signature_techniques_plausible",
  ].map(id => [id, { type: "noul", noul: 0.95 }])) as Record<string, JevAnswer>;
  answers.human_review_recommended = { type: "noul", noul: 0.1 };
  answers.duplicate_candidate = {
    type: "choice", choice: "none", probabilities: { none: 0.95, uncertain: 0.05, existing: 0 }, confidence: 0.95,
  };
  assert.equal(editorialReviewRecommendation(input, answers, 0.8), "ready_for_human_approval");
  assert.equal(editorialReviewRecommendation({ ...input, evidence: [] }, answers, 0.8), "needs_human_review");
});

test("schema and cross-record validators accept valid canonical data and report broken rules", async () => {
  const simpleSchema = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } }, additionalProperties: false };
  assert.doesNotThrow(() => validateSchema({ id: "record" }, simpleSchema));
  assert.throws(() => validateSchema({ id: "" }, simpleSchema), /at least 1 characters/);

  const canonical = await validateCanonical();
  const data: ValidatedCanonicalData = {
    judokaFiles: canonical.judoka.map(value => ({ name: `${value.slug}.json`, value })),
    techniqueFiles: canonical.techniques.map(value => ({ name: `${value.id}.json`, value })),
    eventFiles: canonical.events.map(value => ({ name: `${value.id}.json`, value })),
    countries: canonical.countries,
    weights: canonical.weights,
    dataset: canonical.dataset,
  };
  assert.doesNotThrow(() => validateCanonicalRules(data));
  assert.throws(
    () => validateCanonicalRules({ ...data, judokaFiles: [{ ...data.judokaFiles[0], name: "wrong.json" }, ...data.judokaFiles.slice(1)] }),
    /filename must match canonical slug/,
  );
});
