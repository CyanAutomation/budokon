import { parsePageQuery } from "./page-query-schema.js";
import { queryValues } from "./query-values.js";

export interface EventListQuerySchema {
  ruleset?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}

/** Parse and validate event list query parameters (ruleset, category, pagination). */
export function parseEventListQuery(params: URLSearchParams): EventListQuerySchema {
  const allowed = new Set(["ruleset", "category", "limit", "cursor"]);
  params.forEach((_value, key) => {
    if (!allowed.has(key)) throw new TypeError(`unsupported query parameter: ${key}`);
  });

  const result: Record<string, string | undefined> = {};
  for (const key of allowed) {
    const value = queryValues(params, key);
    if (value.length > 1) throw new TypeError(`${key} must have one value`);
    if (params.has(key) && value.length === 0) throw new TypeError(`${key} must not be empty`);
    result[key] = value[0];
  }

  return { ...(result as EventListQuerySchema), ...parsePageQuery(params) };
}
