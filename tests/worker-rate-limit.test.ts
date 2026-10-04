import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitMcpPrincipal, rateLimitPublicRequest } from "../worker/rate-limit.js";

const request = new Request("https://api.example/v1/judoka", { headers: { "cf-connecting-ip": "203.0.113.7" } });

test("public rate limits use an IP-and-route key and reject only when the binding says so", async () => {
  let key;
  const response = await rateLimitPublicRequest(request, { PUBLIC_RATE_LIMITER: { async limit(input) { key = input.key; return { success: false }; } } });
  assert.equal(key, "203.0.113.7:/v1/judoka");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("ratelimit-limit"), "120");
  assert.equal(response.headers.get("ratelimit-policy"), "120;w=60");
});

test("an absent or temporarily failing limiter does not make the read-only catalogue unavailable", async () => {
  assert.equal(await rateLimitPublicRequest(request, {}), undefined);
  assert.equal(await rateLimitPublicRequest(request, { PUBLIC_RATE_LIMITER: { async limit() { throw new Error("unavailable"); } } }), undefined);
});

test("MCP principal rate limiting rejects blank HMAC secrets without calling the limiter", async () => {
  for (const API_KEY of [undefined, "", " \t\n "]) {
    let calls = 0;
    const response = await rateLimitMcpPrincipal({
      API_KEY,
      MCP_RATE_LIMITER: { async limit() { calls++; return { success: true }; } },
    }, "client:subject");

    assert.equal(response?.status, 503);
    assert.deepEqual(await response?.json(), {
      error: { code: "not_configured", message: "principal rate limiting is not configured" },
    });
    assert.equal(calls, 0);
  }
});

test("MCP principal rate limiting keeps valid HMAC keys private and preserves the optional binding", async () => {
  let limiterKey: string | undefined;
  const response = await rateLimitMcpPrincipal({
    API_KEY: "valid-secret",
    MCP_RATE_LIMITER: { async limit(input) { limiterKey = input.key; return { success: true }; } },
  }, "client:subject");

  assert.equal(response, undefined);
  assert.match(limiterKey ?? "", /^[0-9a-f]{64}:mcp:principal$/u);
  assert.equal(limiterKey?.includes("client:subject"), false);
  assert.equal(await rateLimitMcpPrincipal({}, "client:subject"), undefined);
});
