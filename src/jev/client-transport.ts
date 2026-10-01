import type { JevDecisionResult, JevQuestion } from "./types.js";
import { JEV_DECISIONS_URL, JevClientError } from "./client-contracts.js";
import { parseJevResponse } from "./client-response.js";

class JevHttpError extends Error {
  constructor(readonly clientError: JevClientError, readonly retryAfter: string | null) {
    super(clientError.message);
    this.name = "JevHttpError";
  }
}

export interface RequestFailure {
  error: JevClientError;
  retryAfter?: string | null;
}

export async function requestJevDecision(
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
  const parsed = parseJevResponse(value, questions);
  if (!parsed) throw new JevClientError("invalid_response", "JEV response did not match the requested answer types");
  return parsed;
}

export function classifyRequestFailure(error: unknown, timeout: number): RequestFailure {
  if (error instanceof JevHttpError) return { error: error.clientError, retryAfter: error.retryAfter };
  if (error instanceof JevClientError) return { error };
  if (error instanceof Error && error.name === "AbortError") {
    return { error: new JevClientError("timeout", `JEV timed out after ${timeout}ms`) };
  }
  return { error: new JevClientError("network", error instanceof Error ? error.message : String(error)) };
}
