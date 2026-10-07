import assert from "node:assert/strict";
import test from "node:test";
import { request, runSmokeDeployment } from "./smoke-deployment.js";

test("smoke request accepts successful responses and an explicitly expected status", async () => {
  const ok = await request("https://example.test", "/status", undefined, undefined, async () => new Response("ok"));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "ok");

  const notModified = await request("https://example.test", "/catalog", undefined, 304, async () => new Response(null, { status: 304 }));
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), "");
});

test("smoke request reports unexpected HTTP statuses", async () => {
  await assert.rejects(request("https://example.test", "/status", undefined, undefined,
    async () => new Response("bad", { status: 503 })), /\/status returned 503/);
  await assert.rejects(request("https://example.test", "/catalog", undefined, 304,
    async () => new Response(null, { status: 200 })), /\/catalog returned 200, expected 304/);
});

test("smoke request wraps fetch TypeErrors and preserves other failures", async () => {
  await assert.rejects(request("https://example.test", "/status", undefined, undefined,
    async () => { throw new TypeError("fetch failed"); }), /Network error accessing \/status: fetch failed/);
  await assert.rejects(request("https://example.test", "/status", undefined, undefined,
    async () => { throw new Error("unexpected transport failure"); }), /unexpected transport failure/);
});

test("smoke deployment validates release identity, cache behavior, pagination, and deterministic draws", async () => {
  const requests: string[] = [];
  const messages: string[] = [];
  const base = "https://deployment.example.test";
  const responses = new Map<string, () => Response>([
    ["GET /v1/status", () => Response.json({
      status: "ok",
      sourceGitCommit: "a".repeat(40),
      datasetChecksum: `sha256:${"b".repeat(64)}`,
      datasetVersion: "2026.09.1",
    })],
    ["GET /", () => Response.json({ openapi: `${base}/openapi/v1.yaml`, status: `${base}/v1/status` })],
    ["GET /openapi/v1.yaml", () => new Response("/v1/status:")],
    ["GET /v1/judoka", () => new Response("[]", { headers: { etag: '"versioned"', "cache-control": "public, s-maxage=300" } })],
    ["GET /v1/judoka#revalidate", () => new Response(null, { status: 304 })],
    ["GET /v1/judoka?q=shozo&limit=1", () => Response.json({ judoka: [{ slug: "shozo-fujii" }] })],
    ["GET /v1/judoka?limit=1", () => Response.json({ judoka: [{ slug: "first" }], nextCursor: "next" })],
    ["GET /v1/judoka?limit=1&cursor=next", () => Response.json({ judoka: [{ slug: "next" }] })],
    ["GET /v1/judoka?unknown=smoke", () => Response.json({ error: "unknown query" }, { status: 400 })],
    ["OPTIONS /v1/draw", () => new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET, POST, OPTIONS" } })],
    ["POST /v1/draw", () => new Response("seeded response")],
    ["POST /v1/events/draw", () => new Response("seeded response")],
  ]);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const key = new Headers(init?.headers).has("if-none-match")
      ? `${method} ${url.pathname}#revalidate`
      : `${method} ${url.pathname}${url.search}`;
    requests.push(`${method} ${url.pathname}${url.search}`);
    const response = responses.get(key);
    if (!response) throw new Error(`Unexpected smoke request: ${key}`);
    return response();
  };

  await runSmokeDeployment({
    deploymentUrl: `${base}/`,
    fetchImpl,
    log(message) { messages.push(message); },
  });

  assert.ok(requests.includes("GET /v1/judoka?limit=1&cursor=next"));
  assert.equal(requests.filter(request => request === "POST /v1/draw").length, 2);
  assert.equal(requests.filter(request => request === "POST /v1/events/draw").length, 2);
  assert.deepEqual(messages, [`Smoke check passed for ${base} (2026.09.1, ${"a".repeat(40)})`]);
});

test("smoke deployment rejects an insecure target before making requests", async () => {
  let called = false;
  await assert.rejects(runSmokeDeployment({
    deploymentUrl: "http://deployment.example.test",
    async fetchImpl() { called = true; return new Response(); },
  }), /DEPLOYMENT_URL must be an HTTPS URL/);
  assert.equal(called, false);
});
