import { hostHeaderValidationResponse, originValidationResponse, type AuthInfo } from "@modelcontextprotocol/server";
import { createBudokonMcpHandler } from "../src/mcp/server.js";
import { EditorialReviewService } from "../src/jev/editorial-review.js";
import { PlaystyleClassificationService } from "../src/jev/playstyle-classification.js";
import { OpenRouterJevClient } from "../src/jev/client.js";
import { SemanticJudokaSearchService } from "../src/jev/semantic-search.js";
import { JevJudokaQueryInterpreter } from "../src/jev/query-interpreter.js";
import { MCP_INTERNAL_SCOPE, MCP_JEV_SCOPE, authenticateOAuthBearer, oauthDiscoveryResponse, type McpOAuthConfig } from "./oauth.js";
import { authorized, distinctInternalApiKey } from "./auth.js";
import { rateLimitMcpPrincipal, rateLimitMcpRequest } from "./rate-limit.js";
import { catalog, draw, eventDraw } from "./application.js";
import type { Env } from "./env.js";

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

export function mcpOAuthDiscovery(request: Request, env: Env): Response | undefined {
  return oauthDiscoveryResponse(request, mcpOAuthConfig(env));
}

export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
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
