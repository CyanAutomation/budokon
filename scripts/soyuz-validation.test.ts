import assert from "node:assert/strict";
import test from "node:test";
import { validateSoyuzBaseUrl } from "./validate-soyuz-url.js";
import { validateSoyuzRunId } from "./validate-soyuz-run-id.js";

const SOYUZ_ORIGIN = "https://soyuz.scheimann.workers.dev";

test("Soyuz URL validation accepts only the trusted origin", () => {
  assert.equal(validateSoyuzBaseUrl(SOYUZ_ORIGIN), SOYUZ_ORIGIN);
  assert.equal(validateSoyuzBaseUrl(`${SOYUZ_ORIGIN}/`), SOYUZ_ORIGIN);
});

test("Soyuz URL validation rejects missing, malformed, or non-string values", () => {
  for (const value of [undefined, null, "", " ", "not a URL", 17]) {
    assert.throws(() => validateSoyuzBaseUrl(value), /SOYUZ_BASE_URL must be/u);
  }
});

test("Soyuz URL validation rejects alternate destinations and URL components", () => {
  for (const value of [
    "http://soyuz.scheimann.workers.dev",
    "https://evil.example",
    "https://soyuz.scheimann.workers.dev.evil.example",
    "https://user@soyuz.scheimann.workers.dev",
    "https://soyuz.scheimann.workers.dev/v1",
    "https://soyuz.scheimann.workers.dev/?redirect=evil",
    "https://soyuz.scheimann.workers.dev/#fragment",
  ]) {
    assert.throws(() => validateSoyuzBaseUrl(value), /SOYUZ_BASE_URL must be/u, value);
  }
});

test("Soyuz run ID validation accepts UUIDv7 IDs", () => {
  const runId = "018f47a5-51f3-7abc-8def-0123456789ab";
  assert.equal(validateSoyuzRunId(runId), runId);
});

test("Soyuz run ID validation rejects non-UUIDv7 IDs", () => {
  for (const value of [
    undefined,
    null,
    17,
    "018f47a5-51f3-4abc-8def-0123456789ab",
    "018f47a5-51f3-7abc-7def-0123456789ab",
    "018f47a5-51f3-7abc-8def-0123456789ab\n",
    "not-a-run-id",
  ]) {
    assert.throws(() => validateSoyuzRunId(value), /UUIDv7/u);
  }
});
