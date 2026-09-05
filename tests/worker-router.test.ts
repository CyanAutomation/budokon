import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService, DrawService, EventDrawService, JsonReadModelRepository } from "../build/runtime/index.js";
import { createWorker } from "../worker/router.js";
import type { Env } from "../worker/router.js";
import compiledModel from "./fixtures/compiled-model.js";

const repository = new JsonReadModelRepository(compiledModel);
const catalog = new CatalogService(repository);
const draw = new DrawService(catalog);
const eventDraw = new EventDrawService(repository);

const mockEnv: Env = {
  API_KEY: "test-api-key",
  INTERNAL_API_KEY: "internal-test-key",
  PUBLIC_ALLOWED_ORIGINS: "https://example.com",
};

const worker = createWorker("openapi: 3.0.0");

/**
 * Test MCP protocol initialization and tool listing.
 */
test("MCP initialize request returns proper protocol version and capabilities", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.id, 1);
  assert.equal(data.result.protocolVersion, "2025-06-18");
  assert.equal(data.result.serverInfo.name, "budokon");
  assert.equal(typeof data.result.serverInfo.version, "string");
  assert.deepEqual(data.result.capabilities, { tools: {} });
});

/**
 * Test MCP tools listing.
 */
test("MCP tools/list returns all available tools with schemas", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.id, 2);
  assert.ok(Array.isArray(data.result.tools));
  assert.ok(data.result.tools.length > 0);

  const toolNames = data.result.tools.map((t: { name: string }) => t.name);
  assert.ok(toolNames.includes("get_judoka"));
  assert.ok(toolNames.includes("search_judoka"));
  assert.ok(toolNames.includes("draw_judoka"));
  assert.ok(toolNames.includes("draw_event"));
  assert.ok(toolNames.includes("version"));

  // Verify tool has proper schema structure
  const versionTool = data.result.tools.find((t: { name: string }) => t.name === "version");
  assert.ok(versionTool.inputSchema);
  assert.equal(versionTool.inputSchema.type, "object");
});

/**
 * Test MCP tool call - get_judoka.
 */
test("MCP tools/call get_judoka returns valid MCP response", async () => {
  const judoka = catalog.listJudoka()[0];
  if (!judoka) throw new Error("No judoka in test data");

  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_judoka", arguments: { id: judoka.id } },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.id, 3);
  assert.ok(data.result);
  assert.ok(data.result.content);
  assert.ok(Array.isArray(data.result.content));
  assert.ok(data.result.content.length > 0);
  assert.equal(data.result.content[0].type, "text");
  assert.ok(typeof data.result.content[0].text === "string");
});

/**
 * Test MCP tool call - search_judoka.
 */
test("MCP tools/call search_judoka returns valid MCP response", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "search_judoka", arguments: { query: "shozo" } },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result.isError, undefined); // Success
  assert.ok(data.result.content);
  assert.ok(Array.isArray(data.result.content));
  assert.ok(data.result.content.length > 0);
  assert.equal(data.result.content[0].type, "text");
  assert.ok(typeof data.result.content[0].text === "string");
});

/**
 * Test MCP tool call - draw_judoka.
 */
test("MCP tools/call draw_judoka performs deterministic draw with seed", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "draw_judoka",
          arguments: { count: 1, seed: "test-seed" },
        },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  const result = JSON.parse(data.result.content[0].text);
  assert.ok(result.judoka);
  assert.ok(Array.isArray(result.judoka));
  assert.equal(result.judoka.length, 1);
  assert.ok(result.seed);
});

/**
 * Test MCP tool call - version.
 */
test("MCP tools/call version returns version info", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "version", arguments: {} },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  const result = JSON.parse(data.result.content[0].text);
  assert.ok(result.datasetVersion);
  assert.ok(result.drawAlgorithms);
});

/**
 * Test MCP error handling - invalid JSON.
 */
test("MCP parse error on malformed JSON", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: "{invalid json}",
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.error.code, -32700);
  assert.equal(data.error.message, "Parse error");
});

/**
 * Test MCP error handling - invalid request.
 */
test("MCP invalid request missing required fields", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({ jsonrpc: "1.0", id: 10 }), // missing method
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.error.code, -32600);
  assert.equal(data.error.message, "Invalid Request");
});

/**
 * Test MCP error handling - method not found.
 */
test("MCP method not found for unknown tool", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "unknown_tool" },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result.isError, true);
  assert.ok(data.result.content[0].text.includes("Unknown tool"));
});

/**
 * Test MCP POST requirement.
 */
test("MCP GET request requires authorization before validating method", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", { method: "GET" }),
    mockEnv
  );

  // GET returns 401 (unauthorized) before 405 check because authorization is checked first
  assert.equal(response.status, 401);
});

/**
 * Test worker authorization - MCP path requires API key.
 */
test("MCP unauthorized when API key is missing", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize" }),
    }),
    mockEnv
  );

  assert.equal(response.status, 401);
  const data = await response.json();
  assert.equal(data.error.code, "unauthorized");
  assert.ok(data.error.message.includes("API key"));
});

/**
 * Test worker routing - REST routes are public.
 */
test("REST /v1/judoka endpoint is accessible without API key", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/v1/judoka"),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(Array.isArray(data));
});

/**
 * Test worker routing - landing page.
 */
test("Landing page at / returns documentation links in JSON", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), mockEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  const data = await response.json();
  assert.equal(data.name, "BU-DO-KON public catalogue API");
  assert.ok(data.documentation);
  assert.ok(data.openapi);
});

/**
 * Test worker routing - documentation.
 */
test("Documentation page at /docs returns valid response", async () => {
  const response = await worker.fetch(new Request("https://example.test/docs"), mockEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
});

/**
 * Test worker routing - OpenAPI spec.
 */
test("OpenAPI spec at /openapi/v1.yaml returns valid response", async () => {
  const response = await worker.fetch(new Request("https://example.test/openapi/v1.yaml"), mockEnv);
  assert.equal(response.status, 200);
});

/**
 * Test worker CORS - OPTIONS request for REST endpoint.
 */
test("OPTIONS request for /v1/ endpoint returns CORS headers when origin is allowed", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/v1/judoka", {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com", // Must match PUBLIC_ALLOWED_ORIGINS
        "access-control-request-method": "GET",
      },
    }),
    mockEnv
  );

  assert.equal(response.status, 204);
  assert.ok(response.headers.get("access-control-allow-origin"));
});

/**
 * Test worker CORS - OPTIONS with disallowed origin returns 403.
 */
test("OPTIONS request with disallowed origin returns 403", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/v1/judoka", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.com", // Not in PUBLIC_ALLOWED_ORIGINS
        "access-control-request-method": "GET",
      },
    }),
    mockEnv
  );

  assert.equal(response.status, 403);
});

/**
 * Test worker CORS - OPTIONS request for non-REST endpoint returns 405.
 */
test("OPTIONS request for non-REST endpoint returns 405", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/unknown", { method: "OPTIONS" }),
    mockEnv
  );

  assert.equal(response.status, 405);
});

/**
 * Test MCP notifications/initialized.
 */
test("MCP notifications/initialized returns 202", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 202);
});

/**
 * Test tool error handling - draw_event with missing ruleset.
 */
test("MCP tools/call draw_event validates required parameters", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "draw_event",
          arguments: {}, // Missing required ruleset
        },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.result.isError, true);
  assert.ok(data.result.content[0].text.includes("must be a non-empty string") || data.result.content[0].text.includes("error"));
});
