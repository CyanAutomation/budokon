import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Judoka } from "../src/domain/types.js";
import { OpenRouterJevClient } from "../src/jev/client.js";
import { SemanticJudokaSearchService, type SemanticJudokaSearcher } from "../src/jev/semantic-search.js";

export interface JevEvaluationCase { id: string; query: string; candidateSlugs: string[]; relevantSlugs: string[]; }
export interface JevEvaluationScore {
  truePositives: number;
  predicted: number;
  relevant: number;
  precision: number;
  recall: number;
}

export function scoreEvaluationCases(cases: Array<{ relevant: string[]; predicted: string[] }>): JevEvaluationScore {
  let predicted = 0;
  let relevant = 0;
  let truePositives = 0;
  for (const evaluationCase of cases) {
    const expected = new Set(evaluationCase.relevant);
    const actual = new Set(evaluationCase.predicted);
    relevant += expected.size;
    predicted += actual.size;
    for (const slug of actual) if (expected.has(slug)) truePositives += 1;
  }
  return {
    truePositives,
    predicted,
    relevant,
    precision: predicted ? truePositives / predicted : 1,
    recall: relevant ? truePositives / relevant : 1,
  };
}

export interface EvaluationSearchOptions {
  apiKey: string;
  model?: string;
  timeoutMs: number;
  minimumRelevance: number;
  maxCandidates: number;
}

export interface EvaluationDependencies {
  environment?: NodeJS.ProcessEnv;
  root?: string;
  readText?: (filePath: string) => Promise<string>;
  appendSummary?: (filePath: string, report: string) => Promise<void>;
  writeOutput?: (report: string) => void;
  createSearchService?: (options: EvaluationSearchOptions) => SemanticJudokaSearcher;
}

interface EvaluationRow {
  id: string;
  relevant: string[];
  predicted: string[];
  ranked: Array<{ slug: string; relevance: number }>;
}

interface EvaluationTotals {
  rows: EvaluationRow[];
  models: Set<string>;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

function formatPercent(value: number): string { return `${(value * 100).toFixed(1)}%`; }

async function loadEvaluationRecords(
  root: string,
  fixtures: JevEvaluationCase[],
  readText: (filePath: string) => Promise<string>,
): Promise<Map<string, Judoka>> {
  const slugs = [...new Set(fixtures.flatMap(item => item.candidateSlugs))];
  const records = await Promise.all(slugs.map(async slug => {
    const source = await readText(path.join(root, `data/judoka/${slug}.json`));
    return JSON.parse(source) as Judoka;
  }));
  return new Map(records.map(record => [record.slug, record]));
}

async function evaluateFixtures(
  fixtures: JevEvaluationCase[],
  records: Map<string, Judoka>,
  service: SemanticJudokaSearcher,
): Promise<EvaluationTotals> {
  const results = [];
  const models = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;
  for (const fixture of fixtures) {
    const candidates = fixture.candidateSlugs.map(slug => {
      const record = records.get(slug);
      if (!record) throw new Error(`Evaluation fixture ${fixture.id} refers to missing judoka ${slug}`);
      return record;
    });
    const response = await service.search(fixture.query, candidates);
    models.add(response.model);
    inputTokens += typeof response.usage.input_tokens === "number" ? response.usage.input_tokens : 0;
    outputTokens += typeof response.usage.output_tokens === "number" ? response.usage.output_tokens : 0;
    totalCost += typeof response.usage.cost === "number" ? response.usage.cost : 0;
    results.push({
      id: fixture.id,
      relevant: fixture.relevantSlugs,
      predicted: response.results.map(item => item.judoka.slug),
      ranked: response.results.map(item => ({ slug: item.judoka.slug, relevance: item.relevance })),
    });
  }
  return { rows: results, models, inputTokens, outputTokens, totalCost };
}

function formatEvaluationReport(fixtures: JevEvaluationCase[], totals: EvaluationTotals, threshold: number): string {
  const metrics = scoreEvaluationCases(totals.rows);
  const lines = [
    "## JEV semantic search evaluation",
    "",
    `Model(s): ${[...totals.models].join(", ")}`,
    `Threshold: ${threshold}`,
    `Precision: ${formatPercent(metrics.precision)} (${metrics.truePositives}/${metrics.predicted} retrieved)`,
    `Recall: ${formatPercent(metrics.recall)} (${metrics.truePositives}/${metrics.relevant} labeled relevant)`,
    `Usage: ${totals.inputTokens} input tokens, ${totals.outputTokens} output tokens, $${totals.totalCost.toFixed(6)} reported cost`,
    "",
    "| Case | Query | Expected relevant | Retrieved candidates |",
    "| --- | --- | --- | --- |",
    ...totals.rows.map((row, index) => `| ${fixtures[index].id} | ${fixtures[index].query} | ${row.relevant.join(", ") || "—"} | ${row.ranked.map(item => `${item.slug} (${item.relevance.toFixed(2)})`).join(", ") || "—"} |`),
    "",
    "This small hand-labeled set is for regression tracking and threshold comparison; it is not a release gate or a statistically robust accuracy estimate.",
    "",
  ];
  return lines.join("\n");
}

export async function runEvaluation(dependencies: EvaluationDependencies = {}): Promise<void> {
  const environment = dependencies.environment ?? process.env;
  const apiKey = environment.JEV_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("JEV_OPENROUTER_API_KEY is required to run the live evaluation");
  const root = dependencies.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const readText = dependencies.readText ?? (filePath => readFile(filePath, "utf8"));
  const fixtures = JSON.parse(await readText(path.join(root, "tests/fixtures/jev-evaluation.json"))) as JevEvaluationCase[];
  const records = await loadEvaluationRecords(root, fixtures, readText);
  const threshold = environment.JEV_MINIMUM_RELEVANCE === undefined ? 0.5 : Number(environment.JEV_MINIMUM_RELEVANCE);
  const service = dependencies.createSearchService?.({
    apiKey,
    model: environment.JEV_MODEL,
    timeoutMs: Number(environment.JEV_TIMEOUT_MS) || 20_000,
    minimumRelevance: threshold,
    maxCandidates: 20,
  }) ?? new SemanticJudokaSearchService(new OpenRouterJevClient({
    apiKey,
    model: environment.JEV_MODEL,
    timeoutMs: Number(environment.JEV_TIMEOUT_MS) || 20_000,
  }), { minimumRelevance: threshold, maxCandidates: 20 });
  const totals = await evaluateFixtures(fixtures, records, service);
  const report = formatEvaluationReport(fixtures, totals, threshold);
  if (environment.GITHUB_STEP_SUMMARY) {
    await (dependencies.appendSummary ?? ((filePath, value) => appendFile(filePath, value, "utf8")))(environment.GITHUB_STEP_SUMMARY, report);
  } else {
    (dependencies.writeOutput ?? (value => process.stdout.write(value)))(report);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runEvaluation();
}
