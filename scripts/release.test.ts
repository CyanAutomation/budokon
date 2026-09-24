import assert from "node:assert/strict";
import test from "node:test";
import {
  createReleasePlan,
  parseConventionalCommit,
  parseReleaseTag,
  publishRelease,
  type ConventionalCommit,
} from "./release.js";

const commit = (subject: string, body = "", hash = "0123456789abcdef0123456789abcdef01234567"): ConventionalCommit => ({
  hash,
  subject,
  body,
});

test("release tag parser accepts existing short tags and full semantic-version tags", () => {
  assert.deepEqual(parseReleaseTag("v1.0"), { tag: "v1.0", version: "1.0.0" });
  assert.deepEqual(parseReleaseTag("v2.3.4"), { tag: "v2.3.4", version: "2.3.4" });
  assert.equal(parseReleaseTag("dataset-v2026.09.1"), undefined);
  assert.equal(parseReleaseTag("v1"), undefined);
});

test("Conventional Commit parser recognizes scopes and both breaking-change markers", () => {
  assert.deepEqual(parseConventionalCommit(commit("feat(api): add judoka filters")), {
    type: "feat",
    subject: "add judoka filters",
    breaking: false,
    breakingDescription: undefined,
    hash: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.equal(parseConventionalCommit(commit("refactor!: change catalogue response"))?.breaking, true);
  assert.equal(parseConventionalCommit(commit("docs: describe response", "\nBREAKING CHANGE: remove old response field"))?.breakingDescription,
    "remove old response field");
  assert.equal(parseConventionalCommit(commit("not a conventional commit")), undefined);
});

test("release plan picks the highest-impact change and creates semantic release notes", () => {
  const plan = createReleasePlan([
    commit("fix(api): handle empty cursor", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    commit("feat(search): add country aliases", "", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    commit("docs: update operations guide", "", "cccccccccccccccccccccccccccccccccccccccc"),
  ], "1.4.8");

  assert.equal(plan?.version, "1.5.0");
  assert.equal(plan?.releaseType, "minor");
  assert.match(plan?.notes ?? "", /## Features\n\n- add country aliases/);
  assert.match(plan?.notes ?? "", /## Bug Fixes\n\n- handle empty cursor/);
  assert.doesNotMatch(plan?.notes ?? "", /operations guide/);
});

test("breaking changes override features and are called out separately", () => {
  const plan = createReleasePlan([
    commit("feat(api)!: remove legacy alias", "\nBREAKING CHANGE: clients must use immutable IDs"),
  ], "2.9.7");

  assert.equal(plan?.version, "3.0.0");
  assert.equal(plan?.releaseType, "major");
  assert.match(plan?.notes ?? "", /## Breaking Changes\n\n- clients must use immutable IDs/);
  assert.match(plan?.notes ?? "", /## Features\n\n- remove legacy alias/);
});

test("patch releases include fixes, performance improvements, and reverts", () => {
  const plan = createReleasePlan([
    commit("perf(search): cache normalized names", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    commit("revert: undo a broken migration", "", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
  ], "1.2.3");

  assert.equal(plan?.version, "1.2.4");
  assert.match(plan?.notes ?? "", /## Performance Improvements/);
  assert.match(plan?.notes ?? "", /## Reverts/);
});

test("documentation-only and empty commit ranges do not create a release", () => {
  assert.equal(createReleasePlan([], "1.2.3"), undefined);
  assert.equal(createReleasePlan([commit("docs: clarify API limits")], "1.2.3"), undefined);
  assert.equal(createReleasePlan([commit("chore: refresh generated metadata")], "1.2.3"), undefined);
});

test("release publisher posts a GitHub release for the exact analyzed commit", async () => {
  const plan = createReleasePlan([commit("fix: repair response header")], "1.2.3");
  assert.ok(plan);
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await publishRelease(plan, {
    repository: "CyanAutomation/budokon",
    token: "test-token",
    targetCommit: "fedcba9876543210fedcba9876543210fedcba98",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ html_url: "https://github.com/CyanAutomation/budokon/releases/tag/v1.2.4" }, { status: 201 });
    },
  });

  assert.equal(result.published, true);
  assert.equal(requestUrl, "https://api.github.com/repos/CyanAutomation/budokon/releases");
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-token");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    tag_name: "v1.2.4",
    target_commitish: "fedcba9876543210fedcba9876543210fedcba98",
    name: "v1.2.4",
    body: plan.notes,
    draft: false,
    prerelease: false,
  });
  assert.equal(result.url, "https://github.com/CyanAutomation/budokon/releases/tag/v1.2.4");
});

test("dry-run release returns its plan without credentials or a network request", async () => {
  const plan = createReleasePlan([commit("feat: expose country list")], "1.2.3");
  assert.ok(plan);
  let called = false;
  const result = await publishRelease(plan, {
    dryRun: true,
    fetchImpl: async () => {
      called = true;
      return new Response(null, { status: 500 });
    },
  });

  assert.deepEqual(result, { published: false, dryRun: true });
  assert.equal(called, false);
});

test("release publisher reports GitHub API failures", async () => {
  const plan = createReleasePlan([commit("fix: repair response header")], "1.2.3");
  assert.ok(plan);
  await assert.rejects(publishRelease(plan, {
    repository: "CyanAutomation/budokon",
    token: "test-token",
    targetCommit: "fedcba9876543210fedcba9876543210fedcba98",
    fetchImpl: async () => new Response("release denied", { status: 403 }),
  }), /GitHub release request failed \(403\)/);
});
