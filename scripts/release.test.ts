import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  createReleasePlan,
  createWorkflowReleasePlan,
  parseConventionalCommit,
  parseReleaseTag,
  publishRelease,
  runReleaseCommand,
  type ConventionalCommit,
} from "./release.js";

const commit = (subject: string, body = "", hash = "0123456789abcdef0123456789abcdef01234567"): ConventionalCommit => ({
  hash,
  subject,
  body,
});

async function createReleaseRepository(context: TestContext, subjects: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "budokon-release-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git(["init", "--quiet"]);
  git(["config", "user.name", "Release Test"]);
  git(["config", "user.email", "release-test@example.test"]);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
  await writeFile(path.join(root, "README.md"), "release fixture\n");
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "chore: initialize release fixture"]);
  git(["tag", "v1.2.3"]);
  for (const [index, subject] of subjects.entries()) {
    await writeFile(path.join(root, `change-${index}.txt`), `${subject}\n`);
    git(["add", "."]);
    git(["commit", "--quiet", "-m", subject]);
  }
  return root;
}

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

test("workflow release plans preserve the analyzed commit and separate no-release runs", () => {
  const targetCommit = "fedcba9876543210fedcba9876543210fedcba98";
  const plan = createReleasePlan([commit("fix: repair response header")], "1.2.3");
  assert.ok(plan);

  assert.deepEqual(createWorkflowReleasePlan(plan, targetCommit), {
    releaseRequired: true,
    targetCommit,
    version: "1.2.4",
    releaseType: "patch",
    notes: plan.notes,
  });
  assert.deepEqual(createWorkflowReleasePlan(undefined, targetCommit), {
    releaseRequired: false,
    targetCommit,
  });
});

test("workflow release plans reject a non-commit target", () => {
  assert.throws(() => createWorkflowReleasePlan(undefined, "main"), /full Git commit SHA/);
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

test("release command writes a plan for the exact workflow commit without publishing", async t => {
  const root = await createReleaseRepository(t, ["feat(api): add a release fixture"]);
  const outputFile = path.join(root, "workflow-output.txt");
  const messages: string[] = [];

  await runReleaseCommand({
    environment: { GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98", GITHUB_OUTPUT: outputFile },
    args: ["--plan-only", "--dry-run"],
    root,
    log(message) { messages.push(message); },
  });

  const plan = JSON.parse(await readFile(path.join(root, "release-plan.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual({ ...plan, notes: undefined }, {
    releaseRequired: true,
    targetCommit: "fedcba9876543210fedcba9876543210fedcba98",
    version: "1.3.0",
    releaseType: "minor",
    notes: undefined,
  });
  assert.match(String(plan.notes), /add a release fixture/);
  assert.equal(await readFile(outputFile, "utf8"), "release_required=true\nversion=1.3.0\n");
  assert.match(messages[0] ?? "", /^Dry run: v1\.3\.0 \(minor\)/);
});

test("release command reports a no-release workflow plan", async t => {
  const root = await createReleaseRepository(t, ["docs: clarify the release fixture"]);
  const outputFile = path.join(root, "workflow-output.txt");
  const messages: string[] = [];

  await runReleaseCommand({
    environment: { GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98", GITHUB_OUTPUT: outputFile },
    args: ["--plan-only"],
    root,
    log(message) { messages.push(message); },
  });

  assert.deepEqual(JSON.parse(await readFile(path.join(root, "release-plan.json"), "utf8")), {
    releaseRequired: false,
    targetCommit: "fedcba9876543210fedcba9876543210fedcba98",
  });
  assert.equal(await readFile(outputFile, "utf8"), "release_required=false\nversion=\n");
  assert.deepEqual(messages, ["No release-worthy Conventional Commits found."]);
});

test("release command dry-run does not publish and reports workflow outputs", async t => {
  const root = await createReleaseRepository(t, ["fix(api): repair fixture"]);
  const outputFile = path.join(root, "workflow-output.txt");
  let publishOptions: Parameters<typeof publishRelease>[1] | undefined;
  const messages: string[] = [];

  await runReleaseCommand({
    environment: {
      GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98",
      GITHUB_OUTPUT: outputFile,
    },
    args: ["--dry-run"],
    root,
    log(message) { messages.push(message); },
    async publish(_plan, options) {
      publishOptions = options;
      return { published: false, dryRun: true };
    },
  });

  assert.deepEqual(publishOptions, { dryRun: true });
  assert.equal(await readFile(outputFile, "utf8"), "released=false\nversion=\ndry_run=true\n");
  assert.match(messages[0] ?? "", /^Dry run: v1\.2\.4 \(patch\)/);
});

test("release command delegates publishing and records a successful release", async t => {
  const root = await createReleaseRepository(t, ["fix(api): repair fixture"]);
  const outputFile = path.join(root, "workflow-output.txt");
  let publishedVersion = "";

  await runReleaseCommand({
    environment: {
      GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98",
      GITHUB_OUTPUT: outputFile,
      GITHUB_REPOSITORY: "CyanAutomation/budokon",
      GITHUB_TOKEN: "test-token",
    },
    args: [],
    root,
    log() {},
    async publish(plan) {
      publishedVersion = plan.version;
      return { published: true, url: "https://example.test/release" };
    },
  });

  assert.equal(publishedVersion, "1.2.4");
  assert.equal(await readFile(outputFile, "utf8"), "released=true\nversion=1.2.4\ndry_run=false\n");
});

test("release command reports no-release output without creating a plan", async t => {
  const root = await createReleaseRepository(t, ["docs: clarify the release fixture"]);
  const outputFile = path.join(root, "workflow-output.txt");
  const messages: string[] = [];

  await runReleaseCommand({
    environment: { GITHUB_OUTPUT: outputFile },
    args: [],
    root,
    log(message) { messages.push(message); },
  });

  assert.equal(await readFile(outputFile, "utf8"), "released=false\nversion=\ndry_run=false\n");
  assert.deepEqual(messages, ["No release-worthy Conventional Commits found."]);
});
