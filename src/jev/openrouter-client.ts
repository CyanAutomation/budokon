import type { JevDecisionClient, JevDecisionResult, JevQuestion } from "./types.js";
import { classifyRequestFailure, requestJevDecision } from "./client-transport.js";
import { DEFAULT_JEV_MODEL, JevClientError, type OpenRouterJevClientOptions } from "./client-contracts.js";
import { isRetryableJevFailure, retryDelayMilliseconds } from "./client-retry-policy.js";

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
        return await requestJevDecision(this.fetcher, this.options.apiKey.trim(), requestBody, questions, controller.signal);
      } catch (error) {
        const failure = classifyRequestFailure(error, this.timeout);
        clearTimeout(timer);
        if (attempt === this.retries || !isRetryableJevFailure(failure.error)) throw failure.error;
        await delay(retryDelayMilliseconds(attempt, failure.retryAfter));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new JevClientError("network", "JEV request failed");
  }
}
