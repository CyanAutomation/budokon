import assert from "node:assert/strict";
import test from "node:test";
import { canonicalRepresentationQuery } from "../worker/representation-query.js";

function canonicalQuery(pathAndQuery: string): Array<[string, string[]]> {
  return canonicalRepresentationQuery(new URL(pathAndQuery, "https://api.example"));
}

test("representation query identity ignores parameters unused by fixed REST endpoints", () => {
  assert.deepEqual(canonicalQuery("/v1/status?unknown=one"), []);
  assert.deepEqual(canonicalQuery("/v1/status?another=two"), []);
  assert.deepEqual(canonicalQuery("/v1/techniques/aikido?unknown=one"), []);
});

test("judoka lookup canonicalization trims valid includeHidden values but preserves invalid values", () => {
  assert.deepEqual(
    canonicalQuery("/v1/judoka/slug?includeHidden=%20true%20"),
    canonicalQuery("/v1/judoka/slug?includeHidden=true"),
  );
  assert.deepEqual(canonicalQuery("/v1/judoka/slug?includeHidden=perhaps"), [["includeHidden", ["perhaps"]]]);
});

test("empty scalar query values retain their invalid shape for route validation", () => {
  assert.deepEqual(canonicalQuery("/v1/events?category="), [["category", [""]]]);
});

test("query canonicalization follows resource-specific route semantics", () => {
  assert.deepEqual(canonicalQuery("/other?z=2&a=1"), [["a", ["1"]], ["z", ["2"]]]);
  assert.deepEqual(canonicalQuery("/v1?z=2&a=1"), [["a", ["1"]], ["z", ["2"]]]);
  assert.deepEqual(canonicalQuery("/v1/techniques/harai-goshi?ignored=one"), []);
  assert.deepEqual(canonicalQuery("/v1/judoka/slug?includeHidden=true&limit=1"), [
    ["includeHidden", ["true"]],
    ["limit", ["1"]],
  ]);
  assert.deepEqual(
    canonicalQuery("/v1/techniques?q=J%C5%ABd%C5%8D&category=Te-Waza&limit=10"),
    canonicalQuery("/v1/techniques?q=judo&category=te-waza&limit=10"),
  );
  assert.deepEqual(canonicalQuery("/v1/events?ruleset=ju-do-kon-v1&category=shiai&limit=10"), [
    ["category", ["shiai"]],
    ["limit", ["10"]],
    ["ruleset", ["ju-do-kon-v1"]],
  ]);
  assert.deepEqual(canonicalQuery("/v1/events/event-id?z=2&a=1"), [["a", ["1"]], ["z", ["2"]]]);
});
