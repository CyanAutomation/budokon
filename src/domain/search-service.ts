/**
 * Search service for catalog queries.
 * Handles text search and filtering of judoka records.
 */

import type { Judoka, SearchJudokaOptions } from "./types.js";
import { normalizeSearchText } from "./catalog-filters.js";
import type { FilterService } from "./filter-service.js";

const byImmutableId = (a: Judoka, b: Judoka) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function searchableValues(judoka: Judoka): string[] {
  return [
    judoka.slug,
    ...(judoka.legacySlugs ?? []),
    judoka.firstname,
    judoka.surname,
    `${judoka.firstname ?? ""} ${judoka.surname ?? ""}`.trim(),
    ...(judoka.aliases ?? []),
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
}

export interface SearchService {
  /**
   * Search judoka by text query and apply filters.
   * @param judoka - The judoka array to search
   * @param options - Search options (query, filters, exclude, etc.)
   * @returns Filtered and sorted judoka list matching the search criteria
   */
  search(judoka: Judoka[], options?: SearchJudokaOptions): Judoka[];
}

/**
 * Create a search service instance.
 */
export function createSearchService(filterService: FilterService): SearchService {
  return {
    search(judoka: Judoka[], options: SearchJudokaOptions = {}): Judoka[] {
      const filtered = filterService.applyFilters(
        judoka,
        options.filters,
        options.exclude,
        options.includeHidden,
        options.authorizedInternal
      );

      const query = normalizeSearchText(options.query ?? options.q);
      if (!query) {
        // No search query: return filtered results in UUID order
        return filtered.sort(() => 0);
      }

      // Filter by text match and sort by UUID
      return filtered
        .filter(j => searchableValues(j).some(value => value.includes(query)))
        .sort(byImmutableId);
    },
  };
}
