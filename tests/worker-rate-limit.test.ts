import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitPublicRequest } from "../worker/rate-limit.js";

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
