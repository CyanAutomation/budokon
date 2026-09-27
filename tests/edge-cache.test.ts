import assert from "node:assert/strict";
import test from "node:test";
import {
  publicCacheKey,
  readPublicCache,
  writePublicCache,
  type EdgeCacheStorage,
} from "../worker/edge-cache.js";
import { createWorker, type Env } from "../worker/router.js";

class MemoryCache implements EdgeCacheStorage {
  readonly entries = new Map<string, Response>();
  matches = 0;
  puts = 0;

  async match(request: Request) {
    this.matches += 1;
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response) {
    this.puts += 1;
    this.entries.set(request.url, response.clone());
  }
}

const revision = { dataset: "dataset-1", service: "service-1" };

test("edge cache normalizes queries and serves a stored public hit", async () => {
  const cache = new MemoryCache();
  const first = new Request("https://api.test/v1/judoka?countryCode=JP&gender=female&countryCode=FR");
  const equivalent = new Request("https://api.test/v1/judoka?countryCode=FR&countryCode=JP&gender=female");

  const miss = await readPublicCache(cache, first, revision);
  assert.equal(miss, undefined);
  const stored = await writePublicCache(cache, first, new Response("public", { status: 200 }), revision, { cacheablePublicly: true });
  assert.equal(await stored.text(), "public");
  const hit = await readPublicCache(cache, equivalent, revision);
  assert.equal(await hit?.text(), "public");
  assert.equal(cache.puts, 1);
  assert.equal(publicCacheKey(first, revision)?.url, publicCacheKey(equivalent, revision)?.url);
});

test("dataset and service revisions invalidate edge cache entries", async () => {
  const cache = new MemoryCache();
  const request = new Request("https://api.test/v1/version");
  await writePublicCache(cache, request, new Response("old"), revision, { cacheablePublicly: true });

  assert.equal(await (await readPublicCache(cache, request, revision))?.text(), "old");
  assert.equal(await readPublicCache(cache, request, { ...revision, dataset: "dataset-2" }), undefined);
  assert.equal(await readPublicCache(cache, request, { ...revision, service: "service-2" }), undefined);
});

test("cached responses use weak comparison for If-None-Match validators", async () => {
  const cache = new MemoryCache();
  const request = new Request("https://api.test/v1/version");
  const key = publicCacheKey(request, revision);
  assert.ok(key);
  cache.entries.set(key.url, new Response("public", { headers: { etag: 'W/"revision"' } }));

  for (const validator of ['W/"revision"', '"revision"', '"other", W/"revision"']) {
    const response = await readPublicCache(
      cache,
      new Request(request, { headers: { "if-none-match": validator } }),
      revision,
    );
    assert.equal(response?.status, 304, `${validator} should match a weak cached ETag`);
    assert.equal(await response?.text(), "");
  }

  const miss = await readPublicCache(
    cache,
    new Request(request, { headers: { "if-none-match": 'W/"other"' } }),
    revision,
  );
  assert.equal(miss?.status, 200);
  assert.equal(await miss?.text(), "public");
});

test("private and randomized requests bypass cache lookup and storage", async () => {
  const requests = [
    new Request("https://api.test/v1/judoka", { headers: { authorization: "Bearer secret" } }),
    new Request("https://api.test/v1/judoka", { headers: { "x-api-key": "secret" } }),
    new Request("https://api.test/v1/judoka?includeHidden=true"),
    new Request("https://api.test/v1/judoka", { method: "POST" }),
    new Request("https://api.test/v1/draw"),
    new Request("https://api.test/v1/events/draw"),
  ];

  for (const request of requests) {
    const cache = new MemoryCache();
    assert.equal(await readPublicCache(cache, request, revision), undefined);
    await writePublicCache(cache, request, new Response("sensitive"), revision, { cacheablePublicly: false });
    assert.equal(cache.matches, 0);
    assert.equal(cache.puts, 0);
  }
});

test("hidden and unsuccessful representations cannot contaminate a public entry", async () => {
  const cache = new MemoryCache();
  const publicRequest = new Request("https://api.test/v1/judoka");
  const hiddenRequest = new Request("https://api.test/v1/judoka?includeHidden=true", { headers: { authorization: "Bearer internal" } });

  await writePublicCache(cache, hiddenRequest, new Response('[{"isHidden":true}]'), revision, { cacheablePublicly: false });
  await writePublicCache(cache, publicRequest, new Response("error", { status: 500 }), revision, { cacheablePublicly: true });
  assert.equal(cache.puts, 0);
  assert.equal(await readPublicCache(cache, publicRequest, revision), undefined);

  await writePublicCache(cache, publicRequest, new Response("[]"), revision, { cacheablePublicly: true });
  assert.equal(await (await readPublicCache(cache, publicRequest, revision))?.text(), "[]");
});

test("worker uses the injected cache before REST routing and applies CORS after the cached representation", async () => {
  const cache = new MemoryCache();
  const worker = createWorker("openapi: 3.0.0", { cache });
  const env: Env = { API_KEY: "test", PUBLIC_ALLOWED_ORIGINS: "https://allowed.test" };
  const url = "https://api.test/v1/version";

  const miss = await worker.fetch(new Request(url, { headers: { origin: "https://allowed.test" } }), env);
  assert.equal(miss.status, 200);
  assert.equal(miss.headers.get("access-control-allow-origin"), "https://allowed.test");
  assert.equal(cache.puts, 1);
  const key = [...cache.entries.keys()][0];
  assert.ok(key);
  const stored = cache.entries.get(key);
  assert.equal(stored?.headers.get("access-control-allow-origin"), null, "cache must contain the origin-independent response");
  cache.entries.set(key, new Response("from-cache", { status: 200, headers: stored?.headers }));

  const hit = await worker.fetch(new Request(url, { headers: { origin: "https://not-allowed.test" } }), env);
  assert.equal(await hit.text(), "from-cache", "the injected cache hit must bypass REST routing");
  assert.equal(hit.headers.get("access-control-allow-origin"), null);
  assert.equal(cache.puts, 1);
});
