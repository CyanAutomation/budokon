import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService } from "../build/runtime/domain/catalog-service.js";
import { DrawService } from "../build/runtime/draw/draw-service.js";
import { JsonReadModelRepository } from "../build/runtime/repository/json-read-model-repository.js";
import { createRestHandlers } from "../build/runtime/api/handlers.js";
import { createMcpTools } from "../build/runtime/mcp/tools.js";
import compiledModel from "./fixtures/compiled-model.mjs";

const repository = new JsonReadModelRepository(compiledModel);
const catalog = new CatalogService(repository); const draw = new DrawService(catalog);
const rest = createRestHandlers({ catalog, draw }); const mcp = createMcpTools({ catalog, draw });

test("hidden judoka require an explicit authorized internal option", () => {
  assert.equal(catalog.listJudoka().some(j => j.isHidden), false);
  assert.equal(catalog.listJudoka({ includeHidden: true }).some(j => j.isHidden), false);
  assert.equal(catalog.listJudoka({ includeHidden: true, authorizedInternal: true }).some(j => j.isHidden), true);
});
test("combined filters, exclusions, lookup, and count validation", () => {
  const records = catalog.listJudoka({ filters: { gender: "male", countryCode: ["JP"] }, exclude: ["shozo-fujii"] });
  assert(records.every(j => j.gender === "male" && j.countryCode === "JP" && j.slug !== "shozo-fujii"));
  assert.equal(catalog.getJudoka("shozo-fujii").slug, "shozo-fujii");
  assert.throws(() => draw.draw({ count: 999 }), /exceeds eligible pool/);
});
test("filters do not coerce missing field values into matches", () => {
  const sparseCatalog = new CatalogService({
    listJudoka: () => [
      { id: "null-value", slug: "null-value", countryCode: null },
      { id: "missing-value", slug: "missing-value" }
    ]
  });
  assert.deepEqual(sparseCatalog.listJudoka({ filters: { countryCode: "null" } }), []);
  assert.deepEqual(sparseCatalog.listJudoka({ filters: { countryCode: "undefined" } }), []);
});
test("REST lookup handlers return not found when params are omitted or null", () => {
  assert.equal(rest.getJudoka().status, 404);
  assert.equal(rest.getJudoka({ params: null }).status, 404);
  assert.equal(rest.getTechnique().status, 404);
  assert.equal(rest.getTechnique({ params: null }).status, 404);
});
test("repository accepts serialized compiled data without a loader", () => {
  const copy = new JsonReadModelRepository(JSON.stringify(compiledModel));
  assert.equal(copy.datasetVersion, repository.datasetVersion);
});
test("repository reports malformed serialized data with parse context", () => {
  assert.throws(
    () => new JsonReadModelRepository('{"judoka":'),
    error => error instanceof TypeError
      && error.message.startsWith("Failed to parse JSON:")
      && error.message.length > "Failed to parse JSON:".length
  );
});
test("REST and MCP seeded selections are byte-for-byte equivalent", () => {
  const input = { count: 1, filters: { gender: ["male"], countryCode: ["JP", "GE"] }, exclude: ["ilia-sulamanidze"], seed: "match-472-round-3" };
  const apiBytes = JSON.stringify(rest.draw({ body: input }).body);
  const mcpBytes = JSON.stringify(mcp.draw_judoka({ ...input, filters: { countryCode: ["GE", "JP"], gender: "male" } }));
  assert.equal(apiBytes, mcpBytes);
});
test("version, draw, and MCP results expose the canonical dataset version", () => {
  assert.equal(rest.version().body.datasetVersion, "2026.08.1");
  assert.equal(rest.draw({ body: { seed: "version-test" } }).body.datasetVersion, "2026.08.1");
  assert.equal(mcp.search_judoka().datasetVersion, "2026.08.1");
  assert.equal(mcp.get_judoka({ id: "shozo-fujii" }).datasetVersion, "2026.08.1");
  assert.equal(mcp.version().datasetVersion, "2026.08.1");
});

test("search normalizes case, whitespace, punctuation, and diacritics across every text field", () => {
  assert.deepEqual(catalog.searchJudoka({ query: "  SHŌZŌ---FUJII " }).map(j => j.slug), ["shozo-fujii"]);
  assert.deepEqual(catalog.searchJudoka({ query: "cutro kelly" }).map(j => j.slug), ["nina-cutro-kelly"]);
  assert.deepEqual(catalog.searchJudoka({ query: "sulam" }).map(j => j.slug), ["ilia-sulamanidze"]);
  assert.deepEqual(catalog.searchJudoka({ query: "mckenzie" }).map(j => j.slug), ["ashley-mckenzie"]);
  assert.deepEqual(catalog.searchJudoka({ query: "sulamanidize" }).map(j => j.slug), ["ilia-sulamanidze"]);
});

test("search constructs full names consistently when either name is null", () => {
  const service = new CatalogService({
    listJudoka: () => [
      { id: "surname-only", slug: "surname-only", firstname: null, surname: "Test" },
      { id: "firstname-only", slug: "firstname-only", firstname: "Solo", surname: null }
    ]
  });

  assert.deepEqual(service.searchJudoka({ query: "test" }).map(j => j.id), ["surname-only"]);
  assert.deepEqual(service.searchJudoka({ query: "solo" }).map(j => j.id), ["firstname-only"]);
});

test("search composes with filters, exclusions, visibility, and collection membership in UUID order", () => {
  const records = [
    { id: "b", slug: "second-match", firstname: "Renée", surname: "Test", gender: "female" },
    { id: "a", slug: "first-match", firstname: "Renee", surname: "Test", gender: "female" },
    { id: "c", slug: "hidden-match", firstname: "Renee", surname: "Test", gender: "female", isHidden: true },
    { id: "d", slug: "other-match", firstname: "Renee", surname: "Test", gender: "male" }
  ];
  const service = new CatalogService({ listJudoka: () => records, getCollection: id => id === "featured" ? { members: ["a", "second-match"] } : undefined });
  assert.deepEqual(service.searchJudoka({ query: "renee", filters: { gender: "female" }, exclude: ["second-match"], collection: "featured" }).map(j => j.id), ["a"]);
  assert.deepEqual(service.searchJudoka({ query: "renee", includeHidden: true, authorizedInternal: true }).map(j => j.id), ["a", "b", "c", "d"]);
});

test("REST and MCP searches conform and an absent query retains list behavior", () => {
  const restResult = rest.listJudoka({ query: { q: "  SHOZO! ", countryCode: "JP", exclude: "tatsuuma-ushiyama" } }).body;
  const mcpResult = mcp.search_judoka({ query: "  SHOZO! ", filters: { countryCode: "JP" }, exclude: ["tatsuuma-ushiyama"] }).judoka;
  assert.deepEqual(restResult, mcpResult);
  assert.deepEqual(rest.listJudoka().body, catalog.listJudoka());
  assert.deepEqual(mcp.search_judoka().judoka, catalog.listJudoka());
});

test("collections support repository, catalog, REST, and MCP lookup", () => {
  const collections = catalog.listCollections();
  assert.ok(collections.length > 0);
  assert.deepEqual(repository.getCollection(collections[0].id), collections[0]);
  assert.deepEqual(rest.listCollections().body, collections);
  assert.deepEqual(rest.getCollection({ params: { id: collections[0].id } }).body, collections[0]);
  assert.equal(rest.getCollection({ params: { id: "missing" } }).status, 404);
  assert.deepEqual(mcp.list_collections().collections, collections);
  assert.deepEqual(mcp.get_collection({ id: collections[0].id }).collection, collections[0]);
});

test("collection draws constrain membership, preserve hidden visibility, and are deterministic", () => {
  const collection = catalog.getCollection("japanese-judoka");
  const visible = draw.draw({ collection: collection.id, count: 1, seed: "collection-round" });
  assert.ok(collection.members.includes(visible.judoka[0].id));
  assert.equal(visible.judoka[0].isHidden, false);
  assert.deepEqual(draw.draw({ collection: collection.id, count: 1, seed: "collection-round" }), visible);
  assert.equal(draw.draw({ collection: collection.id, count: 2, seed: "internal", includeHidden: true }, { authorizedInternal: true }).poolSize, 2);
  assert.throws(() => draw.draw({ collection: collection.id, count: 2 }), /exceeds eligible pool/);
});
