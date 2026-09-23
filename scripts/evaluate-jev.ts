import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Judoka } from "../src/domain/types.js";
import { OpenRouterJevClient } from "../src/jev/client.js";
import { SemanticJudokaSearchService } from "../src/jev/semantic-search.js";

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

function formatPercent(value: number): string { return `${(value * 100).toFixed(1)}%`; }

async function runEvaluation(): Promise<void> {
  const apiKey = process.env.JEV_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("JEV_OPENROUTER_API_KEY is required to run the live evaluation");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixtures = JSON.parse(await readFile(path.join(root, "tests/fixtures/jev-evaluation.json"), "utf8")) as JevEvaluationCase[];
  const records = (await Promise.all(fixtures.flatMap(item => item.candidateSlugs).filter((slug, index, all) => all.indexOf(slug) === index)
    .map(async slug => JSON.parse(await readFile(path.join(root, `data/judoka/${slug}.json`), "utf8")) as Judoka)))
    .reduce((bySlug, record) => bySlug.set(record.slug, record), new Map<string, Judoka>());
  const threshold = process.env.JEV_MINIMUM_RELEVANCE === undefined ? 0.5 : Number(process.env.JEV_MINIMUM_RELEVANCE);
  const service = new SemanticJudokaSearchService(new OpenRouterJevClient({
    apiKey,
    model: process.env.JEV_MODEL,
    timeoutMs: Number(process.env.JEV_TIMEOUT_MS) || 20_000,
  }), { minimumRelevance: threshold, maxCandidates: 20 });
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
  const metrics = scoreEvaluationCases(results);
  const lines = [
    "## JEV semantic search evaluation",
    "",
    `Model(s): ${[...models].join(", ")}`,
    `Threshold: ${threshold}`,
    `Precision: ${formatPercent(metrics.precision)} (${metrics.truePositives}/${metrics.predicted} retrieved)`,
    `Recall: ${formatPercent(metrics.recall)} (${metrics.truePositives}/${metrics.relevant} labeled relevant)`,
    `Usage: ${inputTokens} input tokens, ${outputTokens} output tokens, $${totalCost.toFixed(6)} reported cost`,
    "",
    "| Case | Query | Expected relevant | Retrieved candidates |",
    "| --- | --- | --- | --- |",
    ...results.map((row, index) => `| ${fixtures[index].id} | ${fixtures[index].query} | ${row.relevant.join(", ") || "—"} | ${row.ranked.map(item => `${item.slug} (${item.relevance.toFixed(2)})`).join(", ") || "—"} |`),
    "",
    "This small hand-labeled set is for regression tracking and threshold comparison; it is not a release gate or a statistically robust accuracy estimate.",
    "",
  ];
  const report = lines.join("\n");
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, report, "utf8");
  else process.stdout.write(report);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runEvaluation();
}
