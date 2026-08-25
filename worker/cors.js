const METHODS = "GET, POST, OPTIONS";
const HEADERS = "content-type";

function allowedOrigins(env) {
  return new Set((env.PUBLIC_ALLOWED_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean));
}

/** Return CORS headers only when the request Origin is explicitly allowlisted. */
export function corsHeaders(request, env) {
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
export function preflightResponse(request, env) {
  const headers = corsHeaders(request, env);
  const requestedMethod = request.headers.get("access-control-request-method");
  const method = requestedMethod?.toUpperCase();
  const requested = request.headers.get("access-control-request-headers")?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
  const permitted = headers.has("access-control-allow-origin") && requestedMethod !== null && (method === "GET" || method === "POST") && requested.every(header => header === "content-type");
  return permitted ? new Response(null, { status: 204, headers }) : new Response(null, { status: 403, headers: { vary: "Origin" } });
}

/** Apply CORS to every visible response, including validation and authorization errors. */
export function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders(request, env)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function weaklyMatchesEtag(ifNoneMatch, etag) {
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
  }

  return validators.some(validator => {
    if (validator === "*") return true;
    const opaqueTag = validator.startsWith("W/") ? validator.slice(2) : validator;
    return /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(opaqueTag) && opaqueTag === etag;
  });
}

/** Cache immutable catalogue GET representations at the edge and validate them cheaply in browsers. */
export function cachePublicGet(response, request, datasetVersion) {
  if (request.method !== "GET" || response.status !== 200) return response;
  const url = new URL(request.url);
  const etag = `"budokon-${datasetVersion}-${encodeURIComponent(`${url.pathname}${url.search}`)}"`;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400");
  headers.set("etag", etag);
  headers.set("vary", "Origin");
  if (weaklyMatchesEtag(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
