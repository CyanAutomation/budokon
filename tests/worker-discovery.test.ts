import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { documentationResponse, landingResponse } from "../worker/discovery.js";
import { createWorker } from "../worker/router.js";

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

test("worker serves the byte-preserved OpenAPI contract", async () => {
  const specification = `openapi: 3.1.0
info:
  title: Test catalogue API
  version: 1.0.0
paths:
  /v1/status:
    get:
      responses:
        "200":
          description: Catalogue status
`;
  const contract = await createWorker(specification).fetch(
    new Request("https://budokon.example/openapi/v1.yaml"),
    { API_KEY: "test-key" },
  );

  assert.equal(contract.status, 200);
  assert.equal(contract.headers.get("content-type"), "application/yaml; charset=utf-8");
  const responseBytes = new Uint8Array(await contract.arrayBuffer());
  assert.deepEqual(
    responseBytes,
    new TextEncoder().encode(specification),
  );
  const responseDocument = new TextDecoder().decode(responseBytes);
  assert.match(responseDocument, /^openapi: 3\.1\.0$/m);
  assert.match(responseDocument, /^  \/v1\/status:$/m);
});

test("published OpenAPI models response bodies, cache validation, visibility, and rate limiting", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await promisify(execFile)("ruby", ["scripts/validate-openapi.rb"], { cwd: root });
});
