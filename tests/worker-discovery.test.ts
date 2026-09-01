import assert from "node:assert/strict";
import test from "node:test";
import { documentationResponse, landingResponse, openApiResponse } from "../worker/discovery.js";

test("landing document derives all links from the supplied origin", async () => {
  const origin = "https://budokon.example";
  const landing = landingResponse(origin);
  assert.equal(landing.status, 200);
  assert.deepEqual(await landing.json(), {
    name: "BU-DO-KON public catalogue API",
    documentation: `${origin}/docs`, openapi: `${origin}/openapi/v1.yaml`,
    status: `${origin}/v1/status`, version: `${origin}/v1/version`
  });
});

test("documentation is user-visible and links to the OpenAPI contract", async () => {
  const documentation = documentationResponse();

  // Keep this in sync with README.md#worker-documentation-security-requirements.
  assert.equal(documentation.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(documentation.headers.get("x-content-type-options"), "nosniff");

  const directives = new Map(
    documentation.headers.get("content-security-policy")
      ?.split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, new Set(sources)]),
  );
  assert.deepEqual(directives, new Map([
    ["default-src", new Set(["'none'"])],
    ["script-src", new Set(["'self'", "'unsafe-inline'", "https://unpkg.com"])],
    ["style-src", new Set(["'self'", "'unsafe-inline'", "https://unpkg.com"])],
    ["img-src", new Set(["'self'", "data:", "https:"])],
    ["connect-src", new Set(["'self'"])],
    ["base-uri", new Set(["'none'"])],
    ["frame-ancestors", new Set(["'none'"])],
  ]));

  const docs = await documentation.text();
  assert.match(docs, /aria-label="BU-DO-KON API reference"/);
  assert.match(docs, /openapi\/v1\.yaml/);
});

test("OpenAPI response preserves the content type and body", async () => {
  const specification = "openapi: 3.1.0\n";
  const contract = openApiResponse(specification);
  assert.equal(contract.headers.get("content-type"), "application/yaml; charset=utf-8");
  assert.equal(await contract.text(), specification);
});
