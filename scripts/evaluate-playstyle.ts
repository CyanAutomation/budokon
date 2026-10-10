import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Technique } from "../src/domain/types.js";
import { PLAYSTYLE_OPTIONS, type PlaystyleFacet, type PlaystyleOption } from "../src/domain/playstyle.js";
import { DEFAULT_JEV_MODEL, OpenRouterJevClient } from "../src/jev/client.js";
import {
  DEFAULT_PLAYSTYLE_CONFIDENCE_THRESHOLD,
  type PlaystyleClassificationInput,
  type PlaystyleClassificationResult,
  type PlaystyleClassifier,
  type PlaystyleJudokaRecord,
} from "../src/jev/playstyle-classification-contracts.js";
import { PlaystyleClassificationService, validatePlaystyleConfidenceThreshold } from "../src/jev/playstyle-classification.js";
import { validateCanonical } from "../src/validation/validate-canonical.js";

export interface PlaystyleEvaluationFixture {
  id: string;
  record: PlaystyleJudokaRecord;
  evidence: Array<{ url: string; excerpt: string }>;
  expected: Record<PlaystyleFacet, PlaystyleOption<PlaystyleFacet>>;
}

export interface PlaystyleEvaluationScore {
  facets: Record<PlaystyleFacet, { correct: number; total: number; accuracy: number }>;
  abstention: { correct: number; total: number; accuracy: number };
}

export interface PlaystyleEvaluationOptions {
  apiKey: string;
  model?: string;
  timeoutMs: number;
  confidenceThreshold: number;
}

export interface PlaystyleEvaluationDependencies {
  environment?: NodeJS.ProcessEnv;
  root?: string;
  readText?: (filePath: string) => Promise<string>;
  appendSummary?: (filePath: string, report: string) => Promise<void>;
  writeOutput?: (report: string) => void;
  createClassifier?: (options: PlaystyleEvaluationOptions) => PlaystyleClassifier;
}

export function scorePlaystyleEvaluation(
  fixtures: PlaystyleEvaluationFixture[],
  results: PlaystyleClassificationResult[],
): PlaystyleEvaluationScore {
  if (fixtures.length !== results.length) throw new RangeError("evaluation fixture and result counts must match");
  const facets = {} as PlaystyleEvaluationScore["facets"];
  let abstentionCorrect = 0;
  let abstentionTotal = 0;
  for (const facet of Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[]) {
    let correct = 0;
    for (const [index, fixture] of fixtures.entries()) {
      const expected = fixture.expected[facet];
      const actual = results[index].classification[facet].proposed;
      if (expected === actual) correct += 1;
      if ((expected === "insufficient_evidence") === (actual === "insufficient_evidence")) abstentionCorrect += 1;
      abstentionTotal += 1;
    }
    facets[facet] = { correct, total: fixtures.length, accuracy: fixtures.length ? correct / fixtures.length : 1 };
  }
  return {
    facets,
    abstention: { correct: abstentionCorrect, total: abstentionTotal, accuracy: abstentionTotal ? abstentionCorrect / abstentionTotal : 1 },
  };
}

function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }

export function formatPlaystyleEvaluationReport(
  fixtures: PlaystyleEvaluationFixture[],
  results: PlaystyleClassificationResult[],
  requestedModel: string,
): string {
  const score = scorePlaystyleEvaluation(fixtures, results);
  const models = [...new Set(results.map(result => result.model))];
  const inputTokens = results.reduce((sum, result) => sum + (typeof result.usage.input_tokens === "number" ? result.usage.input_tokens : 0), 0);
  const outputTokens = results.reduce((sum, result) => sum + (typeof result.usage.output_tokens === "number" ? result.usage.output_tokens : 0), 0);
  const totalCost = results.reduce((sum, result) => sum + (typeof result.usage.cost === "number" ? result.usage.cost : 0), 0);
  const facets = Object.keys(PLAYSTYLE_OPTIONS) as PlaystyleFacet[];
  return [
    "## JEV playstyle classification evaluation",
    "",
    `Requested model: ${requestedModel}`,
    `Resolved model(s): ${models.join(", ") || "—"}`,
    `Confidence threshold: ${results[0]?.confidenceThreshold ?? DEFAULT_PLAYSTYLE_CONFIDENCE_THRESHOLD}`,
    `Usage: ${inputTokens} input tokens, ${outputTokens} output tokens, $${totalCost.toFixed(6)} reported cost`,
    "",
    "| Facet | Correct | Labeled | Accuracy |",
    "| --- | ---: | ---: | ---: |",
    ...facets.map(facet => `| ${facet} | ${score.facets[facet].correct} | ${score.facets[facet].total} | ${percent(score.facets[facet].accuracy)} |`),
    `| Abstention | ${score.abstention.correct} | ${score.abstention.total} | ${percent(score.abstention.accuracy)} |`,
    "",
    "| Case | Expected | Proposed (confidence) | Policy accepted |",
    "| --- | --- | --- | --- |",
    ...fixtures.flatMap((fixture, index) => facets.map(facet => {
      const result = results[index].classification[facet];
      return `| ${fixture.id} · ${facet} | ${fixture.expected[facet]} | ${result.proposed} (${result.confidence.toFixed(2)}) | ${result.policyAccepted ?? "—"} |`;
    })),
    "",
    "This small synthetic set is non-gating and does not estimate real-world athlete classification accuracy. Use it to compare models, thresholds, and abstention behavior before adding broader human-labeled evidence.",
    "",
  ].join("\n");
}

export async function runPlaystyleEvaluation(dependencies: PlaystyleEvaluationDependencies = {}): Promise<void> {
  const environment = dependencies.environment ?? process.env;
  const apiKey = environment.JEV_OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("JEV_OPENROUTER_API_KEY is required to run the live playstyle evaluation");
  const root = dependencies.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const readText = dependencies.readText ?? (filePath => readFile(filePath, "utf8"));
  const fixtures = JSON.parse(await readText(path.join(root, "tests/fixtures/playstyle-evaluation.json"))) as PlaystyleEvaluationFixture[];
  const canonical = await validateCanonical(root);
  const techniqueById = new Map(canonical.techniques.map(technique => [technique.id, technique as unknown as Technique]));
  const threshold = environment.JEV_PLAYSTYLE_THRESHOLD === undefined
    ? DEFAULT_PLAYSTYLE_CONFIDENCE_THRESHOLD
    : Number(environment.JEV_PLAYSTYLE_THRESHOLD);
  validatePlaystyleConfidenceThreshold(threshold);
  const requestedModel = environment.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;
  const options = {
    apiKey,
    model: environment.JEV_MODEL,
    timeoutMs: Number(environment.JEV_TIMEOUT_MS) || 20_000,
    confidenceThreshold: threshold,
  };
  const classifier = dependencies.createClassifier?.(options) ?? new PlaystyleClassificationService(
    new OpenRouterJevClient({ apiKey, model: options.model, timeoutMs: options.timeoutMs }),
    threshold,
  );
  const results: PlaystyleClassificationResult[] = [];
  for (const fixture of fixtures) {
    const ids = fixture.record.signatureMoveIds;
    const techniques = ids.map(id => {
      const technique = techniqueById.get(id);
      if (!technique) throw new Error(`Evaluation fixture ${fixture.id} refers to unknown technique ${id}`);
      return technique;
    });
    const input: PlaystyleClassificationInput = { record: fixture.record, evidence: fixture.evidence, techniques };
    results.push(await classifier.classify(input));
  }
  const report = formatPlaystyleEvaluationReport(fixtures, results, requestedModel);
  if (environment.GITHUB_STEP_SUMMARY) {
    await (dependencies.appendSummary ?? ((filePath, value) => appendFile(filePath, value, "utf8")))(environment.GITHUB_STEP_SUMMARY, report);
  } else {
    (dependencies.writeOutput ?? (value => process.stdout.write(value)))(report);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPlaystyleEvaluation();
}
