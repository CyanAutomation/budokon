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

test("documentation response sets security headers", () => {
  const documentation = documentationResponse();
  assert.equal(documentation.headers.get("content-security-policy")?.includes("connect-src 'self'"), true);
  assert.equal(documentation.headers.get("x-content-type-options"), "nosniff");
});

test("documentation is user-visible and links to the OpenAPI contract", async () => {
  const documentation = documentationResponse();
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
