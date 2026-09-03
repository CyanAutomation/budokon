import assert from "node:assert/strict";
import test from "node:test";
import { authorized, credential } from "../worker/auth.js";

function request(headers = {}) {
  return new Request("https://example.test/v1/judoka", { headers });
}

test("credential accepts bearer tokens case-insensitively", () => {
  assert.equal(credential(request({ authorization: "bEaReR bearer-secret" })), "bearer-secret");
});

test("authorized rejects both credential headers as required by the worker/API security documentation", () => {
  const expected = "correct-secret";

  assert.equal(authorized(request({ "x-api-key": "api-secret", authorization: "Bearer bearer-secret" }), expected), false);
  assert.equal(authorized(request({ "x-api-key": expected, authorization: `Bearer ${expected}` }), expected), false);
  assert.equal(authorized(request({ "x-api-key": expected, authorization: "Bearer wrong-secret" }), expected), false);
  assert.equal(authorized(request({ "x-api-key": "wrong-secret", authorization: `Bearer ${expected}` }), expected), false);
});

test("authorized accepts only an exact credential match", () => {
  assert.equal(authorized(request({ "x-api-key": "correct-secret" }), "correct-secret"), true);
  assert.equal(authorized(request({ "x-api-key": "wrong--secret" }), "correct-secret"), false);
  assert.equal(authorized(request({ "x-api-key": "short" }), "correct-secret"), false);
  assert.equal(authorized(request({ "x-api-key": "correct-secret-with-extra" }), "correct-secret"), false);
});

test("authorized rejects missing configured and supplied secrets", () => {
  assert.equal(authorized(request({ "x-api-key": "secret" }), undefined), false);
  assert.equal(authorized(request(), "secret"), false);
});
