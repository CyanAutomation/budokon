import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService } from "../build/runtime/domain/catalog-service.js";
import { DrawService } from "../build/runtime/draw/draw-service.js";
import { JsonReadModelRepository } from "../build/runtime/repository/json-read-model-repository.js";
import { createRestHandlers } from "../build/runtime/api/handlers.js";
import { createMcpTools } from "../build/runtime/mcp/tools.js";
import compiledModel from "./fixtures/compiled-model.js";

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
test("display aliases, diacritic-free names, and legacy slugs resolve consistently", () => {
  assert.equal(catalog.getJudoka("Shozo Fujii")?.slug, "shozo-fujii");
  assert.equal(catalog.getJudoka("Shōzō Fujii")?.slug, "shozo-fujii");
  assert.equal(catalog.getJudoka("askley-mckenzie")?.slug, "ashley-mckenzie");
  assert.deepEqual(catalog.searchJudoka({ query: "Askley McKenzie" }).map(j => j.slug), ["ashley-mckenzie"]);
});

test("multi-technique filters match any requested technique across catalog, REST, MCP, and draws", () => {
  const filters = { signatureMoveIds: ["seoi-nage", "o-soto-gari"] };
  const expected = catalog.listJudoka({ filters }).map(j => j.slug);
  assert.ok(expected.includes("shozo-fujii") && expected.includes("nina-cutro-kelly"));
  assert.deepEqual(rest.listJudoka({ query: filters }).body.map(j => j.slug), expected);
  assert.deepEqual(mcp.search_judoka({ filters }).judoka.map(j => j.slug), expected);
  assert.equal(draw.draw({ count: 1, filters, seed: "multi-technique" }).poolSize, expected.length);
});
test("filters do not coerce missing field values into matches", () => {
  const sparseCatalog = new CatalogService({
    listJudoka: () => [
      { id: "null-value", slug: "null-value", countryCode: null, signatureMoveIds: [] },
      { id: "missing-value", slug: "missing-value", signatureMoveIds: [] }
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
test("repository rejects an empty dataset version", () => {
  assert.throws(
    () => new JsonReadModelRepository({ ...compiledModel, datasetVersion: "   " }),
    /invalid compiled dataset/,
  );
});
test("REST and MCP seeded selections are byte-for-byte equivalent", () => {
  const input = { count: 1, filters: { gender: ["male"], countryCode: ["JP", "GE"] }, exclude: ["ilia-sulamanidze"], seed: "match-472-round-3" };
  const apiBytes = JSON.stringify(rest.draw({ body: input }).body);
  const mcpBytes = JSON.stringify(mcp.draw_judoka({ ...input, filters: { countryCode: ["GE", "JP"], gender: "male" } }));
  assert.equal(apiBytes, mcpBytes);
});
test("version, draw, and MCP results expose the canonical dataset version", () => {
  assert.equal(rest.version().body.datasetVersion, compiledModel.datasetVersion);
  assert.equal(rest.draw({ body: { seed: "version-test" } }).body.datasetVersion, compiledModel.datasetVersion);
  assert.equal(mcp.search_judoka().datasetVersion, compiledModel.datasetVersion);
  assert.equal(mcp.get_judoka({ id: "shozo-fujii" }).datasetVersion, compiledModel.datasetVersion);
  assert.equal(mcp.version().datasetVersion, compiledModel.datasetVersion);
  assert.deepEqual(rest.version().body.drawAlgorithms, ["budokon-v1"]);
  assert.equal(rest.version().body.defaultDrawAlgorithm, "budokon-v1");
  assert.equal(rest.draw({ body: {} }).body.algorithm, "budokon-v1");
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
      { id: "surname-only", slug: "surname-only", firstname: null, surname: "Test", signatureMoveIds: [] },
      { id: "firstname-only", slug: "firstname-only", firstname: "Solo", surname: null, signatureMoveIds: [] }
    ]
  });

  assert.deepEqual(service.searchJudoka({ query: "test" }).map(j => j.id), ["surname-only"]);
  assert.deepEqual(service.searchJudoka({ query: "solo" }).map(j => j.id), ["firstname-only"]);
});

test("search composes with filters, exclusions, and visibility in UUID order", () => {
  const records = [
    { id: "b", slug: "second-match", firstname: "Renée", surname: "Test", gender: "female", signatureMoveIds: [] },
    { id: "a", slug: "first-match", firstname: "Renee", surname: "Test", gender: "female", signatureMoveIds: [] },
    { id: "c", slug: "hidden-match", firstname: "Renee", surname: "Test", gender: "female", signatureMoveIds: [], isHidden: true },
    { id: "d", slug: "other-match", firstname: "Renee", surname: "Test", gender: "male", signatureMoveIds: [] }
  ];
  const service = new CatalogService({ listJudoka: () => records });
  assert.deepEqual(service.searchJudoka({ query: "renee", filters: { gender: "female" }, exclude: ["second-match"] }).map(j => j.id), ["a"]);
  assert.deepEqual(service.searchJudoka({ query: "renee", includeHidden: true, authorizedInternal: true }).map(j => j.id), ["a", "b", "c", "d"]);
});

test("REST and MCP searches conform and an absent query retains list behavior", () => {
  const restResult = rest.listJudoka({ query: { q: "  SHOZO! ", countryCode: "JP", exclude: "tatsuuma-ushiyama" } }).body;
  const mcpResult = mcp.search_judoka({ query: "  SHOZO! ", filters: { countryCode: "JP" }, exclude: ["tatsuuma-ushiyama"] }).judoka;
  assert.deepEqual(restResult, mcpResult);
  assert.deepEqual(rest.listJudoka().body, catalog.listJudoka());
  assert.deepEqual(mcp.search_judoka().judoka, catalog.listJudoka());
});
