import assert from "node:assert/strict";
import test from "node:test";
import { authenticateOAuthBearer } from "../worker/oauth.js";

const issuer = "https://auth.example.test";
const resourceUrl = "https://api.example.test/mcp";
const expiresAt = Math.floor(Date.now() / 1_000) + 600;

function oauthConfig(fetcher: typeof fetch) {
  return {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    introspectionEndpoint: `${issuer}/introspect`,
    clientId: "resource-client",
    clientSecret: "resource-secret",
    resourceUrl,
    fetcher,
  };
}

function activeClaims(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    exp: expiresAt,
    iss: issuer,
    aud: resourceUrl,
    sub: "athlete-123",
    scope: "budokon:read  budokon:jev",
    client_id: "chat-client",
    ...overrides,
  };
}

function responseFor(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function authenticate(token: string, fetcher: typeof fetch) {
  return authenticateOAuthBearer(
    new Request(resourceUrl, { headers: { authorization: `Bearer ${token}` } }),
    oauthConfig(fetcher),
  );
}

test("OAuth verifier sends an uncached introspection request and maps valid token metadata", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const token = "sensitive+access-token";
  const result = await authenticate(token, async (url, init) => {
    requests.push({ url: String(url), init });
    return responseFor(activeClaims({ aud: ["https://other.example.test/mcp", resourceUrl] }));
  });

  assert.ok(!(result instanceof Response));
  assert.equal(result.token, token);
  assert.equal(result.clientId, "athlete-123");
  assert.deepEqual(result.scopes, ["budokon:read", "budokon:jev"]);
  assert.equal(result.expiresAt, expiresAt);
  assert.equal(result.resource?.toString(), resourceUrl);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${issuer}/introspect`);
  assert.equal(requests[0].init?.method, "POST");
  const headers = new Headers(requests[0].init?.headers);
  assert.equal(headers.get("authorization"), `Basic ${btoa("resource-client:resource-secret")}`);
  assert.equal(headers.get("cache-control"), "no-store");
  assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
  const body = new URLSearchParams(String(requests[0].init?.body));
  assert.equal(body.get("token"), token);
  assert.equal(body.get("token_type_hint"), "access_token");
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
});

test("OAuth verifier accepts the resource URL and falls back to client_id for the subject", async () => {
  const result = await authenticate("valid-token", async () => responseFor(activeClaims({
    aud: new URL(resourceUrl).toString(),
    sub: undefined,
  })));

  assert.ok(!(result instanceof Response));
  assert.equal(result.clientId, "chat-client");
  assert.deepEqual(result.scopes, ["budokon:read", "budokon:jev"]);
});

test("OAuth verifier rejects inactive, expired, mismatched, and unidentified tokens", async () => {
  const invalidClaims: Array<[string, Record<string, unknown>]> = [
    ["inactive", { active: false }],
    ["expired", { exp: Math.floor(Date.now() / 1_000) - 1 }],
    ["missing expiry", { exp: undefined }],
    ["wrong issuer", { iss: "https://other.example.test" }],
    ["wrong audience", { aud: "https://other.example.test/mcp" }],
    ["missing subject", { sub: undefined, client_id: undefined }],
  ];

  for (const [name, overrides] of invalidClaims) {
    const result = await authenticate("invalid-token", async () => responseFor(activeClaims(overrides)));
    assert.ok(result instanceof Response, `${name} token should receive an HTTP challenge`);
    assert.equal(result.status, 401, name);
    assert.match(result.headers.get("www-authenticate") ?? "", /invalid_token/u, name);
  }
});

test("OAuth verifier treats failed introspection and malformed metadata as server errors", async () => {
  const failed = await authenticate("token", async () => new Response("unavailable", { status: 503 }));
  assert.ok(failed instanceof Response);
  assert.ok(failed.status >= 500);

  const malformed = await authenticate("token", async () => new Response("{", { status: 200 }));
  assert.ok(malformed instanceof Response);
  assert.ok(malformed.status >= 500);

  const networkFailure = await authenticate("token", async () => { throw new Error("private network detail"); });
  assert.ok(networkFailure instanceof Response);
  assert.ok(networkFailure.status >= 500);
  assert.doesNotMatch(await networkFailure.text(), /private network detail/u);
});
