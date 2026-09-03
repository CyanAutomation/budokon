/**
 * Read the API credential accepted by the Worker.
 *
 * @param {Request} request
 */
export function credential(request: Request): string {
  const apiKey = request.headers.get("x-api-key");
  const authorization = request.headers.get("authorization");
  // A request must select exactly one authentication scheme. Treating either
  // credential as authoritative would make conflicting dual-header requests
  // ambiguous to clients and intermediaries.
  if (apiKey !== null && authorization !== null) return "";
  return apiKey ?? authorization?.replace(/^Bearer\s+/i, "") ?? "";
}

/**
 * Compare an incoming credential without exiting early on differing characters.
 *
 * @param {Request} request
 * @param {string | undefined} expected
 */
export function authorized(request: Request, expected: string | undefined): boolean {
  // Secrets are mandatory. A missing secret must never accidentally allow access.
  const credValue = credential(request);
  if (!expected) return false;
  const maxLen = Math.max(credValue.length, expected.length);
  let matches = credValue.length ^ expected.length;
  for (let i = 0; i < maxLen; i++) {
    matches |= (credValue.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return matches === 0;
}
