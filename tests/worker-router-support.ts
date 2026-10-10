import assert from "node:assert/strict";
import { CatalogService, DrawService, EventDrawService, JsonReadModelRepository } from "../src/index.js";
import { createWorker } from "../worker/router.js";
import type { Env } from "../worker/env.js";
import fixtureModel from "./fixtures/compiled-model.js";

export const compiledModel = fixtureModel;
const repository = new JsonReadModelRepository(compiledModel);
export const catalog = new CatalogService(repository);
export const draw = new DrawService(catalog);
export const eventDraw = new EventDrawService(repository);

export const mockEnv: Env = {
  API_KEY: "test-api-key",
  INTERNAL_API_KEY: "internal-test-key",
  MCP_ALLOWED_HOSTNAMES: "example.test",
  PUBLIC_ALLOWED_ORIGINS: "https://example.com",
};

export const worker = createWorker("openapi: 3.0.0");

export async function mcpJson(response: Response) {
  const body = await response.text();
  const payload = body.startsWith("event: message\n")
    ? body.split("\n").find(line => line.startsWith("data: "))?.slice("data: ".length)
    : body;
  return JSON.parse(payload ?? "");
}

export async function successfulMcpToolJson(response: Response) {
  assert.equal(response.status, 200);
  const data = await mcpJson(response);
  assert.equal(data.result.isError, undefined);
  assert.equal(data.result.content[0].type, "text");
  return JSON.parse(data.result.content[0].text);
}
