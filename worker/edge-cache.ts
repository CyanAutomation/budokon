import { cachePublicGet, type RepresentationCacheability } from "./representation-cache.js";

export interface EdgeCacheStorage {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

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

/**
 * Construct an origin-independent key. Query names and values are sorted because
 * the REST API treats repeated filter values as sets rather than ordered input.
 */
export function publicCacheKey(request: Request, revision: EdgeCacheRevision): Request | undefined {
  if (isPrivateRequest(request)) return undefined;
  const source = new URL(request.url);
  const query = [...source.searchParams.entries()].sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName < rightName ? -1 : leftName > rightName ? 1 : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0);
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
): Promise<Response> {
  const decorated = await cachePublicGet(response, request, revision.dataset, revision.service, metadata);
  const key = publicCacheKey(request, revision);
  if (cache && key && response.status === 200 && metadata.cacheablePublicly) await cache.put(key, decorated.clone());
  return decorated;
}
