import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CatalogService } from "../src/domain/catalog-service.js";
import { PLAYSTYLE_OPTIONS, type PlaystyleFacet, type PlaystyleOption } from "../src/domain/playstyle.js";
import type { Judoka, Technique } from "../src/domain/types.js";
import { PlaystyleClassificationService } from "../src/jev/playstyle-classification-service.js";
import { PLAYSTYLE_QUESTION_IDS, type PlaystyleClassificationResult, type PlaystyleJudokaRecord } from "../src/jev/playstyle-classification-contracts.js";
import { buildPlaystyleState, createPlaystyleClassificationQuestions } from "../src/jev/playstyle-classification-policy.js";
import type { JevAnswer, JevDecisionClient, JevDecisionResult, JevQuestion } from "../src/jev/types.js";
import { createJevTools } from "../src/mcp/jev-tools.js";
import { playstyleClassificationInputSchema } from "../src/mcp/server.js";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.js";
import { validateSchema } from "../src/validation/validate-canonical.js";

const record: Judoka = {
  id: "playstyle-test-judoka",
  slug: "playstyle-test-judoka",
  firstname: "Test",
  surname: "Judoka",
  bio: "A bounded biography supplied for playstyle classification.",
  stats: { power: 10, speed: 9, technique: 8, kumikata: 7, newaza: 5 },
  signatureMoveIds: ["uchi-mata", "seoi-nage"],
  countryCode: "JP",
  rarity: "Legendary",
  sourceUrls: ["https://example.test/source-only"],
  unrelatedEditorialField: "must not be sent to JEV",
};

const techniques: Technique[] = [
  { id: "uchi-mata", name: "Uchi-mata", japanese: "内股", style: "Judo", category: "Nage-waza", subCategory: "Ashi-waza", description: "Inner thigh throw.", link: "https://example.test/uchi-mata" },
  { id: "seoi-nage", name: "Seoi-nage", japanese: "背負投", style: "Judo", category: "Nage-waza", subCategory: "Te-waza", description: "Shoulder throw.", link: "https://example.test/seoi-nage" },
];

const input = {
  record: {
    id: record.id,
    slug: record.slug,
    firstname: record.firstname,
    surname: record.surname,
    bio: record.bio as string,
    stats: { technique: 8, kumikata: 7, newaza: 5 },
    signatureMoveIds: [...record.signatureMoveIds],
    countryCode: record.countryCode,
    rarity: record.rarity,
    sourceUrls: record.sourceUrls,
    unrelatedEditorialField: record.unrelatedEditorialField,
  } as PlaystyleJudokaRecord,
  evidence: [{ url: "https://example.test/match-report", excerpt: "The supplied match report describes repeated attacks and grip changes." }],
  techniques: [...techniques].reverse(),
};

function answerSet(
  questions: Record<string, JevQuestion>,
  overrides: Partial<Record<PlaystyleFacet, { choice?: string; confidence?: number; type?: string; probabilities?: unknown }>> = {},
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const facet of Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[]) {
    const questionId = PLAYSTYLE_QUESTION_IDS[facet];
    const question = questions[questionId];
    assert.equal(question.type, "choice");
    if (question.type !== "choice") continue;
    const override = overrides[facet] ?? {};
    const choice = override.choice ?? PLAYSTYLE_OPTIONS[facet][0];
    const probabilities = Object.fromEntries(Object.keys(question.criteria).map(option => [option, option === choice ? 1 : 0]));
    answers[questionId] = {
      type: override.type ?? "choice",
      choice,
      probabilities: override.probabilities ?? probabilities,
      confidence: override.confidence ?? 0.9,
    };
  }
  return answers;
}

function fakeClient(
  createResponse: (state: unknown, questions: Record<string, JevQuestion>) => unknown = (_state, questions) => ({
    model: "typesafe/jev-test",
    usage: { input_tokens: 41, output_tokens: 15 },
    answers: answerSet(questions),
  }),
  onCall?: (state: unknown, questions: Record<string, JevQuestion>) => void,
): JevDecisionClient {
  return {
    async decide(state, questions) {
      onCall?.(state, questions);
      return createResponse(state, questions) as JevDecisionResult;
    },
  };
}

test("playstyle classifier submits five bounded choice facets in one JEV request", async () => {
  let calls = 0;
  const service = new PlaystyleClassificationService(fakeClient((_state, questions) => ({
    model: "typesafe/jev-test", usage: { input_tokens: 41, output_tokens: 15 }, answers: answerSet(questions),
  }), (_state, questions) => {
    calls += 1;
    assert.deepEqual(Object.keys(questions), ["tactical_style", "tempo", "grip_style", "newaza_emphasis", "standing_preference"]);
    for (const facet of Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[]) {
      const question = questions[PLAYSTYLE_QUESTION_IDS[facet]];
      assert.equal(question.type, "choice");
      if (question.type === "choice") {
        assert.deepEqual(Object.keys(question.criteria), PLAYSTYLE_OPTIONS[facet]);
        assert.match(question.instructions, /insufficient_evidence/u);
        for (const option of PLAYSTYLE_OPTIONS[facet]) assert.ok(question.criteria[option].length > 20);
      }
    }
  }));
  const result = await service.classify(input);
  assert.equal(calls, 1);
  assert.equal(result.requiresHumanApproval, true);
  assert.equal(result.confidenceThreshold, 0.78);
  assert.equal(result.model, "typesafe/jev-test");
  assert.equal(result.usage.input_tokens, 41);
  assert.equal(result.classification.tacticalStyle.policyAccepted, "pressure");
});

test("state construction resolves techniques deterministically and excludes unrelated catalogue data", async () => {
  let receivedState: Record<string, unknown> | undefined;
  const service = new PlaystyleClassificationService(fakeClient((_state, questions) => ({
    model: "test", usage: {}, answers: answerSet(questions),
  }), state => { receivedState = state as Record<string, unknown>; }));
  await service.classify(input);
  assert.deepEqual(Object.keys(receivedState ?? {}), ["judoka", "resolvedTechniques", "evidence"]);
  const stateJudoka = receivedState?.judoka as Record<string, unknown>;
  assert.deepEqual(Object.keys(stateJudoka), ["id", "slug", "name", "biography", "signatureMoveIds", "editorialRatings"]);
  assert.equal(stateJudoka.name, "Test Judoka");
  assert.deepEqual(stateJudoka.editorialRatings, { technique: 8, kumikata: 7, newaza: 5 });
  assert.equal("countryCode" in stateJudoka, false);
  assert.equal("unrelatedEditorialField" in stateJudoka, false);
  assert.equal("sourceUrls" in stateJudoka, false, "a URL without an excerpt is not supplied evidence");
  assert.deepEqual((receivedState?.resolvedTechniques as Array<{ id: string; subCategory: string }>).map(({ id, subCategory }) => ({ id, subCategory })), [
    { id: "uchi-mata", subCategory: "Ashi-waza" },
    { id: "seoi-nage", subCategory: "Te-waza" },
  ]);
  assert.deepEqual(receivedState?.evidence, input.evidence);
});

test("playstyle policy gates each facet independently and never accepts abstention", async () => {
  const service = new PlaystyleClassificationService(fakeClient((_state, questions) => ({
    model: "test", usage: {}, answers: answerSet(questions, {
      tacticalStyle: { confidence: 0.78 },
      tempo: { confidence: 0.77 },
      gripStyle: { choice: "insufficient_evidence", confidence: 0.99 },
      newazaEmphasis: { confidence: 0.51 },
      standingPreference: { confidence: 0.95 },
    }),
  })));
  const result = await service.classify(input);
  assert.equal(result.classification.tacticalStyle.policyAccepted, "pressure");
  assert.equal(result.classification.tempo.policyAccepted, null);
  assert.deepEqual(result.classification.gripStyle, { proposed: "insufficient_evidence", confidence: 0.99, policyAccepted: null });
  assert.equal(result.classification.newazaEmphasis.policyAccepted, null);
  assert.equal(result.classification.standingPreference.policyAccepted, "ashi_waza");
  assert.throws(() => new PlaystyleClassificationService(fakeClient(), -0.1), /between 0 and 1/u);
  assert.throws(() => new PlaystyleClassificationService(fakeClient(), Number.NaN), /between 0 and 1/u);
});

test("malformed, missing, unexpected, and out-of-taxonomy JEV answers fail safely", async () => {
  const invalidResponses: Array<[string, (questions: Record<string, JevQuestion>) => Record<string, unknown>]> = [
    ["missing answer", questions => { const answers = answerSet(questions); delete answers.tempo; return answers; }],
    ["unknown option", questions => answerSet(questions, { tacticalStyle: { choice: "fictional_style" } })],
    ["wrong answer type", questions => answerSet(questions, { tempo: { type: "noul" } })],
    ["NaN confidence", questions => answerSet(questions, { gripStyle: { confidence: Number.NaN } })],
    ["out-of-range confidence", questions => answerSet(questions, { newazaEmphasis: { confidence: 1.01 } })],
    ["malformed probabilities", questions => answerSet(questions, { standingPreference: { probabilities: { ashi_waza: 1 } } })],
    ["unexpected answer", questions => ({ ...answerSet(questions), extra: { type: "choice" } })],
  ];
  for (const [name, createAnswers] of invalidResponses) {
    const service = new PlaystyleClassificationService(fakeClient((_state, questions) => ({
      model: "test", usage: {}, answers: createAnswers(questions),
    })));
    await assert.rejects(service.classify(input), TypeError, name);
  }
});

test("playstyle input rejects unbounded or unresolved evidence before calling JEV", async () => {
  let calls = 0;
  const service = new PlaystyleClassificationService(fakeClient((_state, questions) => {
    calls += 1;
    return { model: "test", usage: {}, answers: answerSet(questions) };
  }));
  await assert.rejects(service.classify({ ...input, evidence: [{ url: "http://example.test/source", excerpt: "Not HTTPS" }] }), /HTTPS/u);
  await assert.rejects(service.classify({ ...input, evidence: Array.from({ length: 11 }, () => input.evidence[0]) }), /at most 10/u);
  await assert.rejects(service.classify({ ...input, techniques: [techniques[0]] }), /resolve every signatureMoveId/u);
  await assert.rejects(service.classify({ ...input, record: { ...input.record, bio: "x".repeat(8_001) } }), /8000 characters/u);
  assert.equal(calls, 0);
});

test("complete JEV request including question criteria stays under the 64 KB cap", async () => {
  let called = false;
  const ids = Array.from({ length: 20 }, (_, index) => `technique-${index}`);
  const largeInput = {
    record: { ...input.record, bio: "b".repeat(8_000), signatureMoveIds: ids },
    evidence: Array.from({ length: 10 }, (_, index) => ({ url: `https://example.test/source-${index}`, excerpt: "e".repeat(3_000) })),
    techniques: ids.map(id => ({ ...techniques[0], id, description: "d".repeat(1_000) })),
  };
  const state = buildPlaystyleState(largeInput);
  const questions = createPlaystyleClassificationQuestions();
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength < 64_000);
  assert.ok(new TextEncoder().encode(JSON.stringify({ state, questions })).byteLength > 64_000);
  const service = new PlaystyleClassificationService(fakeClient((_state, requested) => {
    called = true;
    return { model: "test", usage: {}, answers: answerSet(requested) };
  }));
  await assert.rejects(service.classify(largeInput), /64 KB JEV request limit/u);
  assert.equal(called, false);
});

test("internal MCP review resolves a single canonical judoka and never writes its proposal", async () => {
  const irrelevantTechnique: Technique = { id: "unused", name: "Unused", japanese: "未使用", style: "Judo", category: "Nage-waza", subCategory: "Koshi-waza", description: "Not referenced.", link: "https://example.test/unused" };
  const catalog = new CatalogService(new JsonReadModelRepository({
    datasetVersion: "test-version",
    judoka: [record],
    techniques: [...techniques, irrelevantTechnique],
    events: [], countries: {}, weightCategories: [],
    manifest: { datasetVersion: "test-version", serviceVersion: "test", drawAlgorithms: [], defaultDrawAlgorithm: "test", sourceGitCommit: "test", checksums: { "budokon.json": "test" } },
  }));
  let received: unknown;
  let calls = 0;
  const mcp = createJevTools({ catalog, playstyleClassification: {
    async classify(value) {
      calls += 1;
      received = value;
      return {
        judokaId: value.record.id,
        judokaSlug: value.record.slug,
        classification: {
          tacticalStyle: { proposed: "pressure", confidence: 0.9, policyAccepted: "pressure" },
          tempo: { proposed: "aggressive", confidence: 0.9, policyAccepted: "aggressive" },
          gripStyle: { proposed: "adaptive", confidence: 0.9, policyAccepted: "adaptive" },
          newazaEmphasis: { proposed: "medium", confidence: 0.9, policyAccepted: "medium" },
          standingPreference: { proposed: "mixed", confidence: 0.9, policyAccepted: "mixed" },
        },
        confidenceThreshold: 0.78,
        requiresHumanApproval: true,
        model: "test-model",
        usage: {},
      };
    },
  } });
  await assert.rejects(mcp.review_judoka_playstyle({ judokaId: record.id }), /internal authorization/u);
  assert.equal(calls, 0);
  const result = await mcp.review_judoka_playstyle({ judokaId: record.slug, evidence: input.evidence }, { authorizedInternal: true });
  assert.equal(calls, 1);
  assert.equal(result.datasetVersion, "test-version");
  assert.equal(result.requiresHumanApproval, true);
  const receivedInput = received as { record: PlaystyleJudokaRecord; evidence: unknown[]; techniques: Technique[] };
  assert.deepEqual(receivedInput.evidence, input.evidence);
  assert.deepEqual(receivedInput.techniques.map(technique => technique.id), ["uchi-mata", "seoi-nage"]);
  assert.equal(Object.hasOwn(catalog.getJudoka(record.id)!, "playstyle"), false);
  assert.equal(Object.hasOwn(catalog.repository.listJudoka()[0], "playstyle"), false);
});

test("MCP playstyle input is bounded and requires supplied excerpts to use HTTPS", () => {
  assert.equal(playstyleClassificationInputSchema.safeParse({ judokaId: "shohei-ono" }).success, true);
  assert.equal(playstyleClassificationInputSchema.safeParse({ judokaId: "shohei-ono", evidence: [{ url: "https://example.test/source", excerpt: "A supplied excerpt." }] }).success, true);
  assert.equal(playstyleClassificationInputSchema.safeParse({ judokaId: "shohei-ono", evidence: [{ url: "http://example.test/source", excerpt: "Not HTTPS." }] }).success, false);
  assert.equal(playstyleClassificationInputSchema.safeParse({ judokaId: "shohei-ono", evidence: Array.from({ length: 11 }, () => ({ url: "https://example.test/source", excerpt: "Excerpt" })) }).success, false);
  assert.equal(playstyleClassificationInputSchema.safeParse({ judokaId: "shohei-ono", evidence: [{ url: "https://example.test/source", excerpt: "x".repeat(4_001) }] }).success, false);
});

test("canonical playstyle metadata is optional, partial, approved-only, and rejects invalid values", async () => {
  const schema = JSON.parse(await readFile(new URL("../schema/judoka.schema.json", import.meta.url), "utf8"));
  const canonicalRecord = JSON.parse(await readFile(new URL("../data/judoka/ashley-mckenzie.json", import.meta.url), "utf8"));
  assert.doesNotThrow(() => validateSchema(canonicalRecord, schema, "judoka-without-playstyle"));
  assert.doesNotThrow(() => validateSchema({ ...canonicalRecord, playstyle: { tacticalStyle: "counter" } }, schema, "approved-playstyle"));
  assert.doesNotThrow(() => validateSchema({ ...canonicalRecord, playstyle: { standingPreference: "ma_sutemi_waza", newazaEmphasis: "medium" } }, schema, "partial-playstyle"));
  for (const playstyle of [
    {},
    { tacticalStyle: "insufficient_evidence" },
    { tempo: "reckless" },
    { unrecognizedFacet: "balanced" },
  ]) {
    assert.throws(() => validateSchema({ ...canonicalRecord, playstyle }, schema, "invalid-playstyle"));
  }
});

test("playstyle taxonomy uses the existing canonical standing technique subcategories", () => {
  assert.deepEqual(PLAYSTYLE_OPTIONS.standingPreference, [
    "ashi_waza", "te_waza", "koshi_waza", "ma_sutemi_waza", "yoko_sutemi_waza", "mixed", "insufficient_evidence",
  ]);
  const questions = createPlaystyleClassificationQuestions();
  const standing = questions.standing_preference;
  assert.equal(standing.type, "choice");
  if (standing.type === "choice") assert.match(standing.criteria.ma_sutemi_waza, /Ma-sutemi-waza/u);
});
