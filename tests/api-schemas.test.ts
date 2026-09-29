import assert from "node:assert/strict";
import test from "node:test";
import { validateDrawBody } from "../src/api/schemas.js";

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
