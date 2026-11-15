import { canonicalRepresentationKey } from "./representation-query.js";

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

export async function representationEtag(datasetVersion: string, representationRevision: string, request: Request): Promise<string> {
  const url = new URL(request.url);
  const representationKey = canonicalRepresentationKey(url);
  const identity = JSON.stringify([datasetVersion, representationRevision, representationKey]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `"budokon-${hash}"`;
}
