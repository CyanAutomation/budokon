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
