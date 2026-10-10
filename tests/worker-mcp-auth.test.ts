import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../worker/env.js";
import { compiledModel, mockEnv, mcpJson, successfulMcpToolJson, worker } from "./worker-router-support.js";

interface OAuthMcpTestHarness {
  env: Env;
  introspectedTokens: string[];
  limiterKeys: string[];
  quotaState: { rejectPrincipalQuota: boolean };
}

function createOAuthMcpTestHarness(): OAuthMcpTestHarness {
  const env: Env = {
    ...mockEnv,
    MCP_OAUTH_ISSUER: "https://auth.example.test",
    MCP_OAUTH_AUTHORIZATION_ENDPOINT: "https://auth.example.test/authorize",
    MCP_OAUTH_TOKEN_ENDPOINT: "https://auth.example.test/token",
    MCP_OAUTH_INTROSPECTION_ENDPOINT: "https://auth.example.test/introspect",
    MCP_OAUTH_CLIENT_ID: "budokon-resource",
    MCP_OAUTH_CLIENT_SECRET: "resource-secret",
    MCP_RESOURCE_URL: "https://example.test/mcp",
    JEV_OPENROUTER_API_KEY: "unused-model-key",
  };
  const introspectedTokens: string[] = [];
  const limiterKeys: string[] = [];
  const quotaState = { rejectPrincipalQuota: false };
  env.MCP_RATE_LIMITER = { async limit({ key }) {
    limiterKeys.push(key);
    return { success: !(quotaState.rejectPrincipalQuota && key.endsWith(":mcp:principal")) };
  } };
  return { env, introspectedTokens, limiterKeys, quotaState };
}

function mockOAuthIntrospection(env: Env, introspectedTokens: string[]): () => void {
  const originalFetch = globalThis.fetch;
  const tokenClaims: Record<string, Record<string, unknown>> = {
    "public-token": { active: true, sub: "athlete-public", scope: "budokon:read", aud: env.MCP_RESOURCE_URL, exp: Math.floor(Date.now() / 1_000) + 600 },
    "internal-token": { active: true, sub: "athlete-internal", scope: "budokon:read budokon:internal", aud: env.MCP_RESOURCE_URL, exp: Math.floor(Date.now() / 1_000) + 600 },
    "jev-token": { active: true, sub: "athlete-jev", scope: "budokon:read budokon:jev", aud: env.MCP_RESOURCE_URL, exp: Math.floor(Date.now() / 1_000) + 600 },
    "no-read-token": { active: true, sub: "athlete-other", scope: "budokon:internal", aud: env.MCP_RESOURCE_URL, exp: Math.floor(Date.now() / 1_000) + 600 },
    "wrong-audience": { active: true, sub: "athlete-other", scope: "budokon:read", aud: "https://other.example.test/mcp", exp: Math.floor(Date.now() / 1_000) + 600 },
    "expired-token": { active: true, sub: "athlete-other", scope: "budokon:read", aud: env.MCP_RESOURCE_URL, exp: Math.floor(Date.now() / 1_000) - 1 },
    "missing-expiry": { active: true, sub: "athlete-other", scope: "budokon:read", aud: env.MCP_RESOURCE_URL },
    "revoked-token": { active: false, sub: "athlete-other", scope: "budokon:read", aud: env.MCP_RESOURCE_URL, exp: Math.floor(Date.now() / 1_000) + 600 },
  };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), env.MCP_OAUTH_INTROSPECTION_ENDPOINT);
    assert.equal(new Headers(init!.headers).get("authorization"), `Basic ${btoa("budokon-resource:resource-secret")}`);
    const token = new URLSearchParams(String(init!.body)).get("token")!;
    introspectedTokens.push(token);
    return new Response(JSON.stringify(tokenClaims[token]), { headers: { "content-type": "application/json" } });
  };
  return () => { globalThis.fetch = originalFetch; };
}

async function postMcpRequest(env: Env, id: number, token?: string): Promise<Response> {
  const headers = new Headers({
    host: "example.test",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }),
  }), env);
}

async function listOAuthMcpTools(env: Env, token: string, id: number) {
  const response = await postMcpRequest(env, id, token);
  assert.equal(response.status, 200);
  return (await mcpJson(response)).result.tools as Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>;
}

async function assertOAuthDiscovery(env: Env): Promise<void> {
  const protectedResource = await worker.fetch(new Request("https://example.test/.well-known/oauth-protected-resource/mcp"), env);
  assert.equal(protectedResource.status, 200);
  const protectedMetadata = await protectedResource.json() as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
  assert.equal(protectedMetadata.resource, env.MCP_RESOURCE_URL);
  assert.deepEqual(protectedMetadata.authorization_servers, [env.MCP_OAUTH_ISSUER]);
  assert.ok(protectedMetadata.scopes_supported.includes("budokon:internal"));

  const authorizationServer = await worker.fetch(new Request("https://example.test/.well-known/oauth-authorization-server"), env);
  assert.equal(authorizationServer.status, 200);
  const serverMetadata = await authorizationServer.json() as { authorization_endpoint: string; code_challenge_methods_supported: string[] };
  assert.equal(serverMetadata.authorization_endpoint, env.MCP_OAUTH_AUTHORIZATION_ENDPOINT);
  assert.ok(serverMetadata.code_challenge_methods_supported.includes("S256"));

  const challenge = await postMcpRequest(env, 87);
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get("www-authenticate") ?? "", /resource_metadata=/u);
}

async function assertOAuthToolScopes(env: Env, introspectedTokens: string[]): Promise<void> {
  const publicTools = await listOAuthMcpTools(env, "public-token", 82);
  const internalTools = await listOAuthMcpTools(env, "internal-token", 83);
  const jevTools = await listOAuthMcpTools(env, "jev-token", 85);
  assert.equal("includeHidden" in (publicTools.find(tool => tool.name === "get_judoka")?.inputSchema.properties ?? {}), false);
  assert.equal("includeHidden" in (internalTools.find(tool => tool.name === "get_judoka")?.inputSchema.properties ?? {}), true);
  assert.ok(!publicTools.some(tool => tool.name === "semantic_search_judoka"));
  assert.ok(internalTools.some(tool => tool.name === "semantic_search_judoka"));
  assert.ok(jevTools.some(tool => tool.name === "semantic_search_judoka"));
  assert.equal("includeHidden" in (jevTools.find(tool => tool.name === "semantic_search_judoka")?.inputSchema.properties ?? {}), false);
  assert.deepEqual(introspectedTokens, ["public-token", "internal-token", "jev-token"]);
}

async function assertOAuthRejections(env: Env): Promise<void> {
  const insufficientScope = await postMcpRequest(env, 86, "no-read-token");
  assert.equal(insufficientScope.status, 403);
  assert.match(insufficientScope.headers.get("www-authenticate") ?? "", /insufficient_scope/u);

  for (const token of ["wrong-audience", "expired-token", "missing-expiry"]) {
    const response = await postMcpRequest(env, 89, token);
    assert.equal(response.status, 401, `${token} must not authenticate`);
  }
  const revoked = await postMcpRequest(env, 84, "revoked-token");
  assert.equal(revoked.status, 401);
  assert.match(revoked.headers.get("www-authenticate") ?? "", /resource_metadata=/u);
}

async function assertOAuthPrincipalRateLimit(harness: OAuthMcpTestHarness): Promise<void> {
  const principalKeys = harness.limiterKeys.filter(key => key.endsWith(":mcp:principal"));
  assert.equal(principalKeys.length, 3, "each authenticated OAuth subject is independently rate limited");
  assert.equal(new Set(principalKeys).size, 3, "different OAuth subjects must receive distinct quotas");
  assert.ok(principalKeys.every(key => !key.includes("athlete-")), "limiter keys must not contain subject identifiers");

  harness.quotaState.rejectPrincipalQuota = true;
  const limited = await postMcpRequest(harness.env, 88, "public-token");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
}

test("JEV MCP tools are discoverable only to the internal credential when configured", async () => {
  const env: Env = { ...mockEnv, JEV_OPENROUTER_API_KEY: "test-key" };
  const listTools = async (credential: string, id: number) => {
    const response = await worker.fetch(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { host: "example.test", authorization: `Bearer ${credential}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }),
    }), env);
    const body = await mcpJson(response) as { result: { tools: Array<{
      name: string;
      inputSchema: { properties?: Record<string, unknown> };
      outputSchema?: { type?: string };
      title?: string;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
    }> } };
    return body.result.tools;
  };

  const regularTools = await listTools(env.API_KEY, 20);
  const internalTools = await listTools(env.INTERNAL_API_KEY!, 21);
  const regularNames = regularTools.map(tool => tool.name);
  const internalNames = internalTools.map(tool => tool.name);
  assert.ok(!regularNames.includes("semantic_search_judoka"));
  assert.ok(!regularNames.includes("review_proposed_judoka"));
  assert.ok(!regularNames.includes("review_proposed_judoka_batch"));
  assert.ok(!regularNames.includes("review_judoka_playstyle"));
  assert.ok(!regularNames.includes("interpret_judoka_query"));
  assert.ok(internalNames.includes("semantic_search_judoka"));
  assert.ok(internalNames.includes("review_proposed_judoka"));
  assert.ok(internalNames.includes("review_proposed_judoka_batch"));
  assert.ok(internalNames.includes("review_judoka_playstyle"));
  assert.ok(internalNames.includes("interpret_judoka_query"));
  for (const name of ["semantic_search_judoka", "review_proposed_judoka", "review_proposed_judoka_batch", "review_judoka_playstyle", "interpret_judoka_query"]) {
    const tool = internalTools.find(candidate => candidate.name === name);
    assert.equal(tool?.outputSchema?.type, "object", `${name} must expose an output schema`);
    assert.ok(tool?.title, `${name} must expose a display title`);
    assert.equal(tool?.annotations?.readOnlyHint, true, `${name} must be identified as read-only`);
    assert.equal(tool?.annotations?.destructiveHint, false, `${name} must be identified as non-destructive`);
    assert.equal(tool?.annotations?.openWorldHint, true, `${name} must identify external-model behavior`);
  }
  assert.ok("includeHidden" in (internalTools.find(tool => tool.name === "get_judoka")?.inputSchema.properties ?? {}));
  assert.equal("includeHidden" in (regularTools.find(tool => tool.name === "get_judoka")?.inputSchema.properties ?? {}), false);
});

test("OAuth discovery and scoped access are available for MCP clients", async () => {
  const harness = createOAuthMcpTestHarness();
  const restoreFetch = mockOAuthIntrospection(harness.env, harness.introspectedTokens);
  try {
    await assertOAuthDiscovery(harness.env);
    await assertOAuthToolScopes(harness.env, harness.introspectedTokens);
    await assertOAuthRejections(harness.env);
    await assertOAuthPrincipalRateLimit(harness);
  } finally {
    restoreFetch();
  }
});

/** @see ../docs/API.md#MCP-tools */
test("MCP authentication boundary rejects unauthenticated GET and POST without disclosing protected endpoint details", async () => {
  const cases = [
    { method: "GET" },
    {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize" }),
    },
  ] as const;
  const unauthorizedBody = JSON.stringify({
    error: { code: "unauthorized", message: "A valid API key is required" },
  });

  for (const requestCase of cases) {
    const unauthenticatedResponse = await worker.fetch(
      new Request("https://example.test/mcp", requestCase),
      mockEnv
    );

    assert.equal(unauthenticatedResponse.status, 401, requestCase.method);
    assert.equal(unauthenticatedResponse.headers.get("www-authenticate"), "Bearer", requestCase.method);
    assert.equal(unauthenticatedResponse.headers.get("content-type"), "application/json; charset=utf-8", requestCase.method);
    assert.equal(unauthenticatedResponse.headers.get("allow"), null, requestCase.method);
    assert.equal(await unauthenticatedResponse.text(), unauthorizedBody, requestCase.method);
  }

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

test("MCP rejects a Unicode whitespace-only configured API key", async () => {
  const whitespaceKey = "\u00a0";
  const response = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", "x-api-key": whitespaceKey, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 390, method: "tools/list" }),
  }), { ...mockEnv, API_KEY: whitespaceKey });

  assert.equal(response.status, 401);
  assert.deepEqual(await mcpJson(response), { error: { code: "unauthorized", message: "A valid API key is required" } });
});

test("regular MCP key can call public tools but cannot retrieve hidden records", async () => {
  const hidden = compiledModel.judoka.find(record => record.isHidden);
  assert.ok(hidden, "fixture must contain a hidden judoka");

  const publicResponse = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "version", arguments: {} } }),
  }), mockEnv);
  const version = await successfulMcpToolJson(publicResponse);
  assert.equal(version.datasetVersion, compiledModel.datasetVersion);

  const hiddenResponse = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 43, method: "tools/call", params: { name: "get_judoka", arguments: { id: hidden.id } } }),
  }), mockEnv);
  assert.equal((await successfulMcpToolJson(hiddenResponse)).judoka, null);

  const explicitInternalOption = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: `Bearer ${mockEnv.API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 48, method: "tools/call", params: { name: "get_judoka", arguments: { id: hidden.id, includeHidden: true } } }),
  }), mockEnv);
  assert.equal((await mcpJson(explicitInternalOption)).result.isError, true, "public schemas reject internal visibility arguments");
});

test("separate internal MCP key authenticates and retrieves hidden records", async () => {
  const hidden = compiledModel.judoka.find(record => record.isHidden);
  assert.ok(hidden, "fixture must contain a hidden judoka");

  const response = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: `Bearer ${mockEnv.INTERNAL_API_KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 44, method: "tools/call", params: { name: "get_judoka", arguments: { id: hidden.id, includeHidden: true } } }),
  }), mockEnv);

  assert.deepEqual((await successfulMcpToolJson(response)).judoka, hidden);
});

test("unrelated MCP key remains rejected when regular and internal keys are configured", async () => {
  const response = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: "Bearer unrelated-key", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 45, method: "tools/list" }),
  }), mockEnv);

  assert.equal(response.status, 401);
  assert.deepEqual(await mcpJson(response), { error: { code: "unauthorized", message: "A valid API key is required" } });
});

test("MCP internal authentication handles an unset key and does not elevate equal configured secrets", async () => {
  const hidden = compiledModel.judoka.find(record => record.isHidden);
  assert.ok(hidden, "fixture must contain a hidden judoka");
  const request = (credential: string) => new Request("https://example.test/mcp", {
    method: "POST",
    headers: { host: "example.test", authorization: `Bearer ${credential}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 46, method: "tools/call", params: { name: "get_judoka", arguments: { id: hidden.id, includeHidden: true } } }),
  });

  const withoutInternal = await worker.fetch(request(mockEnv.API_KEY), { ...mockEnv, INTERNAL_API_KEY: undefined });
  assert.equal((await mcpJson(withoutInternal)).result.isError, true, "an unset internal key must not expose hidden-record arguments");

  const equalSecrets = await worker.fetch(request(mockEnv.API_KEY), { ...mockEnv, INTERNAL_API_KEY: mockEnv.API_KEY });
  assert.equal((await mcpJson(equalSecrets)).result.isError, true, "equal secrets must leave the credential at public access");

  const hiddenRest = await worker.fetch(new Request("https://example.test/v1/judoka?includeHidden=true", {
    headers: { authorization: `Bearer ${mockEnv.API_KEY}` },
  }), { ...mockEnv, INTERNAL_API_KEY: mockEnv.API_KEY });
  assert.equal(hiddenRest.status, 403, "the colliding public secret must not authorize hidden REST records");
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
  const clientIp = "203.0.113.41";

  for (const allowed of [true, false]) {
    const mcpCalls: Array<{ key: string }> = [];
    const publicCalls: Array<{ key: string }> = [];
    const response = await worker.fetch(new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        host: "example.test",
        authorization: `Bearer ${mockEnv.API_KEY}`,
        "cf-connecting-ip": clientIp,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: allowed ? 41 : 42,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "rate-limit-test", version: "1.0.0" } },
      }),
    }), {
      ...mockEnv,
      MCP_RATE_LIMITER: { async limit(input) { mcpCalls.push(input); return { success: allowed }; } },
      PUBLIC_RATE_LIMITER: { async limit(input) { publicCalls.push(input); return { success: true }; } },
    });

    assert.equal(mcpCalls.length, 1, "the MCP binding must be invoked exactly once");
    assert.equal(publicCalls.length, 0, "the public binding must not receive MCP traffic");
    assert.ok(mcpCalls[0]?.key.startsWith(`${clientIp}:`), "the limiter key must isolate clients");
    assert.ok(mcpCalls[0]?.key.endsWith(":mcp"), "the limiter key must isolate the MCP route");

    if (allowed) {
      assert.equal(response.status, 200);
    } else {
      assert.equal(response.status, 429);
      assert.deepEqual(await response.json(), { error: { code: "rate_limited", message: "too many requests" } });
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(response.headers.get("retry-after"), "60");
      assert.equal(response.headers.get("ratelimit-limit"), "30");
      assert.equal(response.headers.get("ratelimit-policy"), "30;w=60");
    }
  }
});

// Public-catalogue authentication and visibility requirement: docs/API.md,
// "BU-DO-KON API guide" (the public API needs no credential).
