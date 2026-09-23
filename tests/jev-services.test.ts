import assert from "node:assert/strict";
import test from "node:test";
import type { Judoka } from "../src/domain/types.js";
import { EditorialReviewService } from "../src/jev/editorial-review.js";
import { JevClientError, OpenRouterJevClient } from "../src/jev/client.js";
import { SemanticJudokaSearchService } from "../src/jev/semantic-search.js";
import { CatalogService } from "../src/domain/catalog-service.js";
import { DrawService } from "../src/draw/draw-service.js";
import { createMcpTools } from "../src/mcp/tools.js";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.js";

const candidate = (id: string, bio = "A complete editorial biography for testing purposes."): Judoka => ({
  id, slug: id, firstname: id, surname: "Judoka", signatureMoveIds: ["uchi-mata"], bio,
});

test("OpenRouterJevClient posts typed requests and rejects incomplete answers", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    model: "typesafe/jev-test",
    answers: { relevant: { type: "noul", noul: 0.91 } },
    usage: { input_tokens: 12 },
  }), { status: 200 });
  const client = new OpenRouterJevClient({ apiKey: "test-key", fetchImpl, maxRetries: 0 });
  const result = await client.decide({ query: "throw specialist" }, {
    relevant: { type: "noul", instructions: "Is this relevant?" },
  });
  assert.equal(result.model, "typesafe/jev-test");
  assert.equal(result.answers.relevant.type, "noul");
  if (result.answers.relevant.type === "noul") assert.equal(result.answers.relevant.noul, 0.91);

  const malformed = new OpenRouterJevClient({
    apiKey: "test-key", fetchImpl: async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }), maxRetries: 0,
  });
  await assert.rejects(
    malformed.decide({}, { relevant: { type: "noul", instructions: "Is this relevant?" } }),
    (error: unknown) => error instanceof JevClientError && error.code === "invalid_response",
  );
});

test("editorial reviews always require a human and derive a conservative recommendation", async () => {
  const requests: unknown[] = [];
  const service = new EditorialReviewService({
    async decide(state, questions) {
      requests.push({ state, questions });
      return { model: "typesafe/jev-test", usage: {}, answers: {
        biography_publishable: { type: "noul", noul: 0.95 },
        factual_claims_supported: { type: "noul", noul: 0.93 },
        editorial_attributes_consistent: { type: "noul", noul: 0.8 },
        duplicate_candidate: { type: "choice", choice: "none", probabilities: { none: 0.92 }, confidence: 0.92 },
        human_review_recommended: { type: "noul", noul: 0.1 },
      }};
    },
  });
  const result = await service.review({
    record: candidate("proposed"),
    evidence: [{ url: "https://example.test/profile", excerpt: "Supporting biographical evidence." }],
  });
  assert.equal(result.recommendation, "ready_for_human_approval");
  assert.equal(result.requiresHumanApproval, true);
  assert.equal(requests.length, 1);
  assert.ok(Object.hasOwn((requests[0] as { questions: object }).questions, "editorial_attributes_consistent"));
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

test("JEV MCP tools require internal authorization and use an already-filtered candidate pool", async () => {
  const catalog = new CatalogService(new JsonReadModelRepository({
    datasetVersion: "test", judoka: [candidate("a"), candidate("b")], techniques: [], events: [], countries: {}, weightCategories: [],
    manifest: { datasetVersion: "test", serviceVersion: "test", drawAlgorithms: [], defaultDrawAlgorithm: "test", sourceGitCommit: "test", checksums: { "budokon.json": "test" } },
  }));
  const mcp = createMcpTools({
    catalog, draw: new DrawService(catalog),
    semanticSearch: { async search(query, candidates) { return { model: "test", usage: {}, results: candidates.map(judoka => ({ judoka, relevance: query === "specialist" ? 0.9 : 0.5 })) }; } },
    editorialReview: { async review() { return { model: "test", usage: {}, answers: {}, recommendation: "needs_human_review" as const, requiresHumanApproval: true as const }; } },
  });
  await assert.rejects(mcp.semantic_search_judoka({ query: "specialist" }), /internal authorization/);
  const semantic = await mcp.semantic_search_judoka({ query: "specialist", maxCandidates: 2 }, { authorizedInternal: true });
  assert.deepEqual(semantic.results.map(item => item.judoka.id), ["a", "b"]);
  const review = await mcp.review_proposed_judoka({ record: candidate("new"), evidence: [] }, { authorizedInternal: true });
  assert.equal(review.requiresHumanApproval, true);
});
