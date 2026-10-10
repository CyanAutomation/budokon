export interface Env {
  API_KEY: string;
  /** Comma-separated hostnames permitted to serve the MCP endpoint. */
  MCP_ALLOWED_HOSTNAMES?: string;
  /** Optional elevated credential which alone may access hidden records. */
  INTERNAL_API_KEY?: string;
  /** Comma-separated browser origins permitted to read the public REST API. */
  PUBLIC_ALLOWED_ORIGINS?: string;
  PUBLIC_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional secret enabling internal-only JEV editorial review and semantic MCP tools. */
  JEV_OPENROUTER_API_KEY?: string;
  /** OAuth authorization-server issuer and endpoints; this Worker only validates access tokens. */
  MCP_OAUTH_ISSUER?: string;
  MCP_OAUTH_AUTHORIZATION_ENDPOINT?: string;
  MCP_OAUTH_TOKEN_ENDPOINT?: string;
  MCP_OAUTH_INTROSPECTION_ENDPOINT?: string;
  MCP_OAUTH_CLIENT_ID?: string;
  MCP_OAUTH_CLIENT_SECRET?: string;
  /** Exact resource identifier expected in introspected access-token audience claims. */
  MCP_RESOURCE_URL?: string;
  JEV_MODEL?: string;
  JEV_TIMEOUT_MS?: string;
  JEV_MINIMUM_RELEVANCE?: string;
  JEV_EDITORIAL_THRESHOLD?: string;
  JEV_QUERY_MINIMUM_CONFIDENCE?: string;
  JEV_PLAYSTYLE_THRESHOLD?: string;
}
