import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, waitForKasekiRun } from "./wait-for-kaseki.js";

test("default Kaseki polling stops after the 185-minute window", async () => {
  const polls: Array<{ attempt: number; maxPolls: number }> = [];
  const sleepIntervals: number[] = [];

  await assert.rejects(waitForKasekiRun({
    apiBaseUrl: "https://kaseki.example/api/v1",
    token: "test-token",
    runId: "run_123",
    requestStatus: async () => ({ status: "running" }),
    sleep: async milliseconds => { sleepIntervals.push(milliseconds); },
    onPoll: (_status, attempt, maxPolls) => { polls.push({ attempt, maxPolls }); },
  }), /No terminal status after 38 polls/u);

  assert.equal(polls.length, 38);
  assert.deepEqual(polls[0], { attempt: 1, maxPolls: 38 });
  assert.deepEqual(polls.at(-1), { attempt: 38, maxPolls: 38 });
  assert.equal(sleepIntervals.length, 37);
  assert.ok(sleepIntervals.every(milliseconds => milliseconds === 5 * 60 * 1000));
  assert.equal(sleepIntervals.reduce((total, milliseconds) => total + milliseconds, 0), 185 * 60 * 1000);
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
    pollIntervalMs: 17,
    requestStatus: async (url, token) => {
      requested.push({ url, token });
      return responses.shift();
    },
    sleep: async milliseconds => { slept.push(milliseconds); },
  });

  assert.equal(result, "completed");
  assert.deepEqual(slept, [17, 17]);
  assert.deepEqual(requested[0], {
    url: "https://kaseki.example/api/v1/runs/run_123/status",
    token: "test-token",
  });
  assert.equal(requested.length, 3);
});

test("rejects invalid polling configuration before making a request", async () => {
  const invalidOptions = [
    [{ apiBaseUrl: "///" }, /KASEKI_API_BASE_URL is required/u],
    [{ token: "" }, /KASEKI_API_TOKEN is required/u],
    [{ runId: "../unsafe" }, /run ID has an invalid format/u],
    [{ pollIntervalMs: 1.5 }, /pollIntervalMs must be a non-negative integer/u],
    [{ maxPolls: 0 }, /maxPolls must be a positive integer/u],
  ] as const;
  let requestCount = 0;
  const defaults = {
    apiBaseUrl: "https://kaseki.example/api/v1",
    token: "test-token",
    runId: "run_123",
    requestStatus: async () => {
      requestCount += 1;
      return { status: "running" };
    },
    sleep: async () => {},
  };

  for (const [overrides, message] of invalidOptions) {
    await assert.rejects(waitForKasekiRun({ ...defaults, ...overrides }), message);
  }
  assert.equal(requestCount, 0);
});

test("reports string statuses to onPoll before handling terminal and unsupported states", async () => {
  const observed: string[] = [];
  const base = {
    apiBaseUrl: "https://kaseki.example/api/v1",
    token: "test-token",
    runId: "run_123",
    maxPolls: 1,
    onPoll: (status: string) => { observed.push(status); },
  };

  await assert.rejects(waitForKasekiRun({ ...base, requestStatus: async () => ({ status: "failed" }) }), /Kaseki run failed/u);
  await assert.rejects(waitForKasekiRun({ ...base, requestStatus: async () => ({ status: "finished" }) }), /unsupported status/u);
  assert.deepEqual(observed, ["failed", "finished"]);
});

test("Kaseki CLI validates environment before polling", async () => {
  let requestCount = 0;
  await assert.rejects(main({}, {
    requestStatus: async () => {
      requestCount += 1;
      return { status: "completed" };
    },
  }), /KASEKI_API_BASE_URL, KASEKI_API_TOKEN, RUN_ID, and GITHUB_OUTPUT are required/u);
  assert.equal(requestCount, 0);
});

test("Kaseki CLI logs each poll and appends its terminal status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kaseki-poll-test-"));
  const outputFile = join(directory, "github-output");
  const logs: string[] = [];
  const responses = [{ status: "queued" }, { status: "running" }, { status: "completed" }];

  try {
    await main({
      KASEKI_API_BASE_URL: "https://kaseki.example/api/v1",
      KASEKI_API_TOKEN: "test-token",
      RUN_ID: "run_123",
      GITHUB_OUTPUT: outputFile,
    }, {
      maxPolls: 3,
      pollIntervalMs: 0,
      requestStatus: async () => responses.shift()!,
      sleep: async () => {},
      log: message => { logs.push(message); },
    });

    assert.equal(await readFile(outputFile, "utf8"), "status=completed\n");
    assert.deepEqual(logs, [
      "Kaseki status: queued (poll 1/3)",
      "Kaseki status: running (poll 2/3)",
      "Kaseki status: completed (poll 3/3)",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Kaseki CLI reports an empty diff as a successful no-op", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kaseki-poll-test-"));
  const outputFile = join(directory, "github-output");
  const logs: string[] = [];

  try {
    await main({
      KASEKI_API_BASE_URL: "https://kaseki.example/api/v1",
      KASEKI_API_TOKEN: "test-token",
      RUN_ID: "run_123",
      GITHUB_OUTPUT: outputFile,
    }, {
      requestStatus: async () => ({ status: "failed", failureClass: "empty-diff" }),
      log: message => { logs.push(message); },
    });

    assert.equal(await readFile(outputFile, "utf8"), "status=no_changes\n");
    assert.deepEqual(logs, [
      "Kaseki status: failed (poll 1/38)",
      "Kaseki completed without changes; treating the expected empty diff as a successful no-op.",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
