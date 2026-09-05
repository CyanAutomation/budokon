/**
 * Filter service for catalog queries.
 * Centralizes filter validation and normalization logic.
 */

import type { Filters, Judoka, ListJudokaOptions } from "./types.js";
import { normalizeFilters } from "./catalog-filters.js";

export interface FilterService {
  /**
   * Normalize and validate filters, then apply them to filter a judoka list.
   * @param judoka - The judoka array to filter
   * @param filters - Raw filter input
   * @param exclude - Judoka IDs/slugs to exclude
   * @param includeHidden - Whether to include hidden records
   * @param authorizedInternal - Whether the request is authorized for internal access
   * @returns Filtered judoka list
   */
  applyFilters(
    judoka: Judoka[],
    filters?: Filters,
    exclude?: string[],
    includeHidden?: boolean,
    authorizedInternal?: boolean
  ): Judoka[];
}

/**
 * Create a filter service instance.
 */
export function createFilterService(): FilterService {
  return {
    applyFilters(
      judoka: Judoka[],
      filters?: Filters,
      exclude?: string[],
      includeHidden?: boolean,
      authorizedInternal?: boolean
    ): Judoka[] {
      const normalizedFilters = normalizeFilters(filters);
      const exclusions = new Set((exclude ?? []).map(String));
      const shouldIncludeHidden = includeHidden === true && authorizedInternal === true;

      return judoka
        .filter(j => shouldIncludeHidden || j.isHidden !== true)
        .filter(j =>
          Object.entries(normalizedFilters).every(([field, values]) =>
            field === "signatureMoveIds"
              ? values.some(value => j.signatureMoveIds.includes(value))
              : j[field] != null && values.includes(String(j[field]))
          )
        )
        .filter(j => !exclusions.has(j.id) && !exclusions.has(j.slug));
    },
  };
}
