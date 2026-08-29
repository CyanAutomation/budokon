import assert from "node:assert/strict";
import test from "node:test";
import { cachePublicGet, corsHeaders, preflightResponse, withCors } from "../worker/cors.js";

const env = { PUBLIC_ALLOWED_ORIGINS: "https://game.example, http://localhost:5173" };
const request = (origin?: string, init: RequestInit = {}): Request => new Request("https://api.example/v1/judoka", {
  ...init, headers: { ...(origin ? { origin } : {}), ...(init.headers ?? {}) }
});

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

test("CORS preflight allows the public REST methods without accepting API-key headers", () => {
  const allowed = preflightResponse(request("https://game.example", {
    method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" }
  }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(allowed.headers.get("access-control-allow-headers"), "content-type");

  const disallowed = preflightResponse(request("https://game.example", {
    method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "x-api-key" }
  }), env);
  assert.equal(disallowed.status, 403);

  const missingMethod = preflightResponse(request("https://game.example", { method: "OPTIONS" }), env);
  assert.equal(missingMethod.status, 403);
});

test("CORS headers wrap successful and error responses", async () => {
  const response = withCors(new Response("denied", { status: 403 }), request("https://game.example"), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://game.example");
  assert.equal(await response.text(), "denied");
});

test("public GET responses receive a versioned cache validator and honour If-None-Match", async () => {
  const initial = cachePublicGet(new Response("catalogue"), request(), "2026.08.1");
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
    const cached = cachePublicGet(new Response("catalogue"), request(undefined, { headers: { "if-none-match": validator } }), "2026.08.1");
    assert.equal(cached.status, 304, validator);
    assert.equal(await cached.text(), "");
  }

  for (const validator of [
    'W/"unrelated"',
    `W/${etag}malicious`,
    `${etag}malicious`,
    ", ,"
  ]) {
    const fresh = cachePublicGet(new Response("catalogue"), request(undefined, { headers: { "if-none-match": validator } }), "2026.08.1");
    assert.equal(fresh.status, 200, validator);
    assert.equal(await fresh.text(), "catalogue");
  }
});
