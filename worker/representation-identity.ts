import { normalizeSearchText } from "../src/domain/catalog-filters.js";
import { queryValues } from "../src/api/query-values.js";

/** Compare an If-None-Match list using weak comparison for GET validators. */
export function weaklyMatchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;

  const validators = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index <= ifNoneMatch.length; index += 1) {
    const character = index < ifNoneMatch.length ? ifNoneMatch[index] : null;
    if (character === '"') quoted = !quoted;
    if ((character === "," && !quoted) || index === ifNoneMatch.length) {
      const validator = ifNoneMatch.slice(start, index).trim();
      if (validator) validators.push(validator);
      start = index + 1;
    }
  }

  const normalizedEtag = etag.startsWith("W/") ? etag.slice(2) : etag;
  return validators.some(validator => {
    if (validator === "*") return true;
    if (!/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(validator)) return false;
    const normalizedValidator = validator.startsWith("W/") ? validator.slice(2) : validator;
    return normalizedValidator === normalizedEtag;
  });
}

export interface RepresentationCacheability {
  /** Explicit REST-layer assurance that the response is independent of internal visibility. */
  cacheablePublicly: boolean;
}

export function isAuthorizationSensitive(request: Request, metadata?: RepresentationCacheability): boolean {
  const requestsHiddenRecords = new URL(request.url).searchParams.getAll("includeHidden").includes("true");
  return metadata?.cacheablePublicly === false
    || requestsHiddenRecords
    || request.headers.has("authorization")
    || request.headers.has("x-api-key");
}

/**
 * Describe the parts of a validated REST request that select its representation.
 *
 * URLSearchParams has already decoded query names and values. Sorting only the
 * parameter names makes differently ordered, equivalent queries share an
 * identity, while keeping each name's values in request order. The latter is
 * important for filters such as repeated `exclude` values whose order can be
 * reflected in a response. An array of decoded path segments also avoids
 * spelling differences in percent-encoding without conflating encoded slashes
 * with path separators.
 */
function canonicalRepresentationKey(url: URL): string {
  const pathname = url.pathname
    .split("/")
    .filter(Boolean)
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const parameters = canonicalQueryParameters(url);
  return JSON.stringify([pathname, parameters]);
}

const JUDOKA_FILTERS = ["countryCode", "gender", "weightClass", "rarity", "personType", "signatureMoveIds"] as const;

function canonicalQueryParameters(url: URL): Array<[string, string[]]> {
  const params = new URLSearchParams(url.searchParams);
  const segments = url.pathname.split("/").filter(Boolean).map(segment => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (segments[0] !== "v1") return sortedQuery(params);

  const resource = segments[1];
  const hasId = segments.length > 2;
  if (!resource) return sortedQuery(params);

  // These handlers do not inspect query parameters, so they select no variant.
  if (["countries", "weight-categories", "version", "status", "coverage"].includes(resource)) return [];
  if (resource === "techniques" && hasId) return [];

  if (resource === "judoka") {
    if (hasId) {
      // Lookup accepts only includeHidden; other query parameters produce 400.
      if ([...params.keys()].some(name => name !== "includeHidden")) return sortedQuery(params);
      canonicalBoolean(params, "includeHidden");
    } else {
      for (const name of JUDOKA_FILTERS) canonicalSet(params, name);
      canonicalSet(params, "exclude");
      canonicalSearch(params, "q");
      canonicalSingle(params, "includeHidden");
      canonicalPage(params);
    }
  } else if (resource === "techniques" && !hasId) {
    canonicalSearch(params, "q");
    canonicalSet(params, "category", normalizeSearchText);
    canonicalSet(params, "subCategory", normalizeSearchText);
    canonicalPage(params);
  } else if (resource === "events") {
    if (hasId) return sortedQuery(params); // Event lookups reject every query parameter.
    canonicalSingle(params, "ruleset");
    canonicalSingle(params, "category");
    canonicalPage(params);
  }

  return sortedQuery(params);
}

function sortedQuery(params: URLSearchParams): Array<[string, string[]]> {
  const names = [...new Set(params.keys())].sort();
  return names.map(name => [name, params.getAll(name).sort()]);
}

function canonicalSearch(params: URLSearchParams, name: string): void {
  if (!params.has(name)) return;
  const values = queryValues(params, name);
  if (values.length === 0) params.delete(name);
  else if (values.length === 1) params.set(name, normalizeSearchText(values[0]));
  // More than one value is invalid for q; retaining its shape prevents it
  // from colliding with a valid single-value search before route validation.
}

function canonicalSet(params: URLSearchParams, name: string, normalize: (value: string) => string = value => value): void {
  if (!params.has(name)) return;
  const values = queryValues(params, name);
  if (values.length === 0) return; // Empty filters are invalid; preserve them as distinct.
  params.delete(name);
  for (const value of [...new Set(values.map(normalize))].sort()) params.append(name, value);
}

function canonicalSingle(params: URLSearchParams, name: string): void {
  if (!params.has(name)) return;
  const values = queryValues(params, name);
  if (values.length === 1) params.set(name, values[0]);
  // Repeated scalar values stay distinct because the route rejects them.
}

function canonicalBoolean(params: URLSearchParams, name: string): void {
  if (!params.has(name)) return;
  const values = queryValues(params, name);
  if (values.length === 0) params.delete(name);
  else if (values.length === 1 && (values[0] === "true" || values[0] === "false")) params.set(name, values[0]);
}

function canonicalPage(params: URLSearchParams): void {
  if (params.has("limit")) {
    const values = queryValues(params, "limit");
    if (values.length === 1 && /^(?:[1-9]|[1-9][0-9]|100)$/.test(values[0])) params.set("limit", values[0]);
  }
  canonicalSingle(params, "cursor");
}

/** Query identity shared by edge keys and ETags; only valid-equivalent forms collapse. */
export function canonicalRepresentationQuery(url: URL): Array<[string, string[]]> {
  return canonicalQueryParameters(url);
}

export async function representationEtag(datasetVersion: string, representationRevision: string, request: Request): Promise<string> {
  const url = new URL(request.url);
  const representationKey = canonicalRepresentationKey(url);
  const identity = JSON.stringify([datasetVersion, representationRevision, representationKey]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `"budokon-${hash}"`;
}
