import assert from "node:assert/strict";
import test from "node:test";
import { cachePublicGet, corsHeaders, preflightResponse, representationEtag, withCors } from "../worker/cors.js";

const env = { PUBLIC_ALLOWED_ORIGINS: "https://game.example, http://localhost:5173" };
const request = (origin?: string, init: RequestInit = {}): Request => {
  const headers = new Headers(init.headers);
  if (origin) headers.set("origin", origin);
  return new Request("https://api.example/v1/judoka", { ...init, headers });
};

test("CORS returns headers only for exact configured origins", () => {
  const headers = corsHeaders(request("https://game.example"), env);
  assert.equal(headers.get("access-control-allow-origin"), "https://game.example");
  assert.equal(headers.get("vary"), "Origin");
  assert.equal(corsHeaders(request("https://evil.example"), env).get("access-control-allow-origin"), null);
  assert.equal(corsHeaders(request(), env).get("access-control-allow-origin"), null);
});

test("CORS permits every origin only when the deliberate public wildcard is configured", () => {
  const headers = corsHeaders(request("https://another-game.example"), { PUBLIC_ALLOWED_ORIGINS: "*" });
  assert.equal(headers.get("access-control-allow-origin"), "*");
});

test("CORS preflight allows the public REST methods without accepting API-key headers", async () => {
  const allowed = preflightResponse(request("https://game.example", {
    method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" }
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://game.example");
  assert.equal(allowed.headers.get("vary"), "Origin");
  assert.equal(allowed.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(allowed.headers.get("access-control-allow-headers"), "content-type");
  assert.equal(await allowed.text(), "");

  const disallowed = preflightResponse(request("https://game.example", {
    method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "x-api-key" }
  }), env);
  assert.equal(disallowed.status, 403);

  const disallowedOrigin = preflightResponse(request("https://evil.example", {
    method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" }
  }), env);
  assert.equal(disallowedOrigin.status, 403);
  assert.equal(disallowedOrigin.headers.get("access-control-allow-origin"), null);

  const missingMethod = preflightResponse(request("https://game.example", { method: "OPTIONS" }), env);
  assert.equal(missingMethod.status, 403);
});

test("CORS headers wrap successful and error responses", async () => {
  const cases = [
    { name: "successful", status: 200, body: "ok", applicationHeader: "success" },
    { name: "error", status: 403, body: "denied", applicationHeader: "forbidden" }
  ];

  for (const { name, status, body, applicationHeader } of cases) {
    await test(name, async () => {
      const response = withCors(
        new Response(body, { status, headers: { "x-application-header": applicationHeader } }),
        request("https://game.example"),
        env
      );

      assert.equal(response.status, status);
      assert.equal(await response.text(), body);
      assert.equal(response.headers.get("x-application-header"), applicationHeader);
      assert.equal(response.headers.get("access-control-allow-origin"), "https://game.example");
      assert.equal(response.headers.get("vary"), "Origin");
    });
  }

  await test("disallowed origin", () => {
    const response = withCors(new Response("ok"), request("https://evil.example"), env);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("public GET responses receive a versioned cache validator and honour If-None-Match", async () => {
  const initial = await cachePublicGet(new Response("catalogue"), request(), "2026.08.1", "revision-a");
  assert.equal(initial.status, 200);
  assert.match(initial.headers.get("cache-control"), /s-maxage=86400/);
  const etag = initial.headers.get("etag");
  assert.ok(etag);

  for (const validator of [
    etag,
    `W/${etag}`,
    `"unrelated", W/"also-unrelated", ${etag}`,
    "*"
  ]) {
    const cached = await cachePublicGet(new Response("catalogue"), request(undefined, { headers: { "if-none-match": validator } }), "2026.08.1", "revision-a");
    assert.equal(cached.status, 304, validator);
    assert.equal(await cached.text(), "");
  }

  for (const validator of [
    'W/"unrelated"',
    `W/${etag}malicious`,
    `${etag}malicious`,
    ", ,"
  ]) {
    const fresh = await cachePublicGet(new Response("catalogue"), request(undefined, { headers: { "if-none-match": validator } }), "2026.08.1", "revision-a");
    assert.equal(fresh.status, 200, validator);
    assert.equal(await fresh.text(), "catalogue");
  }
});

test("public GET validators change with the representation revision and remain stable for identical inputs", async () => {
  const first = await cachePublicGet(new Response("catalogue"), request(), "2026.08.1", "revision-a");
  const repeated = await cachePublicGet(new Response("catalogue"), request(), "2026.08.1", "revision-a");
  const redeployed = await cachePublicGet(new Response("catalogue"), request(), "2026.08.1", "revision-b");

  assert.match(first.headers.get("etag") ?? "", /^"budokon-[0-9a-f]{64}"$/);
  assert.equal(repeated.headers.get("etag"), first.headers.get("etag"));
  assert.notEqual(redeployed.headers.get("etag"), first.headers.get("etag"));
});

test("representation validators have a bounded opaque format even for long query values", async () => {
  const short = await representationEtag("2026.08.1", "revision-a", request());
  const long = await representationEtag(
    "2026.08.1",
    "revision-a",
    new Request(`https://api.example/v1/judoka?q=${"a".repeat(50_000)}`),
  );

  assert.match(short, /^"budokon-[0-9a-f]{64}"$/);
  assert.match(long, /^"budokon-[0-9a-f]{64}"$/);
  assert.equal(short.length, long.length);
  assert.equal(long.length, 74);
  assert.notEqual(long, short);
});

test("representation validators canonicalize query parameter ordering", async () => {
  const first = await representationEtag(
    "2026.08.1",
    "revision-a",
    new Request("https://api.example/v1/judoka?q=champion&countryCode=JP&limit=10"),
  );
  const reordered = await representationEtag(
    "2026.08.1",
    "revision-a",
    new Request("https://api.example/v1/judoka?limit=10&q=champion&countryCode=JP"),
  );

  assert.equal(reordered, first);
});

test("representation validators distinguish representation parameters and ordered repeated values", async () => {
  const etag = (query: string) => representationEtag(
    "2026.08.1",
    "revision-a",
    new Request(`https://api.example/v1/judoka?${query}`),
  );

  assert.notEqual(await etag("countryCode=JP"), await etag("countryCode=FR"));
  assert.notEqual(
    await etag("exclude=judoka-a&exclude=judoka-b"),
    await etag("exclude=judoka-b&exclude=judoka-a"),
  );
});

test("representation validators remain stable across repeated calls", async () => {
  const candidate = new Request("https://api.example/v1/events?ruleset=ijf&category=senior");
  const validators = await Promise.all(Array.from(
    { length: 5 },
    () => representationEtag("2026.08.1", "revision-a", candidate),
  ));

  assert.equal(new Set(validators).size, 1);
});

test("authorization-sensitive responses are private and never reuse public validators", async () => {
  const publicResponse = await cachePublicGet(new Response("public"), request(), "2026.08.1", "revision-a");
  const publicEtag = publicResponse.headers.get("etag");
  assert.ok(publicEtag);

  for (const sensitiveRequest of [
    request(undefined, { headers: { authorization: "Bearer internal", "if-none-match": publicEtag } }),
    request(undefined, { headers: { "x-api-key": "internal", "if-none-match": publicEtag } }),
    new Request("https://api.example/v1/judoka?includeHidden=true", { headers: { "if-none-match": publicEtag } }),
  ]) {
    const response = await cachePublicGet(new Response("private"), sensitiveRequest, "2026.08.1", "revision-a");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("etag"), null);
    assert.equal(await response.text(), "private");
  }
});
