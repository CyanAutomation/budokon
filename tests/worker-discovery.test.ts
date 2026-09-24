import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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

test("documentation is user-visible and links to the OpenAPI contract", async () => {
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

  const docs = await documentation.text();
  assert.match(docs, /<h1>BU-DO-KON API reference<\/h1>/);
  assert.match(docs, /href="\/openapi\/v1\.yaml"/);
  assert.match(docs, /<span class="method get">GET<\/span><code>\/v1\/judoka<\/code>/);
  assert.match(docs, /<span class="method post">POST<\/span><code>\/v1\/draw<\/code>/);
  assert.ok(docs.includes(`curl "https://budokon.example/v1/judoka?q=shozo&amp;countryCode=JP"`));
  assert.doesNotMatch(docs, /SwaggerUIBundle|swagger-ui\/swagger-ui/);
  assert.doesNotMatch(docs, /<script\b/i);

  const specification = await readFile(new URL("../openapi/v1.yaml", import.meta.url), "utf8");
  const pathEntries = Array.from(specification.matchAll(/^  (\/[^:\n]+):[ \t]*$/gmu));
  for (let index = 0; index < pathEntries.length; index += 1) {
    const entry = pathEntries[index];
    const blockStart = entry.index ?? 0;
    const blockEnd = pathEntries[index + 1]?.index ?? specification.length;
    const pathBlock = specification.slice(blockStart, blockEnd);
    for (const [, method] of pathBlock.matchAll(/^    (get|post|put|patch|delete|options|head):/gmu)) {
      const label = `<span class="method ${method.toLowerCase()}">${method.toUpperCase()}</span><code>${entry[1]}</code>`;
      assert.ok(docs.includes(label), `The /docs endpoint list must include ${method.toUpperCase()} ${entry[1]}`);
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

test("published OpenAPI models response bodies, cache validation, visibility, and rate limiting", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    await promisify(execFile)("ruby", ["scripts/validate-openapi.rb"], { cwd: root });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAPI validation failed: ${detail}`, { cause: error });
  }
});
