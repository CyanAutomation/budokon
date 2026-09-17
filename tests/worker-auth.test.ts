import assert from "node:assert/strict";
import test from "node:test";
import { authorized, credential } from "../worker/auth.js";

function request(headers = {}) {
  return new Request("https://example.test/v1/judoka", { headers });
}

/** @see ../README.md#mcp-authentication-and-allowed-methods */
test("credential parses only documented worker/API authentication syntax", () => {
  const cases = [
    { name: "X-API-Key", headers: { "x-api-key": "api-secret" }, expected: "api-secret" },
    { name: "canonical Bearer scheme", headers: { authorization: "Bearer bearer-secret" }, expected: "bearer-secret" },
    { name: "mixed-case Bearer scheme", headers: { authorization: "bEaReR bearer-secret" }, expected: "bearer-secret" },
    { name: "unsupported scheme", headers: { authorization: "Basic bearer-secret" }, expected: "" },
    { name: "malformed Bearer scheme", headers: { authorization: "Bearer-bearer-secret" }, expected: "" },
    { name: "empty Bearer token", headers: { authorization: "Bearer " }, expected: "" },
    { name: "leading HTTP field whitespace", headers: { authorization: " Bearer bearer-secret" }, expected: "bearer-secret" },
    { name: "trailing HTTP field whitespace", headers: { authorization: "Bearer bearer-secret " }, expected: "bearer-secret" },
    { name: "whitespace within the token", headers: { authorization: "Bearer bearer secret" }, expected: "" },
    {
      name: "simultaneous Authorization and X-API-Key headers",
      headers: { authorization: "Bearer bearer-secret", "x-api-key": "api-secret" },
      expected: ""
    },
    { name: "missing credential", headers: {}, expected: "" }
  ];

  for (const requestCase of cases) {
    assert.equal(credential(request(requestCase.headers)), requestCase.expected, requestCase.name);
  }
});

test("authorized accepts only an exact credential match", () => {
  assert.equal(authorized(request({ "x-api-key": "correct-secret" }), "correct-secret"), true);
  assert.equal(authorized(request({ "x-api-key": "wrong--secret" }), "correct-secret"), false);
  assert.equal(authorized(request({ "x-api-key": "short" }), "correct-secret"), false);
  assert.equal(authorized(request({ "x-api-key": "correct-secret-with-extra" }), "correct-secret"), false);
  assert.equal(authorized(request({ "x-api-key": "secret" }), undefined), false);
  assert.equal(authorized(request(), "secret"), false);
});
