import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawService } from "../draw/draw-service.js";
import type { EventDrawService } from "../draw/event-draw-service.js";
import { createMcpTools } from "./tools.js";

const stringOrStrings = z.union([z.string(), z.array(z.string()).min(1)]);
const filters = z.object({
  countryCode: stringOrStrings.optional(), gender: stringOrStrings.optional(), weightClass: stringOrStrings.optional(),
  rarity: stringOrStrings.optional(), personType: stringOrStrings.optional(), signatureMoveIds: stringOrStrings.optional(),
}).strict();
const searchInput = z.object({ query: z.string().optional(), q: z.string().optional(), filters: filters.optional(), exclude: z.array(z.string()).optional(), includeHidden: z.boolean().optional() }).strict();
const drawInput = z.object({ count: z.number().int().positive().optional(), seed: z.string().optional(), algorithm: z.string().optional(), filters: filters.optional(), exclude: z.array(z.string()).optional(), includeHidden: z.boolean().optional() }).strict();
const idInput = z.object({ id: z.string().min(1), includeHidden: z.boolean().optional() }).strict();
const listEventsInput = z.object({ ruleset: z.string().optional(), category: z.string().optional() }).strict();
const drawEventInput = z.object({ ruleset: z.string().min(1), category: z.string().optional(), seed: z.string().optional(), exclude: z.array(z.string()).optional() }).strict();

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

/**
 * Builds a stateless, Streamable HTTP MCP endpoint over Budokon's existing
 * application services. Authentication and Host/Origin validation stay in the
 * Worker boundary, before this handler receives a request.
 */
export function createBudokonMcpHandler(dependencies: { catalog: CatalogService; draw: DrawService; eventDraw: EventDrawService; authorizeInternal(request: Request): boolean }) {
  return createMcpHandler(({ requestInfo }) => {
    const tools = createMcpTools(dependencies);
    const context = { authorizedInternal: requestInfo ? dependencies.authorizeInternal(requestInfo) : false };
    const server = new McpServer({ name: "budokon", version: "0.1.0" });
    const register = (name: string, description: string, inputSchema: z.ZodType, call: (input: never) => unknown) => {
      server.registerTool(name, { description, inputSchema }, async input => {
        try { return textResult(await call(input as never)); }
        catch (error) { return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Tool execution failed" }], isError: true }; }
      });
    };

    register("get_judoka", "Get one judoka by immutable ID or slug.", idInput, input => tools.get_judoka(input as Parameters<typeof tools.get_judoka>[0], context));
    register("search_judoka", "Search and filter judoka.", searchInput, input => tools.search_judoka(input as Parameters<typeof tools.search_judoka>[0], context));
    register("draw_judoka", "Draw one or more judoka, optionally deterministically with a seed.", drawInput, input => tools.draw_judoka(input as Parameters<typeof tools.draw_judoka>[0], context));
    register("list_techniques", "List all techniques.", z.object({}).strict(), () => tools.list_techniques());
    register("get_technique", "Get one technique by ID.", z.object({ id: z.string().min(1) }).strict(), input => tools.get_technique(input as Parameters<typeof tools.get_technique>[0]));
    register("list_events", "List ruleset-scoped gameplay events.", listEventsInput, input => tools.list_events(input as Parameters<typeof tools.list_events>[0]));
    register("get_event", "Get one gameplay event by ID.", z.object({ id: z.string().min(1) }).strict(), input => tools.get_event(input as Parameters<typeof tools.get_event>[0]));
    register("draw_event", "Draw one event for a required game ruleset, optionally deterministically with a seed.", drawEventInput, input => tools.draw_event(input as Parameters<typeof tools.draw_event>[0]));
    register("version", "Get dataset and draw-algorithm versions.", z.object({}).strict(), () => tools.version());
    return server;
  }, { legacy: "stateless" });
}
