/**
 * Shared catalog filtering and text normalization utilities.
 * Centralizes Unicode normalization and filter field definitions to ensure
 * consistency across search, catalog, and repository layers.
 */

import type { Filters } from "./types.js";

/** Supported filter field names for catalog queries */
export const FILTER_FIELDS = new Set(["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveIds"]);

/**
 * Normalize search text to diacritic-insensitive, lowercase form for comparison.
 * Removes diacritical marks, converts to lowercase, collapses whitespace.
 *
 * @param value - The text to normalize
 * @returns Normalized text ready for search/comparison
 */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

/**
 * Normalize and validate filter values, converting them to a canonical form.
 * - Validates filter field names against supported fields
 * - Converts all values to strings and removes empty values
 * - Sorts field names and values for consistent ordering
 * - Deduplicates values within each field
 *
 * @param filters - Raw filter input (object mapping field names to values)
 * @returns Normalized filter object with sorted, deduplicated values
 * @throws TypeError if filters is invalid or contains unsupported fields
 */
export function normalizeFilters(filters: Filters = {}): Record<string, string[]> {
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("filters must be an object");
  }

  return Object.fromEntries(
    Object.entries(filters)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([field, value]) => {
        if (!FILTER_FIELDS.has(field)) throw new TypeError(`unsupported filter: ${field}`);
        const values = (Array.isArray(value) ? value : [value])
          .map(String)
          .map(v => v.trim())
          .filter(Boolean);
        if (!values.length) throw new TypeError(`filter ${field} must not be empty`);
        return [field, [...new Set(values)].sort()];
      })
  );
}
