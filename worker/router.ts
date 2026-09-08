import dataset from "../dist/budokon.json" with { type: "json" };
import manifest from "../dist/manifest.json" with { type: "json" };
import { CatalogService } from "../src/domain/catalog-service.js";
import { DrawService } from "../src/draw/draw-service.js";
import { EventDrawService } from "../src/draw/event-draw-service.js";
import { createRestRouter } from "../src/api/router.js";
import { createBudokonMcpHandler } from "../src/mcp/server.js";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.js";
import { authorized } from "./auth.js";
import { cachePublicGet, preflightResponse, withCors } from "./cors.js";
import { rateLimitMcpRequest, rateLimitPublicRequest } from "./rate-limit.js";
import { documentationResponse, landingResponse, openApiResponse } from "./discovery.js";
import { hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";

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
}

const repository = new JsonReadModelRepository({ ...dataset, manifest });
const catalog = new CatalogService(repository);
const draw = new DrawService(catalog);
const eventDraw = new EventDrawService(repository);

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}


export function createWorker(openApiSpecification: string) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const path = new URL(request.url).pathname;
      const origin = new URL(request.url).origin;
      if (path === "/") return landingResponse(origin);
      if (path === "/docs" || path === "/docs/") return documentationResponse();
      if (path === "/openapi/v1.yaml") return openApiResponse(openApiSpecification);
      if (request.method === "OPTIONS") return path.startsWith("/v1/") ? preflightResponse(request, env) : new Response(null, { status: 405, headers: { allow: "POST" } });
      let response: Response;
      if (path === "/mcp") {
        const rateLimited = await rateLimitMcpRequest(request, env);
        if (rateLimited) return rateLimited;
        if (!env.MCP_ALLOWED_HOSTNAMES) return json({ error: { code: "not_configured", message: "MCP allowed hostnames are required" } }, 503);
        if (!authorized(request, env.API_KEY)) return json({ error: { code: "unauthorized", message: "A valid API key is required" } }, 401, { "www-authenticate": "Bearer" });
        const allowedHostnames = env.MCP_ALLOWED_HOSTNAMES.split(",").map(value => value.trim()).filter(Boolean);
        const rejected = hostHeaderValidationResponse(request, allowedHostnames)
          ?? originValidationResponse(request, allowedHostnames.map(hostname => `https://${hostname}`));
        const mcp = createBudokonMcpHandler({ catalog, draw, eventDraw, authorizeInternal: candidate => authorized(candidate, env.INTERNAL_API_KEY) });
        response = rejected ?? await mcp.fetch(request);
      } else {
        // Catalogue reads and draws are public; hidden records still require INTERNAL_API_KEY.
        response = await rateLimitPublicRequest(request, env) ?? cachePublicGet(
          await createRestRouter({ catalog, draw, eventDraw }, { authorizeInternal: candidate => authorized(candidate, env.INTERNAL_API_KEY) })(request),
          request,
          catalog.version().datasetVersion
        );
      }
      return path.startsWith("/v1/") ? withCors(response, request, env) : response;
    }
  };
}
