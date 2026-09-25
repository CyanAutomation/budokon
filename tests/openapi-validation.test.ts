import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseOpenApiYaml, validateOpenApiDocument } from "../scripts/openapi-validation.js";

const source = await readFile(new URL("../openapi/v1.yaml", import.meta.url), "utf8");
const originalDocument = parseOpenApiYaml(source);

function documentCopy(): Record<string, any> {
  return structuredClone(originalDocument) as Record<string, any>;
}

test("published OpenAPI contract satisfies the repository requirements", () => {
  assert.doesNotThrow(() => validateOpenApiDocument(originalDocument));
});

test("OpenAPI YAML parsing rejects invalid YAML and aliases", () => {
  assert.throws(() => parseOpenApiYaml("paths: [unterminated"), /Invalid OpenAPI YAML/);
  assert.throws(() => parseOpenApiYaml("base: &base value\ncopy: *base\n"), /alias/i);
});

test("validator rejects an incorrect response reference", () => {
  const document = documentCopy();
  document.paths["/v1/judoka"].get.responses["200"].$ref = "#/components/responses/Judoka";

  assert.throws(() => validateOpenApiDocument(document), /GET \/v1\/judoka response 200/);
});

test("validator restricts IncludeHidden to the judoka list operation", () => {
  const document = documentCopy();
  document.paths["/v1/events"].get.parameters = [
    { $ref: "#/components/parameters/IncludeHidden" },
  ];

  assert.throws(() => validateOpenApiDocument(document), /operations using IncludeHidden/);
});

test("validator requires cache and rate-limit response headers", () => {
  const document = documentCopy();
  delete document.components.responses.NotModified.headers.ETag;

  assert.throws(() => validateOpenApiDocument(document), /NotModified response headers/);

  document.components.responses.NotModified.headers.ETag = {};
  delete document.components.responses.RateLimited.headers["Retry-After"];
  assert.throws(() => validateOpenApiDocument(document), /RateLimited response headers/);
});

test("validator requires documented response and judoka source schemas", () => {
  const document = documentCopy();
  document.components.responses.Judoka.content["application/json"].schema.$ref = "#/components/schemas/Event";

  assert.throws(() => validateOpenApiDocument(document), /Judoka response body/);

  document.components.responses.Judoka.content["application/json"].schema.$ref = "#/components/schemas/Judoka";
  document.components.schemas.Judoka.properties.sources.items.$ref = "#/components/schemas/SourceUrl";
  assert.throws(() => validateOpenApiDocument(document), /Judoka sources/);

  document.components.schemas.Judoka.properties.sources.items.$ref = "#/components/schemas/Source";
  document.components.schemas.Judoka.properties.sourceUrls.items.format = "url";
  assert.throws(() => validateOpenApiDocument(document), /Judoka sourceUrls/);
});
