import assert from "node:assert/strict";
import test from "node:test";
import { authorized, credential } from "../worker/auth.js";

function request(headers = {}) {
  return new Request("https://example.test/v1/judoka", { headers });
}

test("credential accepts the API key header before a bearer token", () => {
  const input = request({ "x-api-key": "header-secret", authorization: "Bearer bearer-secret" });

  assert.equal(credential(input), "header-secret");
});

test("credential accepts bearer tokens case-insensitively", () => {
  assert.equal(credential(request({ authorization: "bEaReR bearer-secret" })), "bearer-secret");
});

test("authorized accepts only an exact credential match", () => {
  assert.equal(authorized(request({ "x-api-key": "correct-secret" }), "correct-secret"), true);
  assert.equal(authorized(request({ "x-api-key": "wrong--secret" }), "correct-secret"), false);
  assert.equal(authorized(request({ "x-api-key": "short" }), "correct-secret"), false);
});

test("authorized rejects missing configured and supplied secrets", () => {
  assert.equal(authorized(request({ "x-api-key": "secret" }), undefined), false);
  assert.equal(authorized(request(), "secret"), false);
});
