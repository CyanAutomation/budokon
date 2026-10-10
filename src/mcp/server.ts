import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawService } from "../draw/draw-service.js";
import type { EventDrawService } from "../draw/event-draw-service.js";
import { createMcpTools } from "./tools.js";
import { MAX_EDITORIAL_REVIEW_BATCH_SIZE, type EditorialReviewer } from "../jev/editorial-review-contracts.js";
import { PLAYSTYLE_OPTIONS } from "../domain/playstyle.js";
import type { PlaystyleClassifier } from "../jev/playstyle-classification-contracts.js";
import { MAX_PLAYSTYLE_EVIDENCE_ITEMS } from "../jev/playstyle-classification-contracts.js";
import type { SemanticJudokaSearcher } from "../jev/semantic-search.js";
import { MAX_SEMANTIC_SEARCH_CANDIDATES } from "../jev/semantic-search.js";
import type { JudokaQueryInterpreter } from "../jev/query-interpreter.js";
import { SUPPORTED_DRAW_ALGORITHMS } from "../draw/draw-service.js";

const MAX_MCP_PAGE_SIZE = 50;
const MAX_MCP_DRAW_COUNT = 10;

const stringOrStrings = z.union([z.string(), z.array(z.string()).min(1)]);
const filters = z.object({
  countryCode: stringOrStrings.optional(), gender: stringOrStrings.optional(), weightClass: stringOrStrings.optional(),
  rarity: stringOrStrings.optional(), personType: stringOrStrings.optional(), signatureMoveIds: stringOrStrings.optional(),
}).strict();
const pageFields = {
  limit: z.number().int().min(1).max(MAX_MCP_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
};
function validatePage(input: { limit?: number; cursor?: string }, context: z.RefinementCtx) {
  if (input.cursor !== undefined && input.limit === undefined) {
    context.addIssue({ code: "custom", path: ["cursor"], message: "cursor requires limit" });
  }
}
function searchAliases(input: { query?: string; q?: string }, context: z.RefinementCtx) {
  if (input.query !== undefined && input.q !== undefined) {
    context.addIssue({ code: "custom", path: ["q"], message: "use query or q, not both" });
  }
}

const searchFields = {
  query: z.string().max(1_000).optional(),
  q: z.string().max(1_000).optional(),
  filters: filters.optional(),
  exclude: z.array(z.string()).optional(),
  ...pageFields,
};
const searchInput = z.object(searchFields).strict().superRefine((input, context) => {
  searchAliases(input, context);
  validatePage(input, context);
});
const internalSearchInput = z.object({ ...searchFields, includeHidden: z.boolean().optional() }).strict().superRefine((input, context) => {
  searchAliases(input, context);
  validatePage(input, context);
});
const drawFields = {
  count: z.number().int().min(1).max(MAX_MCP_DRAW_COUNT).optional(), seed: z.string().optional(), algorithm: z.enum(SUPPORTED_DRAW_ALGORITHMS).optional(),
  filters: filters.optional(), exclude: z.array(z.string()).optional(),
};
const drawInput = z.object(drawFields).strict();
const internalDrawInput = z.object({ ...drawFields, includeHidden: z.boolean().optional() }).strict();
const idInput = z.object({ id: z.string().min(1) }).strict();
const internalIdInput = z.object({ id: z.string().min(1), includeHidden: z.boolean().optional() }).strict();
const listEventsInput = z.object({ ruleset: z.string().optional(), category: z.string().optional(), ...pageFields }).strict().superRefine(validatePage);
const drawEventInput = z.object({ ruleset: z.string().min(1), category: z.string().optional(), seed: z.string().optional(), exclude: z.array(z.string()).optional() }).strict();
const listTechniquesInput = z.object(pageFields).strict().superRefine(validatePage);
const searchTechniquesInput = z.object({
  query: z.string().max(1_000).optional(),
  category: stringOrStrings.optional(),
  subCategory: stringOrStrings.optional(),
  ...pageFields,
}).strict().superRefine(validatePage);

export const semanticSearchInputSchema = z.object({ query: z.string().min(1).max(1_000), filters: filters.optional(), exclude: z.array(z.string()).optional(), includeHidden: z.boolean().optional(), maxCandidates: z.number().int().min(1).max(MAX_SEMANTIC_SEARCH_CANDIDATES).optional() }).strict();
const publicSemanticSearchInputSchema = z.object({ query: z.string().min(1).max(1_000), filters: filters.optional(), exclude: z.array(z.string()).optional(), maxCandidates: z.number().int().min(1).max(MAX_SEMANTIC_SEARCH_CANDIDATES).optional() }).strict();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const approvedPlaystyleSchema = z.object({
  tacticalStyle: z.enum(["pressure", "counter", "balanced"]).optional(),
  tempo: z.enum(["patient", "balanced", "aggressive"]).optional(),
  gripStyle: z.enum(["dominant", "adaptive", "defensive", "mixed"]).optional(),
  newazaEmphasis: z.enum(["low", "medium", "high"]).optional(),
  standingPreference: z.enum(["ashi_waza", "te_waza", "koshi_waza", "ma_sutemi_waza", "yoko_sutemi_waza", "mixed"]).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "playstyle must contain at least one approved facet");
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
  playstyle: approvedPlaystyleSchema.optional(),
}).strict().superRefine((record, context) => {
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 16_000) {
    context.addIssue({ code: "custom", message: "record exceeds the 16 KB JEV review input limit" });
  }
});
const editorialReviewProposalSchema = z.object({
  record: canonicalJudoka,
  evidence: z.array(z.object({ url: z.string().url().max(2_048).refine(value => value.startsWith("https://")), excerpt: z.string().min(1).max(4_000) }).strict()).max(10),
  duplicateCandidates: z.array(canonicalJudoka).max(10).optional(),
}).strict();
export const editorialReviewInputSchema = editorialReviewProposalSchema.superRefine((input, context) => {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 64_000) {
    context.addIssue({ code: "custom", message: "review input exceeds the 64 KB JEV request limit" });
  }
});
export const editorialReviewBatchInputSchema = z.object({ proposals: z.array(editorialReviewProposalSchema).min(1).max(MAX_EDITORIAL_REVIEW_BATCH_SIZE) }).strict().superRefine((input, context) => {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 64_000) {
    context.addIssue({ code: "custom", message: "review batch exceeds the 64 KB JEV request limit" });
  }
});
const playstyleEvidenceSchema = z.object({
  url: z.string().url().max(2_048).refine(value => value.startsWith("https://")),
  excerpt: z.string().trim().min(1).max(4_000),
}).strict();
export const playstyleClassificationInputSchema = z.object({
  judokaId: z.string().trim().min(1).max(200),
  evidence: z.array(playstyleEvidenceSchema).max(MAX_PLAYSTYLE_EVIDENCE_ITEMS).optional(),
}).strict().superRefine((input, context) => {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 64_000) {
    context.addIssue({ code: "custom", message: "playstyle input exceeds the 64 KB JEV request limit" });
  }
});
const interpretJudokaQueryInput = z.object({ query: z.string().trim().min(1).max(1_000) }).strict();

export const judokaOutputSchema = z.object({
  id: z.string().uuid(), slug, firstname: z.string().min(1).max(200), surname: z.string().min(1).max(200),
  personType: z.enum(["real", "fictional"]), countryCode: z.string().regex(/^[A-Z]{2}$/u), country: z.string().optional(),
  gender: z.enum(["male", "female"]), weightClass: z.string().regex(/^[+-][0-9]{2,3}$/u),
  rarity: z.enum(["Common", "Rare", "Epic", "Legendary"]), category: z.literal("Judo"),
  stats: z.object({ power: z.number().int().min(0).max(10), speed: z.number().int().min(0).max(10), technique: z.number().int().min(0).max(10), kumikata: z.number().int().min(0).max(10), newaza: z.number().int().min(0).max(10) }).strict(),
  signatureMoveIds: z.array(slug).min(1).max(20),
  aliases: z.array(z.string().min(1).max(200)).max(20).optional(),
  legacySlugs: z.array(slug).max(20).optional(),
  sourceUrls: z.array(z.string().url().max(2_048).refine(value => value.startsWith("https://"))).max(20).optional(),
  sources: z.array(z.object({
    url: z.string().url().max(2_048).refine(value => value.startsWith("https://")),
    publisher: z.string().min(1).max(200).optional(),
    claims: z.array(z.enum(["identity", "nationality", "weightClass", "biography", "competitionHistory"])).min(1).max(5),
    checkedAt: z.string().datetime(),
  }).strict()).max(20).optional(),
  playstyle: approvedPlaystyleSchema.optional(),
  lastUpdated: z.string().datetime(),
  profileUrl: z.string().url().max(2_048).refine(value => value.startsWith("https://")),
  bio: z.string().min(20).max(8_000), isHidden: z.boolean(),
}).strict();
const judokaSummaryOutputSchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), personType: z.string().optional(),
  countryCode: z.string().optional(), gender: z.string().optional(), weightClass: z.string().optional(),
  rarity: z.string().optional(), signatureMoveIds: z.array(z.string()),
}).strict();
const techniqueSummaryOutputSchema = z.object({
  id: z.string(), name: z.string(), japanese: z.string(), style: z.string(),
  category: z.string(), subCategory: z.string(),
}).strict();
export const techniqueOutputSchema = z.object({
  id: z.string(), name: z.string(), japanese: z.string(), style: z.string(), category: z.string(),
  subCategory: z.string(), description: z.string(), link: z.string().url(),
}).strict();
const eventEffectOutputSchema = z.object({
  action: z.enum(["modify", "set"]),
  target: z.enum(["power", "speed", "technique", "kumikata", "newaza", "shido", "waza_ari", "score", "match_result"]),
  value: z.union([z.number().int(), z.string()]),
}).strict();
const eventOutputSchema = z.object({
  id: z.string(), ruleset: z.string(), category: z.string(), description: z.string(), effects: z.array(eventEffectOutputSchema),
}).strict();
const countryOutputSchema = z.object({ country: z.string(), code: z.string(), lastUpdated: z.string(), active: z.boolean() }).strict();
const weightCategoriesOutputSchema = z.array(z.object({
  gender: z.enum(["male", "female"]), description: z.string(),
  categories: z.array(z.object({ weight: z.string(), descriptor: z.string() }).strict()),
}).strict());
const usageOutputSchema = z.record(z.string(), z.unknown());
const versionOutputSchema = z.object({
  datasetVersion: z.string(), serviceVersion: z.string(), sourceGitCommit: z.string(), datasetChecksum: z.string(),
  drawAlgorithms: z.array(z.string()), defaultDrawAlgorithm: z.string(),
}).strict();
const publicCoverageOutputSchema = z.object({
  publicReal: z.number().int(), byGender: z.record(z.string(), z.number().int()),
  byCountry: z.record(z.string(), z.number().int()), byWeightClass: z.record(z.string(), z.number().int()),
  byRarity: z.record(z.string(), z.number().int()), rarityPercentages: z.record(z.string(), z.number()),
}).strict();
const judokaListOutputSchema = z.object({ datasetVersion: z.string(), judoka: z.array(judokaSummaryOutputSchema), nextCursor: z.string().optional() }).strict();
const techniqueListOutputSchema = z.object({ datasetVersion: z.string(), techniques: z.array(techniqueSummaryOutputSchema), nextCursor: z.string().optional() }).strict();
const eventListOutputSchema = z.object({ datasetVersion: z.string(), events: z.array(eventOutputSchema), nextCursor: z.string().optional() }).strict();
const getJudokaOutputSchema = z.object({ datasetVersion: z.string(), judoka: judokaOutputSchema.nullable() }).strict();
const getTechniqueOutputSchema = z.object({ datasetVersion: z.string(), technique: techniqueOutputSchema.nullable() }).strict();
const getEventOutputSchema = z.object({ datasetVersion: z.string(), event: eventOutputSchema.nullable() }).strict();
const judokaDrawOutputSchema = z.object({ datasetVersion: z.string(), algorithm: z.string(), seed: z.string().optional(), poolSize: z.number().int(), judoka: z.array(judokaOutputSchema) }).strict();
const eventDrawOutputSchema = z.object({ datasetVersion: z.string(), algorithm: z.string(), seed: z.string().optional(), poolSize: z.number().int(), event: eventOutputSchema }).strict();
const countryListOutputSchema = z.object({ datasetVersion: z.string(), countries: z.record(z.string(), countryOutputSchema) }).strict();
const weightCategoryListOutputSchema = z.object({ datasetVersion: z.string(), weightCategories: weightCategoriesOutputSchema }).strict();
const jevAnswerOutputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number() }).strict(),
  z.object({ type: z.literal("choice"), choice: z.string(), probabilities: z.record(z.string(), z.number()), confidence: z.number() }).strict(),
  z.object({ type: z.literal("score"), score: z.number(), legend: z.record(z.string(), z.string()), probabilities: z.record(z.string(), z.number()), confidence: z.number() }).strict(),
]);
const reviewItemOutputSchema = z.object({
  answers: z.record(z.string(), jevAnswerOutputSchema),
  recommendation: z.enum(["ready_for_human_approval", "needs_revision", "needs_human_review"]),
  requiresHumanApproval: z.literal(true),
}).strict();
const semanticSearchOutputSchema = z.object({
  model: z.string(), usage: usageOutputSchema,
  results: z.array(z.object({ judoka: judokaSummaryOutputSchema, relevance: z.number() }).strict()),
}).strict();
const reviewOutputSchema = z.object({ model: z.string(), usage: usageOutputSchema, ...reviewItemOutputSchema.shape }).strict();
const reviewBatchOutputSchema = z.object({ model: z.string(), usage: usageOutputSchema, reviews: z.array(reviewItemOutputSchema) }).strict();
const queryInterpretationOutputSchema = z.object({
  model: z.string(), usage: usageOutputSchema, filters: filters,
  suggestions: z.record(z.string(), z.object({ value: z.string(), confidence: z.number(), applied: z.boolean() }).strict()),
}).strict();
const playstyleClassificationOutputSchema = z.object({
  datasetVersion: z.string(), model: z.string(), usage: usageOutputSchema,
  judokaId: z.string(), judokaSlug: z.string(), confidenceThreshold: z.number().min(0).max(1),
  requiresHumanApproval: z.literal(true),
  classification: z.object({
    tacticalStyle: z.object({ proposed: z.enum(PLAYSTYLE_OPTIONS.tacticalStyle), confidence: z.number().min(0).max(1), policyAccepted: z.enum(["pressure", "counter", "balanced"]).nullable() }).strict(),
    tempo: z.object({ proposed: z.enum(PLAYSTYLE_OPTIONS.tempo), confidence: z.number().min(0).max(1), policyAccepted: z.enum(["patient", "balanced", "aggressive"]).nullable() }).strict(),
    gripStyle: z.object({ proposed: z.enum(PLAYSTYLE_OPTIONS.gripStyle), confidence: z.number().min(0).max(1), policyAccepted: z.enum(["dominant", "adaptive", "defensive", "mixed"]).nullable() }).strict(),
    newazaEmphasis: z.object({ proposed: z.enum(PLAYSTYLE_OPTIONS.newazaEmphasis), confidence: z.number().min(0).max(1), policyAccepted: z.enum(["low", "medium", "high"]).nullable() }).strict(),
    standingPreference: z.object({ proposed: z.enum(PLAYSTYLE_OPTIONS.standingPreference), confidence: z.number().min(0).max(1), policyAccepted: z.enum(["ashi_waza", "te_waza", "koshi_waza", "ma_sutemi_waza", "yoko_sutemi_waza", "mixed"]).nullable() }).strict(),
  }).strict(),
}).strict();

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

function compactJudoka(record: Record<string, unknown>) {
  const name = [record.firstname, record.surname].filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
  return {
    id: String(record.id),
    slug: String(record.slug),
    name: name || String(record.slug),
    ...(typeof record.personType === "string" ? { personType: record.personType } : {}),
    ...(typeof record.countryCode === "string" ? { countryCode: record.countryCode } : {}),
    ...(typeof record.gender === "string" ? { gender: record.gender } : {}),
    ...(typeof record.weightClass === "string" ? { weightClass: record.weightClass } : {}),
    ...(typeof record.rarity === "string" ? { rarity: record.rarity } : {}),
    signatureMoveIds: Array.isArray(record.signatureMoveIds) ? record.signatureMoveIds : [],
  };
}

function compactTechnique(record: Record<string, unknown>) {
  const { id, name, japanese, style, category, subCategory } = record;
  return { id, name, japanese, style, category, subCategory };
}

function compactJudokaPage(value: { datasetVersion: string; judoka: Record<string, unknown>[]; nextCursor?: string }) {
  return { ...value, judoka: value.judoka.map(compactJudoka) };
}

function compactTechniquePage(value: { datasetVersion: string; techniques: Record<string, unknown>[]; nextCursor?: string }) {
  return { ...value, techniques: value.techniques.map(compactTechnique) };
}

const localReadAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const externalReadAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

interface McpRequestContext {
  authorizedInternal: boolean;
  authorizedJev: boolean;
}

interface BudokonMcpDependencies {
  catalog: CatalogService;
  draw: DrawService;
  eventDraw: EventDrawService;
  authorizeInternal(request: Request): boolean;
  authorizeJev?(request: Request): boolean;
  semanticSearch?: SemanticJudokaSearcher;
  editorialReview?: EditorialReviewer;
  playstyleClassification?: PlaystyleClassifier;
  queryInterpreter?: JudokaQueryInterpreter;
}

type McpTools = ReturnType<typeof createMcpTools>;

function createToolRegistrar(server: McpServer) {
  return (name: string, title: string, description: string, inputSchema: z.ZodType, outputSchema: z.ZodType, call: (input: never) => unknown, annotations = localReadAnnotations) => {
    server.registerTool(name, { title, description, inputSchema, outputSchema, annotations }, async input => {
      try { return textResult(await call(input as never)); }
      catch (error) { return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Tool execution failed" }], isError: true }; }
    });
  };
}

type ToolRegistrar = ReturnType<typeof createToolRegistrar>;

function registerCatalogTools(register: ToolRegistrar, tools: McpTools, context: McpRequestContext): void {
  register("get_judoka", "Get judoka", "Get one public judoka by immutable ID, slug, legacy slug, or name alias.", context.authorizedInternal ? internalIdInput : idInput, getJudokaOutputSchema, input => tools.get_judoka(input as Parameters<typeof tools.get_judoka>[0], context));
  register("search_judoka", "Search judoka", "Search public judoka by name, slug, or alias and combine exact catalogue filters. Use query or its q alias, never both. Results are compact summaries, ordered deterministically, and limited to 50 per page; use get_judoka for a full record.", context.authorizedInternal ? internalSearchInput : searchInput, judokaListOutputSchema, input => compactJudokaPage(tools.search_judoka(input as Parameters<typeof tools.search_judoka>[0], context)));
  register("draw_judoka", "Draw judoka", "Draw up to 10 public judoka with optional filters and exclusions. A seed plus datasetVersion and algorithm makes the draw reproducible.", context.authorizedInternal ? internalDrawInput : drawInput, judokaDrawOutputSchema, input => tools.draw_judoka(input as Parameters<typeof tools.draw_judoka>[0], context));
  register("list_techniques", "List techniques", "List compact technique summaries in stable order, at most 50 per page. Continue with nextCursor; use get_technique for a full record.", listTechniquesInput, techniqueListOutputSchema, input => compactTechniquePage(tools.list_techniques(input as Parameters<typeof tools.list_techniques>[0])));
  register("search_techniques", "Search techniques", "Find techniques by name, Japanese name, ID, or description; category and subCategory filters use exact normalized matches. Returns compact summaries, at most 50 per page; use get_technique for full details.", searchTechniquesInput, techniqueListOutputSchema, input => compactTechniquePage(tools.search_techniques(input as Parameters<typeof tools.search_techniques>[0])));
  register("get_technique", "Get technique", "Get one technique by ID, including its Japanese name, classification, description, and reference link.", idInput, getTechniqueOutputSchema, input => tools.get_technique(input as Parameters<typeof tools.get_technique>[0]));
  register("list_events", "List events", "List events, optionally filtered by ruleset and category. The default page contains at most 50 records; continue with nextCursor and repeat the same limit and filters.", listEventsInput, eventListOutputSchema, input => tools.list_events(input as Parameters<typeof tools.list_events>[0]));
  register("get_event", "Get event", "Get one gameplay event by ID with its typed effects.", idInput, getEventOutputSchema, input => tools.get_event(input as Parameters<typeof tools.get_event>[0]));
  register("draw_event", "Draw event", "Draw one event for a required ruleset and optional category. A seed and dataset version make the draw reproducible.", drawEventInput, eventDrawOutputSchema, input => tools.draw_event(input as Parameters<typeof tools.draw_event>[0]));
  register("list_countries", "List countries", "List supported countries and their active status for catalogue filters.", z.object({}).strict(), countryListOutputSchema, () => tools.list_countries());
  register("list_weight_categories", "List weight categories", "List supported senior weight categories by gender for catalogue filters.", z.object({}).strict(), weightCategoryListOutputSchema, () => tools.list_weight_categories());
  register("get_public_coverage", "Get public coverage", "Get catalogue coverage for public real judoka; this response contains no hidden-record totals.", z.object({}).strict(), z.object({ datasetVersion: z.string(), ...publicCoverageOutputSchema.shape }).strict(), () => tools.get_public_coverage());
  register("version", "Get version", "Get dataset, service, and draw-algorithm versions.", z.object({}).strict(), versionOutputSchema, () => tools.version());
}

function registerJevTools(register: ToolRegistrar, tools: McpTools, dependencies: BudokonMcpDependencies, context: McpRequestContext): void {
  if (context.authorizedJev && dependencies.semanticSearch) {
    register("semantic_search_judoka", "Rank judoka semantically", "Rank up to 100 eligible judoka by semantic relevance. Returns compact summaries; use get_judoka for details. This calls an external model and does not replace deterministic search.", context.authorizedInternal ? semanticSearchInputSchema : publicSemanticSearchInputSchema, semanticSearchOutputSchema, async input => {
      const result = await tools.semantic_search_judoka(input as Parameters<typeof tools.semantic_search_judoka>[0], context);
      return { ...result, results: result.results.map(item => ({ ...item, judoka: compactJudoka(item.judoka as unknown as Record<string, unknown>) })) };
    }, externalReadAnnotations);
  }
  if (context.authorizedJev && dependencies.editorialReview) {
    register("review_proposed_judoka", "Review a judoka proposal", "Review a proposed record against supplied evidence and likely duplicates. Calls an external model; advice is non-mutating and requires human approval.", editorialReviewInputSchema, reviewOutputSchema, input => tools.review_proposed_judoka(input as Parameters<typeof tools.review_proposed_judoka>[0], context), externalReadAnnotations);
  }
  if (context.authorizedJev && dependencies.editorialReview?.reviewMany) {
    register("review_proposed_judoka_batch", "Review judoka proposals", "Review up to 10 proposed records in one bounded external-model request. Results are advisory and require human approval.", editorialReviewBatchInputSchema, reviewBatchOutputSchema, input => tools.review_proposed_judoka_batch(input as Parameters<typeof tools.review_proposed_judoka_batch>[0], context), externalReadAnnotations);
  }
  if (context.authorizedJev && dependencies.playstyleClassification) {
    register("review_judoka_playstyle", "Review a judoka playstyle", "Propose confidence-gated playstyle labels from one canonical judoka, resolved signature techniques, and supplied source excerpts. This calls an external model, never changes canonical data, and always requires human approval.", playstyleClassificationInputSchema, playstyleClassificationOutputSchema, input => tools.review_judoka_playstyle(input as Parameters<typeof tools.review_judoka_playstyle>[0], context), externalReadAnnotations);
  }
  if (context.authorizedJev && dependencies.queryInterpreter) {
    register("interpret_judoka_query", "Interpret a judoka query", "Suggest existing catalogue filters from natural language. Calls an external model; low-confidence suggestions are not applied.", interpretJudokaQueryInput, queryInterpretationOutputSchema, input => tools.interpret_judoka_query(input as Parameters<typeof tools.interpret_judoka_query>[0], context), externalReadAnnotations);
  }
}

/** Builds a stateless Streamable HTTP MCP endpoint over the shared application services. */
export function createBudokonMcpHandler(dependencies: BudokonMcpDependencies) {
  return createMcpHandler(({ requestInfo }) => {
    const tools = createMcpTools(dependencies);
    const context = {
      authorizedInternal: requestInfo ? dependencies.authorizeInternal(requestInfo) : false,
      authorizedJev: requestInfo ? (dependencies.authorizeJev?.(requestInfo) ?? dependencies.authorizeInternal(requestInfo)) : false,
    };
    const server = new McpServer(
      { name: "budokon", version: dependencies.catalog.version().serviceVersion },
      { instructions: "Use deterministic catalogue search for exact judoka name, alias, country, gender, weight, rarity, person type, and signature-move filters. Collection tools return at most 50 records by default; continue with the returned nextCursor and repeat the same limit and filters. Draws are read-only; provide a seed and retain datasetVersion and algorithm when reproducibility matters. Public tools never return hidden records. Internal JEV tools, when present, are advisory and call an external model." },
    );
    const register = createToolRegistrar(server);
    registerCatalogTools(register, tools, context);
    registerJevTools(register, tools, dependencies, context);
    return server;
  }, { legacy: "stateless" });
}
