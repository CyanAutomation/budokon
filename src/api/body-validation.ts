export const MAX_REST_REQUEST_BODY_BYTES = 16 * 1024;

export class PayloadTooLargeError extends Error {
  constructor() {
    super(`request body exceeds the ${MAX_REST_REQUEST_BODY_BYTES}-byte limit`);
    this.name = "PayloadTooLargeError";
  }
}

/** Parse JSON while enforcing a byte limit even when Content-Length is absent or inaccurate. */
export async function parseJsonRequestBody(request: Request): Promise<unknown> {
  const contentLengthHeader = request.headers.get("content-length");
  const declaredLength = contentLengthHeader !== null ? Number(contentLengthHeader) : Number.NaN;
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REST_REQUEST_BODY_BYTES) {
    try { await request.body?.cancel(); } catch { /* The oversized request is already rejected. */ }
    throw new PayloadTooLargeError();
  }

  if (!request.body) throw new SyntaxError("Unexpected end of JSON input");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_REST_REQUEST_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* The oversized request is already rejected. */ }
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function requestObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function assertAllowedFields(body: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new TypeError(`unsupported body field: ${key}`);
  }
}

export function assertStringFields(body: Record<string, unknown>, fields: readonly string[]): void {
  for (const key of fields) {
    if (body[key] !== undefined && typeof body[key] !== "string") {
      throw new TypeError(`${key} must be a string`);
    }
  }
}

export function assertExcludeField(body: Record<string, unknown>): void {
  const exclude = body.exclude;
  if (exclude !== undefined && (!Array.isArray(exclude) || exclude.some(item => typeof item !== "string"))) {
    throw new TypeError("exclude must be an array of strings");
  }
}
