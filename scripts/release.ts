import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface ConventionalCommit {
  hash: string;
  subject: string;
  body: string;
}

export type ReleaseType = "patch" | "minor" | "major";

export interface ParsedCommit {
  type: string;
  subject: string;
  breaking: boolean;
  breakingDescription?: string;
  hash: string;
}

export interface ReleasePlan {
  version: string;
  releaseType: ReleaseType;
  notes: string;
}

export interface PublishReleaseOptions {
  repository?: string;
  token?: string;
  targetCommit?: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}

export interface PublishReleaseResult {
  published: boolean;
  dryRun?: boolean;
  url?: string;
}

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const typePriority: Record<ReleaseType, number> = { patch: 1, minor: 2, major: 3 };

/** Existing BU-DO-KON releases use vMAJOR.MINOR tags; new tags use all three components. */
export function parseReleaseTag(tag: string): { tag: string; version: string } | undefined {
  const match = tag.match(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/u);
  if (!match) return undefined;
  return { tag, version: `${match[1]}.${match[2]}.${match[3] ?? "0"}` };
}

/** Parse the Conventional Commit header and breaking-change footer used for releases. */
export function parseConventionalCommit(commit: ConventionalCommit): ParsedCommit | undefined {
  const match = commit.subject.match(/^([a-z][a-z0-9-]*)(?:\(([^()\r\n]+)\))?(!)?:\s+(.+)$/u);
  if (!match) return undefined;
  const footer = commit.body.match(/^BREAKING(?:-| )CHANGE:\s*(.*)$/imu)?.[1]?.trim();
  return {
    type: match[1],
    subject: match[4],
    breaking: match[3] === "!" || footer !== undefined,
    breakingDescription: footer || undefined,
    hash: commit.hash,
  };
}

function releaseTypeFor(commit: ParsedCommit): ReleaseType | undefined {
  if (commit.breaking) return "major";
  if (commit.type === "feat") return "minor";
  if (commit.type === "fix" || commit.type === "perf" || commit.type === "revert") return "patch";
  return undefined;
}

function nextVersion(previousVersion: string, releaseType: ReleaseType): string {
  const match = previousVersion.match(versionPattern);
  if (!match) throw new TypeError(`Invalid previous release version: ${previousVersion}`);
  let [major, minor, patch] = match.slice(1).map(Number);
  if (releaseType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (releaseType === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function commitDescription(commit: ParsedCommit): string {
  return `${commit.subject} (${commit.hash.slice(0, 7)})`;
}

function releaseNotes(commits: ParsedCommit[]): string {
  const sections: Array<[string, ParsedCommit[]]> = [
    ["Breaking Changes", commits.filter(commit => commit.breaking)],
    ["Features", commits.filter(commit => commit.type === "feat")],
    ["Bug Fixes", commits.filter(commit => commit.type === "fix")],
    ["Performance Improvements", commits.filter(commit => commit.type === "perf")],
    ["Reverts", commits.filter(commit => commit.type === "revert")],
  ];
  return sections
    .filter(([, entries]) => entries.length > 0)
    .map(([heading, entries]) => {
      const bullets = entries.map(commit => {
        const description = heading === "Breaking Changes" && commit.breakingDescription
          ? commit.breakingDescription
          : commitDescription(commit);
        return `- ${description}`;
      });
      return `## ${heading}\n\n${bullets.join("\n")}`;
    })
    .join("\n\n");
}

/** Determine the next stable release from the supported Conventional Commit types. */
export function createReleasePlan(commits: ConventionalCommit[], previousVersion: string): ReleasePlan | undefined {
  const parsed = commits.map(parseConventionalCommit).filter((commit): commit is ParsedCommit => commit !== undefined);
  const releaseCommits = parsed.filter(commit => releaseTypeFor(commit) !== undefined);
  if (releaseCommits.length === 0) return undefined;
  const releaseType = releaseCommits.reduce<ReleaseType>((highest, commit) => {
    const candidate = releaseTypeFor(commit)!;
    return typePriority[candidate] > typePriority[highest] ? candidate : highest;
  }, "patch");
  return {
    version: nextVersion(previousVersion, releaseType),
    releaseType,
    notes: releaseNotes(releaseCommits),
  };
}

/** Create a stable GitHub Release pointing at the commit analyzed by this run. */
export async function publishRelease(
  plan: ReleasePlan,
  options: PublishReleaseOptions,
): Promise<PublishReleaseResult> {
  if (options.dryRun) return { published: false, dryRun: true };
  const repository = options.repository?.trim();
  const token = options.token?.trim();
  const targetCommit = options.targetCommit?.trim();
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new TypeError("GITHUB_REPOSITORY must be an owner/repository pair");
  }
  if (!token) throw new TypeError("GITHUB_TOKEN is required to publish a release");
  if (!targetCommit || !/^[0-9a-f]{40}$/iu.test(targetCommit)) {
    throw new TypeError("The release target must be a full Git commit SHA");
  }

  const response = await (options.fetchImpl ?? fetch)(`https://api.github.com/repos/${repository}/releases`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      tag_name: `v${plan.version}`,
      target_commitish: targetCommit,
      name: `v${plan.version}`,
      body: plan.notes,
      draft: false,
      prerelease: false,
    }),
  });
  if (!response.ok) throw new Error(`GitHub release request failed (${response.status})`);

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("GitHub returned an invalid release response");
  }
  if (!result || typeof result !== "object" || typeof (result as { html_url?: unknown }).html_url !== "string") {
    throw new Error("GitHub release response did not include its URL");
  }
  return { published: true, url: (result as { html_url: string }).html_url };
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function latestReleaseTag(root: string): { tag: string; version: string } | undefined {
  const tags = git(root, ["tag", "--list", "v[0-9]*"])
    .split("\n")
    .map(parseReleaseTag)
    .filter((tag): tag is { tag: string; version: string } => tag !== undefined)
    .sort((left, right) => {
      const a = left.version.split(".").map(Number);
      const b = right.version.split(".").map(Number);
      return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
    });
  return tags[0];
}

function commitsSince(root: string, lastTag: string | undefined): ConventionalCommit[] {
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const log = git(root, ["log", "--reverse", "--format=%H%x00%s%x00%b%x1e", range]);
  return log.split("\x1e").map(record => record.trim()).filter(Boolean).map(record => {
    const [hash = "", subject = "", ...body] = record.split("\x00");
    return { hash, subject, body: body.join("\x00").trim() };
  });
}

async function appendWorkflowOutputs(outputFile: string | undefined, values: Record<string, string>): Promise<void> {
  if (!outputFile) return;
  const output = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  await appendFile(outputFile, output, "utf8");
}

export async function main(environment: NodeJS.ProcessEnv = process.env, args = process.argv.slice(2)): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const currentTag = latestReleaseTag(root);
  const packageDocument = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version?: unknown };
  const previousVersion = currentTag?.version ?? packageDocument.version;
  if (typeof previousVersion !== "string" || !versionPattern.test(previousVersion)) {
    throw new TypeError("Could not determine the previous stable release version");
  }

  const plan = createReleasePlan(commitsSince(root, currentTag?.tag), previousVersion);
  const dryRun = args.includes("--dry-run");
  if (!plan) {
    console.log("No release-worthy Conventional Commits found.");
    await appendWorkflowOutputs(environment.GITHUB_OUTPUT, { released: "false", version: "", dry_run: String(dryRun) });
    return;
  }

  console.log(`${dryRun ? "Dry run: " : ""}v${plan.version} (${plan.releaseType})\n\n${plan.notes}`);
  if (dryRun) {
    await publishRelease(plan, { dryRun: true });
    await appendWorkflowOutputs(environment.GITHUB_OUTPUT, { released: "false", version: "", dry_run: "true" });
    return;
  }

  const targetCommit = environment.GITHUB_SHA?.trim() || git(root, ["rev-parse", "HEAD"]);
  const result = await publishRelease(plan, {
    repository: environment.GITHUB_REPOSITORY,
    token: environment.GITHUB_TOKEN,
    targetCommit,
  });
  console.log(`Published v${plan.version}: ${result.url}`);
  await appendWorkflowOutputs(environment.GITHUB_OUTPUT, {
    released: "true",
    version: plan.version,
    dry_run: "false",
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
