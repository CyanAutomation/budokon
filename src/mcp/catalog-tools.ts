import type { EventDrawRequest, RequestContext } from "../domain/types.js";
import { versioned, type CatalogToolDependencies, type SearchToolRequest, type TechniqueSearchToolRequest } from "./tool-types.js";

// Part of the emitted type for the exported createCatalogTools factory.
// fallow-ignore-next-line unused-type
export interface PageOptions { limit?: number; cursor?: string; }

function pageRecords<T extends { id: string }>(records: T[], { limit, cursor }: PageOptions = {}) {
  if (cursor !== undefined && limit === undefined) throw new TypeError("cursor requires limit");
  const pageSize = limit ?? 50;
  const cursorIndex = cursor === undefined ? -1 : records.findIndex(record => record.id === cursor);
  if (cursor !== undefined && cursorIndex === -1) throw new TypeError("cursor must identify a result from the current query");
  const start = cursorIndex + 1;
  const items = records.slice(start, start + pageSize);
  return {
    items,
    ...(start + items.length < records.length ? { nextCursor: items.at(-1)!.id } : {}),
  };
}

export function createCatalogTools({ catalog, draw, eventDraw }: CatalogToolDependencies) {
  return {
    get_judoka: ({ id, includeHidden }: { id: string; includeHidden?: boolean }, context: RequestContext = {}) =>
      versioned(catalog, { judoka: catalog.getJudoka(id, { includeHidden, authorizedInternal: context.authorizedInternal }) ?? null }),
    search_judoka: ({ query, q, filters = {}, exclude = [], includeHidden, limit, cursor }: SearchToolRequest = {}, context: RequestContext = {}) => {
      if (query !== undefined && q !== undefined) throw new TypeError("use query or q, not both");
      const records = catalog.searchJudoka({ query: query ?? q, filters, exclude, includeHidden, authorizedInternal: context.authorizedInternal });
      const page = pageRecords(records, { limit, cursor });
      return versioned(catalog, { judoka: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
    },
    draw_judoka: (input: SearchToolRequest = {}, context: RequestContext = {}) => draw.draw(input, context),
    list_techniques: ({ limit, cursor }: PageOptions = {}) => {
      const page = pageRecords(catalog.listTechniques(), { limit, cursor });
      return versioned(catalog, { techniques: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
    },
    search_techniques: ({ query, category, subCategory, limit, cursor }: TechniqueSearchToolRequest = {}) => {
      const page = pageRecords(catalog.searchTechniques({ query, category, subCategory }), { limit, cursor });
      return versioned(catalog, { techniques: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
    },
    get_technique: ({ id }: { id: string }) => versioned(catalog, { technique: catalog.getTechnique(id) ?? null }),
    list_events: ({ ruleset, category, limit, cursor }: { ruleset?: string; category?: string } & PageOptions = {}) => {
      const page = pageRecords(catalog.listEvents({ ruleset, category }), { limit, cursor });
      return versioned(catalog, { events: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
    },
    get_event: ({ id }: { id: string }) => versioned(catalog, { event: catalog.getEvent(id) ?? null }),
    draw_event: (input: EventDrawRequest) => {
      if (!eventDraw) throw new Error("eventDraw service not configured");
      return eventDraw.draw(input);
    },
    version: () => catalog.version(),
    list_countries: () => versioned(catalog, { countries: catalog.listCountries() }),
    list_weight_categories: () => versioned(catalog, { weightCategories: catalog.listWeightCategories() }),
    get_public_coverage: () => versioned(catalog, catalog.publicCoverage()),
  };
}
