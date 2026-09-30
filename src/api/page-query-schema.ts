import { queryValues } from "./query-values.js";

export interface PageSchema {
  limit?: number;
  cursor?: string;
}

/** Parse and validate pagination query parameters (limit, cursor). */
export function parsePageQuery(params: URLSearchParams): PageSchema {
  const limit = queryValues(params, "limit");
  const cursor = queryValues(params, "cursor");
  if (limit.length > 1 || (limit.length === 1 && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit[0]))) {
    throw new TypeError("limit must be an integer from 1 through 100");
  }
  if (cursor.length > 1) throw new TypeError("cursor must have one value");
  return { limit: limit[0] === undefined ? undefined : Number(limit[0]), cursor: cursor[0] };
}
