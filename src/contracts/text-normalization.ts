/**
 * Shared catalog text normalization contract.
 *
 * Converts text to a diacritic-insensitive, lowercase, whitespace-collapsed
 * form for search matching, alias-collision checks, and cross-record equality.
 * Kept centralized so every consumer applies byte-identical normalization.
 */

/** Normalize catalog text to a canonical, diacritic-insensitive, lowercase form. */
export function normalizeCatalogText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}
