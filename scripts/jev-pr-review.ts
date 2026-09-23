import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Judoka } from "../src/domain/types.js";
import { EditorialReviewService, type EditorialReviewResult } from "../src/jev/editorial-review.js";
import { OpenRouterJevClient } from "../src/jev/client.js";
import { validateCanonical, validateSchema } from "../src/validation/validate-canonical.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultApiUrl = "https://api.github.com";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Mark}+/gu, "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function identityTerms(record: Judoka): Set<string> {
  return new Set([record.slug, record.firstname, record.surname, `${record.firstname ?? ""} ${record.surname ?? ""}`, ...(record.aliases ?? [])]
    .flatMap(value => normalize(String(value ?? "")).split(/\s+/u))
    .filter(Boolean));
}

/** Detect canonical handle or normalized display-name collisions, excluding the same immutable record ID. */
export function findCanonicalIdentityConflicts(proposed: Judoka, candidates: Judoka[]): Judoka[] {
  const handles = new Set([proposed.slug, ...(proposed.legacySlugs ?? [])]);
  const names = new Set([`${proposed.firstname ?? ""} ${proposed.surname ?? ""}`, ...(proposed.aliases ?? [])]
    .map(normalize).filter(Boolean));
  return candidates.filter(candidate => {
    if (candidate.id === proposed.id) return false;
    const sharedHandle = [candidate.slug, ...(candidate.legacySlugs ?? [])].some(handle => handles.has(handle));
    const sharedName = [`${candidate.firstname ?? ""} ${candidate.surname ?? ""}`, ...(candidate.aliases ?? [])]
      .map(normalize).some(name => name && names.has(name));
    return sharedHandle || sharedName;
  });
}

function duplicateScore(proposed: Judoka, candidate: Judoka): number {
  const proposalName = normalize(`${proposed.firstname ?? ""} ${proposed.surname ?? ""}`);
  const candidateName = normalize(`${candidate.firstname ?? ""} ${candidate.surname ?? ""}`);
  if (proposalName && proposalName === candidateName) return 10;
  const proposedTerms = identityTerms(proposed);
  const candidateTerms = identityTerms(candidate);
  const shared = [...proposedTerms].filter(term => candidateTerms.has(term)).length;
  const union = new Set([...proposedTerms, ...candidateTerms]).size;
  const nameScore = union ? shared / union : 0;
  const surnameScore = proposed.surname && candidate.surname && normalize(proposed.surname) === normalize(candidate.surname) ? 1.5 : 0;
  return nameScore + surnameScore;
}

/** Build a deterministic, name-focused duplicate shortlist before asking JEV. */
export function rankDuplicateCandidates(proposed: Judoka, candidates: Judoka[], limit = 10): Judoka[] {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError("duplicate shortlist limit must be a non-negative integer");
  return candidates.filter(candidate => candidate.id !== proposed.id)
    .map(candidate => ({ candidate, score: duplicateScore(proposed, candidate) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || (left.candidate.id < right.candidate.id ? -1 : left.candidate.id > right.candidate.id ? 1 : 0))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function markdownText(value: unknown): string {
  return String(value ?? "—").replace(/[|`*_{}\[\]<>]/gu, "\\$&").replace(/[\r\n]+/gu, " ");
}

function answerValue(answer: EditorialReviewResult["answers"][string] | undefined): string {
  if (!answer) return "missing";
  return answer.type === "noul" ? `${Math.round(answer.noul * 100)}% yes`
    : answer.type === "choice" ? `${answer.choice} (${Math.round(answer.confidence * 100)}% confidence)`
      : `${answer.score} (${Math.round(answer.confidence * 100)}% confidence)`;
}

export function renderPullRequestReviewSummary(prNumber: number, rows: Array<{ record: Judoka; review: EditorialReviewResult }>): string {
  const lines = [
    `## JEV advisory review · PR #${prNumber}`,
    "",
    "These are model review signals for editors. JEV is advisory only: it does not validate facts or approve a record.",
    "",
  ];
  for (const { record, review } of rows) {
    lines.push(
      `### ${markdownText(`${record.firstname ?? ""} ${record.surname ?? ""}`.trim())} (${markdownText(record.slug)})`,
      "",
      `- Recommendation: **${review.recommendation}**; human approval required: **yes**`,
      `- Biography publishable: ${answerValue(review.answers.biography_publishable)}`,
      `- Factual support: ${answerValue(review.answers.factual_claims_supported)}`,
      `- Stats coherence: ${answerValue(review.answers.stats_coherent)}`,
      `- Rarity fit: ${answerValue(review.answers.rarity_appropriate)}`,
      `- Signature techniques: ${answerValue(review.answers.signature_techniques_plausible)}`,
      `- Duplicate candidate: ${answerValue(review.answers.duplicate_candidate)}`,
      `- JEV recommends human review: ${answerValue(review.answers.human_review_recommended)}`,
      `- Model: ${markdownText(review.model)}`,
      "- No source excerpts were supplied, so factual-support scores cannot establish that claims are verified.",
      "",
    );
  }
  if (rows.length === 0) lines.push("No changed judoka records were found in this pull request.", "");
  return lines.join("\n");
}

interface PullRequestInfo { number: number; state: string; base: { ref: string; sha: string }; head: { sha: string }; }
interface PullRequestFile { filename: string; status: string; }

async function githubJson<T>(route: string, token: string, apiUrl: string): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/u, "")}${route}`, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`GitHub API request failed with HTTP ${response.status}`);
  return await response.json() as T;
}

async function fetchPullRequestFiles(repository: string, prNumber: number, token: string, apiUrl: string): Promise<PullRequestFile[]> {
  const files: PullRequestFile[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubJson<PullRequestFile[]>(`/repos/${repository}/pulls/${prNumber}/files?per_page=100&page=${page}`, token, apiUrl);
    files.push(...batch);
    if (batch.length < 100) return files;
  }
  throw new RangeError("pull request file list exceeded the review limit");
}

async function fetchJudokaAtRef(repository: string, filename: string, ref: string, token: string, apiUrl: string): Promise<Judoka> {
  const apiPath = filename.split("/").map(encodeURIComponent).join("/");
  const file = await githubJson<{ encoding: string; content: string }>(`/repos/${repository}/contents/${apiPath}?ref=${encodeURIComponent(ref)}`, token, apiUrl);
  if (file.encoding !== "base64") throw new Error(`GitHub returned an unsupported encoding for ${filename}`);
  const content = file.content.replace(/\s+/gu, "");
  if (content.length > 22_000) throw new RangeError(`${filename}: encoded record exceeds the JEV review input limit`);
  return JSON.parse(Buffer.from(content, "base64").toString("utf8")) as Judoka;
}

function validateProposal(record: Judoka, filename: string, canonical: Awaited<ReturnType<typeof validateCanonical>>, schema: unknown): void {
  validateSchema(record, schema, filename);
  const country = canonical.countries[record.countryCode];
  if (!country?.active) throw new Error(`${filename}: country ${record.countryCode} is unknown or inactive on the current main branch`);
  const techniqueIds = new Set(canonical.techniques.map(technique => technique.id));
  for (const id of record.signatureMoveIds) if (!techniqueIds.has(id)) throw new Error(`${filename}: unknown signature technique ${id}`);
  const weightGroup = canonical.weights.find(group => group.gender === record.gender);
  if (!weightGroup?.categories.some(category => (category as { weight?: unknown }).weight === record.weightClass)) {
    throw new Error(`${filename}: weight class ${record.weightClass} is not in the current catalogue`);
  }
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > 16_000) throw new RangeError(`${filename}: record exceeds the 16 KB JEV review input limit`);
}

async function runPullRequestReview(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const jevKey = process.env.JEV_OPENROUTER_API_KEY;
  const repository = process.env.GITHUB_REPOSITORY;
  const prNumber = Number(process.env.JEV_PR_NUMBER);
  const apiUrl = process.env.GITHUB_API_URL ?? defaultApiUrl;
  if (!token || !jevKey || !repository || !Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error("GITHUB_TOKEN, JEV_OPENROUTER_API_KEY, GITHUB_REPOSITORY, and a valid JEV_PR_NUMBER are required");
  }
  const pr = await githubJson<PullRequestInfo>(`/repos/${repository}/pulls/${prNumber}`, token, apiUrl);
  if (pr.state !== "open") throw new Error(`PR #${prNumber} is not open`);
  if (pr.base.ref !== (process.env.GITHUB_DEFAULT_BRANCH ?? "main")) throw new Error("JEV review only supports pull requests targeting the default branch");

  const changedFiles = (await fetchPullRequestFiles(repository, prNumber, token, apiUrl))
    .filter(file => file.status !== "removed" && /^data\/judoka\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/u.test(file.filename));
  if (changedFiles.length > 10) throw new RangeError("JEV PR review is limited to 10 changed judoka records per run");

  const canonical = await validateCanonical(repositoryRoot);
  const existing = canonical.judoka as unknown as Judoka[];
  const judokaSchema = JSON.parse(await readFile(path.join(repositoryRoot, "schema/judoka.schema.json"), "utf8"));
  const proposals = await Promise.all(changedFiles.map(file => fetchJudokaAtRef(repository, file.filename, pr.head.sha, token, apiUrl)));
  const proposalIds = new Set<string>();
  const proposalSlugs = new Set<string>();
  proposals.forEach((record, index) => {
    const filename = changedFiles[index].filename;
    validateProposal(record, filename, canonical, judokaSchema);
    if (proposalIds.has(record.id) || proposalSlugs.has(record.slug)) throw new Error(`${filename}: duplicate ID or slug among changed records`);
    const conflicts = findCanonicalIdentityConflicts(record, [...existing, ...proposals]);
    if (conflicts.length > 0) throw new Error(`${filename}: canonical identity collision with ${conflicts.map(item => item.slug).join(", ")}`);
    proposalIds.add(record.id);
    proposalSlugs.add(record.slug);
  });

  const techniques = canonical.techniques as unknown as Array<{ id: string; name: string; japanese: string; style: string; category: string; subCategory: string; description: string; link: string }>;
  const reviewer = new EditorialReviewService(new OpenRouterJevClient({
    apiKey: jevKey,
    model: process.env.JEV_MODEL,
    timeoutMs: Number(process.env.JEV_TIMEOUT_MS) || 20_000,
  }));
  const rows = [];
  for (const record of proposals) {
    const candidates = rankDuplicateCandidates(record, [...existing, ...proposals], 10);
    const resolvedTechniques = techniques.filter(technique => record.signatureMoveIds.includes(technique.id));
    const review = await reviewer.review({ record, evidence: [], duplicateCandidates: candidates, techniques: resolvedTechniques });
    rows.push({ record, review });
  }
  const summary = renderPullRequestReviewSummary(prNumber, rows);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) await appendFile(summaryFile, `${summary}\n`, "utf8");
  else process.stdout.write(summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPullRequestReview();
}
