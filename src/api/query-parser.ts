/**
 * Query parameter parser for REST API requests.
 * Centralizes query parsing logic with proper validation.
 */

import { parseListQuery, parseEventListQuery, parsePageQuery } from "./schemas.js";
import type { ListQuerySchema, EventListQuerySchema, PageSchema } from "./schemas.js";

export interface QueryParser {
  /**
   * Parse and validate judoka list query parameters.
   * @param params - URL search parameters
   * @returns Parsed list query with filters, search, and pagination
   */
  parseListQuery(params: URLSearchParams): ListQuerySchema;

  /**
   * Parse and validate event list query parameters.
   * @param params - URL search parameters
   * @returns Parsed event list query with ruleset/category filters and pagination
   */
  parseEventListQuery(params: URLSearchParams): EventListQuerySchema;

  /**
   * Parse and validate pagination query parameters.
   * @param params - URL search parameters
   * @returns Parsed pagination parameters (limit, cursor)
   */
  parsePageQuery(params: URLSearchParams): PageSchema;
}

/**
 * Create a query parser instance.
 */
export function createQueryParser(): QueryParser {
  return {
    parseListQuery(params: URLSearchParams): ListQuerySchema {
      return parseListQuery(params);
    },

    parseEventListQuery(params: URLSearchParams): EventListQuerySchema {
      return parseEventListQuery(params);
    },

    parsePageQuery(params: URLSearchParams): PageSchema {
      return parsePageQuery(params);
    },
  };
}
