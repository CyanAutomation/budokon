import type { DrawRequest } from "../domain/types.js";
import { FILTER_FIELDS } from "../domain/catalog-filters.js";
import { assertAllowedFields, assertExcludeField, assertStringFields, requestObject } from "./body-validation.js";

export interface DrawBodySchema extends DrawRequest {}

const FILTERS = Array.from(FILTER_FIELDS) as readonly string[];
const DRAW_BODY_FIELDS = new Set(["count", "seed", "algorithm", "filters", "exclude", "includeHidden"]);

function assertDrawFilters(value: unknown): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("filters must be an object");
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!FILTERS.includes(key)) throw new TypeError(`unsupported filter: ${key}`);
    const validValue = typeof item === "string" || (
      Array.isArray(item) && item.length > 0 && item.every(entry => typeof entry === "string")
    );
    if (!validValue) throw new TypeError(`filter ${key} must be a string or non-empty array of strings`);
  }
}

/** Validate and normalize a draw request body. */
export function validateDrawBody(value: unknown): DrawBodySchema {
  const body = requestObject(value);
  assertAllowedFields(body, DRAW_BODY_FIELDS);

  if (body.count !== undefined && (!Number.isSafeInteger(body.count) || (body.count as number) < 1)) {
    throw new TypeError("count must be a positive integer");
  }
  assertStringFields(body, ["seed", "algorithm"]);

  if (body.includeHidden !== undefined && typeof body.includeHidden !== "boolean") {
    throw new TypeError("includeHidden must be a boolean");
  }
  assertExcludeField(body);
  assertDrawFilters(body.filters);

  return body as DrawBodySchema;
}
