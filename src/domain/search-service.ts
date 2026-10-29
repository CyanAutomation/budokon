/**
 * Search service for catalog queries.
 * Handles text search and filtering of judoka records.
 */

import type { Judoka, SearchJudokaOptions } from "./types.js";
import { normalizeSearchText } from "./catalog-filters.js";
import type { FilterService } from "./filter-service.js";

const byImmutableId = (a: Judoka, b: Judoka) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

interface SearchableSnapshot {
  slug: string;
  firstname: string | undefined;
  surname: string | undefined;
  legacySlugs: readonly string[];
  aliases: readonly string[];
  values: string[];
}

const searchableByJudoka = new WeakMap<Judoka, SearchableSnapshot>();

// Catalogue records are shared across each request's shallow-copied arrays.
// Cache only derived strings, and compare their source fields so mutations in
// portable library callers cannot leave stale search results behind.
function sameStrings(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return (left?.length ?? 0) === right.length && right.every((value, index) => left?.[index] === value);
}

function searchableValues(judoka: Judoka): string[] {
  const cached = searchableByJudoka.get(judoka);
  const legacySlugs = judoka.legacySlugs ?? [];
  const aliases = judoka.aliases ?? [];
  if (cached
    && cached.slug === judoka.slug
    && cached.firstname === judoka.firstname
    && cached.surname === judoka.surname
    && sameStrings(judoka.legacySlugs, cached.legacySlugs)
    && sameStrings(judoka.aliases, cached.aliases)) return cached.values;

  const values = [
    judoka.slug,
    ...legacySlugs,
    judoka.firstname,
    judoka.surname,
    `${judoka.firstname ?? ""} ${judoka.surname ?? ""}`.trim(),
    ...aliases,
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
  searchableByJudoka.set(judoka, {
    slug: judoka.slug,
    firstname: judoka.firstname,
    surname: judoka.surname,
    legacySlugs: [...legacySlugs],
    aliases: [...aliases],
    values,
  });
  return values;
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
