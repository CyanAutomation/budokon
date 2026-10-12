import path from "node:path";
import { pathToFileURL } from "node:url";

interface StatusBody {
  status: string;
  sourceGitCommit: string;
  datasetChecksum: string;
  datasetVersion: string;
}

interface LandingBody {
  openapi: string;
  status: string;
}

export interface SmokeDeploymentOptions {
  deploymentUrl?: string;
  directDeploymentUrl?: string;
  expectedSourceGitCommit?: string;
  deploymentIdentityAttempts?: number;
  deploymentIdentityRetryIntervalMs?: number;
  waitImpl?: (milliseconds: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

type ExpectedStatus = number | readonly number[] | "any";

export async function request(
  base: string,
  path: string,
  init?: RequestInit,
  expectedStatus?: ExpectedStatus,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  try {
    const response = await fetchImpl(`${base}${path}`, init);
    const acceptedStatuses = typeof expectedStatus === "number"
      ? [expectedStatus]
      : expectedStatus === undefined || expectedStatus === "any" ? undefined : expectedStatus;
    if (expectedStatus === undefined ? !response.ok : expectedStatus !== "any" && !acceptedStatuses?.includes(response.status)) {
      const expected = acceptedStatuses?.join(" or ") ?? "a successful response";
      throw new Error(`${path} returned ${response.status}, expected ${expected}`);
    }
    return response;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(`Network error accessing ${path}: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

type DeploymentRequest = (path: string, init?: RequestInit, expectedStatus?: ExpectedStatus) => Promise<Response>;

function assertValidReleaseIdentity(status: StatusBody): void {
  const validCommit = /^[0-9a-f]{40}$/.test(status.sourceGitCommit);
  const validChecksum = /^sha256:[0-9a-f]{64}$/.test(status.datasetChecksum);
  if (status.status !== "ok" || !validCommit || !validChecksum) {
    throw new Error("status did not expose a valid immutable release identity");
  }
}

async function waitForReleaseIdentity(
  base: string,
  send: DeploymentRequest,
  expectedSourceGitCommit: string | undefined,
  attempts: number,
  retryIntervalMs: number,
  waitImpl: (milliseconds: number) => Promise<void>,
  log: (message: string) => void,
): Promise<StatusBody> {
  if (expectedSourceGitCommit !== undefined && !/^[0-9a-f]{40}$/.test(expectedSourceGitCommit)) {
    throw new Error("EXPECTED_SOURCE_GIT_COMMIT must be a 40-character lowercase Git commit");
  }
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("deploymentIdentityAttempts must be a positive integer");
  if (!Number.isFinite(retryIntervalMs) || retryIntervalMs < 0) {
    throw new Error("deploymentIdentityRetryIntervalMs must be a non-negative number");
  }

  let lastStatus: StatusBody | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastStatus = await send("/v1/status").then(response => response.json() as Promise<StatusBody>);
    assertValidReleaseIdentity(lastStatus);
    if (!expectedSourceGitCommit || lastStatus.sourceGitCommit === expectedSourceGitCommit) return lastStatus;
    if (attempt === 1) {
      log(`Waiting for ${base} to serve commit ${expectedSourceGitCommit}; currently serving ${lastStatus.sourceGitCommit}`);
    }
    if (attempt < attempts) await waitImpl(retryIntervalMs);
  }

  throw new Error(
    `${base} still serves commit ${lastStatus?.sourceGitCommit ?? "unknown"}; expected ${expectedSourceGitCommit} after ${attempts} checks`,
  );
}

async function validateReleaseIdentity(base: string, send: DeploymentRequest, status: StatusBody): Promise<void> {
  assertValidReleaseIdentity(status);
  const landing = await send("/").then(response => response.json() as Promise<LandingBody>);
  const hasOpenApiLink = landing.openapi === `${base}/openapi/v1.yaml`;
  const hasStatusLink = landing.status === `${base}/v1/status`;
  if (!hasOpenApiLink || !hasStatusLink) throw new Error("landing document is incomplete");

  const contract = await send("/openapi/v1.yaml");
  if (!(await contract.text()).includes("/v1/status:")) throw new Error("OpenAPI contract does not document status");
}

async function validatePublicCatalogue(send: DeploymentRequest): Promise<void> {
  const first = await send("/v1/judoka");
  const etag = first.headers.get("etag");
  if (!etag) throw new Error("public catalogue response is missing ETag");
  if (!first.headers.get("cache-control")?.includes("s-maxage=")) {
    throw new Error("public catalogue response is missing its shared-cache policy");
  }
  const revalidation = await send("/v1/judoka", { headers: { "if-none-match": etag } }, "any");
  if (revalidation.status !== 304) {
    const diagnosticHeaders = [
      ["ETag", revalidation.headers.get("etag")],
      ["CF-Cache-Status", revalidation.headers.get("cf-cache-status")],
      ["Age", revalidation.headers.get("age")],
      ["CF-Ray", revalidation.headers.get("cf-ray")],
    ].map(([name, value]) => `${name}=${value ?? "<missing>"}`).join(", ");
    throw new Error(
      `/v1/judoka revalidation with If-None-Match ${etag} returned ${revalidation.status}, expected 304 (${diagnosticHeaders})`,
    );
  }

  const search = await send("/v1/judoka?q=shozo&limit=1").then(response => response.json() as Promise<{ judoka?: unknown[] }>);
  if (!Array.isArray(search.judoka) || search.judoka.length === 0) {
    throw new Error("catalogue search did not return the expected public record");
  }

  const page = await send("/v1/judoka?limit=1").then(response => response.json() as Promise<{ judoka?: unknown[]; nextCursor?: string }>);
  if (!Array.isArray(page.judoka) || page.judoka.length !== 1 || !page.nextCursor) {
    throw new Error("catalogue pagination did not return a cursor");
  }
  const nextPage = await send(`/v1/judoka?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`)
    .then(response => response.json() as Promise<{ judoka?: unknown[] }>);
  if (!Array.isArray(nextPage.judoka) || nextPage.judoka.length !== 1) {
    throw new Error("catalogue cursor pagination did not return a result");
  }
  await send("/v1/judoka?unknown=smoke", undefined, 400);
}

async function validatePublicDraws(send: DeploymentRequest): Promise<void> {
  const preflight = await send("/v1/draw", {
    method: "OPTIONS",
    headers: { origin: "https://smoke.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  }, 204);
  if (preflight.headers.get("access-control-allow-methods")?.includes("POST") !== true) {
    throw new Error("CORS preflight does not permit public draws");
  }

  const drawRequest: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: 1, seed: "deployment-smoke", filters: { personType: "real" } }),
  };
  const eventRequest: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ruleset: "ju-do-kon-v1", category: "shiai", seed: "deployment-smoke" }),
  };
  await assertDeterministicResponse(send, "/v1/draw", drawRequest, "seeded draw");
  await assertDeterministicResponse(send, "/v1/events/draw", eventRequest, "seeded event draw");
}

async function assertDeterministicResponse(
  send: DeploymentRequest,
  path: string,
  init: RequestInit,
  name: string,
): Promise<void> {
  const [first, second] = await Promise.all([
    send(path, init).then(response => response.text()),
    send(path, init).then(response => response.text()),
  ]);
  if (first !== second) throw new Error(`${name} is not deterministic`);
}

export async function runSmokeDeployment(options: SmokeDeploymentOptions = {}): Promise<void> {
  const base = (options.deploymentUrl ?? process.env.DEPLOYMENT_URL ?? "").replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("DEPLOYMENT_URL must be an HTTPS URL");
  const directBase = (options.directDeploymentUrl ?? process.env.DIRECT_DEPLOYMENT_URL ?? "").replace(/\/$/, "");
  if (directBase && !/^https:\/\//.test(directBase)) {
    throw new Error("DIRECT_DEPLOYMENT_URL must be an HTTPS URL");
  }
  const expectedSourceGitCommit = options.expectedSourceGitCommit ?? process.env.EXPECTED_SOURCE_GIT_COMMIT;
  const attempts = options.deploymentIdentityAttempts ?? 13;
  const retryIntervalMs = options.deploymentIdentityRetryIntervalMs ?? 5_000;
  const waitImpl = options.waitImpl ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const log = options.log ?? console.log;
  const targets = [...new Set([base, directBase].filter(Boolean))];

  for (const target of targets) {
    const send = (path: string, init?: RequestInit, expectedStatus?: ExpectedStatus) =>
      request(target, path, init, expectedStatus, options.fetchImpl ?? fetch);
    const status = await waitForReleaseIdentity(target, send, expectedSourceGitCommit, attempts, retryIntervalMs, waitImpl, log);
    await validateReleaseIdentity(target, send, status);
    await validatePublicCatalogue(send);
    await validatePublicDraws(send);
    log(`Smoke check passed for ${target} (${status.datasetVersion}, ${status.sourceGitCommit})`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  runSmokeDeployment().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
