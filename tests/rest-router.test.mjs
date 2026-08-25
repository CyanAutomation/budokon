import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService, DrawService, JsonReadModelRepository, createRestRouter } from "../build/runtime/index.js";
import compiledModel from "./fixtures/compiled-model.mjs";

const repository = new JsonReadModelRepository(compiledModel);
const catalog = new CatalogService(repository);
const router = createRestRouter({ catalog, draw: new DrawService(catalog) }, {
  authorizeInternal: request => request.headers.get("authorization") === "Bearer internal"
});
const request = (path, init) => router(new Request(`https://example.test${path}`, init));
const body = response => response.json();

test("every documented catalogue and metadata endpoint conforms", async () => {
  for (const [path, expected] of [
    ["/v1/judoka", catalog.listJudoka()], ["/v1/techniques", catalog.listTechniques()],
    ["/v1/collections", catalog.listCollections()], ["/v1/countries", catalog.listCountries()],
    ["/v1/weight-categories", catalog.listWeightCategories()], ["/v1/version", catalog.version()]
  ]) {
    const response = await request(path); assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /^application\/json/); assert.deepEqual(await body(response), expected);
  }
  for (const [path, expected] of [
    ["/v1/judoka/shozo-fujii", catalog.getJudoka("shozo-fujii")],
    [`/v1/techniques/${catalog.listTechniques()[0].id}`, catalog.listTechniques()[0]],
    [`/v1/collections/${catalog.listCollections()[0].id}`, catalog.listCollections()[0]]
  ]) assert.deepEqual(await body(await request(path)), expected);
});

test("repeated and comma-separated combined filters share OR/AND semantics", async () => {
  const response = await request("/v1/judoka?countryCode=JP,GE&countryCode=FR&gender=male&signatureMoveIds=seoi-nage,o-soto-gari");
  assert.equal(response.status, 200);
  const records = await body(response);
  assert.deepEqual(records, catalog.searchJudoka({ filters: { countryCode: ["JP", "GE", "FR"], gender: ["male"], signatureMoveIds: ["seoi-nage", "o-soto-gari"] } }));
});

test("judoka pagination is opt-in, bounded, and preserves the filtered canonical order", async () => {
  const all = catalog.listJudoka();
  const first = await request("/v1/judoka?limit=1");
  assert.equal(first.status, 200);
  const firstPage = await body(first);
  assert.deepEqual(firstPage.judoka, all.slice(0, 1));
  assert.equal(firstPage.nextCursor, all[0].id);

  const second = await request(`/v1/judoka?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
  assert.deepEqual((await body(second)).judoka, all.slice(1, 2));
  const afterSecondRecord = await request(`/v1/judoka?limit=1&cursor=${encodeURIComponent(all[1].id)}`);
  assert.deepEqual((await body(afterSecondRecord)).judoka, all.slice(2, 3));
  assert.equal((await request("/v1/judoka?limit=0")).status, 400);
  assert.equal((await request("/v1/judoka?limit=101")).status, 400);
  assert.equal((await request("/v1/judoka?cursor=missing")).status, 400);
});

test("hidden access is explicit and unauthorized access is forbidden", async () => {
  let response = await request("/v1/judoka?includeHidden=true");
  assert.equal(response.status, 403); assert.equal((await body(response)).error.code, "forbidden");
  response = await request("/v1/judoka?includeHidden=true", { headers: { authorization: "Bearer internal" } });
  assert.equal(response.status, 200); assert.ok((await body(response)).some(record => record.isHidden));
});

test("draw validates transport and body before calling the service", async () => {
  for (const [init, message] of [
    [{ method: "POST", body: "{}" }, "content-type"],
    [{ method: "POST", headers: { "content-type": "application/json" }, body: "{" }, "malformed JSON"],
    [{ method: "POST", headers: { "content-type": "application/json" }, body: "[]" }, "JSON object"],
    [{ method: "POST", headers: { "content-type": "application/json" }, body: '{"filters":{"unknown":"x"}}' }, "unsupported filter"]
  ]) {
    const response = await request("/v1/draw", init); assert.equal(response.status, 400);
    assert.match((await body(response)).error.message, new RegExp(message));
  }
});

test("draw succeeds and impossible counts have the documented conflict response", async () => {
  let response = await request("/v1/draw", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: '{"count":1,"seed":"rest"}' });
  assert.equal(response.status, 200); assert.equal((await body(response)).algorithm, "budokon-v1");
  response = await request("/v1/draw", { method: "POST", headers: { "content-type": "application/json" }, body: '{"count":999}' });
  assert.equal(response.status, 409); assert.deepEqual(await body(response), { error: { code: "conflict", message: "requested count exceeds the eligible pool" } });
});

test("missing resources, unsupported input, methods, and unexpected failures are stable", async () => {
  assert.equal((await request("/v1/judoka/missing")).status, 404);
  assert.equal((await request("/v1/unknown")).status, 404);
  assert.equal((await request("/v1/judoka?unknown=x")).status, 400);
  assert.equal((await request("/v1/version", { method: "POST" })).status, 405);
  const broken = createRestRouter({ catalog: { version() { throw new Error("secret database detail"); } }, draw: {} });
  const response = await broken(new Request("https://example.test/v1/version"));
  assert.equal(response.status, 500); assert.equal(JSON.stringify(await body(response)).includes("secret"), false);
});
