/**
 * Shared catalog filtering and text normalization utilities.
 * Centralizes Unicode normalization and filter field definitions to ensure
 * consistency across search, catalog, and repository layers.
 */

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
