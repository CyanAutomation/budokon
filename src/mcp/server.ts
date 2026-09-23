import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawService } from "../draw/draw-service.js";
import type { EventDrawService } from "../draw/event-draw-service.js";
import { createMcpTools } from "./tools.js";
import type { EditorialReviewer } from "../jev/editorial-review.js";
import type { SemanticJudokaSearcher } from "../jev/semantic-search.js";
import type { JudokaQueryInterpreter } from "../jev/query-interpreter.js";

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
const semanticSearchInput = z.object({ query: z.string().min(1).max(1_000), filters: filters.optional(), exclude: z.array(z.string()).optional(), includeHidden: z.boolean().optional(), maxCandidates: z.number().int().min(1).max(20).optional() }).strict();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const canonicalJudoka = z.object({
  id: z.string().uuid(), slug, firstname: z.string().min(1).max(200), surname: z.string().min(1).max(200),
  personType: z.enum(["real", "fictional"]), countryCode: z.string().regex(/^[A-Z]{2}$/u),
  weightClass: z.string().regex(/^[+-][0-9]{2,3}$/u), category: z.literal("Judo"),
  stats: z.object({ power: z.number().int().min(0).max(10), speed: z.number().int().min(0).max(10), technique: z.number().int().min(0).max(10), kumikata: z.number().int().min(0).max(10), newaza: z.number().int().min(0).max(10) }).strict(),
  aliases: z.array(z.string().min(1).max(200)).max(20).refine(values => new Set(values).size === values.length).optional(),
  legacySlugs: z.array(slug).max(20).refine(values => new Set(values).size === values.length).optional(),
  signatureMoveIds: z.array(slug).min(1).max(20).refine(values => new Set(values).size === values.length), lastUpdated: z.string().datetime(),
  profileUrl: z.string().url().max(2_048).refine(value => value.startsWith("https://")),
  sourceUrls: z.array(z.string().url().max(2_048).refine(value => value.startsWith("https://"))).min(1).max(20).refine(values => new Set(values).size === values.length).optional(),
  sources: z.array(z.object({
    url: z.string().url().max(2_048).refine(value => value.startsWith("https://")),
    publisher: z.string().min(1).max(200).optional(),
    claims: z.array(z.enum(["identity", "nationality", "weightClass", "biography", "competitionHistory"])).min(1).max(5),
    checkedAt: z.string().datetime(),
  }).strict()).max(20).optional(),
  bio: z.string().min(20).max(8_000), gender: z.enum(["male", "female"]), isHidden: z.boolean(),
  rarity: z.enum(["Common", "Rare", "Epic", "Legendary"]),
}).strict().superRefine((record, context) => {
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 16_000) {
    context.addIssue({ code: "custom", message: "record exceeds the 16 KB JEV review input limit" });
  }
});
export const editorialReviewInputSchema = z.object({
  record: canonicalJudoka,
  evidence: z.array(z.object({ url: z.string().url().max(2_048).refine(value => value.startsWith("https://")), excerpt: z.string().min(1).max(4_000) }).strict()).max(10),
  duplicateCandidates: z.array(canonicalJudoka).max(10).optional(),
}).strict().superRefine((input, context) => {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 64_000) {
    context.addIssue({ code: "custom", message: "review input exceeds the 64 KB JEV request limit" });
  }
});
const interpretJudokaQueryInput = z.object({ query: z.string().trim().min(1).max(1_000) }).strict();

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

/**
 * Builds a stateless, Streamable HTTP MCP endpoint over Budokon's existing
 * application services. Authentication and Host/Origin validation stay in the
 * Worker boundary, before this handler receives a request.
 */
export function createBudokonMcpHandler(dependencies: { catalog: CatalogService; draw: DrawService; eventDraw: EventDrawService; authorizeInternal(request: Request): boolean; semanticSearch?: SemanticJudokaSearcher; editorialReview?: EditorialReviewer; queryInterpreter?: JudokaQueryInterpreter }) {
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
    if (context.authorizedInternal && dependencies.semanticSearch) {
      register("semantic_search_judoka", "Rank a bounded, filter-narrowed judoka candidate pool by semantic relevance. This does not change deterministic catalogue search.", semanticSearchInput, input => tools.semantic_search_judoka(input as Parameters<typeof tools.semantic_search_judoka>[0], context));
    }
    if (context.authorizedInternal && dependencies.editorialReview) {
      register("review_proposed_judoka", "Review a proposed canonical judoka record against supplied source excerpts. It always requires human approval and never changes catalogue data.", editorialReviewInputSchema, input => tools.review_proposed_judoka(input as Parameters<typeof tools.review_proposed_judoka>[0], context));
    }
    if (context.authorizedInternal && dependencies.queryInterpreter) {
      register("interpret_judoka_query", "Suggest existing catalogue filters from a natural-language judoka query. Low-confidence suggestions are returned but not applied.", interpretJudokaQueryInput, input => tools.interpret_judoka_query(input as Parameters<typeof tools.interpret_judoka_query>[0], context));
    }
    return server;
  }, { legacy: "stateless" });
}
