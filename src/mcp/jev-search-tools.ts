import type { RequestContext } from "../domain/types.js";
import { DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES } from "../jev/semantic-search.js";
import { requireJev, versioned, type JevToolDependencies, type SearchToolRequest } from "./tool-types.js";

export function createJevSearchTools({ catalog, semanticSearch, queryInterpreter }: JevToolDependencies) {
  return {
    async semantic_search_judoka(
      { query, q, filters = {}, exclude = [], includeHidden, maxCandidates = DEFAULT_SEMANTIC_SEARCH_MAX_CANDIDATES }: SearchToolRequest & { maxCandidates?: number },
      context: RequestContext = {},
    ) {
      requireJev(context);
      if (!semanticSearch) throw new Error("JEV semantic search is not configured");
      const candidates = catalog.listJudoka({ filters, exclude, includeHidden: context.authorizedInternal === true && includeHidden, authorizedInternal: context.authorizedInternal });
      if (candidates.length > maxCandidates) {
        throw new RangeError(`semantic search has ${candidates.length} eligible candidates; narrow with catalogue filters before using the ${maxCandidates}-candidate limit`);
      }
      return versioned(catalog, await semanticSearch.search(query ?? q ?? "", candidates));
    },
    async interpret_judoka_query({ query }: { query: string }, context: RequestContext = {}) {
      requireJev(context);
      if (!queryInterpreter) throw new Error("JEV judoka query interpretation is not configured");
      const interpretation = await queryInterpreter.interpret(query, {
        countries: catalog.listCountries(),
        weightCategories: catalog.listWeightCategories(),
      });
      return versioned(catalog, interpretation);
    },
  };
}
