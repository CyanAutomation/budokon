import assert from "node:assert/strict";
import test from "node:test";
import { cloudflareRequest, validateDeploymentTarget } from "./validate-cloudflare-deployment-target.js";

test("Cloudflare API request sends the account credential and returns the result", async () => {
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  const result = await cloudflareRequest("/workers/scripts/budokon/settings", "account-id", "api-token", async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    return Response.json({ success: true, result: { id: "script-id" } });
  });

  assert.equal(requestUrl, "https://api.cloudflare.com/client/v4/accounts/account-id/workers/scripts/budokon/settings");
  assert.equal(requestHeaders?.get("authorization"), "Bearer api-token");
  assert.deepEqual(result, { id: "script-id" });
});

test("Cloudflare API request distinguishes invalid JSON and API error responses", async () => {
  await assert.rejects(cloudflareRequest("/broken", "account-id", "api-token",
    async () => new Response("not-json", { status: 502 })), /non-JSON response, status 502/);
  await assert.rejects(cloudflareRequest("/denied", "account-id", "api-token",
    async () => Response.json({ success: false, errors: [{ code: 1001, message: "denied" }] }, { status: 403 })), /1001: denied/);
});

test("deployment target validation checks workers.dev routing against the account", async () => {
  const requested: string[] = [];
  const logs: string[] = [];
  await validateDeploymentTarget({
    accountId: "account-id",
    apiToken: "api-token",
    deploymentUrl: "https://budokon.team.workers.dev/",
    async fetchImpl(input) {
      const url = String(input);
      requested.push(url);
      return url.endsWith("/workers/subdomain")
        ? Response.json({ success: true, result: { subdomain: "team" } })
        : Response.json({ success: true, result: {} });
    },
    log(message) { logs.push(message); },
  });
  assert.equal(requested.length, 2);
  assert.equal(logs[0], "Deployment target validated: https://budokon.team.workers.dev -> Cloudflare Worker budokon");
});

test("deployment target validation checks all pages of production custom-domain records", async () => {
  const requested: string[] = [];
  const unrelated = Array.from({ length: 100 }, (_, index) => ({ hostname: `other-${index}.example.test`, service: "budokon" }));
  await validateDeploymentTarget({
    accountId: "account-id",
    apiToken: "api-token",
    deploymentUrl: "https://api.example.test",
    async fetchImpl(input) {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/workers/scripts/budokon/settings")) return Response.json({ success: true, result: {} });
      if (new URL(url).searchParams.get("page") === "1") return Response.json({ success: true, result: unrelated });
      return Response.json({ success: true, result: [{ hostname: "api.example.test", service: "budokon", environment: "production" }] });
    },
    log() {},
  });

  assert.ok(requested.some(url => url.includes("page=1")));
  assert.ok(requested.some(url => url.includes("page=2")));
});

test("deployment target validation rejects incomplete credentials and unsafe URLs", async () => {
  await assert.rejects(validateDeploymentTarget({ accountId: "", apiToken: "token", deploymentUrl: "https://example.test" }), /are required/);
  await assert.rejects(validateDeploymentTarget({ accountId: "account", apiToken: "token", deploymentUrl: "not a URL" }), /valid URL/);
  await assert.rejects(validateDeploymentTarget({ accountId: "account", apiToken: "token", deploymentUrl: "http://example.test" }), /HTTPS origin/);
});

test("deployment target validation rejects a workers.dev hostname owned by another account", async () => {
  await assert.rejects(validateDeploymentTarget({
    accountId: "account-id",
    apiToken: "api-token",
    deploymentUrl: "https://wrong.team.workers.dev",
    async fetchImpl(input) {
      return String(input).endsWith("/workers/subdomain")
        ? Response.json({ success: true, result: { subdomain: "team" } })
        : Response.json({ success: true, result: {} });
    },
    log() {},
  }), /does not route to Worker budokon/);
});
