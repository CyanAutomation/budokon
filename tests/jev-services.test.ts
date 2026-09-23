import assert from "node:assert/strict";
import test from "node:test";
import type { Judoka } from "../src/domain/types.js";
import { EditorialReviewService } from "../src/jev/editorial-review.js";
import { JevClientError, OpenRouterJevClient, retryDelayMilliseconds } from "../src/jev/client.js";
import { SemanticJudokaSearchService } from "../src/jev/semantic-search.js";
import { JevJudokaQueryInterpreter } from "../src/jev/query-interpreter.js";
import { CatalogService } from "../src/domain/catalog-service.js";
import { DrawService } from "../src/draw/draw-service.js";
import { createMcpTools } from "../src/mcp/tools.js";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.js";
import { editorialReviewInputSchema } from "../src/mcp/server.js";
import { validateCanonical } from "../src/validation/validate-canonical.js";

const candidate = (id: string, bio = "A complete editorial biography for testing purposes."): Judoka => ({
  id, slug: id, firstname: id, surname: "Judoka", signatureMoveIds: ["uchi-mata"], bio,
});

test("OpenRouterJevClient posts typed requests and rejects incomplete answers", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit) => {
    requestUrl = String(url);
    requestInit = init;
    return new Response(JSON.stringify({
    model: "typesafe/jev-test",
    answers: { relevant: { type: "noul", noul: 0.91 } },
    usage: { input_tokens: 12 },
    }), { status: 200 });
  };
  const client = new OpenRouterJevClient({ apiKey: "test-key", model: "typesafe/jev-test", fetchImpl, maxRetries: 0 });
  const result = await client.decide({ query: "throw specialist" }, {
    relevant: { type: "noul", instructions: "Is this relevant?" },
  });
  assert.equal(result.model, "typesafe/jev-test");
  assert.equal(result.answers.relevant.type, "noul");
  if (result.answers.relevant.type === "noul") assert.equal(result.answers.relevant.noul, 0.91);
  assert.equal(requestUrl, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-key");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    model: "typesafe/jev-test",
    state: { query: "throw specialist" },
    questions: { relevant: { type: "noul", instructions: "Is this relevant?" } },
  });

  const malformed = new OpenRouterJevClient({
    apiKey: "test-key", fetchImpl: async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }), maxRetries: 0,
  });
  await assert.rejects(
    malformed.decide({}, { relevant: { type: "noul", instructions: "Is this relevant?" } }),
    (error: unknown) => error instanceof JevClientError && error.code === "invalid_response",
  );
});

test("OpenRouterJevClient rejects malformed choice and score probability distributions", async () => {
  const invalidResponses = [
    {
      question: { type: "choice", instructions: "Pick one", criteria: { none: "No", match: "Yes" } },
      answer: { type: "choice", choice: "none", probabilities: {}, confidence: 0 },
    },
    {
      question: { type: "choice", instructions: "Pick one", criteria: { none: "No", match: "Yes" } },
      answer: { type: "choice", choice: "none", probabilities: { none: 0.4, match: 0.4 }, confidence: 0.5 },
    },
    {
      question: { type: "choice", instructions: "Pick one", criteria: { none: "No", match: "Yes" } },
      answer: { type: "choice", choice: "none", probabilities: { none: 0.6, match: 0.4, extra: 0 }, confidence: 0.5 },
    },
    {
      question: { type: "score", instructions: "Rate it", criteria: ["low", "high"] },
      answer: { type: "score", score: 2, legend: { "0": "low", "1": "high" }, probabilities: { "0": 0, "1": 1 }, confidence: 1 },
    },
    {
      question: { type: "score", instructions: "Rate it", criteria: ["low", "high"] },
      answer: { type: "score", score: 0.5, legend: { "0": "wrong", "1": "high" }, probabilities: { "0": 0.5, "1": 0.5 }, confidence: 0.5 },
    },
  ];

  for (const { question, answer } of invalidResponses) {
    const client = new OpenRouterJevClient({
      apiKey: "test-key",
      maxRetries: 0,
      fetchImpl: async () => new Response(JSON.stringify({
        model: "typesafe/jev-test",
        answers: { decision: answer },
        usage: {},
      }), { status: 200 }),
    });
    await assert.rejects(
      client.decide({}, { decision: question as never }),
      (error: unknown) => error instanceof JevClientError && error.code === "invalid_response",
    );
  }
});

test("OpenRouterJevClient retries transient HTTP errors and honors Retry-After", async () => {
  assert.equal(retryDelayMilliseconds(0, "2", 0, () => 0), 2000);
  assert.equal(retryDelayMilliseconds(2, "invalid", 0, () => 0), 200);
  assert.equal(retryDelayMilliseconds(2, new Date(2000).toUTCString(), 0, () => 0), 2000);
  assert.equal(retryDelayMilliseconds(10, "120", 0, () => 0), 10_000);

  let attempts = 0;
  const client = new OpenRouterJevClient({
    apiKey: "test-key",
    maxRetries: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ model: "typesafe/jev-test", answers: { ok: { type: "noul", noul: 1 } }, usage: {} }), { status: 200 });
    },
  });
  const result = await client.decide("retry", { ok: { type: "noul", instructions: "Did retry work?" } });
  assert.equal(attempts, 2);
  assert.equal(result.answers.ok.type, "noul");
});

test("OpenRouterJevClient does not retry a successful response containing malformed JSON", async () => {
  let attempts = 0;
  const client = new OpenRouterJevClient({
    apiKey: "test-key",
    fetchImpl: async () => { attempts += 1; return new Response("{not-json", { status: 200 }); },
  });
  await assert.rejects(
    client.decide({}, { answer: { type: "noul", instructions: "Does it pass?" } }),
    (error: unknown) => error instanceof JevClientError && error.code === "invalid_response",
  );
  assert.equal(attempts, 1);
});

test("OpenRouterJevClient rejects non-serializable state before making a request", async () => {
  let attempts = 0;
  const state: Record<string, unknown> = {};
  state.self = state;
  const client = new OpenRouterJevClient({
    apiKey: "test-key",
    fetchImpl: async () => { attempts += 1; return new Response("{}"); },
  });
  await assert.rejects(client.decide(state, { answer: { type: "noul", instructions: "Does it pass?" } }), /JSON-serializable/);
  assert.equal(attempts, 0);
});

test("editorial reviews always require a human and derive a conservative recommendation", async () => {
  const requests: unknown[] = [];
  const service = new EditorialReviewService({
    async decide(state, questions) {
      requests.push({ state, questions });
      return { model: "typesafe/jev-test", usage: {}, answers: {
        biography_publishable: { type: "noul", noul: 0.95 },
        factual_claims_supported: { type: "noul", noul: 0.93 },
        stats_coherent: { type: "noul", noul: 0.9 },
        rarity_appropriate: { type: "noul", noul: 0.9 },
        signature_techniques_plausible: { type: "noul", noul: 0.9 },
        duplicate_candidate: { type: "choice", choice: "none", probabilities: { none: 0.92, uncertain: 0.08 }, confidence: 0.92 },
        human_review_recommended: { type: "noul", noul: 0.1 },
      }};
    },
  });
  const result = await service.review({
    record: candidate("proposed"),
    evidence: [{ url: "https://example.test/profile", excerpt: "Supporting biographical evidence." }],
    techniques: [{ id: "uchi-mata", name: "Uchi Mata", japanese: "Uchi Mata", style: "Judo", category: "Nage-waza", subCategory: "Ashi-waza", description: "A hip throw.", link: "https://example.test/uchi-mata" }],
  });
  assert.equal(result.recommendation, "ready_for_human_approval");
  assert.equal(result.requiresHumanApproval, true);
  assert.equal(requests.length, 1);
  const questions = (requests[0] as { questions: Record<string, unknown> }).questions;
  assert.ok(Object.hasOwn(questions, "stats_coherent"));
  assert.ok(Object.hasOwn(questions, "rarity_appropriate"));
  assert.ok(Object.hasOwn(questions, "signature_techniques_plausible"));
});

test("editorial review uses every editorial answer and escalates when source excerpts are missing", async () => {
  const answers = {
    biography_publishable: { type: "noul", noul: 0.95 },
    factual_claims_supported: { type: "noul", noul: 0.95 },
    stats_coherent: { type: "noul", noul: 0.95 },
    rarity_appropriate: { type: "noul", noul: 0.95 },
    signature_techniques_plausible: { type: "noul", noul: 0.01 },
    duplicate_candidate: { type: "choice", choice: "none", probabilities: { none: 1, uncertain: 0 }, confidence: 1 },
    human_review_recommended: { type: "noul", noul: 0.01 },
  } as const;
  const service = new EditorialReviewService({ async decide() { return { model: "test", usage: {}, answers }; } });
  const record = candidate("proposed");
  const withEvidence = await service.review({
    record,
    evidence: [{ url: "https://example.test/source", excerpt: "A source excerpt." }],
    techniques: [{ id: "uchi-mata", name: "Uchi Mata", japanese: "Uchi Mata", style: "Judo", category: "Nage-waza", subCategory: "Ashi-waza", description: "A hip throw.", link: "https://example.test/uchi-mata" }],
  });
  assert.equal(withEvidence.recommendation, "needs_revision");
  assert.equal(withEvidence.requiresHumanApproval, true);
  const withoutEvidence = await service.review({ record, evidence: [] });
  assert.equal(withoutEvidence.recommendation, "needs_human_review");
});

test("editorial reviewer enforces a total request size cap before calling JEV", async () => {
  let called = false;
  const service = new EditorialReviewService({ async decide() { called = true; return { model: "test", usage: {}, answers: {} }; } });
  await assert.rejects(service.review({
    record: { ...candidate("large"), extra: "x".repeat(65_000) }, evidence: [],
  }), /64 KB/);
  assert.equal(called, false);
});

test("semantic search sends bounded candidate questions and ranks by relevance deterministically", async () => {
  const service = new SemanticJudokaSearchService({
    async decide(_state, questions) {
      assert.deepEqual(Object.keys(questions), ["relevance_0", "relevance_1"]);
      return { model: "typesafe/jev-test", usage: {}, answers: {
        relevance_0: { type: "noul", noul: 0.6 },
        relevance_1: { type: "noul", noul: 0.9 },
      }};
    },
  }, { maxCandidates: 2 });
  const result = await service.search("dynamic specialist", [candidate("a"), candidate("b")]);
  assert.deepEqual(result.results.map(item => item.judoka.id), ["b", "a"]);
  assert.equal(result.results[0].relevance, 0.9);
  await assert.rejects(
    service.search("too broad", [candidate("a"), candidate("b"), candidate("c")]),
    /at most 2 candidates/,
  );
});

test("semantic search uses code-unit ordering for equal relevance scores", async () => {
  const service = new SemanticJudokaSearchService({
    async decide() { return { model: "test", usage: {}, answers: {
      relevance_0: { type: "noul", noul: 0.8 },
      relevance_1: { type: "noul", noul: 0.8 },
    } }; },
  });
  const result = await service.search("same score", [candidate("a"), candidate("Z")]);
  assert.deepEqual(result.results.map(({ judoka }) => judoka.id), ["Z", "a"]);
});

test("semantic search rejects oversized queries or candidate payloads before calling JEV", async () => {
  let called = false;
  const service = new SemanticJudokaSearchService({ async decide() { called = true; return { model: "test", usage: {}, answers: {} }; } });
  await assert.rejects(service.search("x".repeat(1_001), [candidate("a")]), /1000 characters/);
  await assert.rejects(service.search("short query", [{ ...candidate("large"), bio: "x".repeat(64_000) }]), /64 KB/);
  assert.equal(called, false);
});

test("JEV query interpretation returns confident catalogue filters and preserves uncertain choices as suggestions", async () => {
  let receivedState: unknown;
  const interpreter = new JevJudokaQueryInterpreter({
    async decide(state, questions) {
      receivedState = state;
      assert.deepEqual(Object.keys(questions), ["countryCode", "gender", "weightClass", "rarity", "personType"]);
      return { model: "typesafe/jev-test", usage: { input_tokens: 30 }, answers: {
        countryCode: { type: "choice", choice: "JP", probabilities: { any: 0.02, JP: 0.98, US: 0 }, confidence: 0.97 },
        gender: { type: "choice", choice: "female", probabilities: { any: 0.01, male: 0.01, female: 0.98 }, confidence: 0.96 },
        weightClass: { type: "choice", choice: "-57", probabilities: { any: 0.01, "-57": 0.99 }, confidence: 0.99 },
        rarity: { type: "choice", choice: "any", probabilities: { any: 1, Common: 0, Rare: 0 }, confidence: 1 },
        personType: { type: "choice", choice: "real", probabilities: { any: 0.45, real: 0.55, fictional: 0 }, confidence: 0.2 },
      } };
    },
  }, { minimumConfidence: 0.7 });
  const result = await interpreter.interpret("Japanese women under 57 kg", {
    countries: { JP: { code: "JP", country: "Japan", active: true }, US: { code: "US", country: "United States", active: true } },
    weightCategories: [{ gender: "female", description: "Women's categories", categories: [{ weight: "-57", descriptor: "Lightweight" }] }],
  });
  assert.deepEqual(result.filters, { countryCode: "JP", gender: "female", weightClass: "-57" });
  assert.deepEqual(result.suggestions.personType, { value: "real", confidence: 0.2, applied: false });
  assert.deepEqual(result.suggestions.rarity, { value: "any", confidence: 1, applied: false });
  assert.equal((receivedState as { query: string }).query, "Japanese women under 57 kg");
  assert.equal(result.model, "typesafe/jev-test");
});

test("JEV query interpretation validates its confidence threshold and empty queries", async () => {
  const client = { async decide() { throw new Error("must not call"); } };
  assert.throws(() => new JevJudokaQueryInterpreter(client, { minimumConfidence: 1.1 }), /between 0 and 1/);
  const interpreter = new JevJudokaQueryInterpreter(client);
  await assert.rejects(interpreter.interpret("  ", { countries: {}, weightCategories: [] }), /query must be non-empty/);
});

test("JEV query interpretation omits catalogue facets with no selectable values", async () => {
  const interpreter = new JevJudokaQueryInterpreter({
    async decide(_state, questions) {
      assert.deepEqual(Object.keys(questions), ["gender", "rarity", "personType"]);
      return { model: "test", usage: {}, answers: {
        gender: { type: "choice", choice: "any", probabilities: { any: 1, male: 0, female: 0 }, confidence: 1 },
        rarity: { type: "choice", choice: "any", probabilities: { any: 1, Common: 0, Rare: 0, Epic: 0, Legendary: 0 }, confidence: 1 },
        personType: { type: "choice", choice: "any", probabilities: { any: 1, real: 0, fictional: 0 }, confidence: 1 },
      } };
    },
  });
  const result = await interpreter.interpret("judoka", { countries: {}, weightCategories: [] });
  assert.deepEqual(result.filters, {});
  assert.equal(Object.hasOwn(result.suggestions, "countryCode"), false);
  assert.equal(Object.hasOwn(result.suggestions, "weightClass"), false);
});

test("JEV MCP tools require internal authorization and use an already-filtered candidate pool", async () => {
  const catalog = new CatalogService(new JsonReadModelRepository({
    datasetVersion: "test", judoka: [candidate("a"), candidate("b")], techniques: [], events: [], countries: {}, weightCategories: [],
    manifest: { datasetVersion: "test", serviceVersion: "test", drawAlgorithms: [], defaultDrawAlgorithm: "test", sourceGitCommit: "test", checksums: { "budokon.json": "test" } },
  }));
  const mcp = createMcpTools({
    catalog, draw: new DrawService(catalog),
    semanticSearch: { async search(query, candidates) { return { model: "test", usage: {}, results: candidates.map(judoka => ({ judoka, relevance: query === "specialist" ? 0.9 : 0.5 })) }; } },
    editorialReview: { async review() { return { model: "test", usage: {}, answers: {}, recommendation: "needs_human_review" as const, requiresHumanApproval: true as const }; } },
    queryInterpreter: { async interpret() { return { model: "test", usage: {}, filters: { countryCode: "JP" }, suggestions: { countryCode: { value: "JP", confidence: 0.9, applied: true } } }; } },
  });
  await assert.rejects(mcp.semantic_search_judoka({ query: "specialist" }), /internal authorization/);
  const semantic = await mcp.semantic_search_judoka({ query: "specialist", maxCandidates: 2 }, { authorizedInternal: true });
  assert.deepEqual(semantic.results.map(item => item.judoka.id), ["a", "b"]);
  const review = await mcp.review_proposed_judoka({ record: candidate("new"), evidence: [] }, { authorizedInternal: true });
  assert.equal(review.requiresHumanApproval, true);
  await assert.rejects(mcp.interpret_judoka_query({ query: "Japanese" }), /internal authorization/);
  const interpretation = await mcp.interpret_judoka_query({ query: "Japanese" }, { authorizedInternal: true });
  assert.deepEqual(interpretation.filters, { countryCode: "JP" });
});

test("JEV MCP editorial review accepts bounded canonical records and rejects malformed or oversized input", () => {
  const record = {
    id: "57a86958-73c3-4dd3-b8b8-f0bbaab58b67", slug: "test-judoka", firstname: "Test", surname: "Judoka",
    personType: "real", countryCode: "JP", weightClass: "-57", category: "Judo",
    stats: { power: 5, speed: 5, technique: 5, kumikata: 5, newaza: 5 },
    signatureMoveIds: ["uchi-mata"], lastUpdated: "2026-09-23T00:00:00Z", profileUrl: "https://example.test/profile",
    bio: "A sufficiently long biography for the canonical record schema.", gender: "female", isHidden: false, rarity: "Rare",
  };
  const base = { record, evidence: [{ url: "https://example.test/source", excerpt: "Published source excerpt." }] };
  assert.equal(editorialReviewInputSchema.safeParse(base).success, true);
  assert.equal(editorialReviewInputSchema.safeParse({ ...base, record: { ...record, extra: true } }).success, false);
  assert.equal(editorialReviewInputSchema.safeParse({ ...base, record: { ...record, stats: { ...record.stats, power: 11 } } }).success, false);
  assert.equal(editorialReviewInputSchema.safeParse({ ...base, record: { ...record, bio: "x".repeat(8_001) } }).success, false);
  assert.equal(editorialReviewInputSchema.safeParse({ ...base, evidence: [{ url: "http://example.test/source", excerpt: "Not HTTPS." }] }).success, false);
});

test("JEV MCP review schema accepts every current canonical judoka record", async () => {
  const canonical = await validateCanonical();
  const invalid = canonical.judoka.find(record => !editorialReviewInputSchema.safeParse({ record, evidence: [] }).success);
  assert.equal(invalid, undefined, invalid ? `canonical record rejected: ${invalid.slug}` : undefined);
});
