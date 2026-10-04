import dataset from "../dist/budokon.json" with { type: "json" };
import manifest from "../dist/manifest.json" with { type: "json" };
import { CatalogService } from "../src/domain/catalog-service.js";
import { DrawService } from "../src/draw/draw-service.js";
import { EventDrawService } from "../src/draw/event-draw-service.js";
import { createRestRouter } from "../src/api/router.js";
import { createBudokonMcpHandler } from "../src/mcp/server.js";
import { EditorialReviewService } from "../src/jev/editorial-review-service.js";
import { PlaystyleClassificationService } from "../src/jev/playstyle-classification-service.js";
import { OpenRouterJevClient } from "../src/jev/openrouter-client.js";
import { SemanticJudokaSearchService } from "../src/jev/semantic-search.js";
import { JevJudokaQueryInterpreter } from "../src/jev/query-interpreter.js";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.js";
import { authorized } from "./auth.js";
import { preflightResponse, withCors } from "./cors.js";
import { defaultEdgeCache, readPublicCache, writePublicCache, type EdgeCacheStorage } from "./edge-cache.js";
import { rateLimitMcpPrincipal, rateLimitMcpRequest, rateLimitPublicRequest } from "./rate-limit.js";
import { documentationResponse, landingResponse, openApiResponse } from "./discovery.js";
import { hostHeaderValidationResponse, originValidationResponse, type AuthInfo } from "@modelcontextprotocol/server";
import { MCP_INTERNAL_SCOPE, MCP_JEV_SCOPE, authenticateOAuthBearer, oauthDiscoveryResponse, type McpOAuthConfig } from "./oauth.js";

export interface Env {
  API_KEY: string;
  /** Comma-separated hostnames permitted to serve the MCP endpoint. */
  MCP_ALLOWED_HOSTNAMES?: string;
  /** Optional elevated credential which alone may access hidden records. */
  INTERNAL_API_KEY?: string;
  /** Comma-separated browser origins permitted to read the public REST API. */
  PUBLIC_ALLOWED_ORIGINS?: string;
  PUBLIC_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional secret enabling internal-only JEV editorial review and semantic MCP tools. */
  JEV_OPENROUTER_API_KEY?: string;
  /** OAuth authorization-server issuer and endpoints; this Worker only validates access tokens. */
  MCP_OAUTH_ISSUER?: string;
  MCP_OAUTH_AUTHORIZATION_ENDPOINT?: string;
  MCP_OAUTH_TOKEN_ENDPOINT?: string;
  MCP_OAUTH_INTROSPECTION_ENDPOINT?: string;
  MCP_OAUTH_CLIENT_ID?: string;
  MCP_OAUTH_CLIENT_SECRET?: string;
  /** Exact resource identifier expected in introspected access-token audience claims. */
  MCP_RESOURCE_URL?: string;
  JEV_MODEL?: string;
  JEV_TIMEOUT_MS?: string;
  JEV_MINIMUM_RELEVANCE?: string;
  JEV_EDITORIAL_THRESHOLD?: string;
  JEV_QUERY_MINIMUM_CONFIDENCE?: string;
  JEV_PLAYSTYLE_THRESHOLD?: string;
}

const repository = new JsonReadModelRepository({ ...dataset, manifest });
const catalog = new CatalogService(repository);
const draw = new DrawService(catalog);
const eventDraw = new EventDrawService(repository);

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function configuredProbability(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

type McpAuthentication = { authorizedInternal: boolean; authorizedJev: boolean; authInfo?: AuthInfo; principal?: string };

function mcpOAuthConfig(env: Env): McpOAuthConfig | undefined {
  const values = [env.MCP_OAUTH_ISSUER, env.MCP_OAUTH_AUTHORIZATION_ENDPOINT, env.MCP_OAUTH_TOKEN_ENDPOINT,
    env.MCP_OAUTH_INTROSPECTION_ENDPOINT, env.MCP_OAUTH_CLIENT_ID, env.MCP_OAUTH_CLIENT_SECRET, env.MCP_RESOURCE_URL];
  if (values.some(value => !value)) return undefined;
  return {
    issuer: env.MCP_OAUTH_ISSUER!,
    authorizationEndpoint: env.MCP_OAUTH_AUTHORIZATION_ENDPOINT!,
    tokenEndpoint: env.MCP_OAUTH_TOKEN_ENDPOINT!,
    introspectionEndpoint: env.MCP_OAUTH_INTROSPECTION_ENDPOINT!,
    clientId: env.MCP_OAUTH_CLIENT_ID!,
    clientSecret: env.MCP_OAUTH_CLIENT_SECRET!,
    resourceUrl: env.MCP_RESOURCE_URL!,
  };
}

function distinctInternalApiKey(env: Pick<Env, "API_KEY" | "INTERNAL_API_KEY">): string | undefined {
  if (!env.INTERNAL_API_KEY || env.INTERNAL_API_KEY === env.API_KEY) return undefined;
  return env.INTERNAL_API_KEY;
}

/**
 * Authenticate one managed key or one introspected OAuth bearer token.
 * A configured internal key grants internal and JEV access; OAuth uses scopes.
 */
async function authenticateMcpRequest(request: Request, env: Env): Promise<McpAuthentication | Response> {
  const authorizedInternal = authorized(request, distinctInternalApiKey(env));
  if (authorizedInternal) return { authorizedInternal: true, authorizedJev: true };
  if (authorized(request, env.API_KEY)) return { authorizedInternal: false, authorizedJev: false };
  if (request.headers.has("x-api-key") && request.headers.has("authorization")) {
    return json({ error: { code: "unauthorized", message: "A valid API key is required" } }, 401, { "www-authenticate": "Bearer" });
  }
  const oauth = mcpOAuthConfig(env);
  if (oauth) {
    const authInfo = await authenticateOAuthBearer(request, oauth);
    if (authInfo instanceof Response) return authInfo;
    const scopes = new Set(authInfo.scopes);
    return {
      authorizedInternal: scopes.has(MCP_INTERNAL_SCOPE),
      authorizedJev: scopes.has(MCP_INTERNAL_SCOPE) || scopes.has(MCP_JEV_SCOPE),
      authInfo,
      principal: `${String(authInfo.extra?.client_id ?? authInfo.clientId)}:${authInfo.clientId}`,
    };
  }
  return json(
    { error: { code: "unauthorized", message: "A valid API key is required" } },
    401,
    { "www-authenticate": "Bearer" }
  );
}

function discoveryResponse(path: string, method: string, origin: string, openApiSpecification: string): Response | undefined {
  let response: Response | undefined;
  if (path === "/") response = landingResponse(origin);
  else if (path === "/docs" || path === "/docs/") response = documentationResponse(origin);
  else if (path === "/openapi/v1.yaml") response = openApiResponse(openApiSpecification);
  if (!response) return undefined;
  if (method === "GET") return response;
  return new Response(JSON.stringify({ error: { code: "method_not_allowed", message: "method not allowed" } }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "GET" },
  });
}

async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  const rateLimited = await rateLimitMcpRequest(request, env);
  if (rateLimited) return rateLimited;
  if (!env.MCP_ALLOWED_HOSTNAMES) {
    return json({ error: { code: "not_configured", message: "MCP allowed hostnames are required" } }, 503);
  }

  const authentication = await authenticateMcpRequest(request, env);
  if (authentication instanceof Response) return authentication;
  const allowedHostnames = env.MCP_ALLOWED_HOSTNAMES.split(",").map(value => value.trim()).filter(Boolean);
  const rejected = hostHeaderValidationResponse(request, allowedHostnames)
    ?? originValidationResponse(request, allowedHostnames.map(hostname => `https://${hostname}`));
  if (rejected) return rejected;

  if (authentication.principal) {
    const limited = await rateLimitMcpPrincipal(env, authentication.principal);
    if (limited) return limited;
  }

  const client = env.JEV_OPENROUTER_API_KEY ? new OpenRouterJevClient({
    apiKey: env.JEV_OPENROUTER_API_KEY,
    model: env.JEV_MODEL,
    timeoutMs: Number(env.JEV_TIMEOUT_MS),
  }) : undefined;
  const mcp = createBudokonMcpHandler({
    catalog, draw, eventDraw,
    authorizeInternal: () => authentication.authorizedInternal,
    authorizeJev: () => authentication.authorizedJev,
    semanticSearch: client ? new SemanticJudokaSearchService(client, { minimumRelevance: configuredProbability(env.JEV_MINIMUM_RELEVANCE, 0.5) }) : undefined,
    editorialReview: client ? new EditorialReviewService(client, configuredProbability(env.JEV_EDITORIAL_THRESHOLD, 0.8)) : undefined,
    playstyleClassification: client ? new PlaystyleClassificationService(client, configuredProbability(env.JEV_PLAYSTYLE_THRESHOLD, 0.78)) : undefined,
    queryInterpreter: client ? new JevJudokaQueryInterpreter(client, { minimumConfidence: configuredProbability(env.JEV_QUERY_MINIMUM_CONFIDENCE, 0.7) }) : undefined,
  });
  return mcp.fetch(request, authentication.authInfo ? { authInfo: authentication.authInfo } : undefined);
}

async function handleRestRequest(
  request: Request,
  env: Env,
  cacheOption: EdgeCacheStorage | null | undefined,
): Promise<Response> {
  // Catalogue reads and draws are public; hidden records still require INTERNAL_API_KEY.
  // Keep a stable metadata object so cachePublicGet observes the value reported
  // while the awaited REST request is being routed.
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

export function createWorker(openApiSpecification: string, options: { cache?: EdgeCacheStorage | null } = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.startsWith("/.well-known/oauth-")) {
        const oauthDiscovery = oauthDiscoveryResponse(request, mcpOAuthConfig(env));
        if (oauthDiscovery) return oauthDiscovery;
      }
      const discovery = discoveryResponse(path, request.method, url.origin, openApiSpecification);
      if (discovery) return discovery;
      if (request.method === "OPTIONS") {
        return path.startsWith("/v1/")
          ? preflightResponse(request, env)
          : new Response(null, { status: 405, headers: { allow: "POST" } });
      }

      const response = path === "/mcp"
        ? await handleMcpRequest(request, env)
        : await handleRestRequest(request, env, options.cache);
      return path.startsWith("/v1/") ? withCors(response, request, env) : response;
    }
  };
}
