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
