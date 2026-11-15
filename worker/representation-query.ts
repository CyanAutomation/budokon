import { normalizeSearchText } from "../src/domain/catalog-filters.js";
import { queryValues } from "../src/api/query-values.js";

/**
 * Describe the parts of a validated REST request that select its representation.
 *
 * URLSearchParams has already decoded query names and values. Known set-style
 * filters are normalized, deduplicated, and sorted; repeated scalar values keep
 * their invalid shape so they cannot collide with valid single-value requests.
 * Decoding each path segment separately removes percent-encoding differences
 * without conflating an encoded slash with a path separator.
 */
export function canonicalRepresentationKey(url: URL): string {
  const pathname = decodedPathSegments(url);
  const parameters = canonicalRepresentationQuery(url);
  return JSON.stringify([pathname, parameters]);
}

function decodedPathSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

const JUDOKA_FILTERS = ["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveIds"] as const;
const PARAMETER_FREE_RESOURCES = new Set(["countries", "weight-categories", "version", "status", "coverage"]);

/** Query identity shared by edge keys and ETags; only valid-equivalent forms collapse. */
export function canonicalRepresentationQuery(url: URL): Array<[string, string[]]> {
  const params = new URLSearchParams(url.searchParams);
  const segments = decodedPathSegments(url);
  if (segments[0] !== "v1") return sortedQuery(params);

  const resource = segments[1];
  if (!resource) return sortedQuery(params);
  const hasId = segments.length > 2;
  // These handlers do not inspect query parameters, so they select no variant.
  if (PARAMETER_FREE_RESOURCES.has(resource)) return [];
  if (resource === "techniques" && hasId) return [];
  if (resource === "judoka") return canonicalJudokaQuery(params, hasId);
  if (resource === "techniques") return canonicalTechniquesQuery(params);
  if (resource === "events") return canonicalEventsQuery(params, hasId);
  return sortedQuery(params);
}

function canonicalJudokaQuery(params: URLSearchParams, hasId: boolean): Array<[string, string[]]> {
  if (hasId) {
    // Lookup accepts only includeHidden; other query parameters produce 400.
    if ([...params.keys()].some(name => name !== "includeHidden")) return sortedQuery(params);
    canonicalBoolean(params, "includeHidden");
    return sortedQuery(params);
  }

  for (const name of JUDOKA_FILTERS) canonicalSet(params, name);
  canonicalSet(params, "exclude");
  canonicalSearch(params, "q");
  canonicalSingle(params, "includeHidden");
  canonicalPage(params);
  return sortedQuery(params);
}

function canonicalTechniquesQuery(params: URLSearchParams): Array<[string, string[]]> {
  canonicalSearch(params, "q");
  canonicalSet(params, "category", normalizeSearchText);
  canonicalSet(params, "subCategory", normalizeSearchText);
  canonicalPage(params);
  return sortedQuery(params);
}

function canonicalEventsQuery(params: URLSearchParams, hasId: boolean): Array<[string, string[]]> {
  if (hasId) return sortedQuery(params); // Event lookups reject every query parameter.
  canonicalSingle(params, "ruleset");
  canonicalSingle(params, "category");
  canonicalPage(params);
  return sortedQuery(params);
}

function sortedQuery(params: URLSearchParams): Array<[string, string[]]> {
  const names = [...new Set(params.keys())].sort();
  return names.map(name => [name, params.getAll(name).sort()]);
}

function canonicalSearch(params: URLSearchParams, name: string): void {
  canonicalSingleValue(params, name, normalizeSearchText, true);
  // Multiple values are invalid for q; retaining their shape keeps them
  // distinct from a valid single-value search before route validation.
}

function canonicalSet(params: URLSearchParams, name: string, normalize: (value: string) => string = value => value): void {
  if (!params.has(name)) return;
  const values = queryValues(params, name);
  if (values.length === 0) return; // Empty filters are invalid; preserve them as distinct.
  params.delete(name);
  for (const value of [...new Set(values.map(normalize))].sort()) params.append(name, value);
}

function canonicalSingle(params: URLSearchParams, name: string): void {
  canonicalSingleValue(params, name, value => value);
  // Repeated scalar values stay distinct because the route rejects them.
}

function canonicalBoolean(params: URLSearchParams, name: string): void {
  canonicalSingleValue(params, name, value => value === "true" || value === "false" ? value : undefined, true);
}

function canonicalSingleValue(
  params: URLSearchParams,
  name: string,
  normalize: (value: string) => string | undefined,
  deleteWhenEmpty = false,
): void {
  if (!params.has(name)) return;
  const values = queryValues(params, name);
  if (values.length === 0) {
    if (deleteWhenEmpty) params.delete(name);
    return;
  }
  if (values.length !== 1) return;
  const normalized = normalize(values[0]);
  if (normalized !== undefined) params.set(name, normalized);
}

function canonicalPage(params: URLSearchParams): void {
  if (params.has("limit")) {
    const values = queryValues(params, "limit");
    if (values.length === 1 && /^(?:[1-9]|[1-9][0-9]|100)$/.test(values[0])) params.set("limit", values[0]);
  }
  canonicalSingle(params, "cursor");
}
