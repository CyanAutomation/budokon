# Internal API access

The public OpenAPI contract at `/openapi/v1.yaml` intentionally excludes
controls for hidden records. Public catalogue calls need no credential.

## REST hidden-record access

To include hidden records, set `INTERNAL_API_KEY` as a Worker secret and send
exactly one credential header: `X-API-Key: <key>` or
`Authorization: Bearer <key>`. `API_KEY` is an MCP credential and does not grant
internal REST visibility.

Internal REST callers may set `includeHidden=true` on `GET /v1/judoka`,
`GET /v1/judoka/{id}`, or the JSON body of `POST /v1/draw`. The query/body flag
is explicit; credentials alone do not include hidden records. An unauthorized
list or draw request that explicitly asks for hidden records returns `403`.
An unauthorized lookup of a hidden record returns `404` to avoid disclosing
whether it exists. Credentialed and hidden-record responses are private and
are not written to the public response cache.

Do not add these controls to a public GPT Action schema. If an internal
ChatGPT/MCP client needs them, use a separately managed credential and limit
access to trusted users.

## MCP credentials and OAuth

`/mcp` accepts `API_KEY` for public tools or `INTERNAL_API_KEY` for public and
internal tools. The internal key also permits hidden-record access and JEV
tools when `JEV_OPENROUTER_API_KEY` is configured. If the two keys are equal,
that value remains public-only until they are distinct. Keep static credentials
separate, rotate them through Worker secret management, and do not place them
in browser code or source control.

The Worker can also act as an OAuth resource server for user-connected MCP
clients. Configure all of these Worker values to enable OAuth; partial
configuration leaves OAuth discovery and bearer-token validation disabled.
Keep `MCP_OAUTH_CLIENT_SECRET` in Worker secret storage. The endpoint and
resource values may be regular Worker vars:

* `MCP_OAUTH_ISSUER`
* `MCP_OAUTH_AUTHORIZATION_ENDPOINT`
* `MCP_OAUTH_TOKEN_ENDPOINT`
* `MCP_OAUTH_INTROSPECTION_ENDPOINT`
* `MCP_OAUTH_CLIENT_ID`
* `MCP_OAUTH_CLIENT_SECRET`
* `MCP_RESOURCE_URL` (for example, `https://api.example.com/mcp`)

Every OAuth access token must include `budokon:read`. The external
authorization server must implement authorization-code sign-in with PKCE S256,
token introspection using `client_secret_basic`, expiry and resource audience
claims, and these additional scopes:

* `budokon:internal` adds hidden-record access and JEV tools;
* `budokon:jev` adds paid/advisory JEV tools without hidden-record access.

OAuth metadata is served at
`/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server`. Introspection must return
`active: true`, a future `exp`, a `sub` or `client_id`, a `scope` string, and an
`aud` value matching `MCP_RESOURCE_URL`. The Worker verifies those claims and
passes validated authentication to the MCP SDK. The authorization server
still owns user consent, client registration, authorization-code exchange,
refresh, and token issuance; this Worker does not issue tokens.

OAuth MCP calls receive the existing IP-based MCP quota and an additional
30-request-per-minute quota keyed by a keyed hash of the OAuth client and
subject. The raw subject is not placed in rate-limit keys. Public REST/GPT
Action use does not need a credential.

## Coverage migration

`GET /v1/coverage` is deprecated because its legacy `total` and `hidden`
properties count internal records. Use `GET /v1/coverage/public`, which reports
only visible real-judoka counts and distributions. The legacy route advertises
its replacement and a 15 January 2027 sunset date.
