import {
  isAuthorizationSensitive,
  representationEtag,
  weaklyMatchesEtag,
  type RepresentationCacheability,
} from "./representation-identity.js";

export type { RepresentationCacheability } from "./representation-identity.js";

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.delete("etag");
  headers.delete("cdn-cache-control");
  headers.delete("surrogate-control");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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

/** Add shared-cache policy and validators; edge-cache performs Cache API storage before CORS is applied. */
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
