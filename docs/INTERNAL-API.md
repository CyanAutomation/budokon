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

## MCP credentials and JEV tools

`/mcp` accepts the configured `API_KEY` for public tools or `INTERNAL_API_KEY`
for public and internal tools. The internal key also permits hidden-record
access and discovers the optional JEV semantic search, query interpretation,
and editorial-review tools when `JEV_OPENROUTER_API_KEY` is configured. Keep
these secrets separate, rotate them through Worker secret management, and do
not place them in browser code or source control.

The current MCP endpoint uses a managed static credential. It does not provide
OAuth authorization/discovery or per-user scopes. For a user-connected
ChatGPT MCP integration, add an OAuth 2.1-compatible authorization flow and
separate scopes for internal data and paid JEV operations before distributing
the connection broadly. Public REST/GPT Action use does not need a credential.

## Coverage migration

`GET /v1/coverage` is deprecated because its legacy `total` and `hidden`
properties count internal records. Use `GET /v1/coverage/public`, which reports
only visible real-judoka counts and distributions. The legacy route advertises
its replacement and a 15 January 2027 sunset date.
