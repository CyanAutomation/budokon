const base = (process.env.DEPLOYMENT_URL ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) throw new Error("DEPLOYMENT_URL must be an HTTPS URL");

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

async function request(path: string, init?: RequestInit, expectedStatus?: number): Promise<Response> {
  try {
    const response = await fetch(`${base}${path}`, init);
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new Error(`${path} returned ${response.status}${expectedStatus === undefined ? "" : `, expected ${expectedStatus}`}`);
    }
    return response;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(`Network error accessing ${path}: ${error.message}`);
    }
    throw error;
  }
}

const status = await request("/v1/status").then(response => response.json() as Promise<StatusBody>);
if (status.status !== "ok" || !/^[0-9a-f]{40}$/.test(status.sourceGitCommit) || !/^sha256:[0-9a-f]{64}$/.test(status.datasetChecksum)) {
  throw new Error("status did not expose a valid immutable release identity");
}
const landing = await request("/").then(response => response.json() as Promise<LandingBody>);
if (landing.openapi !== `${base}/openapi/v1.yaml` || landing.status !== `${base}/v1/status`) throw new Error("landing document is incomplete");
const contract = await request("/openapi/v1.yaml");
if (!(await contract.text()).includes("/v1/status:")) throw new Error("OpenAPI contract does not document status");
const first = await request("/v1/judoka");
const etag = first.headers.get("etag");
if (!etag) throw new Error("public catalogue response is missing ETag");
await request("/v1/judoka", { headers: { "if-none-match": etag } }, 304);
const search = await request("/v1/judoka?q=shozo&limit=1").then(response => response.json() as Promise<{ judoka?: unknown[] }>);
if (!Array.isArray(search.judoka) || search.judoka.length === 0) throw new Error("catalogue search did not return the expected public record");
const page = await request("/v1/judoka?limit=1").then(response => response.json() as Promise<{ judoka?: unknown[]; nextCursor?: string }>);
if (!Array.isArray(page.judoka) || page.judoka.length !== 1 || !page.nextCursor) throw new Error("catalogue pagination did not return a cursor");
const nextPage = await request(`/v1/judoka?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`).then(response => response.json() as Promise<{ judoka?: unknown[] }>);
if (!Array.isArray(nextPage.judoka) || nextPage.judoka.length !== 1) throw new Error("catalogue cursor pagination did not return a result");
await request("/v1/judoka?unknown=smoke", undefined, 400);
const preflight = await request("/v1/draw", {
  method: "OPTIONS",
  headers: { origin: "https://smoke.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
}, 204);
if (preflight.headers.get("access-control-allow-methods")?.includes("POST") !== true) throw new Error("CORS preflight does not permit public draws");
const drawRequest: RequestInit = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ count: 1, seed: "deployment-smoke", filters: { personType: "real" } }),
};
const [firstDraw, secondDraw] = await Promise.all([
  request("/v1/draw", drawRequest).then(response => response.text()),
  request("/v1/draw", drawRequest).then(response => response.text()),
]);
if (firstDraw !== secondDraw) throw new Error("seeded draw is not deterministic");
const eventRequest: RequestInit = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ruleset: "ju-do-kon-v1", category: "shiai", seed: "deployment-smoke" }),
};
const [firstEvent, secondEvent] = await Promise.all([
  request("/v1/events/draw", eventRequest).then(response => response.text()),
  request("/v1/events/draw", eventRequest).then(response => response.text()),
]);
if (firstEvent !== secondEvent) throw new Error("seeded event draw is not deterministic");
console.log(`Smoke check passed for ${base} (${status.datasetVersion}, ${status.sourceGitCommit})`);
