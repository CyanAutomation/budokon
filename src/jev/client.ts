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
const validDistribution = (value: unknown, expectedKeys: string[]): value is Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const distribution = value as Record<string, unknown>;
  const keys = Object.keys(distribution);
  if (keys.length !== expectedKeys.length || !expectedKeys.every(key => Object.hasOwn(distribution, key))) return false;
  if (!Object.values(distribution).every(validProbability)) return false;
  const total = Object.values(distribution as Record<string, number>).reduce((sum, probability) => sum + probability, 0);
  return Math.abs(total - 1) <= 0.01;
};

function validChoiceAnswer(question: Extract<JevQuestion, { type: "choice" }>, value: Record<string, unknown>): boolean {
  if (value.type !== "choice" || typeof value.choice !== "string" || !Object.hasOwn(question.criteria, value.choice)) return false;
  const options = Object.keys(question.criteria);
  return validDistribution(value.probabilities, options)
    && Object.hasOwn(value.probabilities as object, value.choice)
    && validProbability(value.confidence);
}

function validScoreAnswer(question: Extract<JevQuestion, { type: "score" }>, value: Record<string, unknown>): boolean {
  if (value.type !== "score" || typeof value.score !== "number" || !Number.isFinite(value.score)) return false;
  if (value.score < 0 || value.score > question.criteria.length - 1) return false;
  const levels = question.criteria.map((_, index) => String(index));
  if (!validDistribution(value.probabilities, levels) || !validProbability(value.confidence)) return false;
  if (!value.legend || typeof value.legend !== "object" || Array.isArray(value.legend)) return false;
  const legend = value.legend as Record<string, unknown>;
  return Object.keys(legend).length === levels.length
    && levels.every(level => legend[level] === question.criteria[Number(level)]);
}

function validAnswer(question: JevQuestion, answer: unknown): answer is JevAnswer {
  if (!answer || typeof answer !== "object") return false;
  const value = answer as Record<string, unknown>;
  if (question.type === "noul") return value.type === "noul" && validProbability(value.noul);
  if (question.type === "choice") return validChoiceAnswer(question, value);
  return validScoreAnswer(question, value);
}

function parseResponse(value: unknown, questions: Record<string, JevQuestion>): JevDecisionResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as { model?: unknown; answers?: unknown; usage?: unknown };
  if (typeof body.model !== "string" || !body.model.trim()
    || !body.usage || typeof body.usage !== "object" || Array.isArray(body.usage)
    || !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) return undefined;
  const answers = body.answers as Record<string, unknown>;
  const ids = Object.keys(questions);
  if (Object.keys(answers).length !== ids.length || !ids.every(id => validAnswer(questions[id], answers[id]))) return undefined;
  return {
    model: body.model,
    answers: answers as Record<string, JevAnswer>,
    usage: body.usage as Record<string, unknown>,
  };
}

const retryable = (error: JevClientError) => error.code === "timeout" || error.code === "network"
  || [429, 502, 503, 504, 529].includes(error.status ?? 0);
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

class JevHttpError extends Error {
  constructor(readonly clientError: JevClientError, readonly retryAfter: string | null) {
    super(clientError.message);
    this.name = "JevHttpError";
  }
}

interface RequestFailure {
  error: JevClientError;
  retryAfter?: string | null;
}

async function requestDecision(
  fetcher: typeof fetch,
  apiKey: string,
  requestBody: string,
  questions: Record<string, JevQuestion>,
  signal: AbortSignal,
): Promise<JevDecisionResult> {
  const response = await fetcher(JEV_DECISIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: requestBody,
    signal,
  });
  if (!response.ok) {
    throw new JevHttpError(
      new JevClientError("http", `JEV returned HTTP ${response.status}`, response.status),
      response.headers.get("retry-after"),
    );
  }
  const body = await response.text();
  let value: unknown;
  try { value = JSON.parse(body); }
  catch { throw new JevClientError("invalid_response", "JEV returned invalid JSON"); }
  const parsed = parseResponse(value, questions);
  if (!parsed) throw new JevClientError("invalid_response", "JEV response did not match the requested answer types");
  return parsed;
}

function requestFailure(error: unknown, timeout: number): RequestFailure {
  if (error instanceof JevHttpError) return { error: error.clientError, retryAfter: error.retryAfter };
  if (error instanceof JevClientError) return { error };
  if (error instanceof Error && error.name === "AbortError") {
    return { error: new JevClientError("timeout", `JEV timed out after ${timeout}ms`) };
  }
  return { error: new JevClientError("network", error instanceof Error ? error.message : String(error)) };
}

/** Compute a bounded retry delay, preferring a provider Retry-After value when present. */
export function retryDelayMilliseconds(attempt: number, retryAfter: string | null | undefined, now = Date.now(), random = Math.random): number {
  const maxDelay = 10_000;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, Math.min(maxDelay, retryAt - now));
  }
  const exponential = Math.min(maxDelay, 100 * 2 ** Math.max(0, attempt));
  const jitter = 0.5 + Math.max(0, Math.min(1, random()));
  return Math.round(Math.min(maxDelay, exponential * jitter));
}

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
    this.model = options.model?.trim() || DEFAULT_JEV_MODEL;
  }

  async decide(state: unknown, questions: Record<string, JevQuestion>): Promise<JevDecisionResult> {
    if (Object.keys(questions).length === 0) throw new TypeError("at least one JEV question is required");
    let requestBody: string;
    try { requestBody = JSON.stringify({ model: this.model, state, questions }); }
    catch { throw new TypeError("JEV request must be JSON-serializable"); }
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        return await requestDecision(this.fetcher, this.options.apiKey.trim(), requestBody, questions, controller.signal);
      } catch (error) {
        const failure = requestFailure(error, this.timeout);
        clearTimeout(timer);
        if (attempt === this.retries || !retryable(failure.error)) throw failure.error;
        await delay(retryDelayMilliseconds(attempt, failure.retryAfter));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new JevClientError("network", "JEV request failed");
  }
}
