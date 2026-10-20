import path from "node:path";
import { pathToFileURL } from "node:url";

export const KASEKI_CONTROLLER_URL = "https://kaseki-tunnel.scheimann.xyz";
export const KASEKI_API_BASE_URL = `${KASEKI_CONTROLLER_URL}/api/v1`;

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

type JsonObject = Record<string, unknown>;

export interface KasekiCheckOptions {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface KasekiReadinessOptions extends KasekiCheckOptions {
  baseUrl: string;
}

export interface KasekiApiReadinessOptions extends KasekiCheckOptions {
  apiBaseUrl: string;
  token: string;
}

interface RequestResult {
  statusCode: number;
  body: unknown;
}

function asObject(value: unknown): JsonObject | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function validateRetryCount(maxRetries: number): void {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("maxRetries must be a non-negative integer");
  }
}

function validateControllerUrl(baseUrl: string): void {
  if (baseUrl !== KASEKI_CONTROLLER_URL) {
    throw new Error("Use the approved HTTPS controller URL.");
  }
}

function validateApiUrl(apiBaseUrl: string): void {
  if (apiBaseUrl !== KASEKI_API_BASE_URL) {
    throw new Error("Use the approved Kaseki API URL.");
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

async function requestJson(
  url: string,
  label: string,
  options: KasekiCheckOptions,
  token?: string,
): Promise<RequestResult> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  validateRetryCount(maxRetries);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("timeoutMs must be a positive integer");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (token !== undefined) headers.authorization = `Bearer ${token}`;

      const response = await fetcher(url, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // Preserve the HTTP response classification if cleanup itself fails.
        }
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(`Kaseki ${label} request failed with HTTP ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json() as unknown;
      } catch {
        throw new Error(`Kaseki ${label} returned an invalid JSON response`);
      }
      return { statusCode: response.status, body };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Kaseki ")) throw error;
      if (attempt === maxRetries) {
        throw new Error(`Kaseki ${label} request failed after retries`);
      }
      await sleep(1000 * (attempt + 1));
    }
  }

  throw new Error(`Kaseki ${label} request failed`);
}

export async function checkKasekiReadiness(options: KasekiReadinessOptions): Promise<void> {
  validateControllerUrl(options.baseUrl);
  const response = await requestJson(
    `${options.baseUrl}/ready`,
    "readiness",
    { ...options, timeoutMs: options.timeoutMs ?? 20_000 },
  );
  if (asObject(response.body)?.status !== "ready") {
    throw new Error("Kaseki controller is not ready.");
  }
}

export async function checkKasekiApiReadiness(options: KasekiApiReadinessOptions): Promise<void> {
  validateApiUrl(options.apiBaseUrl);
  if (!options.token) throw new Error("KASEKI_API_TOKEN is required.");

  const gateway = await requestJson(
    `${options.apiBaseUrl}/gateway-test?stage=1`,
    "gateway authentication",
    options,
    options.token,
  );
  if (asObject(gateway.body)?.status !== "ok") {
    throw new Error("Kaseki gateway authentication failed.");
  }

  const capabilities = asObject((await requestJson(
    `${options.apiBaseUrl}/capabilities`,
    "capability",
    { ...options, timeoutMs: options.timeoutMs ?? 30_000 },
    options.token,
  )).body);
  const taskModes = capabilities?.taskModes;
  const publishModes = capabilities?.publishModes;
  if (!Array.isArray(taskModes) || !taskModes.includes("patch")
    || !Array.isArray(publishModes) || !publishModes.includes("pr")) {
    throw new Error("Kaseki API must support patch tasks and regular pull requests.");
  }

  const preflight = await requestJson(
    `${options.apiBaseUrl}/preflight`,
    "runner preflight",
    options,
    options.token,
  );
  const preflightBody = asObject(preflight.body);
  const failedChecks = preflightBody?.failedChecks;
  const errors = preflightBody?.errors;
  const acceptedStatus = preflightBody?.status === "ok" || preflightBody?.status === "degraded";
  if (preflight.statusCode !== 200 || !acceptedStatus
    || (Array.isArray(failedChecks) && failedChecks.length > 0)
    || (Array.isArray(errors) && errors.length > 0)
    || (failedChecks !== undefined && !Array.isArray(failedChecks))
    || (errors !== undefined && !Array.isArray(errors))) {
    throw new Error("Kaseki runner preflight failed.");
  }
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function main(environment: NodeJS.ProcessEnv = process.env, mode = process.argv[2]): Promise<void> {
  if (mode === "readiness") {
    await checkKasekiReadiness({ baseUrl: requiredEnvironment(environment, "KASEKI_BASE_URL") });
    console.log("Kaseki readiness check succeeded.");
    return;
  }
  if (mode === "api") {
    await checkKasekiApiReadiness({
      apiBaseUrl: requiredEnvironment(environment, "KASEKI_API_BASE_URL"),
      token: requiredEnvironment(environment, "KASEKI_API_TOKEN"),
    });
    console.log("Kaseki API readiness checks succeeded.");
    return;
  }
  throw new Error("Run with either the readiness or api mode.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unexpected error";
    console.error(`::error title=Kaseki controller check failed::${message}`);
    process.exitCode = 1;
  });
}
