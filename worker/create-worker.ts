import { documentationResponse, landingResponse, openApiResponse } from "./discovery.js";
import { preflightResponse, withCors } from "./cors.js";
import { handleMcpRequest, mcpOAuthDiscovery } from "./mcp-route.js";
import { handleRestRequest } from "./rest-route.js";
import type { EdgeCacheStorage } from "./edge-cache-types.js";
import type { Env } from "./env.js";

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

export function createWorker(openApiSpecification: string, options: { cache?: EdgeCacheStorage | null } = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path.startsWith("/.well-known/oauth-")) {
        const oauthDiscovery = mcpOAuthDiscovery(request, env);
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
