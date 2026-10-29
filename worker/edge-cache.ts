import { cachePublicGet, type RepresentationCacheability } from "./representation-cache.js";
import { canonicalRepresentationQuery } from "./representation-identity.js";
import type { EdgeCacheStorage } from "./edge-cache-types.js";

export interface EdgeCacheRevision {
  dataset: string;
  service: string;
}

declare const caches: { default: EdgeCacheStorage } | undefined;

/** Resolve Cloudflare's cache without requiring it in local or portable runtimes. */
export function defaultEdgeCache(): EdgeCacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches.default;
}

function isPrivateRequest(request: Request): boolean {
  const url = new URL(request.url);
  return request.method !== "GET"
    || !url.pathname.startsWith("/v1/")
    || url.pathname === "/v1/draw"
    || url.pathname === "/v1/events/draw"
    || request.headers.has("authorization")
    || request.headers.has("x-api-key")
    || url.searchParams.getAll("includeHidden").includes("true");
}

export function isPublicCacheEligible(request: Request): boolean {
  return !isPrivateRequest(request);
}

/**
 * Construct an origin-independent key. Query normalization follows the REST
 * route semantics while preserving invalid scalar shapes for normal validation.
 */
export function publicCacheKey(request: Request, revision: EdgeCacheRevision): Request | undefined {
  if (!isPublicCacheEligible(request)) return undefined;
  const source = new URL(request.url);
  const query = canonicalRepresentationQuery(source).flatMap(([name, values]) => values.map(value => [name, value] as const));
  const key = new URL(source.origin);
  key.pathname = source.pathname;
  for (const [name, value] of query) key.searchParams.append(name, value);
  key.searchParams.append("__budokon_dataset", revision.dataset);
  key.searchParams.append("__budokon_service", revision.service);
  return new Request(key, { method: "GET" });
}

function conditional(response: Response, request: Request): Response {
  const etag = response.headers.get("etag");
  const validators = request.headers.get("if-none-match")?.split(",").map(value => value.trim());
  if (etag && validators?.some(value => {
    if (value === "*") return true;
    const strippedValidator = value.startsWith("W/") ? value.slice(2) : value;
    const strippedEtag = etag.startsWith("W/") ? etag.slice(2) : etag;
    return strippedValidator === strippedEtag;
  })) {
    return new Response(null, { status: 304, headers: response.headers });
  }
  return response;
}

/** Read an eligible public representation before routing it. */
export async function readPublicCache(
  cache: EdgeCacheStorage | undefined,
  request: Request,
  revision: EdgeCacheRevision,
): Promise<Response | undefined> {
  const key = publicCacheKey(request, revision);
  if (!cache || !key) return undefined;
  const response = await cache.match(key);
  return response ? conditional(response, request) : undefined;
}

/** Decorate and store only a successful representation explicitly marked public. */
export async function writePublicCache(
  cache: EdgeCacheStorage | undefined,
  request: Request,
  response: Response,
  revision: EdgeCacheRevision,
  metadata: RepresentationCacheability,
  onCacheError?: () => void,
): Promise<Response> {
  const key = publicCacheKey(request, revision);
  const cacheable = cache !== undefined && key !== undefined && response.status === 200 && metadata.cacheablePublicly;
  const conditionalRepresentation = cacheable && request.headers.has("if-none-match") ? response.clone() : undefined;
  const decorated = await cachePublicGet(response, request, revision.dataset, revision.service, metadata);
  if (cache && key && cacheable) {
    if (decorated.status === 304) {
      const headers = new Headers(request.headers);
      headers.delete("if-none-match");
      const unconditionalRequest = new Request(request, { headers });
      const successfulRepresentation = await cachePublicGet(
        conditionalRepresentation ?? response.clone(),
        unconditionalRequest,
        revision.dataset,
        revision.service,
        metadata,
      );
      try {
        await cache.put(key, successfulRepresentation);
      } catch {
        onCacheError?.();
      }
    } else {
      try {
        await cache.put(key, decorated.clone());
      } catch {
        onCacheError?.();
      }
    }
  }
  return decorated;
}
