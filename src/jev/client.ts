import type { JevAnswer, JevDecisionClient, JevDecisionResult, JevQuestion } from "./types.js";

export const DEFAULT_JEV_MODEL = "~typesafe/jev-latest";
export const JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

export interface OpenRouterJevClientOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class JevClientError extends Error {
  constructor(readonly code: "timeout" | "http" | "network" | "invalid_response", message: string, readonly status?: number) {
    super(message);
    this.name = "JevClientError";
  }
}

const validProbability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const validDistribution = (value: unknown): value is Record<string, number> => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.values(value as Record<string, unknown>).every(validProbability);

function validAnswer(question: JevQuestion, answer: unknown): answer is JevAnswer {
  if (!answer || typeof answer !== "object") return false;
  const value = answer as Record<string, unknown>;
  if (question.type === "noul") return value.type === "noul" && validProbability(value.noul);
  if (question.type === "choice") return value.type === "choice" && typeof value.choice === "string" && Object.hasOwn(question.criteria, value.choice) && validDistribution(value.probabilities) && validProbability(value.confidence);
  return value.type === "score" && typeof value.score === "number" && Number.isFinite(value.score) && validDistribution(value.probabilities) && validProbability(value.confidence) && Boolean(value.legend) && typeof value.legend === "object";
}

function parseResponse(value: unknown, questions: Record<string, JevQuestion>, defaultModel: string): JevDecisionResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as { model?: unknown; answers?: unknown; usage?: unknown };
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) return undefined;
  const answers = body.answers as Record<string, unknown>;
  const ids = Object.keys(questions);
  if (Object.keys(answers).length !== ids.length || !ids.every(id => validAnswer(questions[id], answers[id]))) return undefined;
  return {
    model: typeof body.model === "string" ? body.model : defaultModel,
    answers: answers as Record<string, JevAnswer>,
    usage: body.usage && typeof body.usage === "object" && !Array.isArray(body.usage) ? body.usage as Record<string, unknown> : {},
  };
}

const retryable = (error: JevClientError) => error.code === "timeout" || error.code === "network" || error.status === 429 || error.status === 503 || error.status === 529;
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

/** A strict, timeout-bounded JEV client. It never logs or exposes its API key. */
export class OpenRouterJevClient implements JevDecisionClient {
  private readonly timeout: number;
  private readonly retries: number;
  private readonly fetcher: typeof fetch;
  private readonly model: string;

  constructor(private readonly options: OpenRouterJevClientOptions) {
    if (!options.apiKey.trim()) throw new TypeError("JEV API key must be non-empty");
    this.timeout = Number.isInteger(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs! : 15_000;
    this.retries = Number.isInteger(options.maxRetries) && options.maxRetries! >= 0 ? options.maxRetries! : 2;
    this.fetcher = options.fetchImpl ?? fetch;
    this.model = options.model ?? DEFAULT_JEV_MODEL;
  }

  async decide(state: unknown, questions: Record<string, JevQuestion>): Promise<JevDecisionResult> {
    if (Object.keys(questions).length === 0) throw new TypeError("at least one JEV question is required");
    let lastError: JevClientError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const response = await this.fetcher(JEV_DECISIONS_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
          body: JSON.stringify({ model: this.model, state, questions }),
          signal: controller.signal,
        });
        if (!response.ok) throw new JevClientError("http", `JEV returned HTTP ${response.status}`, response.status);
        const parsed = parseResponse(await response.json(), questions, this.model);
        if (!parsed) throw new JevClientError("invalid_response", "JEV response did not match the requested answer types");
        return parsed;
      } catch (error) {
        lastError = error instanceof JevClientError ? error : error instanceof Error && error.name === "AbortError"
          ? new JevClientError("timeout", `JEV timed out after ${this.timeout}ms`)
          : new JevClientError("network", error instanceof Error ? error.message : String(error));
        if (attempt === this.retries || !retryable(lastError)) throw lastError;
        await delay(100 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new JevClientError("network", "JEV request failed");
  }
}
