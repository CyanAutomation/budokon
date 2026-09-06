/**
 * Reusable validation primitives for canonical data validation.
 */

import { isProhibitedGameStatePropertyName } from '../contracts/game-state.js';

const placeholder = /^(?:todo|tbd|unknown|n\/?a|none|more info to come)(?=$|[\s:_\p{P}\p{S}])/iu;

/**
 * Validate that a string contains meaningful text (not empty, not placeholder).
 * @throws Error if value is not a meaningful string
 */
export function meaningfulText(value: unknown, location: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${location} must contain meaningful text`);
  }
  if (placeholder.test(value.trim())) {
    throw new Error(`${location} contains placeholder content`);
  }
}

/**
 * Ensure all values in a set of items are unique by a specific field or set of fields.
 * @throws Error if duplicate values are found
 */
export function ensureUnique<T extends Record<string, unknown>>(
  items: T[],
  fieldName: string,
  label: string,
  getValues?: (item: T) => unknown[]
): void {
  const seen = new Map<unknown, string>();
  for (const item of items) {
    const values = getValues ? getValues(item) : [item[fieldName]];
    for (const value of values) {
      const key = JSON.stringify(value);
      if (seen.has(key)) {
        throw new Error(`duplicate ${label} ${key} in ${seen.get(key)}`);
      }
      seen.set(key, String((item as any).slug ?? (item as any).id));
    }
  }
}

/**
 * Recursively reject any game-state property names in an object.
 * @throws Error if a prohibited property is found
 */
export function rejectGameStateProperties(value: unknown, location: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rejectGameStateProperties(item, `${location}[${index}]`);
    });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (isProhibitedGameStatePropertyName(key)) {
      throw new Error(`${location}.${key} is a prohibited game-state property`);
    }
    rejectGameStateProperties(item, `${location}.${key}`);
  }
}

/**
 * Validate that a value is a valid RFC 3339 UTC timestamp.
 */
export function isValidDateTime(value: unknown): boolean {
  const rfc3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
  if (typeof value !== 'string' || !rfc3339.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const normalized = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_, fraction) => `.${fraction.padEnd(3, '0')}Z`)
    : value.replace(/Z$/, '.000Z');
  return date.toISOString() === normalized;
}

/**
 * Validate that a date is not in the future.
 * @throws Error if the date is in the future
 */
export function rejectFutureDate(value: string, location: string): void {
  if (Date.parse(value) > Date.now()) {
    throw new Error(`${location} must not be in the future`);
  }
}
