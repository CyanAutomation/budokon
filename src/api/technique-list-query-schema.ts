import type { SearchTechniqueOptions } from "../domain/types.js";
import { parsePageQuery } from "./page-query-schema.js";
import { queryValues } from "./query-values.js";

export interface TechniqueListQuerySchema extends SearchTechniqueOptions {
  limit?: number;
  cursor?: string;
}

/** Parse technique text/category filters and optional cursor pagination. */
export function parseTechniqueListQuery(params: URLSearchParams): TechniqueListQuerySchema {
  const allowed = new Set(["q", "category", "subCategory", "limit", "cursor"]);
  params.forEach((_value, key) => {
    if (!allowed.has(key)) throw new TypeError(`unsupported query parameter: ${key}`);
  });

  const query = queryValues(params, "q");
  if (query.length > 1) throw new TypeError("q must have one value");

  const category = queryValues(params, "category");
  if (params.has("category") && category.length === 0) throw new TypeError("category must not be empty");
  const subCategory = queryValues(params, "subCategory");
  if (params.has("subCategory") && subCategory.length === 0) throw new TypeError("subCategory must not be empty");

  return {
    query: query[0],
    ...(category.length ? { category } : {}),
    ...(subCategory.length ? { subCategory } : {}),
    ...parsePageQuery(params),
  };
}
