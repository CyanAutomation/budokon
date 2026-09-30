import path from "node:path";
import { pathToFileURL } from "node:url";

const workerName = "budokon";
const workersDevSuffix = ".workers.dev";

interface CloudflareEnvelope {
  success?: unknown;
  errors?: unknown;
  result?: unknown;
}

interface WorkerDomainRecord {
  hostname?: string;
  service?: string;
  environment?: string;
}

export interface DeploymentTargetOptions {
  accountId: string;
  apiToken: string;
  deploymentUrl: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export async function cloudflareRequest(
  endpoint: string,
  accountId: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Cloudflare API request ${endpoint} failed (non-JSON response, status ${response.status})`);
  }

  const envelope = body && typeof body === "object" ? body as CloudflareEnvelope : {};
  if (!response.ok || !envelope.success) {
    const messages = Array.isArray(envelope.errors)
      ? envelope.errors.map(error => {
        if (!error || typeof error !== "object") return String(error);
        const item = error as { code?: unknown; message?: unknown };
        return `${String(item.code ?? "unknown")}: ${String(item.message ?? "unspecified error")}`;
      }).join("; ")
      : response.statusText;
    throw new Error(`Cloudflare API request ${endpoint} failed (${messages})`);
  }
  return envelope.result;
}

function parseDeploymentUrl(deploymentUrl: string): URL {
  let target: URL;
  try {
    target = new URL(deploymentUrl);
  } catch {
    throw new Error("DEPLOYMENT_URL must be a valid URL");
  }
  if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
    throw new Error("DEPLOYMENT_URL must be an HTTPS origin without credentials, path, query, or fragment");
  }
  return target;
}

type CloudflareRequest = (endpoint: string) => Promise<unknown>;

async function validateWorkersDevRouting(target: URL, request: CloudflareRequest): Promise<void> {
  const result = await request("/workers/subdomain");
  const subdomain = result && typeof result === "object" ? (result as { subdomain?: unknown }).subdomain : undefined;
  const expectedHostname = typeof subdomain === "string" ? `${workerName}.${subdomain}${workersDevSuffix}` : "";
  if (target.hostname !== expectedHostname) {
    throw new Error(`Configured workers.dev hostname does not route to Worker ${workerName} in the deployment account`);
  }
}

async function loadWorkerDomainRecords(request: CloudflareRequest): Promise<WorkerDomainRecord[]> {
  const records: WorkerDomainRecord[] = [];
  let page = 1;
  while (true) {
    const result = await request(
      `/workers/domains/records?service=${workerName}&environment=production&per_page=100&page=${page}`,
    );
    if (!Array.isArray(result)) {
      throw new Error("Cloudflare API returned an invalid custom-domain response");
    }
    records.push(...result as WorkerDomainRecord[]);
    if (result.length < 100) return records;
    page += 1;
  }
}

async function validateCustomDomainRouting(target: URL, request: CloudflareRequest): Promise<void> {
  const records = await loadWorkerDomainRecords(request);
  const record = records.find(({ hostname }) => hostname === target.hostname);
  if (!record || record.service !== workerName || (record.environment && record.environment !== "production")) {
    throw new Error(`Configured custom domain does not route to production Worker ${workerName} in the deployment account`);
  }
}

export async function validateDeploymentTarget(options: DeploymentTargetOptions): Promise<void> {
  const { accountId, apiToken, deploymentUrl } = options;
  if (!accountId || !apiToken || !deploymentUrl) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and DEPLOYMENT_URL are required");
  }

  const target = parseDeploymentUrl(deploymentUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = (endpoint: string) => cloudflareRequest(endpoint, accountId, apiToken, fetchImpl);
  await request(`/workers/scripts/${workerName}/settings`);

  if (target.hostname.endsWith(workersDevSuffix)) {
    await validateWorkersDevRouting(target, request);
  } else {
    await validateCustomDomainRouting(target, request);
  }

  (options.log ?? console.log)(`Deployment target validated: ${target.origin} -> Cloudflare Worker ${workerName}`);
}

export async function main(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  await validateDeploymentTarget({
    accountId: environment.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: environment.CLOUDFLARE_API_TOKEN ?? "",
    deploymentUrl: environment.DEPLOYMENT_URL ?? "",
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
