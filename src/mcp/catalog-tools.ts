import type { EventDrawRequest, RequestContext } from "../domain/types.js";
import { versioned, type CatalogToolDependencies, type SearchToolRequest } from "./tool-types.js";

export function createCatalogTools({ catalog, draw, eventDraw }: CatalogToolDependencies) {
  return {
    get_judoka: ({ id, includeHidden }: { id: string; includeHidden?: boolean }, context: RequestContext = {}) =>
      versioned(catalog, { judoka: catalog.getJudoka(id, { includeHidden, authorizedInternal: context.authorizedInternal }) ?? null }),
    search_judoka: ({ query, q, filters = {}, exclude = [], includeHidden }: SearchToolRequest = {}, context: RequestContext = {}) =>
      versioned(catalog, { judoka: catalog.searchJudoka({ query: query ?? q, filters, exclude, includeHidden, authorizedInternal: context.authorizedInternal }) }),
    draw_judoka: (input: SearchToolRequest = {}, context: RequestContext = {}) => draw.draw(input, context),
    list_techniques: () => versioned(catalog, { techniques: catalog.listTechniques() }),
    get_technique: ({ id }: { id: string }) => versioned(catalog, { technique: catalog.getTechnique(id) ?? null }),
    list_events: ({ ruleset, category }: { ruleset?: string; category?: string } = {}) =>
      versioned(catalog, { events: catalog.listEvents({ ruleset, category }) }),
    get_event: ({ id }: { id: string }) => versioned(catalog, { event: catalog.getEvent(id) ?? null }),
    draw_event: (input: EventDrawRequest) => {
      if (!eventDraw) throw new Error("eventDraw service not configured");
      return eventDraw.draw(input);
    },
    version: () => catalog.version(),
  };
}
