import dataset from "../dist/budokon.json" with { type: "json" };
import manifest from "../dist/manifest.json" with { type: "json" };
import { CatalogService } from "../src/domain/catalog-service.js";
import { DrawService } from "../src/draw/draw-service.js";
import { createRestRouter } from "../src/api/router.js";
import { createMcpTools } from "../src/mcp/tools.js";
import { JsonReadModelRepository } from "../src/repository/json-read-model-repository.js";
import { authorized } from "./auth.js";
import { cachePublicGet, preflightResponse, withCors } from "./cors.js";
import { rateLimitPublicRequest } from "./rate-limit.js";
import { documentationResponse, landingResponse, openApiResponse } from "./discovery.js";
import openApiSpecification from "../openapi/v1.yaml" with { type: "text" };

interface Env {
  API_KEY: string;
  /** Optional elevated credential which alone may access hidden records. */
  INTERNAL_API_KEY?: string;
  /** Comma-separated browser origins permitted to read the public REST API. */
  PUBLIC_ALLOWED_ORIGINS?: string;
  PUBLIC_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

type JsonObject = Record<string, unknown>;
type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: JsonObject };

const repository = new JsonReadModelRepository({ ...dataset, manifest });
const catalog = new CatalogService(repository);
const draw = new DrawService(catalog);
const tools = createMcpTools({ catalog, draw });

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function mcpError(id: RpcRequest["id"], code: number, message: string) {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

const toolDefinitions = [
  ["get_judoka", "Get one judoka by immutable ID or slug.", { type: "object", properties: { id: { type: "string" }, includeHidden: { type: "boolean" } }, required: ["id"] }],
  ["search_judoka", "Search and filter judoka.", { type: "object", properties: { query: { type: "string" }, q: { type: "string" }, filters: { type: "object" }, exclude: { type: "array", items: { type: "string" } }, includeHidden: { type: "boolean" } } }],
  ["draw_judoka", "Draw one or more judoka, optionally deterministically with a seed.", { type: "object", properties: { count: { type: "integer", minimum: 1 }, seed: { type: "string" }, algorithm: { type: "string" }, filters: { type: "object" }, exclude: { type: "array", items: { type: "string" } }, includeHidden: { type: "boolean" } } }],
  ["list_techniques", "List all techniques.", { type: "object", properties: {} }],
  ["get_technique", "Get one technique by ID.", { type: "object", properties: { id: { type: "string" } }, required: ["id"] }],
  ["version", "Get dataset and draw-algorithm versions.", { type: "object", properties: {} }]
] as const;

async function handleMcp(request: Request, env: Env) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let rpc: RpcRequest;
  try { rpc = await request.json() as RpcRequest; } catch { return mcpError(null, -32700, "Parse error"); }
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return mcpError(rpc.id, -32600, "Invalid Request");
  if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (rpc.method === "initialize") return json({ jsonrpc: "2.0", id: rpc.id ?? null, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "budokon", version: "0.1.0" } } });
  if (rpc.method === "tools/list") return json({ jsonrpc: "2.0", id: rpc.id ?? null, result: { tools: toolDefinitions.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) } });
  if (rpc.method !== "tools/call" || typeof rpc.params?.name !== "string") return mcpError(rpc.id, -32601, "Method not found");
  const fn = tools[rpc.params.name as keyof typeof tools] as ((input?: never, context?: { authorizedInternal?: boolean }) => unknown) | undefined;
  if (!fn) return json({ jsonrpc: "2.0", id: rpc.id ?? null, result: { content: [{ type: "text", text: `Unknown tool: ${rpc.params.name}` }], isError: true } });
  try {
    const result = await fn((rpc.params.arguments ?? {}) as never, { authorizedInternal: authorized(request, env.INTERNAL_API_KEY) });
    return json({ jsonrpc: "2.0", id: rpc.id ?? null, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
  } catch (error) {
    return json({ jsonrpc: "2.0", id: rpc.id ?? null, result: { content: [{ type: "text", text: error instanceof Error ? error.message : "Tool execution failed" }], isError: true } });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const origin = new URL(request.url).origin;
    if (path === "/") return landingResponse(origin);
    if (path === "/docs") return documentationResponse(origin);
    if (path === "/openapi/v1.yaml") return openApiResponse(openApiSpecification);
    if (request.method === "OPTIONS") return path.startsWith("/v1/") ? preflightResponse(request, env) : new Response(null, { status: 405, headers: { allow: "POST" } });
    let response: Response;
    if (path === "/mcp") {
      response = authorized(request, env.API_KEY)
        ? await handleMcp(request, env)
        : json({ error: { code: "unauthorized", message: "A valid API key is required" } }, 401, { "www-authenticate": "Bearer" });
    } else {
      // Catalogue reads and draws are public; hidden records still require INTERNAL_API_KEY.
      response = await rateLimitPublicRequest(request, env) ?? cachePublicGet(
        await createRestRouter({ catalog, draw }, { authorizeInternal: candidate => authorized(candidate, env.INTERNAL_API_KEY) })(request),
        request,
        catalog.version().datasetVersion
      );
    }
    return path.startsWith("/v1/") ? withCors(response, request, env) : response;
  }
};
