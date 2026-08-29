import assert from "node:assert/strict";
import test from "node:test";
import {
  CatalogService, DrawService, JsonReadModelRepository, createRestRouter, summarizeCoverage,
  type RestCatalogDependency, type RestDrawDependency
} from "../build/runtime/index.js";
import compiledModel from "./fixtures/compiled-model.js";

const repository = new JsonReadModelRepository(compiledModel);
const catalog = new CatalogService(repository);
const router = createRestRouter({ catalog, draw: new DrawService(catalog) }, {
  authorizeInternal: request => request.headers.get("authorization") === "Bearer internal"
});
const request = (path: string, init?: RequestInit): Promise<Response> => router(new Request(`https://example.test${path}`, init));
const body = (response: Response): Promise<any> => response.json();

test("every documented catalogue and metadata endpoint conforms", async () => {
  for (const [path, expected] of <[string, unknown][]>[
    ["/v1/judoka", catalog.listJudoka()], ["/v1/techniques", catalog.listTechniques()],
    ["/v1/countries", catalog.listCountries()],
    ["/v1/weight-categories", catalog.listWeightCategories()], ["/v1/version", catalog.version()]
  ]) {
    const response = await request(path); assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /^application\/json/); assert.deepEqual(await body(response), expected);
  }
  for (const [path, expected] of <[string, unknown][]>[
    ["/v1/judoka/shozo-fujii", catalog.getJudoka("shozo-fujii")],
    [`/v1/techniques/${catalog.listTechniques()[0].id}`, catalog.listTechniques()[0]]
  ]) assert.deepEqual(await body(await request(path)), expected);
});

test("coverage returns empty rarity percentages when no public real judoka exist", () => {
  const coverage = summarizeCoverage([
    { personType: "real", isHidden: true, rarity: "Rare" },
    { personType: "fictional", isHidden: false, rarity: "Common" },
  ]);

  assert.equal(coverage.publicReal, 0);
  assert.deepEqual(coverage.byRarity, {});
  assert.deepEqual(coverage.rarityPercentages, {});
});

test("coverage exposes public real-judoka counts and stable rarity percentages", async () => {
  const response = await request("/v1/coverage");
  assert.equal(response.status, 200);
  const coverage = await body(response);
  assert.equal(coverage.publicReal, catalog.listJudoka().filter(record => record.personType === "real").length);
  assert.deepEqual(Object.keys(coverage.byRarity), ["Common", "Epic", "Legendary", "Rare"]);
  assert.ok(Math.abs(Object.values(coverage.rarityPercentages).reduce((sum, value) => sum + value, 0) - 100) <= 0.1);
});

test("version and status expose an immutable, traceable release identity", async () => {
  const version = await request("/v1/version");
  assert.equal(version.status, 200);
  const metadata = await body(version);
  assert.match(metadata.sourceGitCommit, /^[0-9a-f]{40}$/);
  assert.match(metadata.datasetChecksum, /^sha256:[0-9a-f]{64}$/);

  const status = await request("/v1/status");
  assert.equal(status.status, 200);
  assert.deepEqual(await body(status), { status: "ok", ...metadata });
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
  const drawValidationCases: Array<[RequestInit, string]> = [
    [{ method: "POST", body: "{}" }, "content-type"],
    [{ method: "POST", headers: { "content-type": "application/json" }, body: "{" }, "malformed JSON"],
    [{ method: "POST", headers: { "content-type": "application/json" }, body: "[]" }, "JSON object"],
    [{ method: "POST", headers: { "content-type": "application/json" }, body: '{"filters":{"unknown":"x"}}' }, "unsupported filter"]
  ];
  for (const [init, message] of drawValidationCases) {
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
  assert.equal((await request("/v1/collections")).status, 404);
  assert.equal((await request("/v1/unknown")).status, 404);
  assert.equal((await request("/v1/judoka?unknown=x")).status, 400);
  assert.equal((await request("/v1/judoka?collection=featured")).status, 400);
  assert.equal((await request("/v1/draw", { method: "POST", headers: { "content-type": "application/json" }, body: '{"collection":"featured"}' })).status, 400);
  assert.equal((await request("/v1/version", { method: "POST" })).status, 405);
  const failingCatalog: RestCatalogDependency = {
    searchJudoka() { throw new Error("unexpected catalog call"); },
    getJudoka() { throw new Error("unexpected catalog call"); },
    listTechniques() { throw new Error("unexpected catalog call"); },
    getTechnique() { throw new Error("unexpected catalog call"); },
    listEvents() { throw new Error("unexpected catalog call"); },
    getEvent() { throw new Error("unexpected catalog call"); },
    listCountries() { throw new Error("unexpected catalog call"); },
    listWeightCategories() { throw new Error("unexpected catalog call"); },
    version() { throw new Error("secret database detail"); },
    status() { throw new Error("unexpected catalog call"); },
    coverage() { throw new Error("unexpected catalog call"); },
  };
  const failingDraw: RestDrawDependency = {
    draw() { throw new Error("unexpected draw call"); },
  };
  const broken = createRestRouter({ catalog: failingCatalog, draw: failingDraw });
  const response = await broken(new Request("https://example.test/v1/version"));
  assert.equal(response.status, 500); assert.equal(JSON.stringify(await body(response)).includes("secret"), false);
});
