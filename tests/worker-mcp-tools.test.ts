import assert from "node:assert/strict";
import test from "node:test";
import { DRAW_ALGORITHM, createMcpTools } from "../src/index.js";
import { judokaOutputSchema, techniqueOutputSchema } from "../src/mcp/server.js";
import { catalog, compiledModel, draw, eventDraw, mockEnv, mcpJson, successfulMcpToolJson, worker } from "./worker-router-support.js";

test("strict MCP detail schemas accept every canonical fixture record", () => {
  for (const record of compiledModel.judoka) {
    const parsed = judokaOutputSchema.safeParse(record);
    assert.equal(parsed.success, true, `canonical judoka ${record.slug} must satisfy the MCP detail schema${parsed.success ? "" : `: ${JSON.stringify(parsed.error.issues)}`}`);
  }
  for (const technique of compiledModel.techniques) {
    const parsed = techniqueOutputSchema.safeParse(technique);
    assert.equal(parsed.success, true, `canonical technique ${technique.id} must satisfy the MCP detail schema${parsed.success ? "" : `: ${JSON.stringify(parsed.error.issues)}`}`);
  }
});

/**
 * MCP initialization returns the requested supported protocol revision and the
 * server capabilities advertised by this read-only catalogue.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#initialization
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
  assert.equal(data.result.protocolVersion, "2025-06-18");
  assert.equal(data.result.serverInfo.name, "budokon");
  assert.match(data.result.serverInfo.version, /^\d+\.\d+\.\d+$/u);
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
  const listedTools = data.result.tools as Array<ListedTool & { outputSchema?: unknown; title?: string; annotations?: { readOnlyHint?: boolean } }>;
  const expectedNames = [
    "draw_event",
    "draw_judoka",
    "get_event",
    "get_judoka",
    "get_public_coverage",
    "get_technique",
    "list_countries",
    "list_events",
    "list_techniques",
    "list_weight_categories",
    "search_judoka",
    "search_techniques",
    "version",
  ];
  const actualNames = listedTools.map(tool => tool.name);
  assert.deepEqual([...actualNames].sort(), expectedNames, "tools/list must expose exactly the public tool-name set");
  assert.equal(new Set(actualNames).size, actualNames.length, "tool names must be unique");
  const toolsByName = new Map(listedTools.map(tool => [tool.name, tool]));

  for (const name of expectedNames) {
    const tool = toolsByName.get(name);
    const schema = tool?.inputSchema as { type?: string; additionalProperties?: boolean } | undefined;
    assert.equal(schema?.type, "object", `${name} must expose an object input schema`);
    assert.equal(schema?.additionalProperties, false, `${name} must reject unknown input properties`);
    assert.equal((tool?.outputSchema as { type?: string } | undefined)?.type, "object", `${name} must expose an output schema`);
    assert.ok(tool?.title, `${name} must expose a display title`);
    assert.equal(tool?.annotations?.readOnlyHint, true, `${name} must be identified as read-only`);
  }
  const publicGetJudoka = toolsByName.get("get_judoka")?.inputSchema as { properties?: Record<string, unknown> } | undefined;
  assert.equal("includeHidden" in (publicGetJudoka?.properties ?? {}), false, "public tool discovery must omit internal visibility controls");
  const getJudokaOutput = toolsByName.get("get_judoka")?.outputSchema as { properties?: Record<string, any>; additionalProperties?: boolean } | undefined;
  const judokaVariants = getJudokaOutput?.properties?.judoka?.anyOf as Array<Record<string, any>> | undefined;
  const fullJudokaOutput = (getJudokaOutput?.properties?.judoka?.type === "object"
    ? getJudokaOutput.properties.judoka
    : judokaVariants?.find(schema => schema.type === "object")) as Record<string, any> | undefined;
  assert.equal(fullJudokaOutput?.additionalProperties, false, "full judoka output must reject undocumented fields");
  assert.equal(fullJudokaOutput?.properties?.stats?.additionalProperties, false, "judoka stats must use a closed typed schema");
  assert.deepEqual(fullJudokaOutput?.properties?.sources?.items?.properties?.claims?.items?.enum, ["identity", "nationality", "weightClass", "biography", "competitionHistory"]);
});

test("public MCP catalog tools support bounded, filterable result pages", async () => {
  const call = async (id: number, name: string, args: unknown) => {
    const response = await worker.fetch(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    }), mockEnv);
    return successfulMcpToolJson(response);
  };

  const judokaFirst = await call(70, "search_judoka", { limit: 1 });
  assert.equal(judokaFirst.judoka.length, 1);
  assert.equal(typeof judokaFirst.nextCursor, "string");
  assert.deepEqual(Object.keys(judokaFirst.judoka[0]).sort(), ["countryCode", "gender", "id", "name", "personType", "rarity", "signatureMoveIds", "slug", "weightClass"].sort());
  assert.equal("bio" in judokaFirst.judoka[0], false, "collection tools should return compact judoka summaries");
  const judokaSecond = await call(71, "search_judoka", { limit: 1, cursor: judokaFirst.nextCursor });
  assert.equal(judokaSecond.judoka.length, 1);
  assert.notEqual(judokaSecond.judoka[0].id, judokaFirst.judoka[0].id);

  const techniquePage = await call(72, "list_techniques", { limit: 1 });
  assert.equal(techniquePage.techniques.length, 1);
  assert.equal("description" in techniquePage.techniques[0], false, "collection tools should return compact technique summaries");
  assert.equal(typeof techniquePage.nextCursor, "string");
  const techniqueSearch = await call(73, "search_techniques", { query: "背負", category: "Nage-waza", subCategory: "Te-waza" });
  assert.deepEqual(techniqueSearch.techniques.map((technique: { id: string }) => technique.id), ["ippon-seoi-nage", "seoi-nage", "seoi-otoshi"]);

  const eventPage = await call(74, "list_events", { ruleset: "ju-do-kon-v1", limit: 1 });
  assert.equal(eventPage.events.length, 1);
  assert.equal(typeof eventPage.nextCursor, "string");
  assert.equal((await call(75, "list_countries", {})).countries.JP.code, "JP");
  assert.ok(Array.isArray((await call(76, "list_weight_categories", {})).weightCategories));
  const coverage = await call(77, "get_public_coverage", {});
  assert.equal("hidden" in coverage, false);
  assert.equal("total" in coverage, false);
});

/** @see ../docs/API.md#MCP-tools */
test("MCP collection and draw bounds reject oversized requests", async () => {
  const call = async (id: number, name: string, args: unknown) => {
    const response = await worker.fetch(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    }), mockEnv);
    return mcpJson(response);
  };

  const maximumPage = await call(78, "search_judoka", { limit: 50 });
  assert.equal(maximumPage.result.isError, undefined);
  const page = JSON.parse(maximumPage.result.content[0].text);
  assert.ok(page.judoka.length <= 50);

  const maximumDraw = await call(79, "draw_judoka", { count: 10, seed: "mcp-boundary" });
  assert.equal(maximumDraw.result.isError, undefined);
  assert.equal(JSON.parse(maximumDraw.result.content[0].text).judoka.length, 10);

  const oversizedPage = await call(80, "search_judoka", { limit: 51 });
  const oversizedDraw = await call(81, "draw_judoka", { count: 11 });
  const unsupportedAlgorithm = await call(82, "draw_judoka", { algorithm: "unknown" });
  for (const [toolName, field, result] of [
    ["search_judoka", "limit", oversizedPage],
    ["draw_judoka", "count", oversizedDraw],
    ["draw_judoka", "algorithm", unsupportedAlgorithm],
  ] as const) {
    assert.equal(result.jsonrpc, "2.0");
    assert.equal(result.result.isError, true);
    assert.equal(result.result.content.length, 1);
    assert.equal(result.result.content[0].type, "text");
    assert.match(result.result.content[0].text, new RegExp(`Invalid arguments for tool ${toolName}`, "u"));
    assert.match(result.result.content[0].text, new RegExp(field, "u"));
  }
});

test("MCP rejects ambiguous judoka search aliases", async () => {
  const response = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 78, method: "tools/call", params: { name: "search_judoka", arguments: { query: "shozo", q: "teddy" } } }),
  }), mockEnv);
  const envelope = await mcpJson(response);
  assert.equal(envelope.result.isError, true);
  assert.equal(envelope.result.content.length, 1);
  assert.equal(envelope.result.content[0].type, "text");
  assert.match(envelope.result.content[0].text, /Invalid arguments for tool search_judoka/u);
  assert.match(envelope.result.content[0].text, /q/u);
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
      expected: { datasetVersion: compiledModel.datasetVersion, judoka: [{
        id: shozo.id,
        slug: shozo.slug,
        name: `${shozo.firstname} ${shozo.surname}`,
        personType: shozo.personType,
        countryCode: shozo.countryCode,
        gender: shozo.gender,
        weightClass: shozo.weightClass,
        rarity: shozo.rarity,
        signatureMoveIds: shozo.signatureMoveIds,
      }] },
      expectedJudokaIds: [shozoId],
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
 * Release-identity contract: application-services.test.ts, "version endpoint
 * release identity matches repository metadata and the draw algorithm contract".
 * This test adds only the MCP SDK's JSON-RPC and text-content serialization.
 */
test("MCP tools/call version wraps the release identity in a valid JSON-RPC response", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "version", arguments: {} },
      }),
    }),
    mockEnv,
  );

  assert.equal(response.status, 200);
  const envelope = await mcpJson(response);
  assert.equal(envelope.jsonrpc, "2.0");
  assert.equal(envelope.id, 6);
  assert.equal(envelope.result.isError, undefined);
  assert.equal(envelope.result.content.length, 1);
  assert.equal(envelope.result.content[0].type, "text");
  assert.equal(typeof envelope.result.content[0].text, "string");

  const releaseIdentity = JSON.parse(envelope.result.content[0].text);
  assert.equal(typeof releaseIdentity.datasetVersion, "string");
  assert.equal(typeof releaseIdentity.serviceVersion, "string");
  assert.equal(typeof releaseIdentity.sourceGitCommit, "string");
  assert.equal(typeof releaseIdentity.datasetChecksum, "string");
  assert.ok(Array.isArray(releaseIdentity.drawAlgorithms));
  assert.ok(releaseIdentity.drawAlgorithms.every((algorithm: unknown) => typeof algorithm === "string"));
  assert.equal(typeof releaseIdentity.defaultDrawAlgorithm, "string");

  const applicationVersion = createMcpTools({ catalog, draw, eventDraw }).version();
  assert.deepEqual(releaseIdentity, applicationVersion);
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
 * MCP uses JSON-RPC's Parse error response for JSON that cannot be parsed. The
 * response ID must be null because no request ID can be recovered. The detail
 * after the standard public "Parse error" message is intentionally not tested:
 * it is SDK-specific rather than part of the protocol contract.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic#messages
 * @see https://www.jsonrpc.org/specification#response_object
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
  assert.equal(response.headers.get("content-type"), "application/json");
  const data = await mcpJson(response);
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.error.code, -32700);
  assert.equal(data.id, null);
  assert.match(data.error.message, /^Parse error(?:$|:)/);
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
 * Protocol-level errors such as an unknown tool are returned as JSON-RPC errors.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling
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
        params: { name: "unknown_tool", arguments: {} },
      }),
    }),
    mockEnv
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await mcpJson(response), {
    jsonrpc: "2.0",
    id: 11,
    error: {
      code: -32602,
      message: "Tool unknown_tool not found",
    },
  });
});

/**
 * The protected endpoint does not disclose its allowed methods to unauthenticated callers.
 * @see ../README.md#mcp-authentication-and-allowed-methods
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
  assert.equal(response.headers.get("content-type"), null);

  const body = await response.text();
  assert.equal(body, "");
  assert.equal(body.includes('"result"'), false, "notification must not return a JSON-RPC result envelope");
  assert.equal(body.includes('"error"'), false, "notification must not return a JSON-RPC error envelope");
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
