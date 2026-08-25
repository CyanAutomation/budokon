const workerName = "budokon";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const configuredUrl = process.env.DEPLOYMENT_URL ?? "";

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
}

let target;
try {
  target = new URL(configuredUrl);
} catch {
  throw new Error("DEPLOYMENT_URL must be a valid URL");
}
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") {
  throw new Error("DEPLOYMENT_URL must be an HTTPS origin without credentials, path, query, or fragment");
}

async function cloudflare(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    const messages = Array.isArray(body.errors) ? body.errors.map(({ code, message }) => `${code}: ${message}`).join("; ") : response.statusText;
    throw new Error(`Cloudflare API request ${path} failed (${messages})`);
  }
  return body.result;
}

// Confirm that the deployment account contains the Worker named by wrangler.toml.
await cloudflare(`/workers/scripts/${workerName}/settings`);

const workersDevSuffix = ".workers.dev";
if (target.hostname.endsWith(workersDevSuffix)) {
  const { subdomain } = await cloudflare("/workers/subdomain");
  const expectedHostname = `${workerName}.${subdomain}${workersDevSuffix}`;
  if (target.hostname !== expectedHostname) {
    throw new Error(`Configured workers.dev hostname does not route to Worker ${workerName} in the deployment account`);
  }
} else {
  const records = await cloudflare(`/workers/domains/records?service=${workerName}&environment=production&per_page=100`);
  const record = records.find(({ hostname }) => hostname === target.hostname);
  if (!record || record.service !== workerName || (record.environment && record.environment !== "production")) {
    throw new Error(`Configured custom domain does not route to production Worker ${workerName} in the deployment account`);
  }
}

// This deliberately reports only public routing information, never account IDs or credentials.
console.log(`Deployment target validated: ${target.origin} -> Cloudflare Worker ${workerName}`);
