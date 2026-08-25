/**
 * Read the API credential accepted by the Worker.
 *
 * @param {Request} request
 */
export function credential(request) {
  return request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

/**
 * Compare an incoming credential without exiting early on differing characters.
 *
 * @param {Request} request
 * @param {string | undefined} expected
 */
export function authorized(request, expected) {
  // Secrets are mandatory. A missing secret must never accidentally allow access.
  const credValue = credential(request);
  if (!expected || credValue.length !== expected.length) return false;
  let matches = 0;
  for (let i = 0; i < expected.length; i++) {
    matches |= credValue.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return matches === 0;
}
