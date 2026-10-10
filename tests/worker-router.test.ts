import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../worker/router.js";
import type { Env } from "../worker/env.js";
import { catalog, compiledModel, mockEnv, mcpJson, worker } from "./worker-router-support.js";

test("assembled worker exposes exactly the public judoka catalogue without credentials", async () => {
  const request = new Request("https://example.test/v1/judoka");
  assert.equal(request.headers.get("authorization"), null);
  assert.equal(request.headers.get("x-api-key"), null);

  const response = await worker.fetch(request, mockEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400");
  assert.match(response.headers.get("etag") ?? "", /^"budokon-/);

  const validatorIdentity = JSON.stringify([
    compiledModel.datasetVersion,
    compiledModel.manifest.sourceGitCommit,
    JSON.stringify([["v1", "judoka"], []]),
  ]);
  const validatorDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(validatorIdentity));
  const validatorHash = Array.from(new Uint8Array(validatorDigest), byte => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(response.headers.get("etag"), `"budokon-${validatorHash}"`);

  const records = await mcpJson(response);
  const expectedPublicCatalogue = catalog.listJudoka();
  const hiddenFixtureIds = compiledModel.judoka
    .filter(record => record.isHidden)
    .map(record => record.id);
  assert.ok(hiddenFixtureIds.length > 0, "fixture must exercise hidden-record exclusion");
  assert.deepEqual(records, expectedPublicCatalogue);
  assert.equal(
    records.some((record: { id: string }) => hiddenFixtureIds.includes(record.id)),
    false,
    "public catalogue must not expose hidden fixture records",
  );
});

test("public coverage is included in public representation caching", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/coverage/public"), mockEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag") ?? "", /^"budokon-/);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400");
  const body = await response.json() as Record<string, unknown>;
  assert.equal("hidden" in body, false);
  assert.equal("total" in body, false);
});

test("matching cached public revalidation bypasses quota, while sensitive requests do not", async () => {
  const url = "https://example.test/v1/judoka";
  const entries = new Map<string, Response>();
  const cache = {
    async match(request: Request) { return entries.get(request.url)?.clone(); },
    async put(request: Request, response: Response) { entries.set(request.url, response.clone()); },
  };
  const revalidationWorker = createWorker("openapi: 3.0.0", { cache });
  const initial = await revalidationWorker.fetch(new Request(url), mockEnv);
  const etag = initial.headers.get("etag");
  assert.ok(etag);

  const limiterCalls: Array<{ key: string }> = [];
  let allow = false;
  const env: Env = {
    ...mockEnv,
    PUBLIC_RATE_LIMITER: {
      async limit(input) {
        limiterCalls.push(input);
        return { success: allow };
      },
    },
  };

  const notModified = await revalidationWorker.fetch(new Request(url, {
    headers: { "if-none-match": etag, origin: "https://example.com" },
  }), env);
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), "");
  assert.equal(notModified.headers.get("etag"), etag);
  assert.equal(notModified.headers.get("cache-control"), "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400");
  assert.equal(notModified.headers.get("vary"), "Origin");
  assert.equal(notModified.headers.get("access-control-allow-origin"), "https://example.com");
  assert.equal(limiterCalls.length, 0, "a cached successful representation must bypass public quota");

  const mismatched = await createWorker("openapi: 3.0.0", { cache: null }).fetch(new Request(url, {
    headers: { "if-none-match": '"unrelated"' },
  }), env);
  assert.equal(mismatched.status, 429);
  assert.equal(limiterCalls.length, 1, "a validator mismatch must use the normal limiter");

  allow = true;
  const credentialed = await createWorker("openapi: 3.0.0", { cache: null }).fetch(new Request(url, {
    headers: { authorization: `Bearer ${mockEnv.INTERNAL_API_KEY}`, "if-none-match": etag },
  }), env);
  assert.equal(credentialed.status, 200);
  assert.equal(credentialed.headers.get("etag"), null);
  assert.equal(credentialed.headers.get("cache-control"), "private, no-store");

  const hidden = await createWorker("openapi: 3.0.0", { cache: null }).fetch(new Request(`${url}?includeHidden=true`, {
    headers: { "if-none-match": etag },
  }), env);
  assert.equal(hidden.status, 403);
  assert.equal(hidden.headers.get("etag"), null);
  assert.equal(hidden.headers.get("cache-control"), "private, no-store");
  assert.equal(limiterCalls.length, 3, "credentialed and hidden-record requests must retain normal quota handling");
});

test("conditional requests do not turn missing resources or invalid queries into 304", async () => {
  const noCacheWorker = createWorker("openapi: 3.0.0", { cache: null });
  const cases = [
    { path: "/v1/judoka/no-such-record", expectedStatus: 404 },
    { path: "/v1/judoka?unknownFilter=value", expectedStatus: 400 },
    { path: "/v1/techniques/%ZZ", expectedStatus: 400 },
  ];

  for (const { path, expectedStatus } of cases) {
    const response = await noCacheWorker.fetch(new Request(`https://example.test${path}`, {
      headers: { "if-none-match": "*" },
    }), mockEnv);
    assert.equal(response.status, expectedStatus, path);
  }
});

test("an authorized hidden-record representation cannot contaminate the public cache", async () => {
  const url = "https://example.test/v1/judoka?includeHidden=true";
  const internalResponse = await worker.fetch(new Request(url, {
    headers: { authorization: `Bearer ${mockEnv.INTERNAL_API_KEY}` },
  }), mockEnv);
  assert.equal(internalResponse.status, 200);
  assert.equal(internalResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(internalResponse.headers.get("etag"), null);
  const internalRecords = await internalResponse.json() as Array<{ isHidden?: boolean }>;
  assert.equal(internalRecords.some(record => record.isHidden === true), true);

  const publicResponse = await worker.fetch(new Request(url), mockEnv);
  assert.equal(publicResponse.status, 403);
  assert.equal(publicResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(publicResponse.headers.get("etag"), null);
  const publicBody = await publicResponse.json() as { error?: unknown; judoka?: Array<{ isHidden?: boolean }> };
  assert.equal(publicBody.judoka?.some(record => record.isHidden === true) ?? false, false);
});

/**
 * The initialized notification completes MCP initialization but, as a JSON-RPC
 * notification, must not receive a JSON-RPC response. Budokon's tools are
 * side-effect-free, so the absence of a response envelope is the observable
 * assurance that this message was not dispatched as an unrelated tool call.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#initialization
 */
