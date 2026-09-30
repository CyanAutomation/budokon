import type { Filters } from "../domain/types.js";
import { FILTER_FIELDS } from "../domain/catalog-filters.js";
import { parsePageQuery } from "./page-query-schema.js";
import { queryValues } from "./query-values.js";

export interface ListQuerySchema {
  filters: Filters;
  exclude: string[];
  query?: string;
  includeHidden: boolean;
  limit?: number;
  cursor?: string;
}

const FILTERS = Array.from(FILTER_FIELDS) as readonly string[];

/** Parse and validate list query parameters (filters, search, pagination). */
export function parseListQuery(params: URLSearchParams): ListQuerySchema {
  const allowed = new Set(["q", "exclude", "includeHidden", "limit", "cursor", ...FILTERS]);
  params.forEach((_value, key) => {
    if (!allowed.has(key)) throw new TypeError(`unsupported query parameter: ${key}`);
  });

  const filters: Record<string, string[]> = {};
  for (const field of FILTERS) {
    const parsed = queryValues(params, field);
    if (params.has(field) && parsed.length === 0) throw new TypeError(`filter ${field} must not be empty`);
    if (parsed.length) filters[field] = parsed;
  }

  const hidden = queryValues(params, "includeHidden");
  if (hidden.length > 1 || (hidden.length === 1 && hidden[0] !== "true" && hidden[0] !== "false")) {
    throw new TypeError("includeHidden must be true or false");
  }

  const query = queryValues(params, "q");
  if (query.length > 1) throw new TypeError("q must have one value");

  return {
    filters: filters as Filters,
    exclude: queryValues(params, "exclude"),
    query: query[0],
    includeHidden: hidden[0] === "true",
    ...parsePageQuery(params),
  };
}
