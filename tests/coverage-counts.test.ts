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
  ];

  const counts = countStringField(records, "country");

  assert.deepEqual(counts, { FR: 1, JP: 2 });
  assert.deepEqual(Object.keys(counts), ["FR", "JP"]);
});

test("countStringField returns an empty map when there are no string values", () => {
  assert.deepEqual(countStringField([{ country: null }, { country: 42 }], "country"), {});
});
