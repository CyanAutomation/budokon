import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CatalogService, DRAW_ALGORITHM, DrawService, JsonReadModelRepository, createMcpTools } from "../build/runtime/index.js";
import { createRestHandlers } from "../build/runtime/api/handlers.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/draw-v1-golden.json", import.meta.url), "utf8"));
const catalog = new CatalogService(new JsonReadModelRepository(fixture.dataset));
const draw = new DrawService(catalog);
const rest = createRestHandlers({ catalog, draw });
const mcp = createMcpTools({ catalog, draw });
const ids = response => response.judoka.map(record => record.id);

test("budokon-v1 golden vectors are identical through REST and MCP", () => {
  assert.equal(DRAW_ALGORITHM, "budokon-v1");
  for (const vector of fixture.vectors) {
    if (vector.expectedError) {
      assert.throws(() => rest.draw({ body: vector.request }), { message: vector.expectedError }, vector.name);
      assert.throws(() => mcp.draw_judoka(vector.request), { message: vector.expectedError }, vector.name);
      continue;
    }
    const restResponse = rest.draw({ body: vector.request }).body;
    const mcpResponse = mcp.draw_judoka(vector.request);
    assert.deepEqual(ids(restResponse), vector.expectedIds, vector.name);
    assert.deepEqual(ids(mcpResponse), vector.expectedIds, vector.name);
    assert.equal(restResponse.algorithm, DRAW_ALGORITHM);
    assert.equal(mcpResponse.algorithm, DRAW_ALGORITHM);
    assert.equal(new Set(vector.expectedIds).size, vector.expectedIds.length, vector.name);
    if (vector.equivalentRequest) assert.deepEqual(ids(draw.draw(vector.equivalentRequest)), vector.expectedIds, vector.name);
  }
});

test("all draws identify their algorithm and unsupported identifiers are rejected", () => {
  assert.equal(draw.draw({ count: 1 }).algorithm, DRAW_ALGORITHM);
  assert.throws(() => draw.draw({ algorithm: "budokon-v2" }), /unsupported draw algorithm: budokon-v2/);
  assert.throws(() => rest.draw({ body: { algorithm: "legacy" } }), /unsupported draw algorithm: legacy/);
  assert.throws(() => mcp.draw_judoka({ algorithm: "legacy" }), /unsupported draw algorithm: legacy/);
});
