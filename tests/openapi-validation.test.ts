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

test("public OpenAPI covers technique search and the privacy-safe coverage route", () => {
  const document = originalDocument as Record<string, any>;
  assert.ok(document.paths["/v1/coverage/public"]?.get, "public coverage must have a documented operation");
  assert.equal(document.paths["/v1/coverage/public"].get.operationId, "getPublicCoverage");
  const techniqueParams = document.paths["/v1/techniques"].get.parameters.map((entry: any) => entry.$ref);
  assert.ok(techniqueParams.includes("#/components/parameters/TechniqueQuery"));
  assert.ok(techniqueParams.includes("#/components/parameters/TechniqueCategory"));
  assert.ok(techniqueParams.includes("#/components/parameters/TechniqueSubCategory"));
  assert.equal("includeHidden" in document.components.parameters, false, "public schema must not advertise internal visibility controls");
  assert.equal(document.components.schemas.Judoka.properties.stats.type, "object");
  assert.equal(document.components.schemas.Technique.properties.subCategory.type, "string");
  assert.equal(document.components.schemas.EventEffect.properties.action.enum.join(","), "modify,set");
  assert.equal(document.components.schemas.Coverage.properties.hidden.deprecated, true);
  assert.equal(document.paths["/v1/draw"].post["x-openai-isConsequential"], false);
  assert.equal(document.paths["/v1/events/draw"].post["x-openai-isConsequential"], false);
});

test("OpenAPI validation rejects unregistered API operations", () => {
  const document = documentCopy();
  document.paths["/v1/unimplemented"] = { get: { operationId: "notImplemented", responses: { "200": { description: "No route" } } } };
  assert.throws(() => validateOpenApiDocument(document), /unexpected OpenAPI operation GET \/v1\/unimplemented/);
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

test("validator formats values that JSON cannot serialize", () => {
  const document = documentCopy();
  delete document.paths["/v1/judoka"].get.responses["200"].$ref;

  assert.throws(
    () => validateOpenApiDocument(document),
    { message: "GET /v1/judoka response 200: expected \"#/components/responses/JudokaList\", got undefined" },
  );

  document.paths["/v1/judoka"].get.responses["200"].$ref = Symbol("invalid-reference");
  assert.throws(
    () => validateOpenApiDocument(document),
    { message: "GET /v1/judoka response 200: expected \"#/components/responses/JudokaList\", got Symbol(invalid-reference)" },
  );
});

test("public contract rejects internal-only IncludeHidden controls", () => {
  const document = documentCopy();
  document.paths["/v1/events"].get.parameters = [
    { $ref: "#/components/parameters/IncludeHidden" },
  ];

  assert.throws(() => validateOpenApiDocument(document), /operations using internal-only IncludeHidden controls/);
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
