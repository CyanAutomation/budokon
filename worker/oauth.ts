import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  verifyBearerToken,
  type AuthInfo,
  type AuthMetadataOptions,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

export const MCP_READ_SCOPE = "budokon:read";
export const MCP_INTERNAL_SCOPE = "budokon:internal";
export const MCP_JEV_SCOPE = "budokon:jev";
export const MCP_SUPPORTED_SCOPES = [MCP_READ_SCOPE, MCP_INTERNAL_SCOPE, MCP_JEV_SCOPE] as const;

export interface McpOAuthConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  introspectionEndpoint: string;
  clientId: string;
  clientSecret: string;
  resourceUrl: string;
  fetcher?: typeof fetch;
}

function httpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new TypeError(`${label} must be a valid URL`); }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "[::1]") {
    throw new TypeError(`${label} must use HTTPS`);
  }
  return parsed;
}

export function mcpOAuthMetadataOptions(config: McpOAuthConfig): AuthMetadataOptions {
  const issuer = httpsUrl(config.issuer, "MCP_OAUTH_ISSUER");
  const resourceServerUrl = httpsUrl(config.resourceUrl, "MCP_RESOURCE_URL");
  const authorizationEndpoint = httpsUrl(config.authorizationEndpoint, "MCP_OAUTH_AUTHORIZATION_ENDPOINT");
  const tokenEndpoint = httpsUrl(config.tokenEndpoint, "MCP_OAUTH_TOKEN_ENDPOINT");
  const introspectionEndpoint = httpsUrl(config.introspectionEndpoint, "MCP_OAUTH_INTROSPECTION_ENDPOINT");
  const oauthMetadata: OAuthMetadata = {
    issuer: config.issuer,
    authorization_endpoint: authorizationEndpoint.toString(),
    token_endpoint: tokenEndpoint.toString(),
    introspection_endpoint: introspectionEndpoint.toString(),
    introspection_endpoint_auth_methods_supported: ["client_secret_basic"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
  };
  const options: AuthMetadataOptions = {
    oauthMetadata,
    resourceServerUrl,
    resourceName: "BU-DO-KON MCP API",
    scopesSupported: [...MCP_SUPPORTED_SCOPES],
    ...(issuer.protocol === "http:" ? { dangerouslyAllowInsecureIssuerUrl: true } : {}),
  };
  // Validate the RFC 9728 payload when configuration is loaded so bad issuer
  // configuration does not turn discovery into a request-time surprise.
  buildOAuthProtectedResourceMetadata(options);
  return options;
}

export function oauthDiscoveryResponse(request: Request, config: McpOAuthConfig | undefined): Response | undefined {
  if (!config) return undefined;
  return oauthMetadataResponse(request, mcpOAuthMetadataOptions(config));
}

export function createMcpOAuthVerifier(config: McpOAuthConfig): OAuthTokenVerifier {
  httpsUrl(config.issuer, "MCP_OAUTH_ISSUER");
  const resource = httpsUrl(config.resourceUrl, "MCP_RESOURCE_URL");
  const endpoint = httpsUrl(config.introspectionEndpoint, "MCP_OAUTH_INTROSPECTION_ENDPOINT");
  const fetcher = config.fetcher ?? fetch;
  const encodeFormValue = (value: string) => new URLSearchParams([ ["value", value] ]).toString().slice("value=".length);
  const basicCredentials = `${encodeFormValue(config.clientId)}:${encodeFormValue(config.clientSecret)}`;
  const basicBytes = new TextEncoder().encode(basicCredentials);
  let basicBinary = "";
  for (const byte of basicBytes) basicBinary += String.fromCharCode(byte);
  const basicAuthorization = `Basic ${btoa(basicBinary)}`;
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const form = new URLSearchParams({ token, token_type_hint: "access_token" });
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            authorization: basicAuthorization,
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
            "cache-control": "no-store",
          },
          body: form.toString(),
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        throw new OAuthError(OAuthErrorCode.ServerError, "authorization server token validation failed");
      }
      if (!response.ok) throw new OAuthError(OAuthErrorCode.ServerError, "authorization server token validation failed");

      let claims: unknown;
      try { claims = await response.json(); }
      catch { throw new OAuthError(OAuthErrorCode.ServerError, "authorization server returned invalid token metadata"); }
      if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
        throw new OAuthError(OAuthErrorCode.ServerError, "authorization server returned invalid token metadata");
      }
      const value = claims as Record<string, unknown>;
      if (value.active !== true) throw new OAuthError(OAuthErrorCode.InvalidToken, "access token is inactive");
      if (typeof value.exp !== "number" || !Number.isFinite(value.exp) || value.exp <= Date.now() / 1_000) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "access token is expired or has no expiry");
      }
      if (value.iss !== undefined && value.iss !== config.issuer) throw new OAuthError(OAuthErrorCode.InvalidToken, "access token issuer does not match");
      const audiences = typeof value.aud === "string" ? [value.aud] : Array.isArray(value.aud) ? value.aud : [];
      if (!audiences.includes(resource.toString()) && !audiences.includes(config.resourceUrl)) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "access token is not intended for this resource");
      }
      const scopes = typeof value.scope === "string" ? value.scope.split(/\s+/u).filter(Boolean) : [];
      const clientId = typeof value.sub === "string" && value.sub.length > 0
        ? value.sub
        : typeof value.client_id === "string" && value.client_id.length > 0 ? value.client_id : undefined;
      if (!clientId) throw new OAuthError(OAuthErrorCode.InvalidToken, "access token has no subject");
      return {
        token,
        clientId,
        scopes,
        expiresAt: value.exp,
        resource,
        extra: {
          ...(typeof value.client_id === "string" ? { client_id: value.client_id } : {}),
          ...(typeof value.iss === "string" ? { iss: value.iss } : {}),
        },
      };
    },
  };
}

export async function authenticateOAuthBearer(
  request: Request,
  config: McpOAuthConfig,
): Promise<AuthInfo | Response> {
  const options = mcpOAuthMetadataOptions(config);
  try {
    return await verifyBearerToken(request.headers.get("authorization"), {
      verifier: createMcpOAuthVerifier(config),
      requiredScopes: [MCP_READ_SCOPE],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(options.resourceServerUrl),
    });
  } catch (error) {
    return bearerAuthChallengeResponse(error, {
      requiredScopes: [MCP_READ_SCOPE],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(options.resourceServerUrl),
    });
  }
}
