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

/** MCP credentials are separately rate-limited from public catalogue reads. */
export async function rateLimitMcpRequest(request: Request, env: { MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> } }): Promise<Response | undefined> {
  if (!env.MCP_RATE_LIMITER) return undefined;
  const client = request.headers.get("cf-connecting-ip") ?? "anonymous";
  try {
    const { success } = await env.MCP_RATE_LIMITER.limit({ key: `${client}:mcp` });
    if (success) return undefined;
    return new Response(JSON.stringify({ error: { code: "rate_limited", message: "too many requests" } }), { status: 429, headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60", "ratelimit-limit": "30", "ratelimit-policy": "30;w=60" } });
  } catch { return undefined; }
}

/** Apply a second MCP quota per OAuth principal without placing subject IDs in limiter keys. */
export async function rateLimitMcpPrincipal(
  env: { MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> }; API_KEY: string },
  principal: string,
): Promise<Response | undefined> {
  if (!env.MCP_RATE_LIMITER) return undefined;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.API_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(principal)));
    const principalHash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    const { success } = await env.MCP_RATE_LIMITER.limit({ key: `${principalHash}:mcp:principal` });
    if (success) return undefined;
    return new Response(JSON.stringify({ error: { code: "rate_limited", message: "too many requests" } }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60", "ratelimit-limit": "30", "ratelimit-policy": "30;w=60" },
    });
  } catch { return undefined; }
}
