import assert from "node:assert/strict";
import test from "node:test";
import {
  CatalogService,
  EventDrawService,
  JsonReadModelRepository,
  createMcpTools,
  createRestHandlers,
  createRestRouter,
  DrawService,
} from "../build/runtime/index.js";
import compiledModel from "./fixtures/compiled-model.js";

const events = [
  {
    id: "great-warmup", ruleset: "ju-do-kon-v1", category: "shiai",
    description: "The judoka completes an effective warm-up and enters the contest exceptionally well prepared.",
    effects: [{ action: "modify", target: "power", value: 1 }]
  },
  {
    id: "shido-false-attack", ruleset: "ju-do-kon-v1", category: "shiai",
    description: "The judoka receives a shido for making an attack without genuine intent to throw.",
    effects: [{ action: "modify", target: "kumikata", value: -1 }, { action: "modify", target: "shido", value: 1 }]
  },
  {
    id: "failed-judogi-control", ruleset: "ju-do-kon-v1", category: "shiai",
    description: "The judoka fails judogi control and forfeits the contest.",
    effects: [{ action: "set", target: "match_result", value: "forfeit" }]
  }
];
const repository = new JsonReadModelRepository({ ...compiledModel, events });
const catalog = new CatalogService(repository);
const eventDraw = new EventDrawService(repository);
const router = createRestRouter({ catalog, draw: new DrawService(catalog), eventDraw });
const request = (path: string, init?: RequestInit): Promise<Response> => router(new Request(`https://example.test${path}`, init));
const eventIds = events.map(event => event.id).sort();

test("event draws are ruleset-scoped, deterministic, and support category exclusions", () => {
  const input = { ruleset: "ju-do-kon-v1", category: "shiai", seed: "round-3", exclude: ["great-warmup"] };
  const first = eventDraw.draw(input);
  const second = eventDraw.draw({ ...input, exclude: ["great-warmup"] });
  assert.deepEqual(first, second);
  assert.equal(first.algorithm, "budokon-event-v1");
  assert.equal(first.poolSize, 2);
  assert.notEqual(first.event.id, "great-warmup");
  assert.throws(() => eventDraw.draw({ ruleset: "missing" }), /exceeds eligible pool size/);
});

test("event REST endpoints expose lookup/listing and POST-only draws", async () => {
  let response = await request("/v1/events?ruleset=ju-do-kon-v1&category=shiai");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(event => event.id), eventIds);

  response = await request("/v1/events/shido-false-attack");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, "shido-false-attack");

  response = await request("/v1/events/draw", { method: "POST", headers: { "content-type": "application/json" }, body: '{"ruleset":"ju-do-kon-v1","seed":"rest"}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).event.ruleset, "ju-do-kon-v1");

  assert.equal((await request("/v1/events/draw")).status, 405);
  assert.equal((await request("/v1/events?unknown=x")).status, 400);
});

test("MCP event tools share event-draw semantics", () => {
  const mcp = createMcpTools({ catalog, draw: new DrawService(catalog), eventDraw });
  assert.deepEqual(mcp.list_events({ ruleset: "ju-do-kon-v1" }).events.map(event => event.id), eventIds);
  assert.equal(mcp.get_event({ id: "failed-judogi-control" }).event.effects[0].value, "forfeit");
  assert.equal(mcp.draw_event({ ruleset: "ju-do-kon-v1", seed: "mcp" }).event.ruleset, "ju-do-kon-v1");
});

test("optional event draw adapters fail explicitly when the service is unavailable", () => {
  const draw = new DrawService(catalog);
  const rest = createRestHandlers({ catalog, draw });
  const mcp = createMcpTools({ catalog, draw });

  assert.throws(
    () => rest.drawEvent({ body: { ruleset: "ju-do-kon-v1" } }),
    /eventDraw service not configured/
  );
  assert.throws(
    () => mcp.draw_event({ ruleset: "ju-do-kon-v1" }),
    /eventDraw service not configured/
  );
});

test("compiled models from before event support expose an empty event collection", () => {
  const { events: _events, ...legacyCompiledModel } = compiledModel;
  const legacyRepository = new JsonReadModelRepository(legacyCompiledModel);

  assert.deepEqual(legacyRepository.listEvents(), []);
  assert.equal(legacyRepository.getEvent("great-warmup"), undefined);
});

test("event draw rejects an empty optional category as a bad request", async () => {
  const response = await request("/v1/events/draw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"ruleset":"ju-do-kon-v1","category":""}'
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.message, "category must be a non-empty string");
});
