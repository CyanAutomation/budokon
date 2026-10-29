import { createRestRouter } from "../src/api/router.js";
import { authorized, distinctInternalApiKey } from "./auth.js";
import { defaultEdgeCache, isPublicCacheEligible, readPublicCache, writePublicCache } from "./edge-cache.js";
import type { EdgeCacheStorage } from "./edge-cache-types.js";
import { rateLimitPublicRequest } from "./rate-limit.js";
import { catalog, draw, eventDraw, manifest } from "./application.js";
import type { Env } from "./env.js";

type CacheOutcome = "HIT" | "MISS" | "BYPASS" | "UNAVAILABLE" | "ERROR";

function withCacheOutcome(response: Response, outcome: CacheOutcome): Response {
  const headers = new Headers(response.headers);
  headers.set("x-budokon-cache", outcome);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function routeLabel(pathname: string): string {
  for (const resource of ["judoka", "techniques", "events"]) {
    if (pathname.startsWith(`/v1/${resource}/`)) return `/v1/${resource}/:id`;
  }
  return pathname;
}

function requestColo(request: Request): string | undefined {
  const properties = Reflect.get(request, "cf");
  if (properties === null || typeof properties !== "object") return undefined;
  const colo = Reflect.get(properties, "colo");
  return typeof colo === "string" ? colo : undefined;
}

function observeCache(request: Request, response: Response, outcome: CacheOutcome): void {
  const colo = requestColo(request);
  if (!colo) return;
  console.log(JSON.stringify({
    event: "rest_cache",
    outcome,
    route: routeLabel(new URL(request.url).pathname),
    status: response.status,
    colo,
  }));
}

export async function handleRestRequest(
  request: Request,
  env: Env,
  cacheOption: EdgeCacheStorage | null | undefined,
): Promise<Response> {
  const cacheability = { cacheablePublicly: false };
  const revision = { dataset: catalog.version().datasetVersion, service: manifest.sourceGitCommit };
  const edgeCache = cacheOption === null ? undefined : cacheOption ?? defaultEdgeCache();
  const eligible = isPublicCacheEligible(request);
  let outcome: CacheOutcome = !eligible ? "BYPASS" : edgeCache ? "MISS" : "UNAVAILABLE";
  let cacheReadFailed = false;
  let cached: Response | undefined;
  if (edgeCache && eligible) {
    try {
      cached = await readPublicCache(edgeCache, request, revision);
    } catch {
      cacheReadFailed = true;
      outcome = "ERROR";
    }
  }
  if (cached?.status === 304) {
    const response = withCacheOutcome(cached, "HIT");
    observeCache(request, response, "HIT");
    return response;
  }

  const rateLimited = await rateLimitPublicRequest(request, env);
  if (rateLimited) {
    const response = withCacheOutcome(rateLimited, cached ? "HIT" : outcome);
    observeCache(request, response, cached ? "HIT" : outcome);
    return response;
  }
  if (cached) {
    const response = withCacheOutcome(cached, "HIT");
    observeCache(request, response, "HIT");
    return response;
  }

  const rest = createRestRouter({ catalog, draw, eventDraw }, {
    authorizeInternal: candidate => authorized(candidate, distinctInternalApiKey(env)),
    onRepresentation: metadata => { cacheability.cacheablePublicly = metadata.cacheablePublicly; },
  });
  const response = withCacheOutcome(
    await writePublicCache(
      cacheReadFailed ? undefined : edgeCache,
      request,
      await rest(request),
      revision,
      cacheability,
      () => { outcome = "ERROR"; },
    ),
    outcome,
  );
  observeCache(request, response, outcome);
  return response;
}
