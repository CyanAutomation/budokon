import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { createWorker } from "../worker/router.js";

// Public-discovery requirement: README.md, "REST API" (the JSON document at /).
test("landing document derives all links from the supplied origin", async () => {
  const origin = "https://budokon.example";
  const landing = await createWorker("openapi: 3.1.0").fetch(
    new Request(`${origin}/`),
    { API_KEY: "test-key" },
  );

  assert.equal(landing.status, 200);
  assert.equal(landing.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await landing.json(), {
    name: "BU-DO-KON public catalogue API",
    documentation: `${origin}/docs`,
    openapi: `${origin}/openapi/v1.yaml`,
    status: `${origin}/v1/status`,
    version: `${origin}/v1/version`,
  });
});

test("documentation page uses restrictive security headers", async () => {
  const documentation = await createWorker("openapi: 3.1.0").fetch(
    new Request("https://budokon.example/docs"),
    { API_KEY: "test-key" },
  );

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
    ["style-src", new Set(["'unsafe-inline'"])],
    ["connect-src", new Set(["'none'"])],
    ["base-uri", new Set(["'none'"])],
    ["frame-ancestors", new Set(["'none'"])],
  ]));
});

test("documentation links to the OpenAPI contract and gives a usable example", async () => {
  const documentation = await createWorker("openapi: 3.1.0").fetch(
    new Request("https://budokon.example/docs"),
    { API_KEY: "test-key" },
  );
  const docs = await documentation.text();

  assert.equal(documentation.status, 200);
  assert.match(docs, /<h1>BU-DO-KON API reference<\/h1>/);
  assert.match(docs, /href="\/openapi\/v1\.yaml"/);
  assert.ok(docs.includes(`curl "https://budokon.example/v1/judoka?q=shozo&amp;countryCode=JP"`));
  assert.doesNotMatch(docs, /SwaggerUIBundle|swagger-ui\/swagger-ui/);
  assert.doesNotMatch(docs, /<script\b/i);
});

test("documentation lists every REST operation from the OpenAPI contract", async () => {
  const documentation = await createWorker("openapi: 3.1.0").fetch(
    new Request("https://budokon.example/docs"),
    { API_KEY: "test-key" },
  );
  const docs = await documentation.text();
  const specificationSource = await readFile(new URL("../openapi/v1.yaml", import.meta.url), "utf8");
  const specification = parse(specificationSource) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

  for (const [path, operations] of Object.entries(specification.paths ?? {})) {
    for (const method of Object.keys(operations).filter(candidate => methods.has(candidate))) {
      const label = `<span class="method ${method}">${method.toUpperCase()}</span><code>${path}</code>`;
      assert.ok(docs.includes(label), `The /docs endpoint list must include ${method.toUpperCase()} ${path}`);
    }
  }
});

// OpenAPI publication requirement: README.md, "REST API" (the contract at /openapi/v1.yaml).
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

test("discovery routes accept GET only and describe their Allow header", async () => {
  const worker = createWorker("openapi: 3.1.0");
  for (const path of ["/", "/docs", "/openapi/v1.yaml"]) {
    const response = await worker.fetch(new Request(`https://budokon.example${path}`, { method: "POST" }), { API_KEY: "test-key" });
    assert.equal(response.status, 405, path);
    assert.equal(response.headers.get("allow"), "GET", path);
    assert.deepEqual(await response.json(), { error: { code: "method_not_allowed", message: "method not allowed" } }, path);
  }

  const preflight = await worker.fetch(new Request("https://budokon.example/docs", { method: "OPTIONS" }), { API_KEY: "test-key" });
  assert.equal(preflight.status, 405);
  assert.equal(preflight.headers.get("allow"), "GET");
});
