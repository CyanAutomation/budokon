import type { CatalogService } from "../domain/catalog-service.js";
import type { DrawRequest, Filters, RequestContext } from "../domain/types.js";
import type { DrawService } from "../draw/draw-service.js";
import type { EventDrawService } from "../draw/event-draw-service.js";
interface SearchToolRequest extends DrawRequest { query?: string; q?: string; filters?: Filters; }
export function createMcpTools({ catalog, draw, eventDraw }: { catalog: CatalogService; draw: DrawService; eventDraw?: EventDrawService }) {
  const versioned = <T extends object>(body: T) => ({ datasetVersion: catalog.repository.datasetVersion, ...body });
  return {
    get_judoka: ({ id, includeHidden }: { id: string; includeHidden?: boolean }, context: RequestContext = {}) => versioned({ judoka: catalog.getJudoka(id, { includeHidden, authorizedInternal: context.authorizedInternal }) ?? null }),
    search_judoka: ({ query, q, filters = {}, exclude = [], includeHidden }: SearchToolRequest = {}, context: RequestContext = {}) => versioned({ judoka: catalog.searchJudoka({ query: query ?? q, filters, exclude, includeHidden, authorizedInternal: context.authorizedInternal }) }),
    draw_judoka: (input: DrawRequest = {}, context: RequestContext = {}) => draw.draw(input, context), list_techniques: () => versioned({ techniques: catalog.listTechniques() }),
    get_technique: ({ id }: { id: string }) => versioned({ technique: catalog.getTechnique(id) ?? null }),
    list_events: ({ ruleset, category }: { ruleset?: string; category?: string } = {}) => versioned({ events: catalog.listEvents({ ruleset, category }) }),
    get_event: ({ id }: { id: string }) => versioned({ event: catalog.getEvent(id) ?? null }),
    draw_event: (input: import("../domain/types.js").EventDrawRequest) => eventDraw!.draw(input), version: () => catalog.version(),
  };
}
