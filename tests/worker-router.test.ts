import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService, DrawService, EventDrawService, JsonReadModelRepository } from "../build/runtime/index.js";
import { DRAW_ALGORITHM } from "../build/runtime/draw/draw-service.js";
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
  MCP_ALLOWED_HOSTNAMES: "example.test",
  PUBLIC_ALLOWED_ORIGINS: "https://example.com",
};

const worker = createWorker("openapi: 3.0.0");

async function mcpJson(response: Response) {
  const body = await response.text();
  const payload = body.startsWith("event: message\n")
    ? body.split("\n").find(line => line.startsWith("data: "))?.slice("data: ".length)
    : body;
  return JSON.parse(payload ?? "");
}

async function successfulMcpToolJson(response: Response) {
  assert.equal(response.status, 200);
  const data = await mcpJson(response);
  assert.equal(data.result.isError, undefined);
  assert.equal(data.result.content[0].type, "text");
  return JSON.parse(data.result.content[0].text);
}

/**
 * Test MCP protocol initialization and tool listing.
 */
test("MCP initialize request returns proper protocol version and capabilities", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await mcpJson(response);
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.id, 1);
  assert.equal(typeof data.result.protocolVersion, "string");
  assert.equal(data.result.serverInfo.name, "budokon");
  assert.equal(typeof data.result.serverInfo.version, "string");
  assert.equal(data.result.capabilities.tools.listChanged, true);
});

/**
 * Test MCP tools listing.
 */
test("MCP tools/list returns all available tools with schemas", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  const data = await mcpJson(response);
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.id, 2);
  assert.ok(Array.isArray(data.result.tools));

  type ListedTool = { name: string; inputSchema: unknown };
  const listedTools = data.result.tools as ListedTool[];
  const expectedNames = [
    "draw_event",
    "draw_judoka",
    "get_event",
    "get_judoka",
    "get_technique",
    "list_events",
    "list_techniques",
    "search_judoka",
    "version",
  ];
  const actualNames = listedTools.map(tool => tool.name);
  assert.deepEqual([...actualNames].sort(), expectedNames, "tools/list must expose exactly the public tool-name set");
  assert.equal(new Set(actualNames).size, actualNames.length, "tool names must be unique");
  const toolsByName = new Map(listedTools.map(tool => [tool.name, tool]));

  for (const name of expectedNames) {
    const schema = toolsByName.get(name)?.inputSchema as { type?: string; additionalProperties?: boolean } | undefined;
    assert.equal(schema?.type, "object", `${name} must expose an object input schema`);
    assert.equal(schema?.additionalProperties, false, `${name} must reject unknown input properties`);
  }
});

/**
 * Public tool result contracts: docs/API.md#MCP-tools. Search semantics are
 * exercised in detail by the conformance test in application-services.test.ts.
 */
test("MCP tools/call dispatches by tool name and serializes results as text content", async () => {
  const judoka = catalog.listJudoka()[0];
  if (!judoka) throw new Error("No judoka in test data");

  const shozoId = "57a86958-73c3-4dd3-b8b8-f0bbaab58b67";
  const shozo = catalog.getJudoka(shozoId);
  if (!shozo) throw new Error("Shozo fixture is missing");

  const cases = [
    {
      id: 3,
      name: "get_judoka",
      arguments: { id: judoka.id },
      expected: { datasetVersion: compiledModel.datasetVersion, judoka },
    },
    {
      id: 4,
      name: "search_judoka",
      arguments: { query: "shozo" },
      expected: { datasetVersion: compiledModel.datasetVersion, judoka: [shozo] },
      expectedJudokaIds: [shozoId],
    },
    {
      id: 6,
      name: "version",
      arguments: {},
      expected: {
        datasetVersion: repository.datasetVersion,
        serviceVersion: repository.serviceVersion,
        sourceGitCommit: repository.sourceGitCommit,
        datasetChecksum: repository.datasetChecksum,
        drawAlgorithms: [DRAW_ALGORITHM],
        defaultDrawAlgorithm: DRAW_ALGORITHM,
      },
    },
  ] as const;

  for (const toolCase of cases) {
    const response = await worker.fetch(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: toolCase.id,
          method: "tools/call",
          params: { name: toolCase.name, arguments: toolCase.arguments },
        }),
      }),
      mockEnv
    );

    const result = await successfulMcpToolJson(response);
    assert.deepEqual(result, toolCase.expected, `${toolCase.name} must serialize its exact application result`);
    if ("expectedJudokaIds" in toolCase) {
      const resultJudoka = "judoka" in result ? result.judoka : undefined;
      assert.ok(Array.isArray(resultJudoka), `${toolCase.name} must return a judoka array`);
      assert.deepEqual(
        resultJudoka.map((record: { id: string }) => record.id),
        toolCase.expectedJudokaIds,
        "search_judoka must return only the matching public fixture IDs",
      );
    }
  }
});

/**
 * This test is limited to the worker's MCP transport serialization. The draw
 * contract and its golden selections are covered by draw-v1-golden.test.ts;
 * REST/MCP application-adapter equivalence is covered by
 * application-services.test.ts.
 */
test("MCP tools/call draw_judoka performs deterministic draw with seed", async () => {
  const input = { count: 1, seed: "test-seed" };
  const callDrawJudoka = () => worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "draw_judoka",
          arguments: input,
        },
      }),
    }),
    mockEnv
  );

  const [firstResult, secondResult] = await Promise.all([
    callDrawJudoka().then(successfulMcpToolJson),
    callDrawJudoka().then(successfulMcpToolJson),
  ]);
  const restResponse = await worker.fetch(
    new Request("https://example.test/v1/draw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    mockEnv,
  );
  assert.equal(restResponse.status, 200);
  const restResult = await restResponse.json() as { judoka: unknown[] };

  assert.equal(JSON.stringify(firstResult), JSON.stringify(secondResult));
  assert.equal(firstResult.seed, "test-seed");
  assert.equal(firstResult.algorithm, DRAW_ALGORITHM);
  assert.deepEqual(firstResult.judoka, restResult.judoka);
});

/**
 * Test MCP error handling - invalid JSON.
 */
test("MCP parse error on malformed JSON", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: "{invalid json}",
    }),
    mockEnv
  );

  assert.equal(response.status, 400);
  const data = await mcpJson(response);
  assert.ok(data.error);
});

/**
 * MCP messages use JSON-RPC 2.0 request objects, whose `jsonrpc` and `method`
 * members are required. Invalid requests use -32600, and an unidentifiable
 * request ID is represented by null in the error response.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic#messages
 * @see https://www.jsonrpc.org/specification#request_object
 */
test("MCP rejects each malformed JSON-RPC envelope property independently", async () => {
  const cases = [
    {
      description: "missing method",
      body: { jsonrpc: "2.0", id: 10 },
      responseId: null,
    },
    {
      description: "unsupported jsonrpc version",
      body: { jsonrpc: "1.0", id: 11, method: "tools/list" },
      responseId: 11,
    },
    {
      description: "missing required jsonrpc version",
      body: { id: 12, method: "tools/list" },
      responseId: 12,
    },
  ] as const;

  for (const invalidCase of cases) {
    const response = await worker.fetch(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(invalidCase.body),
      }),
      mockEnv
    );

    assert.equal(response.status, 400, invalidCase.description);
    const data = await mcpJson(response);
    assert.equal(data.jsonrpc, "2.0", invalidCase.description);
    assert.equal(data.error.code, -32600, invalidCase.description);
    assert.equal(data.id, invalidCase.responseId, invalidCase.description);
    assert.equal(
      data.error.message,
      "Bad Request: the request body is not a valid JSON-RPC message",
      invalidCase.description,
    );
  }
});

/**
 * Test MCP error handling - method not found.
 */
test("MCP method not found for unknown tool", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
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
  const data = await mcpJson(response);
  assert.ok(data.error, "the SDK returns a JSON-RPC method-not-found error");
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
  assert.deepEqual(await mcpJson(unauthenticatedResponse), {
    error: { code: "unauthorized", message: "A valid API key is required" },
  });

  const authenticatedResponse = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "GET",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    }),
    mockEnv
  );

  assert.equal(authenticatedResponse.status, 405);
  assert.equal(authenticatedResponse.headers.get("content-type"), "application/json");
  assert.equal(authenticatedResponse.headers.get("allow"), null);
  const methodError = await mcpJson(authenticatedResponse);
  assert.equal(methodError.jsonrpc, "2.0");
  assert.equal(methodError.error.code, -32000);
  assert.equal(methodError.error.message, "Method not allowed.");
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
  const data = await mcpJson(response);
  assert.equal(data.error.code, "unauthorized");
  assert.ok(data.error.message.includes("API key"));
});

test("MCP rejects an invalid API key before invoking the SDK handler", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        host: "example.test",
        authorization: "Bearer invalid-api-key",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 39,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
  assert.deepEqual(await mcpJson(response), {
    error: { code: "unauthorized", message: "A valid API key is required" },
  });
});

test("MCP rejects requests for an unconfigured Host or Origin before invoking the SDK handler", async () => {
  const headers = {
    authorization: `Bearer ${mockEnv.API_KEY}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const body = JSON.stringify({ jsonrpc: "2.0", id: 40, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } });

  const rejectedHost = await worker.fetch(new Request("https://other.test/mcp", { method: "POST", headers, body }), mockEnv);
  assert.equal(rejectedHost.status, 403);

  const rejectedOrigin = await worker.fetch(new Request("https://example.test/mcp", { method: "POST", headers: { ...headers, origin: "https://other.test" }, body }), mockEnv);
  assert.equal(rejectedOrigin.status, 403);
});

test("MCP uses its own Cloudflare rate-limit binding", async () => {
  let key: string | undefined;
  const response = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "initialize" }),
  }), {
    ...mockEnv,
    MCP_RATE_LIMITER: { async limit(input) { key = input.key; return { success: false }; } },
  });
  assert.equal(key, "anonymous:mcp");
  assert.equal(response.status, 429);
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

  const records = await mcpJson(response);
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
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
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
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 19, method: "tools/list" }),
    }),
    mockEnv
  );
  const toolsData = await mcpJson(toolsResponse);
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
        headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
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
    const data = await mcpJson(response);
    assert.equal(data.jsonrpc, "2.0", validationCase.description);
    assert.equal(data.id, validationCase.id, validationCase.description);
    assert.equal(data.result.isError, true, validationCase.description);
    assert.equal(data.result.content.length, 1, validationCase.description);
    assert.equal(data.result.content[0].type, "text", validationCase.description);
    assert.match(data.result.content[0].text, /Invalid arguments for tool draw_event/, validationCase.description);
  }
});
