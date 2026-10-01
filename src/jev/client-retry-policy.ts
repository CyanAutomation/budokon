import { JevClientError } from "./client-contracts.js";

export function isRetryableJevFailure(error: JevClientError): boolean {
  return error.code === "timeout" || error.code === "network"
    || [429, 502, 503, 504, 529].includes(error.status ?? 0);
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
