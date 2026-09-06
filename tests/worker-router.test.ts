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
 * Test the MCP envelope for the version endpoint's release-identity response.
 * Exact release metadata is covered by the application-service contract test.
 */
test("MCP tools/call version wraps the release identity in a valid JSON-RPC response", async () => {
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
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.id, 6);
  assert.equal(data.result.isError, undefined);
  assert.equal(data.result.content[0].type, "text");
  assert.doesNotThrow(() => JSON.parse(data.result.content[0].text));
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
 * The protected endpoint does not disclose its allowed methods to unauthenticated callers.
 * @see ../README.md#mcp-authentication-and-allowed-methods
 */
test("MCP GET rejects unauthenticated access without disclosing protected endpoint details", async () => {
  const unauthenticatedResponse = await worker.fetch(
    new Request("https://example.test/mcp", { method: "GET" }),
    mockEnv
  );

  assert.equal(unauthenticatedResponse.status, 401);
  assert.equal(unauthenticatedResponse.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(unauthenticatedResponse.headers.get("allow"), null);
  assert.deepEqual(await unauthenticatedResponse.json(), {
    error: { code: "unauthorized", message: "A valid API key is required" },
  });

  const authenticatedResponse = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "GET",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
    }),
    mockEnv
  );

  assert.equal(authenticatedResponse.status, 405);
  assert.equal(authenticatedResponse.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(authenticatedResponse.headers.get("allow"), "POST");
  assert.deepEqual(await authenticatedResponse.json(), {
    error: { code: "method_not_allowed", message: "Method not allowed" },
  });
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

// Public-catalogue authentication and visibility requirement: docs/API.md,
// "BU-DO-KON API guide" (the public API needs no credential).
test("assembled worker exposes exactly the public judoka catalogue without credentials", async () => {
  const request = new Request("https://example.test/v1/judoka");
  assert.equal(request.headers.get("authorization"), null);
  assert.equal(request.headers.get("x-api-key"), null);

  const response = await worker.fetch(request, mockEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");

  const records = await response.json();
  const expectedPublicCatalogue = catalog.listJudoka();
  const hiddenFixtureIds = compiledModel.judoka
    .filter(record => record.isHidden)
    .map(record => record.id);
  assert.ok(hiddenFixtureIds.length > 0, "fixture must exercise hidden-record exclusion");
  assert.deepEqual(records, expectedPublicCatalogue);
  assert.equal(
    records.some((record: { id: string }) => hiddenFixtureIds.includes(record.id)),
    false,
    "public catalogue must not expose hidden fixture records",
  );
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
 * The draw_event input schema requires a string ruleset (see toolDefinitions in
 * worker/router.ts and the drawEvent request body in openapi/v1.yaml).
 */
test("MCP tools/call draw_event validates required parameters", async () => {
  const toolsResponse = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 19, method: "tools/list" }),
    }),
    mockEnv
  );
  const toolsData = await toolsResponse.json();
  const drawEventDefinition = toolsData.result.tools.find((tool: { name: string }) => tool.name === "draw_event");
  assert.deepEqual(drawEventDefinition.inputSchema.required, ["ruleset"]);
  assert.equal(drawEventDefinition.inputSchema.properties.ruleset.type, "string");

  const cases = [
    { id: 20, description: "missing", arguments: {} },
    { id: 21, description: "empty", arguments: { ruleset: "" } },
    { id: 22, description: "non-string", arguments: { ruleset: 42 } },
  ] as const;

  for (const validationCase of cases) {
    const response = await worker.fetch(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: validationCase.id,
          method: "tools/call",
          params: { name: "draw_event", arguments: validationCase.arguments },
        }),
      }),
      mockEnv
    );

    assert.equal(response.status, 200, validationCase.description);
    const data = await response.json();
    assert.equal(data.jsonrpc, "2.0", validationCase.description);
    assert.equal(data.id, validationCase.id, validationCase.description);
    assert.equal(data.result.isError, true, validationCase.description);
    assert.equal(data.result.content.length, 1, validationCase.description);
    assert.equal(data.result.content[0].type, "text", validationCase.description);
    assert.equal(data.result.content[0].text, "ruleset must be a non-empty string", validationCase.description);
  }
});
