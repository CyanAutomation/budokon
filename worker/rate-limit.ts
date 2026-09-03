/** Apply Cloudflare's optional best-effort limiter to the public catalogue. */
type RateLimitEnv = { PUBLIC_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> } };
const RATE_LIMIT = 120;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const rateLimitHeaders = {
  "ratelimit-limit": String(RATE_LIMIT),
  "ratelimit-policy": `${RATE_LIMIT};w=${RATE_LIMIT_WINDOW_SECONDS}`,
};

export async function rateLimitPublicRequest(request: Request, env: RateLimitEnv): Promise<Response | undefined> {
  if (!env.PUBLIC_RATE_LIMITER) return undefined;
  const url = new URL(request.url);
  const client = request.headers.get("cf-connecting-ip") ?? "anonymous";
  try {
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: `${client}:${url.pathname}` });
    if (success) return undefined;
    return new Response(JSON.stringify({ error: { code: "rate_limited", message: "too many requests" } }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(RATE_LIMIT_WINDOW_SECONDS),
        ...rateLimitHeaders,
      }
    });
  } catch {
    return undefined;
  }
}
