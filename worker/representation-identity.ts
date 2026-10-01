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

  return validators.some(validator => {
    if (validator === "*") return true;
    if (!/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(validator)) return false;
    return (validator.startsWith("W/") ? validator.slice(2) : validator) === etag;
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
  const parameterNames = [...new Set(url.searchParams.keys())].sort();
  const parameters = parameterNames.map(name => [name, url.searchParams.getAll(name)]);
  return JSON.stringify([pathname, parameters]);
}

export async function representationEtag(datasetVersion: string, representationRevision: string, request: Request): Promise<string> {
  const url = new URL(request.url);
  const representationKey = canonicalRepresentationKey(url);
  const identity = JSON.stringify([datasetVersion, representationRevision, representationKey]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `"budokon-${hash}"`;
}
