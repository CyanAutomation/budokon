import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_POLLS = 38;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const REQUEST_RETRIES = 3;

class PermanentHttpStatusError extends Error {}

type KasekiStatusResponse = {
  status?: unknown;
  failureClass?: unknown;
};

export interface WaitForKasekiOptions {
  apiBaseUrl: string;
  token: string;
  runId: string;
  pollIntervalMs?: number;
  maxPolls?: number;
  requestStatus?: (url: string, token: string) => Promise<KasekiStatusResponse>;
  sleep?: (milliseconds: number) => Promise<void>;
  onPoll?: (status: string, attempt: number, maxPolls: number) => void;
}

export type KasekiRunResult = "completed" | "no_changes";

export async function waitForKasekiRun(options: WaitForKasekiOptions): Promise<KasekiRunResult> {
  const apiBaseUrl = options.apiBaseUrl.replace(/\/+$/u, "");
  if (!apiBaseUrl) throw new Error("KASEKI_API_BASE_URL is required");
  if (!options.token) throw new Error("KASEKI_API_TOKEN is required");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(options.runId)) {
    throw new Error("Kaseki run ID has an invalid format");
  }

  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error("pollIntervalMs must be a non-negative integer");
  }
  if (!Number.isInteger(maxPolls) || maxPolls < 1) {
    throw new Error("maxPolls must be a positive integer");
  }

  const requestStatus = options.requestStatus ?? requestStatusFromController;
  const sleep = options.sleep ?? delay;
  const statusUrl = `${apiBaseUrl}/runs/${encodeURIComponent(options.runId)}/status`;

  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    const response = await requestStatus(statusUrl, options.token);
    const status = response.status;
    if (typeof status !== "string") throw new Error("Kaseki returned an invalid status response");
    options.onPoll?.(status, attempt, maxPolls);

    if (status === "completed") return "completed";
    if (status === "failed") {
      if (response.failureClass === "empty-diff") return "no_changes";
      throw new Error("Kaseki run failed");
    }
    if (status !== "queued" && status !== "running") {
      throw new Error("Kaseki returned an unsupported status");
    }
    if (attempt === maxPolls) break;
    await sleep(pollIntervalMs);
  }

  throw new Error(`No terminal status after ${maxPolls} polls`);
}

async function requestStatusFromController(url: string, token: string): Promise<KasekiStatusResponse> {
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        if (!isRetryableHttpStatus(response.status)) {
          throw new PermanentHttpStatusError(`Kaseki status request failed with HTTP ${response.status}`);
        }
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json() as KasekiStatusResponse;
    } catch (error) {
      if (error instanceof PermanentHttpStatusError) throw error;
      if (attempt === REQUEST_RETRIES) throw new Error("Kaseki status request failed after retries");
      await delay(1000 * (attempt + 1));
    }
  }

  throw new Error("Kaseki status request failed");
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function main(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const apiBaseUrl = environment.KASEKI_API_BASE_URL;
  const token = environment.KASEKI_API_TOKEN;
  const runId = environment.RUN_ID;
  const outputFile = environment.GITHUB_OUTPUT;
  if (!apiBaseUrl || !token || !runId || !outputFile) {
    throw new Error("KASEKI_API_BASE_URL, KASEKI_API_TOKEN, RUN_ID, and GITHUB_OUTPUT are required");
  }

  const result = await waitForKasekiRun({
    apiBaseUrl,
    token,
    runId,
    onPoll: (status, attempt, maxPolls) => {
      console.log(`Kaseki status: ${status} (poll ${attempt}/${maxPolls})`);
    },
  });

  if (result === "no_changes") {
    console.log("Kaseki completed without changes; treating the expected empty diff as a successful no-op.");
  }
  await appendFile(outputFile, `status=${result}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unexpected error";
    console.error(`::error title=Kaseki run wait failed::${message}`);
    process.exitCode = 1;
  });
}
