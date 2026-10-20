import assert from "node:assert/strict";
import test from "node:test";
import {
  checkKasekiApiReadiness,
  checkKasekiReadiness,
  KASEKI_API_BASE_URL,
  KASEKI_CONTROLLER_URL,
} from "./check-kaseki.js";

interface MockReply {
  body: unknown;
  status?: number;
}

function mockFetch(replies: MockReply[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const reply = replies.shift();
    assert.ok(reply, "unexpected Kaseki request");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

test("Kaseki readiness checks only the approved controller and sends no API token", async () => {
  const { calls, fetcher } = mockFetch([{ body: { status: "ready" } }]);

  await checkKasekiReadiness({ baseUrl: KASEKI_CONTROLLER_URL, fetcher });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${KASEKI_CONTROLLER_URL}/ready`);
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, undefined);
});

test("Kaseki readiness rejects a changed controller URL before making a request", async () => {
  const { calls, fetcher } = mockFetch([]);

  await assert.rejects(
    checkKasekiReadiness({ baseUrl: "https://attacker.example", fetcher }),
    /approved HTTPS controller URL/u,
  );
  assert.equal(calls.length, 0);
});

test("authenticated Kaseki preflight shares gateway, capability, and runner checks", async () => {
  const { calls, fetcher } = mockFetch([
    { body: { status: "ok" } },
    { body: { taskModes: ["patch"], publishModes: ["pr"] } },
    { body: { status: "degraded", failedChecks: [], errors: [] } },
  ]);

  await checkKasekiApiReadiness({ apiBaseUrl: KASEKI_API_BASE_URL, token: "test-token", fetcher });

  assert.deepEqual(calls.map(call => call.url), [
    `${KASEKI_API_BASE_URL}/gateway-test?stage=1`,
    `${KASEKI_API_BASE_URL}/capabilities`,
    `${KASEKI_API_BASE_URL}/preflight`,
  ]);
  for (const call of calls) {
    assert.deepEqual(call.init?.headers, { authorization: "Bearer test-token", accept: "application/json" });
  }
});

test("authenticated Kaseki checks reject an unapproved API endpoint before making requests", async () => {
  const { calls, fetcher } = mockFetch([]);

  await assert.rejects(
    checkKasekiApiReadiness({ apiBaseUrl: "https://attacker.example/api/v1", token: "test-token", fetcher }),
    /approved Kaseki API URL/u,
  );
  assert.equal(calls.length, 0);
});

test("authenticated Kaseki checks reject missing pull-request support", async () => {
  const { fetcher } = mockFetch([
    { body: { status: "ok" } },
    { body: { taskModes: ["patch"], publishModes: ["draft_pr"] } },
  ]);

  await assert.rejects(
    checkKasekiApiReadiness({ apiBaseUrl: KASEKI_API_BASE_URL, token: "test-token", fetcher }),
    /regular pull requests/u,
  );
});

test("authenticated Kaseki checks reject failed runner preflight", async () => {
  const { fetcher } = mockFetch([
    { body: { status: "ok" } },
    { body: { taskModes: ["patch"], publishModes: ["pr"] } },
    { body: { status: "degraded", failedChecks: ["workspace"], errors: [] } },
  ]);

  await assert.rejects(
    checkKasekiApiReadiness({ apiBaseUrl: KASEKI_API_BASE_URL, token: "test-token", fetcher }),
    /runner preflight failed/u,
  );
});

test("Kaseki checks retry transient HTTP failures but stop on permanent failures", async () => {
  const sleeps: number[] = [];
  const { calls, fetcher } = mockFetch([
    { body: { error: "temporarily unavailable" }, status: 503 },
    { body: { status: "ok" } },
    { body: { taskModes: ["patch"], publishModes: ["pr"] } },
    { body: { status: "ok", failedChecks: [], errors: [] } },
  ]);

  await checkKasekiApiReadiness({
    apiBaseUrl: KASEKI_API_BASE_URL,
    token: "test-token",
    fetcher,
    maxRetries: 1,
    sleep: async milliseconds => { sleeps.push(milliseconds); },
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [1000]);

  const permanent = mockFetch([{ body: { error: "unauthorized" }, status: 401 }]);
  await assert.rejects(
    checkKasekiApiReadiness({
      apiBaseUrl: KASEKI_API_BASE_URL,
      token: "test-token",
      fetcher: permanent.fetcher,
      maxRetries: 3,
      sleep: async () => assert.fail("permanent HTTP failures must not be retried"),
    }),
    /HTTP 401/u,
  );
  assert.equal(permanent.calls.length, 1);

  const redirect = mockFetch([{ body: { location: "https://other.example" }, status: 302 }]);
  await assert.rejects(
    checkKasekiReadiness({
      baseUrl: KASEKI_CONTROLLER_URL,
      fetcher: redirect.fetcher,
      maxRetries: 3,
      sleep: async () => assert.fail("redirects must not be retried"),
    }),
    /HTTP 302/u,
  );
  assert.equal(redirect.calls.length, 1);
});
