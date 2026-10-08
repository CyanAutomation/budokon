import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_POLLS, DEFAULT_POLL_INTERVAL_MS, waitForKasekiRun } from "./wait-for-kaseki.js";

test("Kaseki status polling uses five-minute intervals for a 185-minute window", () => {
  assert.equal(DEFAULT_POLL_INTERVAL_MS, 5 * 60 * 1000);
  assert.equal(DEFAULT_MAX_POLLS, 38);
  assert.equal((DEFAULT_MAX_POLLS - 1) * DEFAULT_POLL_INTERVAL_MS, 185 * 60 * 1000);
});

test("polls queued and running runs until completion", async () => {
  const responses = [
    { status: "queued" },
    { status: "running" },
    { status: "completed" },
  ];
  const slept: number[] = [];
  const requested: Array<{ url: string; token: string }> = [];

  const result = await waitForKasekiRun({
    apiBaseUrl: "https://kaseki.example/api/v1/",
    token: "test-token",
    runId: "run_123",
    requestStatus: async (url, token) => {
      requested.push({ url, token });
      return responses.shift();
    },
    sleep: async milliseconds => { slept.push(milliseconds); },
  });

  assert.equal(result, "completed");
  assert.deepEqual(slept, [DEFAULT_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS]);
  assert.deepEqual(requested[0], {
    url: "https://kaseki.example/api/v1/runs/run_123/status",
    token: "test-token",
  });
  assert.equal(requested.length, 3);
});

test("does not retry permanent Kaseki HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response("not found", { status: 404 });
  };

  try {
    await assert.rejects(waitForKasekiRun({
      apiBaseUrl: "https://kaseki.example/api/v1",
      token: "test-token",
      runId: "run_123",
      maxPolls: 1,
    }));
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("treats the expected empty diff as a successful no-op", async () => {
  const result = await waitForKasekiRun({
    apiBaseUrl: "https://kaseki.example/api/v1",
    token: "test-token",
    runId: "run_123",
    requestStatus: async () => ({ status: "failed", failureClass: "empty-diff" }),
    sleep: async () => assert.fail("a terminal result should not sleep"),
  });

  assert.equal(result, "no_changes");
});

test("fails on a terminal Kaseki error", async () => {
  await assert.rejects(waitForKasekiRun({
    apiBaseUrl: "https://kaseki.example/api/v1",
    token: "test-token",
    runId: "run_123",
    requestStatus: async () => ({ status: "failed", failureClass: "validation" }),
    sleep: async () => assert.fail("a terminal result should not sleep"),
  }), /Kaseki run failed/u);
});

test("rejects unknown statuses and times out after the configured polls", async () => {
  await assert.rejects(waitForKasekiRun({
    apiBaseUrl: "https://kaseki.example/api/v1",
    token: "test-token",
    runId: "run_123",
    requestStatus: async () => ({ status: "finished" }),
  }), /unsupported status/u);

  let polls = 0;
  await assert.rejects(waitForKasekiRun({
    apiBaseUrl: "https://kaseki.example/api/v1",
    token: "test-token",
    runId: "run_123",
    maxPolls: 2,
    requestStatus: async () => {
      polls += 1;
      return { status: "running" };
    },
    sleep: async () => {},
  }), /No terminal status after 2 polls/u);
  assert.equal(polls, 2);
});
