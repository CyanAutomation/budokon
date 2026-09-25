import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";

type OpenApiObject = Record<string, unknown>;

function asObject(value: unknown): OpenApiObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as OpenApiObject
    : undefined;
}

function valueAt(root: unknown, ...segments: string[]): unknown {
  let value = root;
  for (const segment of segments) value = asObject(value)?.[segment];
  return value;
}

function format(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function assertEqual(actual: unknown, expected: unknown, context: string): void {
  if (isDeepStrictEqual(actual, expected)) return;
  throw new Error(`${context}: expected ${format(expected)}, got ${format(actual)}`);
}

export function parseOpenApiYaml(source: string): unknown {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid OpenAPI YAML: ${document.errors.map(error => error.message).join("; ")}`);
  }

  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid OpenAPI YAML: ${detail}`, { cause: error });
  }
}

export function validateOpenApiYaml(source: string): void {
  validateOpenApiDocument(parseOpenApiYaml(source));
}

export function validateOpenApiDocument(document: unknown): void {
  const expectedResponses: Record<string, Record<string, Record<string, string>>> = {
    "/v1/judoka": { get: { "200": "JudokaList", "304": "NotModified", "429": "RateLimited" } },
    "/v1/judoka/{id}": { get: { "200": "Judoka", "304": "NotModified", "429": "RateLimited" } },
    "/v1/techniques": { get: { "200": "TechniqueList", "304": "NotModified", "429": "RateLimited" } },
    "/v1/techniques/{id}": { get: { "200": "Technique", "304": "NotModified", "429": "RateLimited" } },
    "/v1/events": { get: { "200": "EventList", "304": "NotModified", "429": "RateLimited" } },
    "/v1/events/{id}": { get: { "200": "Event", "304": "NotModified", "429": "RateLimited" } },
    "/v1/events/draw": { post: { "200": "EventDraw", "429": "RateLimited" } },
    "/v1/countries": { get: { "200": "Countries", "304": "NotModified", "429": "RateLimited" } },
    "/v1/weight-categories": { get: { "200": "WeightCategories", "304": "NotModified", "429": "RateLimited" } },
    "/v1/version": { get: { "200": "Version", "304": "NotModified", "429": "RateLimited" } },
    "/v1/status": { get: { "200": "Status", "304": "NotModified", "429": "RateLimited" } },
    "/v1/coverage": { get: { "200": "Coverage", "304": "NotModified", "429": "RateLimited" } },
    "/v1/draw": { post: { "200": "JudokaDraw", "429": "RateLimited" } },
  };

  for (const [path, methods] of Object.entries(expectedResponses)) {
    for (const [method, responses] of Object.entries(methods)) {
      for (const [status, component] of Object.entries(responses)) {
        const actual = valueAt(document, "paths", path, method, "responses", status, "$ref");
        assertEqual(actual, `#/components/responses/${component}`, `${method.toUpperCase()} ${path} response ${status}`);
      }
    }
  }

  const paths = asObject(valueAt(document, "paths")) ?? {};
  const visibilityOperations: string[][] = [];
  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = asObject(pathItemValue) ?? {};
    for (const [method, operationValue] of Object.entries(pathItem)) {
      const operation = asObject(operationValue);
      const parameters = operation?.parameters;
      if (!Array.isArray(parameters)) continue;
      if (parameters.some(parameter => asObject(parameter)?.["$ref"] === "#/components/parameters/IncludeHidden")) {
        visibilityOperations.push([path, method]);
      }
    }
  }
  assertEqual(visibilityOperations, [["/v1/judoka", "get"]], "operations using IncludeHidden");

  const notModifiedHeaders = asObject(valueAt(document, "components", "responses", "NotModified", "headers")) ?? {};
  assertEqual(Object.keys(notModifiedHeaders), ["ETag"], "NotModified response headers");

  const rateLimitedHeaders = asObject(valueAt(document, "components", "responses", "RateLimited", "headers")) ?? {};
  assertEqual(
    Object.keys(rateLimitedHeaders).sort(),
    ["RateLimit-Limit", "RateLimit-Policy", "Retry-After"].sort(),
    "RateLimited response headers",
  );

  const responseSchemas: Record<string, string> = {
    Judoka: "Judoka",
    Technique: "Technique",
    Event: "Event",
    EventDraw: "EventDraw",
    Version: "Version",
    Status: "Status",
    Coverage: "Coverage",
    JudokaDraw: "JudokaDraw",
  };
  for (const [response, schema] of Object.entries(responseSchemas)) {
    const actual = valueAt(
      document,
      "components", "responses", response, "content", "application/json", "schema", "$ref",
    );
    assertEqual(actual, `#/components/schemas/${schema}`, `${response} response body`);
  }

  assertEqual(
    valueAt(document, "components", "schemas", "Judoka", "properties", "sources", "items", "$ref"),
    "#/components/schemas/Source",
    "Judoka sources",
  );
  assertEqual(
    valueAt(document, "components", "schemas", "Judoka", "properties", "sourceUrls", "items", "format"),
    "uri",
    "Judoka sourceUrls",
  );
}
