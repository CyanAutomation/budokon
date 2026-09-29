import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CatalogService, DRAW_ALGORITHM, DrawService, JsonReadModelRepository, createMcpTools } from "../src/index.js";
import { createRestRouter } from "../src/api/router.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/draw-v1-golden.json", import.meta.url), "utf8"));
const catalog = new CatalogService(new JsonReadModelRepository(fixture.dataset));
const draw = new DrawService(catalog);
const rest = createRestRouter({ catalog, draw });
const mcp = createMcpTools({ catalog, draw });
const ids = response => response.judoka.map(record => record.id);
const restDraw = (request: unknown) => rest(new Request("https://example.test/v1/draw", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(request),
}));

test("budokon-v1 golden vectors are identical through REST and MCP", async () => {
  assert.equal(DRAW_ALGORITHM, "budokon-v1");
  for (const vector of fixture.vectors) {
    const response = await restDraw(vector.request);
    if (vector.expectedError) {
      assert.equal(response.status, 409, vector.name);
      assert.match((await response.json()).error.message, /exceeds the eligible pool/, vector.name);
      assert.throws(() => draw.draw(vector.request), { message: vector.expectedError }, vector.name);
      assert.throws(() => mcp.draw_judoka(vector.request), { message: vector.expectedError }, vector.name);
      continue;
    }
    assert.equal(response.status, 200, vector.name);
    const restResponse = await response.json();
    const mcpResponse = mcp.draw_judoka(vector.request);
    assert.deepEqual(ids(restResponse), vector.expectedIds, vector.name);
    assert.deepEqual(ids(mcpResponse), vector.expectedIds, vector.name);
    assert.equal(restResponse.algorithm, DRAW_ALGORITHM);
    assert.equal(mcpResponse.algorithm, DRAW_ALGORITHM);
    assert.equal(new Set(vector.expectedIds).size, vector.expectedIds.length, vector.name);
    if (vector.equivalentRequest) assert.deepEqual(ids(draw.draw(vector.equivalentRequest)), vector.expectedIds, vector.name);
  }
});

test("all draws identify their algorithm and unsupported identifiers are rejected", async () => {
  assert.equal(draw.draw({ count: 1 }).algorithm, DRAW_ALGORITHM);
  assert.throws(() => draw.draw({ algorithm: "budokon-v2" }), /unsupported draw algorithm: budokon-v2/);
  const response = await restDraw({ algorithm: "legacy" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.message, "unsupported draw algorithm: legacy");
  assert.throws(() => mcp.draw_judoka({ algorithm: "legacy" }), /unsupported draw algorithm: legacy/);
});
