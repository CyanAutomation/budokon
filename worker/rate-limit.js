/** Apply Cloudflare's optional best-effort limiter to the public catalogue. */
export async function rateLimitPublicRequest(request, env) {
  if (!env.PUBLIC_RATE_LIMITER) return undefined;
  const url = new URL(request.url);
  const client = request.headers.get("cf-connecting-ip") ?? "anonymous";
  try {
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: `${client}:${url.pathname}` });
    if (success) return undefined;
    return new Response(JSON.stringify({ error: { code: "rate_limited", message: "too many requests" } }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" }
    });
  } catch {
    return undefined;
  }
}
