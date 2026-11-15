import assert from "node:assert/strict";
import test from "node:test";
import { request, runSmokeDeployment } from "./smoke-deployment.js";

test("smoke requests accept documented statuses and report failures with endpoint context", async () => {
  const ok = await request("https://example.test", "/status", undefined, undefined, async () => new Response("ok"));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "ok");

  const notModified = await request("https://example.test", "/catalog", undefined, 304, async () => new Response(null, { status: 304 }));
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), "");
  await assert.rejects(request("https://example.test", "/status", undefined, undefined,
    async () => new Response("bad", { status: 503 })), /\/status returned 503/);
  await assert.rejects(request("https://example.test", "/catalog", undefined, 304,
    async () => new Response(null, { status: 200 })), /\/catalog returned 200, expected 304/);
  const networkFailure = new TypeError("fetch failed");
  await assert.rejects(
    request("https://example.test", "/status", undefined, undefined, async () => { throw networkFailure; }),
    error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Network error accessing /status: fetch failed");
      assert.equal(error.cause, networkFailure);
      return true;
    },
  );

  const unexpectedFailure = new Error("unexpected transport failure");
  await assert.rejects(
    request("https://example.test", "/status", undefined, undefined, async () => { throw unexpectedFailure; }),
    error => error === unexpectedFailure,
  );

  const teapot = await request("https://example.test", "/status", undefined, [418, 503], async () =>
    new Response("teapot", { status: 418 }));
  assert.equal(teapot.status, 418);
  const serverError = await request("https://example.test", "/status", undefined, "any", async () =>
    new Response("unavailable", { status: 503 }));
  assert.equal(serverError.status, 503);
});

test("smoke deployment validates release identity, cache behavior, pagination, and deterministic draws", async () => {
  const requests: string[] = [];
  const messages: string[] = [];
  const base = "https://deployment.example.test";
  const directBase = "https://budokon.example.workers.dev";
  let statusCalls = 0;
  const responses = new Map<string, () => Response>([
    ["GET /v1/status", () => {
      statusCalls += 1;
      return Response.json({
        status: "ok",
        sourceGitCommit: statusCalls === 1 ? "c".repeat(40) : "a".repeat(40),
        datasetChecksum: `sha256:${"b".repeat(64)}`,
        datasetVersion: "2026.09.1",
      });
    }],
    ["GET /", () => Response.json({ openapi: `${base}/openapi/v1.yaml`, status: `${base}/v1/status` })],
    ["GET /openapi/v1.yaml", () => new Response("/v1/status:")],
    ["GET /v1/judoka", () => new Response("[]", { headers: { etag: '"versioned"', "cache-control": "public, s-maxage=300", "x-budokon-cache": "MISS" } })],
    ["GET /v1/judoka#revalidate", () => new Response(null, { status: 304, headers: { "x-budokon-cache": "HIT" } })],
    ["GET /v1/judoka?q=shozo&limit=1", () => Response.json({ judoka: [{ slug: "shozo-fujii" }] })],
    ["GET /v1/judoka?limit=1", () => Response.json({ judoka: [{ slug: "first" }], nextCursor: "next" })],
    ["GET /v1/judoka?limit=1&cursor=next", () => Response.json({ judoka: [{ slug: "next" }] })],
    ["GET /v1/judoka?unknown=smoke", () => Response.json({ error: "unknown query" }, { status: 400 })],
    ["OPTIONS /v1/draw", () => new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET, POST, OPTIONS" } })],
    ["POST /v1/draw", () => new Response("seeded response")],
    ["POST /v1/events/draw", () => new Response("seeded response")],
  ]);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const key = new Headers(init?.headers).has("if-none-match")
      ? `${method} ${url.pathname}#revalidate`
      : `${method} ${url.pathname}${url.search}`;
    requests.push(`${url.origin} ${method} ${url.pathname}${url.search}`);
    const response = responses.get(key);
    if (!response) throw new Error(`Unexpected smoke request: ${key}`);
    if (url.pathname === "/") {
      return Response.json({ openapi: `${url.origin}/openapi/v1.yaml`, status: `${url.origin}/v1/status` });
    }
    return response();
  };

  await runSmokeDeployment({
    deploymentUrl: `${base}/`,
    directDeploymentUrl: directBase,
    expectedSourceGitCommit: "a".repeat(40),
    deploymentIdentityAttempts: 2,
    waitImpl: async () => {},
    fetchImpl,
    log(message) { messages.push(message); },
  });

  assert.ok(requests.includes(`${base} GET /v1/judoka?limit=1&cursor=next`));
  assert.ok(requests.includes(`${directBase} GET /v1/judoka?limit=1&cursor=next`));
  assert.equal(requests.filter(request => request.endsWith("POST /v1/draw")).length, 4);
  assert.equal(requests.filter(request => request.endsWith("POST /v1/events/draw")).length, 4);
  assert.deepEqual(messages, [
    `Waiting for ${base} to serve commit ${"a".repeat(40)}; currently serving ${"c".repeat(40)}`,
    `Smoke check passed for ${base} (2026.09.1, ${"a".repeat(40)})`,
    `Smoke check passed for ${directBase} (2026.09.1, ${"a".repeat(40)})`,
  ]);
});

test("smoke deployment reports conditional-cache headers when a matching ETag returns 200", async () => {
  const base = "https://deployment.example.test";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/status") return Response.json({
      status: "ok",
      sourceGitCommit: "a".repeat(40),
      datasetChecksum: `sha256:${"b".repeat(64)}`,
      datasetVersion: "2026.09.1",
    });
    if (url.pathname === "/") return Response.json({ openapi: `${base}/openapi/v1.yaml`, status: `${base}/v1/status` });
    if (url.pathname === "/openapi/v1.yaml") return new Response("/v1/status:");
    if (url.pathname === "/v1/judoka" && !new Headers(init?.headers).has("if-none-match")) {
      return new Response("[]", { headers: { etag: '"versioned"', "cache-control": "public, s-maxage=300", "x-budokon-cache": "MISS" } });
    }
    if (url.pathname === "/v1/judoka") {
      return new Response("[]", { headers: {
        etag: '"versioned"',
        "x-budokon-cache": "HIT",
        "cf-cache-status": "HIT",
        age: "12",
        "cf-ray": "ray-id-LHR",
      } });
    }
    throw new Error(`Unexpected smoke request: ${url.pathname}`);
  };

  await assert.rejects(runSmokeDeployment({ deploymentUrl: base, fetchImpl }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /If-None-Match.*"versioned"/);
    assert.match(error.message, /returned 200, expected 304/);
    assert.match(error.message, /ETag="versioned"/);
    assert.match(error.message, /CF-Cache-Status=HIT/);
    assert.match(error.message, /Age=12/);
    assert.match(error.message, /CF-Ray=ray-id-LHR/);
    return true;
  });
});

test("smoke deployment waits a bounded number of checks for the expected release commit", async () => {
  let statusCalls = 0;
  const fetchImpl: typeof fetch = async input => {
    assert.equal(new URL(String(input)).pathname, "/v1/status");
    statusCalls += 1;
    return Response.json({
      status: "ok",
      sourceGitCommit: "b".repeat(40),
      datasetChecksum: `sha256:${"c".repeat(64)}`,
      datasetVersion: "2026.09.1",
    });
  };

  await assert.rejects(runSmokeDeployment({
    deploymentUrl: "https://deployment.example.test",
    expectedSourceGitCommit: "a".repeat(40),
    deploymentIdentityAttempts: 2,
    waitImpl: async () => {},
    fetchImpl,
  }), /still serves commit [b]{40}; expected [a]{40} after 2 checks/);
  assert.equal(statusCalls, 2);
});

test("smoke deployment validates release polling options before making requests", async () => {
  const invalidOptions = [
    { expectedSourceGitCommit: "A".repeat(40), message: /EXPECTED_SOURCE_GIT_COMMIT must be a 40-character lowercase Git commit/ },
    { deploymentIdentityAttempts: 0, message: /deploymentIdentityAttempts must be a positive integer/ },
    { deploymentIdentityAttempts: 1.5, message: /deploymentIdentityAttempts must be a positive integer/ },
    { deploymentIdentityRetryIntervalMs: -1, message: /deploymentIdentityRetryIntervalMs must be a non-negative number/ },
    { deploymentIdentityRetryIntervalMs: Number.NaN, message: /deploymentIdentityRetryIntervalMs must be a non-negative number/ },
  ] as const;

  for (const { message, ...options } of invalidOptions) {
    let requestCount = 0;
    await assert.rejects(runSmokeDeployment({
      deploymentUrl: "https://deployment.example.test",
      ...options,
      async fetchImpl() { requestCount += 1; return new Response(); },
    }), message);
    assert.equal(requestCount, 0, message.source);
  }
});

test("smoke deployment rejects malformed immutable status identities before checking other endpoints", async () => {
  const base = "https://deployment.example.test";
  const requestedPaths: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input));
    requestedPaths.push(url.pathname);
    return Response.json({
      status: "ok",
      sourceGitCommit: "not-a-commit",
      datasetChecksum: `sha256:${"b".repeat(64)}`,
      datasetVersion: "2026.09.1",
    });
  };

  await assert.rejects(runSmokeDeployment({ deploymentUrl: base, fetchImpl }), /valid immutable release identity/);
  assert.deepEqual(requestedPaths, ["/v1/status"]);
});

test("smoke deployment identifies missing public catalogue cache metadata", async () => {
  const cases = [
    {
      name: "ETag",
      headers: { "cache-control": "public, s-maxage=300", "x-budokon-cache": "MISS" },
      message: /public catalogue response is missing ETag/,
    },
    {
      name: "edge-cache outcome",
      headers: { etag: '"versioned"', "cache-control": "public, s-maxage=300", "x-budokon-cache": "BYPASS" },
      message: /public catalogue response is missing a working edge-cache outcome/,
    },
    {
      name: "shared-cache policy",
      headers: { etag: '"versioned"', "x-budokon-cache": "MISS" },
      message: /public catalogue response is missing its shared-cache policy/,
    },
  ] as const;

  for (const scenario of cases) {
    await assert.rejects(runSmokeDeployment({
      deploymentUrl: "https://deployment.example.test",
      fetchImpl: createSmokeFetch({ "GET /v1/judoka": () => new Response("[]", { headers: scenario.headers }) }),
    }), error => {
      assert.ok(error instanceof Error, scenario.name);
      assert.match(error.message, scenario.message, scenario.name);
      return true;
    });
  }
});

function createSmokeFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  const routes: Record<string, () => Response> = {
    "GET /v1/status": () => Response.json({
      status: "ok",
      sourceGitCommit: "a".repeat(40),
      datasetChecksum: `sha256:${"b".repeat(64)}`,
      datasetVersion: "2026.09.1",
    }),
    "GET /openapi/v1.yaml": () => new Response("/v1/status:"),
    "GET /v1/judoka": () => new Response("[]", { headers: {
      etag: '"versioned"',
      "cache-control": "public, s-maxage=300",
      "x-budokon-cache": "MISS",
    } }),
    "GET /v1/judoka#revalidate": () => new Response(null, { status: 304, headers: { "x-budokon-cache": "HIT" } }),
    "GET /v1/judoka?q=shozo&limit=1": () => Response.json({ judoka: [{ slug: "shozo-fujii" }] }),
    "GET /v1/judoka?limit=1": () => Response.json({ judoka: [{ slug: "first" }], nextCursor: "next" }),
    "GET /v1/judoka?limit=1&cursor=next": () => Response.json({ judoka: [{ slug: "next" }] }),
    "GET /v1/judoka?unknown=smoke": () => Response.json({ error: "unknown query" }, { status: 400 }),
    "OPTIONS /v1/draw": () => new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET, POST, OPTIONS" } }),
    "POST /v1/draw": () => new Response("seeded response"),
    "POST /v1/events/draw": () => new Response("seeded response"),
  };

  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/") {
      return Response.json({ openapi: `${url.origin}/openapi/v1.yaml`, status: `${url.origin}/v1/status` });
    }
    const key = new Headers(init?.headers).has("if-none-match")
      ? `${method} ${url.pathname}#revalidate`
      : `${method} ${url.pathname}${url.search}`;
    const response = overrides[key] ?? routes[key];
    if (!response) throw new Error(`Unexpected smoke request: ${key}`);
    return response();
  };
}

test("smoke deployment rejects an insecure target before making requests", async () => {
  let called = false;
  await assert.rejects(runSmokeDeployment({
    deploymentUrl: "http://deployment.example.test",
    async fetchImpl() { called = true; return new Response(); },
  }), /DEPLOYMENT_URL must be an HTTPS URL/);
  assert.equal(called, false);
});
