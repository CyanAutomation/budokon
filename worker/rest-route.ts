import { createRestRouter } from "../src/api/router.js";
import { authorized, distinctInternalApiKey } from "./auth.js";
import { defaultEdgeCache, readPublicCache, writePublicCache } from "./edge-cache.js";
import type { EdgeCacheStorage } from "./edge-cache-types.js";
import { rateLimitPublicRequest } from "./rate-limit.js";
import { catalog, draw, eventDraw, manifest } from "./application.js";
import type { Env } from "./env.js";

export async function handleRestRequest(
  request: Request,
  env: Env,
  cacheOption: EdgeCacheStorage | null | undefined,
): Promise<Response> {
  const cacheability = { cacheablePublicly: false };
  const revision = { dataset: catalog.version().datasetVersion, service: manifest.sourceGitCommit };
  const edgeCache = cacheOption === null ? undefined : cacheOption ?? defaultEdgeCache();
  const cached = await readPublicCache(edgeCache, request, revision);
  if (cached) return cached;

  const rest = createRestRouter({ catalog, draw, eventDraw }, {
    authorizeInternal: candidate => authorized(candidate, distinctInternalApiKey(env)),
    onRepresentation: metadata => { cacheability.cacheablePublicly = metadata.cacheablePublicly; },
  });
  const rateLimited = await rateLimitPublicRequest(request, env);
  return rateLimited ?? await writePublicCache(edgeCache, request, await rest(request), revision, cacheability);
}
