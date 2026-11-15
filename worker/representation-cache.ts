import { representationEtag, weaklyMatchesEtag } from "./etag.js";

export interface RepresentationCacheability {
  /** Explicit REST-layer assurance that the response is independent of internal visibility. */
  cacheablePublicly: boolean;
}

function isAuthorizationSensitive(request: Request, metadata?: RepresentationCacheability): boolean {
  const requestsHiddenRecords = new URL(request.url).searchParams.getAll("includeHidden").includes("true");
  return metadata?.cacheablePublicly === false
    || requestsHiddenRecords
    || request.headers.has("authorization")
    || request.headers.has("x-api-key");
}

function privateResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.delete("etag");
  headers.delete("cdn-cache-control");
  headers.delete("surrogate-control");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=86400";

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
