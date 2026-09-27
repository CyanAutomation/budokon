const METHODS = "GET, POST, OPTIONS";
const HEADERS = "content-type";
type PublicEnv = { PUBLIC_ALLOWED_ORIGINS?: string };

function allowedOrigins(env: PublicEnv): Set<string> {
  return new Set((env.PUBLIC_ALLOWED_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean));
}

/** Return CORS headers only when the request Origin is explicitly allowlisted. */
export function corsHeaders(request: Request, env: PublicEnv): Headers {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins(env);
  if (!origin || (!allowed.has("*") && !allowed.has(origin))) return new Headers();
  return new Headers({
    "access-control-allow-origin": allowed.has("*") ? "*" : origin,
    "access-control-allow-methods": METHODS,
    "access-control-allow-headers": HEADERS,
    "access-control-max-age": "86400",
    ...(allowed.has("*") ? {} : { vary: "Origin" })
  });
}

/** Handle browser preflight without ever accepting a browser-held API key. */
export function preflightResponse(request: Request, env: PublicEnv): Response {
  const headers = corsHeaders(request, env);
  const requestedMethod = request.headers.get("access-control-request-method");
  const method = requestedMethod?.toUpperCase();
  const requested = request.headers.get("access-control-request-headers")?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
  const permitted = headers.has("access-control-allow-origin") && requestedMethod !== null && (method === "GET" || method === "POST") && requested.every(header => header === "content-type");
  return permitted ? new Response(null, { status: 204, headers }) : new Response(null, { status: 403, headers: { vary: "Origin" } });
}

/** Apply CORS to every visible response, including validation and authorization errors. */
export function withCors(response: Response, request: Request, env: PublicEnv): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders(request, env)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function weaklyMatchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;

  const validators = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index <= ifNoneMatch.length; index += 1) {
    const character = index < ifNoneMatch.length ? ifNoneMatch[index] : null;
    if (character === '"') quoted = !quoted;
    if ((character === "," && !quoted) || index === ifNoneMatch.length) {
      const validator = ifNoneMatch.slice(start, index).trim();
      if (validator) validators.push(validator);
      start = index + 1;
    }
  }

  return validators.some(validator => {
    if (validator === "*") return true;
    if (!/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(validator)) return false;
    return (validator.startsWith("W/") ? validator.slice(2) : validator) === etag;
  });
}

export interface RepresentationCacheability {
  /** Explicit REST-layer assurance that the response is independent of internal visibility. */
  cacheablePublicly: boolean;
}

export function isAuthorizationSensitive(request: Request, metadata?: RepresentationCacheability): boolean {
  const requestsHiddenRecords = new URL(request.url).searchParams.getAll("includeHidden").includes("true");
  return metadata?.cacheablePublicly === false
    || requestsHiddenRecords
    || request.headers.has("authorization")
    || request.headers.has("x-api-key");
}

/**
 * Describe the parts of a validated REST request that select its representation.
 *
 * URLSearchParams has already decoded query names and values. Sorting only the
 * parameter names makes differently ordered, equivalent queries share an
 * identity, while keeping each name's values in request order. The latter is
 * important for filters such as repeated `exclude` values whose order can be
 * reflected in a response. An array of decoded path segments also avoids
 * spelling differences in percent-encoding without conflating encoded slashes
 * with path separators.
 */
function canonicalRepresentationKey(url: URL): string {
  const pathname = url.pathname
    .split("/")
    .filter(Boolean)
    .map(segment => decodeURIComponent(segment));
  const parameterNames = [...new Set(url.searchParams.keys())].sort();
  const parameters = parameterNames.map(name => [name, url.searchParams.getAll(name)]);
  return JSON.stringify([pathname, parameters]);
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.delete("etag");
  headers.delete("cdn-cache-control");
  headers.delete("surrogate-control");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function representationEtag(datasetVersion: string, representationRevision: string, request: Request): Promise<string> {
  const url = new URL(request.url);
  const representationKey = canonicalRepresentationKey(url);
  const identity = JSON.stringify([datasetVersion, representationRevision, representationKey]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `"budokon-${hash}"`;
}

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400";

function isKnownPublicGet(request: Request): boolean {
  if (request.method !== "GET" || isAuthorizationSensitive(request)) return false;
  let segments: string[];
  try { segments = new URL(request.url).pathname.split("/").filter(Boolean).map(segment => decodeURIComponent(segment)); }
  catch { return false; }
  if (segments[0] !== "v1" || segments.length < 2 || segments.length > 3) return false;
  const [_, resource, id] = segments;
  if (resource === "judoka" || resource === "techniques") return true;
  if (resource === "events") return id !== "draw";
  return id === undefined && ["countries", "weight-categories", "version", "status", "coverage"].includes(resource ?? "");
}

/**
 * Resolve a safe public conditional GET without generating its representation.
 * Revalidations deliberately bypass quota: hashing immutable release identity is
 * substantially cheaper than routing, while mismatches retain the normal limiter.
 */
export async function publicNotModifiedResponse(
  request: Request,
  datasetVersion: string,
  representationRevision: string,
): Promise<Response | undefined> {
  if (!isKnownPublicGet(request)) return undefined;
  const etag = await representationEtag(datasetVersion, representationRevision, request);
  if (!weaklyMatchesEtag(request.headers.get("if-none-match"), etag)) return undefined;
  return new Response(null, { status: 304, headers: {
    "cache-control": PUBLIC_CACHE_CONTROL,
    etag,
    vary: "Origin",
  } });
}

/** Add shared-cache policy and validators; worker/edge-cache.ts performs Cache API storage before CORS is applied. */
export async function cachePublicGet(
  response: Response,
  request: Request,
  datasetVersion: string,
  representationRevision: string,
  metadata?: RepresentationCacheability,
): Promise<Response> {
  if (isAuthorizationSensitive(request, metadata)) return privateResponse(response);
  if (request.method !== "GET" || response.status !== 200) return response;
  const etag = await representationEtag(datasetVersion, representationRevision, request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  headers.set("etag", etag);
  headers.set("vary", "Origin");
  if (weaklyMatchesEtag(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
