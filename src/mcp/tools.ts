import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawRequest, Filters, RequestContext } from "../domain/types.js";
import type { DrawService } from "../draw/draw-service.js";
import type { EventDrawService } from "../draw/event-draw-service.js";
import type { EditorialReviewInput, EditorialReviewer } from "../jev/editorial-review.js";
import type { SemanticJudokaSearcher } from "../jev/semantic-search.js";
import type { JudokaQueryInterpreter } from "../jev/query-interpreter.js";
interface SearchToolRequest extends DrawRequest { query?: string; q?: string; filters?: Filters; }
export function createMcpTools({ catalog, draw, eventDraw, semanticSearch, editorialReview, queryInterpreter }: { catalog: CatalogService; draw: DrawService; eventDraw?: EventDrawService; semanticSearch?: SemanticJudokaSearcher; editorialReview?: EditorialReviewer; queryInterpreter?: JudokaQueryInterpreter }) {
  const versioned = <T extends object>(body: T) => ({ datasetVersion: catalog.repository.datasetVersion, ...body });
  const requireInternal = (context: RequestContext) => {
    if (context.authorizedInternal !== true) throw new Error("internal authorization is required for JEV tools");
  };
  return {
    get_judoka: ({ id, includeHidden }: { id: string; includeHidden?: boolean }, context: RequestContext = {}) => versioned({ judoka: catalog.getJudoka(id, { includeHidden, authorizedInternal: context.authorizedInternal }) ?? null }),
    search_judoka: ({ query, q, filters = {}, exclude = [], includeHidden }: SearchToolRequest = {}, context: RequestContext = {}) => versioned({ judoka: catalog.searchJudoka({ query: query ?? q, filters, exclude, includeHidden, authorizedInternal: context.authorizedInternal }) }),
    draw_judoka: (input: DrawRequest = {}, context: RequestContext = {}) => draw.draw(input, context), list_techniques: () => versioned({ techniques: catalog.listTechniques() }),
    get_technique: ({ id }: { id: string }) => versioned({ technique: catalog.getTechnique(id) ?? null }),
    list_events: ({ ruleset, category }: { ruleset?: string; category?: string } = {}) => versioned({ events: catalog.listEvents({ ruleset, category }) }),
    get_event: ({ id }: { id: string }) => versioned({ event: catalog.getEvent(id) ?? null }),
    draw_event: (input: import("../domain/types.js").EventDrawRequest) => { if (!eventDraw) throw new Error("eventDraw service not configured"); return eventDraw.draw(input); }, version: () => catalog.version(),
    async semantic_search_judoka({ query, q, filters = {}, exclude = [], includeHidden, maxCandidates = 20 }: SearchToolRequest & { maxCandidates?: number }, context: RequestContext = {}) {
      requireInternal(context);
      if (!semanticSearch) throw new Error("JEV semantic search is not configured");
      const candidates = catalog.listJudoka({ filters, exclude, includeHidden, authorizedInternal: context.authorizedInternal });
      if (candidates.length > maxCandidates) throw new RangeError(`semantic search has ${candidates.length} eligible candidates; narrow with catalogue filters before using the ${maxCandidates}-candidate limit`);
      return versioned(await semanticSearch.search(query ?? q ?? "", candidates));
    },
    async review_proposed_judoka(input: EditorialReviewInput, context: RequestContext = {}) {
      requireInternal(context);
      if (!editorialReview) throw new Error("JEV editorial review is not configured");
      const signatureMoveIds = Array.isArray(input.record?.signatureMoveIds) ? input.record.signatureMoveIds : [];
      const techniques = catalog.listTechniques().filter(technique => signatureMoveIds.includes(technique.id));
      return editorialReview.review({ ...input, techniques });
    },
    async interpret_judoka_query({ query }: { query: string }, context: RequestContext = {}) {
      requireInternal(context);
      if (!queryInterpreter) throw new Error("JEV judoka query interpretation is not configured");
      const interpretation = await queryInterpreter.interpret(query, {
        countries: catalog.listCountries(),
        weightCategories: catalog.listWeightCategories(),
      });
      return versioned(interpretation);
    },
  };
}
