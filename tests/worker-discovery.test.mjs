import assert from "node:assert/strict";
import test from "node:test";
import { documentationResponse, landingResponse, openApiResponse } from "../worker/discovery.js";

test("public discovery responses link only to the service's own documented entry points", async () => {
  const origin = "https://budokon.example";
  const landing = landingResponse(origin);
  assert.equal(landing.status, 200);
  assert.deepEqual(await landing.json(), {
    name: "BU-DO-KON public catalogue API",
    documentation: `${origin}/docs`, openapi: `${origin}/openapi/v1.yaml`,
    status: `${origin}/v1/status`, version: `${origin}/v1/version`
  });
  const docs = await documentationResponse(origin).text();
  assert.match(docs, /BU-DO-KON API/);
  assert.match(docs, /openapi\/v1\.yaml/);
  assert.match(docs, /v1\/status/);
  const contract = openApiResponse("openapi: 3.1.0\n");
  assert.equal(contract.headers.get("content-type"), "application/yaml; charset=utf-8");
  assert.equal(await contract.text(), "openapi: 3.1.0\n");
});
