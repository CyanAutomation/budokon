import assert from "node:assert/strict";
import test from "node:test";
import { CatalogService } from "../build/runtime/domain/catalog-service.js";
import { DRAW_ALGORITHM, DrawService } from "../build/runtime/draw/draw-service.js";
import { JsonReadModelRepository } from "../build/runtime/repository/json-read-model-repository.js";
import { createRestHandlers } from "../build/runtime/api/handlers.js";
import { createMcpTools } from "../build/runtime/mcp/tools.js";
import type { JsonValue, Judoka } from "../build/runtime/domain/types.js";
import type { ReadModelRepository } from "../build/runtime/repository/read-model-repository.js";
import compiledModel from "./fixtures/compiled-model.js";

const repository = new JsonReadModelRepository(compiledModel);
const repositoryWithJudoka = (records: Judoka[]): ReadModelRepository => ({
  get datasetVersion() { return repository.datasetVersion; },
  get serviceVersion() { return repository.serviceVersion; },
  get sourceGitCommit() { return repository.sourceGitCommit; },
  get datasetChecksum() { return repository.datasetChecksum; },
  listJudoka: (): Judoka[] => records,
  getJudoka: id => repository.getJudoka(id),
  listTechniques: () => repository.listTechniques(),
  getTechnique: id => repository.getTechnique(id),
  listEvents: () => repository.listEvents(),
  getEvent: id => repository.getEvent(id),
  listCountries: () => repository.listCountries(),
  listWeightCategories: () => repository.listWeightCategories()
});
const catalog = new CatalogService(repository); const draw = new DrawService(catalog);
const rest = createRestHandlers({ catalog, draw }); const mcp = createMcpTools({ catalog, draw });

test("hidden judoka require an explicit authorized internal option", () => {
  assert.equal(catalog.listJudoka().some(j => j.isHidden), false);
  assert.equal(catalog.listJudoka({ includeHidden: true }).some(j => j.isHidden), false);
  assert.equal(catalog.listJudoka({ includeHidden: true, authorizedInternal: true }).some(j => j.isHidden), true);
});
test("gender and country filters compose with AND semantics", () => {
  const records = catalog.listJudoka({ filters: { gender: "male", countryCode: ["JP"] } });
  assert.deepEqual(records.map(j => j.slug), [
    "aaron-wolf",
    "shozo-fujii",
    "hifumi-abe",
    "naohisa-takato",
    "takanori-nagase",
    "shohei-ono"
  ]);
});

test("exclusions remove an otherwise eligible record", () => {
  const filters = { gender: "male", countryCode: ["JP"] };
  assert.ok(catalog.listJudoka({ filters }).some(j => j.slug === "shozo-fujii"));
  assert.equal(catalog.listJudoka({ filters, exclude: ["shozo-fujii"] }).some(j => j.slug === "shozo-fujii"), false);
});

test("draw count validation rejects a count larger than the eligible pool", () => {
  const poolSize = catalog.listJudoka().length;
  assert.throws(
    () => draw.draw({ count: poolSize + 1 }),
    error => {
      return error instanceof RangeError
        && error.message === `count ${poolSize + 1} exceeds eligible pool size ${poolSize}`;
    }
  );
});
test("display aliases, diacritic-free names, and legacy slugs resolve consistently", () => {
  for (const [inputType, input, expectedCanonicalSlug] of [
    ["canonical slug", "shozo-fujii", "shozo-fujii"],
    ["display alias", "Shozo Fujii", "shozo-fujii"],
    ["diacritic form", "Shōzō Fujii", "shozo-fujii"],
    ["legacy slug", "askley-mckenzie", "ashley-mckenzie"],
    ["unknown identifier", "unknown-judoka", undefined]
  ] as const) {
    assert.equal(catalog.getJudoka(input)?.slug, expectedCanonicalSlug, inputType);
  }
  assert.deepEqual(catalog.searchJudoka({ query: "Askley McKenzie" }).map(j => j.slug), ["ashley-mckenzie"]);
});

test("multi-technique filters match any requested technique across catalog, REST, MCP, and draws", () => {
  const filters = { signatureMoveIds: ["seoi-nage", "o-soto-gari"] };
  const expected = catalog.listJudoka({ filters }).map(j => j.slug);
  assert.ok(expected.includes("shozo-fujii") && expected.includes("nina-cutro-kelly"));
  assert.deepEqual(rest.listJudoka({ query: filters }).body.map(j => j.slug), expected);
  assert.deepEqual(mcp.search_judoka({ filters }).judoka.map(j => j.slug), expected);
  assert.equal(draw.draw({ count: 1, filters, seed: "multi-technique" }).poolSize, expected.length);
});
test("filters do not coerce missing field values into matches", () => {
  const records: Judoka[] = [
    { id: "null-value", slug: "null-value", countryCode: null, signatureMoveIds: [] },
    { id: "missing-value", slug: "missing-value", signatureMoveIds: [] }
  ];
  const sparseCatalog = new CatalogService(repositoryWithJudoka(records));
  assert.deepEqual(sparseCatalog.listJudoka({ filters: { countryCode: "null" } }), []);
  assert.deepEqual(sparseCatalog.listJudoka({ filters: { countryCode: "undefined" } }), []);
});
test("repository preserves the compiled dataset contract across object and serialized inputs", () => {
  const inputs = [
    ["object", compiledModel],
    ["JSON string", JSON.stringify(compiledModel)],
  ] as const;

  for (const [inputForm, input] of inputs) {
    const subject = new JsonReadModelRepository(input);

    assert.deepEqual({
      datasetVersion: subject.datasetVersion,
      serviceVersion: subject.serviceVersion,
      sourceGitCommit: subject.sourceGitCommit,
      datasetChecksum: subject.datasetChecksum,
    }, {
      datasetVersion: "2026.08.7",
      serviceVersion: "0.1.0",
      sourceGitCommit: compiledModel.manifest.sourceGitCommit,
      datasetChecksum: "sha256:870328b35375aaeede9b95df969325b8641105890d82dfc5a8b3996c90f6e8da",
    }, `${inputForm}: release metadata`);
    assert.deepEqual(subject.getJudoka("shozo-fujii"), {
      id: "57a86958-73c3-4dd3-b8b8-f0bbaab58b67",
      slug: "shozo-fujii",
      firstname: "Shōzō",
      surname: "Fujii",
      personType: "real",
      countryCode: "JP",
      weightClass: "-81",
      category: "Judo",
      stats: { power: 8, speed: 8, technique: 8, kumikata: 7, newaza: 8 },
      lastUpdated: "2026-08-14T00:00:00Z",
      profileUrl: "https://en.wikipedia.org/wiki/Sh%C5%8Dz%C5%8D_Fujii",
      bio: "Japanese judoka Shōzō Fujii won four consecutive world titles during the 1970s in the divisions now represented by 81 kg.",
      gender: "male",
      isHidden: false,
      rarity: "Legendary",
      signatureMoveIds: ["seoi-nage"],
      aliases: ["Shozo Fujii"],
      country: "Japan",
    }, `${inputForm}: judoka`);
    assert.deepEqual(subject.getTechnique("seoi-nage"), {
      id: "seoi-nage",
      name: "Seoi-nage",
      japanese: "背負投",
      style: "Judo",
      category: "Nage-waza",
      subCategory: "Te-waza",
      description: "A shoulder throw where the opponent is lifted and thrown over the shoulder.",
      link: "https://en.wikipedia.org/wiki/Seoi_nage",
    }, `${inputForm}: technique`);
    assert.deepEqual(subject.getEvent("failed-judogi-control"), {
      id: "failed-judogi-control",
      ruleset: "ju-do-kon-v1",
      category: "shiai",
      description: "The judoka fails judogi control and forfeits the contest.",
      effects: [{ action: "set", target: "match_result", value: "forfeit" }],
    }, `${inputForm}: event`);
    assert.deepEqual(Object.keys(subject.listCountries()), [
      "AT", "AU", "AZ", "BE", "BG", "BR", "BT", "CA", "CL", "CN", "CZ", "DE", "ES", "FR", "GB", "GE", "GR", "HR", "HU", "IT", "JM", "JP", "KR", "KZ", "MA", "MD", "MN", "MX", "NL", "PT", "RU", "SE", "TJ", "TR", "US", "UZ", "VU",
    ], `${inputForm}: countries`);
    assert.deepEqual(subject.listCountries().JP, {
      country: "Japan", code: "JP", lastUpdated: "2025-04-23T10:00:00Z", active: true,
    }, `${inputForm}: country details`);
    assert.deepEqual(subject.listWeightCategories(), [
      {
        gender: "female",
        description: "Women’s weight categories",
        categories: [
          { weight: "+78", descriptor: "Heavyweight" },
          { weight: "-48", descriptor: "Extra Lightweight" },
          { weight: "-52", descriptor: "Half Lightweight" },
          { weight: "-57", descriptor: "Lightweight" },
          { weight: "-63", descriptor: "Half Middleweight" },
          { weight: "-70", descriptor: "Middleweight" },
          { weight: "-78", descriptor: "Half Heavyweight" },
        ],
      },
      {
        gender: "male",
        description: "Men’s weight categories",
        categories: [
          { weight: "+100", descriptor: "Heavyweight" },
          { weight: "-100", descriptor: "Half Heavyweight" },
          { weight: "-60", descriptor: "Extra Lightweight" },
          { weight: "-66", descriptor: "Half Lightweight" },
          { weight: "-73", descriptor: "Lightweight" },
          { weight: "-81", descriptor: "Half Middleweight" },
          { weight: "-90", descriptor: "Middleweight" },
        ],
      },
    ], `${inputForm}: weight categories`);
  }

  const objectRecordCount = new JsonReadModelRepository(compiledModel).listJudoka().length;
  const serializedRecordCount = new JsonReadModelRepository(JSON.stringify(compiledModel)).listJudoka().length;
  assert.equal(serializedRecordCount, objectRecordCount, "serialization preserves the record count");
});
test("repository reports malformed serialized data with parse context", () => {
  assert.throws(
    () => new JsonReadModelRepository('{"judoka":'),
    error => error instanceof TypeError
      && error.message.startsWith("Failed to parse JSON:")
      && error.message.length > "Failed to parse JSON:".length
  );
});
test("repository rejects an empty dataset version", () => {
  assert.throws(
    () => new JsonReadModelRepository({ ...compiledModel, datasetVersion: "   " }),
    /invalid compiled dataset/,
  );
});

test("repository rejects invalid compiled dataset structure", () => {
  const cases = [
    ["judoka", { ...compiledModel, judoka: undefined }, "invalid compiled dataset"],
    ["techniques", { ...compiledModel, techniques: undefined }, "invalid compiled dataset"],
    ["countries", { ...compiledModel, countries: undefined }, "invalid compiled dataset"],
    ["countries string", { ...compiledModel, countries: "JP" }, "invalid compiled dataset"],
    ["countries array", { ...compiledModel, countries: [] }, "invalid compiled dataset"],
    ["weightCategories", { ...compiledModel, weightCategories: undefined }, "invalid compiled dataset"],
    ["manifest.serviceVersion", { ...compiledModel, manifest: { ...compiledModel.manifest, serviceVersion: undefined } }, "invalid compiled dataset: manifest.serviceVersion"],
    ["manifest.sourceGitCommit", { ...compiledModel, manifest: { ...compiledModel.manifest, sourceGitCommit: undefined } }, "invalid compiled dataset: manifest.sourceGitCommit"],
    ['manifest.checksums["budokon.json"]', { ...compiledModel, manifest: { ...compiledModel.manifest, checksums: { ...compiledModel.manifest.checksums, "budokon.json": undefined } } }, 'invalid compiled dataset: manifest.checksums["budokon.json"]'],
  ] as const;

  for (const [field, malformedModel, expectedMessage] of cases) {
    // These deliberately malformed values bypass compile-time validation to exercise runtime guards.
    assert.throws(
      () => new JsonReadModelRepository(malformedModel as unknown as JsonValue),
      error => error instanceof TypeError && error.message === expectedMessage,
      field,
    );
  }
});
test("REST and MCP seeded selections are byte-for-byte equivalent", () => {
  const input = { count: 1, filters: { gender: ["male"], countryCode: ["JP", "GE"] }, exclude: ["ilia-sulamanidze"], seed: "match-472-round-3" };
  const apiBytes = JSON.stringify(rest.draw({ body: input }).body);
  const mcpBytes = JSON.stringify(mcp.draw_judoka({ ...input, filters: { countryCode: ["GE", "JP"], gender: "male" } }));
  assert.equal(apiBytes, mcpBytes);
});
test("version, draw, and MCP results expose the canonical dataset version", () => {
  assert.equal(rest.version().body.datasetVersion, compiledModel.datasetVersion);
  assert.equal(rest.draw({ body: { seed: "version-test" } }).body.datasetVersion, compiledModel.datasetVersion);
  assert.equal(mcp.search_judoka().datasetVersion, compiledModel.datasetVersion);
  assert.equal(mcp.get_judoka({ id: "shozo-fujii" }).datasetVersion, compiledModel.datasetVersion);
  assert.equal(mcp.version().datasetVersion, compiledModel.datasetVersion);
});

test("version endpoint release identity matches repository metadata and the draw algorithm contract", () => {
  const restVersion = rest.version().body;
  const mcpVersion = mcp.version();
  const expectedVersion = {
    datasetVersion: repository.datasetVersion,
    serviceVersion: repository.serviceVersion,
    sourceGitCommit: repository.sourceGitCommit,
    datasetChecksum: repository.datasetChecksum,
    drawAlgorithms: [DRAW_ALGORITHM],
    defaultDrawAlgorithm: DRAW_ALGORITHM,
  };

  assert.deepEqual(restVersion, expectedVersion);
  assert.deepEqual(mcpVersion, expectedVersion);
});

test("search normalizes case, whitespace, punctuation, and diacritics across every text field", () => {
  assert.deepEqual(catalog.searchJudoka({ query: "  SHŌZŌ---FUJII " }).map(j => j.slug), ["shozo-fujii"]);
  assert.deepEqual(catalog.searchJudoka({ query: "cutro kelly" }).map(j => j.slug), ["nina-cutro-kelly"]);
  assert.deepEqual(catalog.searchJudoka({ query: "sulam" }).map(j => j.slug), ["ilia-sulamanidze"]);
  assert.deepEqual(catalog.searchJudoka({ query: "mckenzie" }).map(j => j.slug), ["ashley-mckenzie"]);
  assert.deepEqual(catalog.searchJudoka({ query: "sulamanidize" }).map(j => j.slug), ["ilia-sulamanidze"]);
});

test("search constructs full names consistently when either name is null", () => {
  const records: Judoka[] = [
    { id: "surname-only", slug: "surname-only", firstname: null, surname: "Test", signatureMoveIds: [] },
    { id: "firstname-only", slug: "firstname-only", firstname: "Solo", surname: null, signatureMoveIds: [] }
  ];
  const service = new CatalogService(repositoryWithJudoka(records));

  assert.deepEqual(service.searchJudoka({ query: "test" }).map(j => j.id), ["surname-only"]);
  assert.deepEqual(service.searchJudoka({ query: "solo" }).map(j => j.id), ["firstname-only"]);
});

test("search composes with filters, exclusions, and visibility in UUID order", () => {
  const records: Judoka[] = [
    { id: "b", slug: "second-match", firstname: "Renée", surname: "Test", gender: "female", signatureMoveIds: [] },
    { id: "a", slug: "first-match", firstname: "Renee", surname: "Test", gender: "female", signatureMoveIds: [] },
    { id: "c", slug: "hidden-match", firstname: "Renee", surname: "Test", gender: "female", signatureMoveIds: [], isHidden: true },
    { id: "d", slug: "other-match", firstname: "Renee", surname: "Test", gender: "male", signatureMoveIds: [] }
  ];
  const service = new CatalogService(repositoryWithJudoka(records));
  assert.deepEqual(service.searchJudoka({ query: "renee", filters: { gender: "female" }, exclude: ["second-match"] }).map(j => j.id), ["a"]);
  assert.deepEqual(service.searchJudoka({ query: "renee", includeHidden: true, authorizedInternal: true }).map(j => j.id), ["a", "b", "c", "d"]);
});

test("REST and MCP searches conform and an absent query retains list behavior", () => {
  const restResult = rest.listJudoka({ query: { q: "  SHOZO! ", countryCode: "JP", exclude: "tatsuuma-ushiyama" } }).body;
  const mcpResult = mcp.search_judoka({ query: "  SHOZO! ", filters: { countryCode: "JP" }, exclude: ["tatsuuma-ushiyama"] }).judoka;
  assert.deepEqual(restResult, mcpResult);
  assert.deepEqual(rest.listJudoka().body, catalog.listJudoka());
  assert.deepEqual(mcp.search_judoka().judoka, catalog.listJudoka());
});
