import assert from "node:assert/strict";
import test from "node:test";
import { countStringField } from "../src/domain/coverage-counts.js";

test("countStringField ignores missing and empty values and sorts keys", () => {
  const records = [
    { country: "JP" },
    { country: "FR" },
    { country: "JP" },
    { country: "" },
    { country: undefined },
    { country: null },
    { country: 42 },
  ];

  const counts = countStringField(records, "country");

  assert.deepEqual(counts, { FR: 1, JP: 2 });
  assert.deepEqual(Object.keys(counts), ["FR", "JP"]);
});
