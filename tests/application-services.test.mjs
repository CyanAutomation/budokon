import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService } from "../src/domain/catalog-service.mjs";
import { DrawService } from "../src/draw/draw-service.mjs";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.mjs";
import { createRestHandlers } from "../src/api/handlers.mjs";
import { createMcpTools } from "../src/mcp/tools.mjs";

const repository = await JsonReadModelRepository.load();
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
