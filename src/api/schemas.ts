/**
 * Centralized validation schemas and parsing utilities for REST API requests.
 * Consolidates query and body validation logic to reduce duplication across endpoints.
 */

import type { DrawRequest, EventDrawRequest, Filters } from "../domain/types.js";
import { FILTER_FIELDS } from "../domain/catalog-filters.js";

export interface ListQuerySchema {
  filters: Filters;
  exclude: string[];
  query?: string;
  includeHidden: boolean;
  limit?: number;
  cursor?: string;
}

export interface EventListQuerySchema {
  ruleset?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}

export interface PageSchema {
  limit?: number;
  cursor?: string;
}

export interface DrawBodySchema extends DrawRequest {}
export interface EventDrawBodySchema extends EventDrawRequest {}

const FILTERS = Array.from(FILTER_FIELDS) as readonly string[];
const DRAW_BODY_FIELDS = new Set(["count", "seed", "algorithm", "filters", "exclude", "includeHidden"]);
const EVENT_DRAW_BODY_FIELDS = new Set(["ruleset", "category", "seed", "exclude"]);

function requestObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function assertAllowedFields(body: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new TypeError(`unsupported body field: ${key}`);
  }
}

function assertStringFields(body: Record<string, unknown>, fields: readonly string[]): void {
  for (const key of fields) {
    if (body[key] !== undefined && typeof body[key] !== "string") {
      throw new TypeError(`${key} must be a string`);
    }
  }
}

function assertExcludeField(body: Record<string, unknown>): void {
  const exclude = body.exclude;
  if (exclude !== undefined && (!Array.isArray(exclude) || exclude.some(item => typeof item !== "string"))) {
    throw new TypeError("exclude must be an array of strings");
  }
}

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

function values(params: URLSearchParams, name: string): string[] {
  return params.getAll(name).flatMap(value => value.split(",")).map(value => value.trim()).filter(Boolean);
}

/**
 * Parse and validate pagination query parameters (limit, cursor).
 */
export function parsePageQuery(params: URLSearchParams): PageSchema {
  const limit = values(params, "limit");
  const cursor = values(params, "cursor");
  if (limit.length > 1 || (limit.length === 1 && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit[0]))) {
    throw new TypeError("limit must be an integer from 1 through 100");
  }
  if (cursor.length > 1) throw new TypeError("cursor must have one value");
  return { limit: limit[0] === undefined ? undefined : Number(limit[0]), cursor: cursor[0] };
}

/**
 * Parse and validate list query parameters (filters, search, pagination).
 */
export function parseListQuery(params: URLSearchParams): ListQuerySchema {
  const allowed = new Set(["q", "exclude", "includeHidden", "limit", "cursor", ...FILTERS]);
  params.forEach((_value, key) => {
    if (!allowed.has(key)) throw new TypeError(`unsupported query parameter: ${key}`);
  });

  const filters: Record<string, string[]> = {};
  for (const field of FILTERS) {
    const parsed = values(params, field);
    if (params.has(field) && parsed.length === 0) throw new TypeError(`filter ${field} must not be empty`);
    if (parsed.length) filters[field] = parsed;
  }

  const hidden = values(params, "includeHidden");
  if (hidden.length > 1 || (hidden.length === 1 && hidden[0] !== "true" && hidden[0] !== "false")) {
    throw new TypeError("includeHidden must be true or false");
  }

  const query = values(params, "q");
  if (query.length > 1) throw new TypeError("q must have one value");

  return {
    filters: filters as Filters,
    exclude: values(params, "exclude"),
    query: query[0],
    includeHidden: hidden[0] === "true",
    ...parsePageQuery(params),
  };
}

/**
 * Parse and validate event list query parameters (ruleset, category, pagination).
 */
export function parseEventListQuery(params: URLSearchParams): EventListQuerySchema {
  const allowed = new Set(["ruleset", "category", "limit", "cursor"]);
  params.forEach((_value, key) => {
    if (!allowed.has(key)) throw new TypeError(`unsupported query parameter: ${key}`);
  });

  const result: Record<string, string | undefined> = {};
  for (const key of allowed) {
    const value = values(params, key);
    if (value.length > 1) throw new TypeError(`${key} must have one value`);
    if (params.has(key) && value.length === 0) throw new TypeError(`${key} must not be empty`);
    result[key] = value[0];
  }

  return { ...(result as EventListQuerySchema), ...parsePageQuery(params) };
}

/**
 * Validate and normalize a draw request body.
 */
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

/**
 * Validate and normalize an event draw request body.
 */
export function validateEventDrawBody(value: unknown): EventDrawBodySchema {
  const body = requestObject(value);
  assertAllowedFields(body, EVENT_DRAW_BODY_FIELDS);

  if (typeof body.ruleset !== "string" || body.ruleset.trim() === "") {
    throw new TypeError("ruleset must be a non-empty string");
  }

  assertStringFields(body, ["category", "seed"]);
  assertExcludeField(body);

  return body as unknown as EventDrawBodySchema;
}
