import assert from "node:assert/strict";
import test from "node:test";
import {
  parseEventListQuery,
  parseListQuery,
  parsePageQuery,
  validateDrawBody,
  validateEventDrawBody,
} from "../src/api/schemas.js";

test("validateDrawBody accepts valid optional fields and preserves their values", () => {
  const body = {
    count: 3,
    seed: "tournament-final",
    algorithm: "budokon-v1",
    filters: { countryCode: ["JP", "FR"], gender: "female" },
    exclude: ["shozo-fujii"],
    includeHidden: false,
  };

  assert.equal(validateDrawBody(body), body);
});

test("validateDrawBody rejects malformed scalar and collection fields", () => {
  for (const [value, message] of [
    [{ count: 0 }, "count must be a positive integer"],
    [{ seed: 3 }, "seed must be a string"],
    [{ includeHidden: "true" }, "includeHidden must be a boolean"],
    [{ exclude: ["ok", 1] }, "exclude must be an array of strings"],
    [{ filters: { gender: [] } }, "filter gender must be a string or non-empty array of strings"],
    [{ filters: { unknown: "x" } }, "unsupported filter: unknown"],
  ] as const) {
    assert.throws(() => validateDrawBody(value), { name: "TypeError", message });
  }
});

test("parseListQuery normalizes comma-separated and repeated filter values", () => {
  assert.deepEqual(parseListQuery(new URLSearchParams(
    "countryCode=JP,FR&countryCode=GB&gender=female&exclude=one,two&includeHidden=true&q=champion&limit=25&cursor=next",
  )), {
    filters: { countryCode: ["JP", "FR", "GB"], gender: ["female"] },
    exclude: ["one", "two"],
    query: "champion",
    includeHidden: true,
    limit: 25,
    cursor: "next",
  });
});

test("parseListQuery rejects unsupported, empty, and repeated single-value parameters", () => {
  for (const [query, message] of [
    ["unknown=value", "unsupported query parameter: unknown"],
    ["countryCode=%20", "filter countryCode must not be empty"],
    ["q=first&q=second", "q must have one value"],
    ["includeHidden=yes", "includeHidden must be true or false"],
    ["includeHidden=true&includeHidden=false", "includeHidden must be true or false"],
    ["limit=0", "limit must be an integer from 1 through 100"],
    ["limit=101", "limit must be an integer from 1 through 100"],
    ["cursor=a&cursor=b", "cursor must have one value"],
  ] as const) {
    assert.throws(() => parseListQuery(new URLSearchParams(query)), { name: "TypeError", message });
  }
});

test("parsePageQuery accepts its inclusive bounds and rejects malformed limits", () => {
  assert.deepEqual(parsePageQuery(new URLSearchParams("limit=1")), { limit: 1, cursor: undefined });
  assert.deepEqual(parsePageQuery(new URLSearchParams("limit=100")), { limit: 100, cursor: undefined });
  for (const query of ["limit=1.5", "limit=1&limit=2", "cursor=a&cursor=b"]) {
    assert.throws(() => parsePageQuery(new URLSearchParams(query)), TypeError);
  }
});

test("parseEventListQuery accepts its filters and pagination and rejects invalid values", () => {
  assert.deepEqual(parseEventListQuery(new URLSearchParams("ruleset=ju-do-kon-v1&category=shiai&limit=2&cursor=next")), {
    ruleset: "ju-do-kon-v1",
    category: "shiai",
    limit: 2,
    cursor: "next",
  });
  for (const [query, message] of [
    ["category=", "category must not be empty"],
    ["ruleset=a&ruleset=b", "ruleset must have one value"],
    ["other=value", "unsupported query parameter: other"],
  ] as const) {
    assert.throws(() => parseEventListQuery(new URLSearchParams(query)), { name: "TypeError", message });
  }
});

test("validateEventDrawBody requires a ruleset and rejects malformed optional fields", () => {
  const body = { ruleset: "ju-do-kon-v1", category: "shiai", seed: "final", exclude: ["event-a"] };
  assert.equal(validateEventDrawBody(body), body);
  for (const [value, message] of [
    [{}, "ruleset must be a non-empty string"],
    [{ ruleset: "   " }, "ruleset must be a non-empty string"],
    [{ ruleset: "ju-do-kon-v1", category: 3 }, "category must be a string"],
    [{ ruleset: "ju-do-kon-v1", exclude: "event-a" }, "exclude must be an array of strings"],
    [{ ruleset: "ju-do-kon-v1", extra: true }, "unsupported body field: extra"],
  ] as const) {
    assert.throws(() => validateEventDrawBody(value), { name: "TypeError", message });
  }
});
