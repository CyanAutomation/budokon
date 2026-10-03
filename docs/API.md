# BU-DO-KON API guide

The public API is read-only and needs no credential. Use the deployed origin
from the OpenAPI `servers` entry, or your own Worker origin.

## Everyday use

`GET /v1/judoka` returns the public catalogue. Search with `q` and combine
structured filters such as `countryCode`, `gender`, `weightClass`, `rarity`,
`personType`, and `signatureMoveIds`. A multi-value filter may be repeated or
comma-separated; values within a filter are ORed and different filters are
ANDed.

`GET /v1/techniques` accepts `q`, `category`, and `subCategory` before cursor
pagination. Text search matches technique IDs, names, Japanese names, and
descriptions; category filters use exact normalized matches (case- and
diacritic-insensitive) and accept repeated or comma-separated values.

Use `limit` (1--100) to opt into cursor pagination on judoka, technique, and
event lists. The resulting object uses the collection name (`judoka`,
`techniques`, or `events`) and `nextCursor`. Supply that returned value as the
`cursor` query parameter, with the same filters, to fetch the following page:
`/v1/judoka?limit=20&cursor=<nextCursor>`. Repeat `limit` and all filters on
every page. Without `limit`, list endpoints continue to return their original
array response.

`POST /v1/draw` draws judoka. A supplied `seed`, together with the returned
`datasetVersion` and `algorithm`, makes a draw reproducible. Gameplay events
use the equivalent `POST /v1/events/draw` endpoint and require a `ruleset`.

Use `GET /v1/coverage/public` for public real-judoka coverage metrics. It does
not reveal all-record totals or hidden-record counts. The legacy
`GET /v1/coverage` response is deprecated and scheduled to sunset on
15 January 2027; it carries `Deprecation`, `Sunset`, and successor `Link`
headers during the migration window.

All public GET responses include `ETag`. Send it as `If-None-Match` to receive
`304 Not Modified` when the representation has not changed. A matching public
revalidation bypasses request quota because it is resolved from immutable release
identity without generating the representation. Mismatches, requests carrying
credentials, and `includeHidden=true` requests follow the normal rate-limit and
authorization flow. On `429`, honour
`Retry-After` before retrying; that response also includes `RateLimit-Limit`
and `RateLimit-Policy`.

## Routing errors and CORS

An unknown `/v1` route returns `404` with the JSON error envelope and no
`Allow` header. An unsupported method on a known REST route instead returns
`405` with error code `method_not_allowed`; its `Allow` header lists the method
that route supports (`GET` or `POST`). Both responses include CORS headers when
the request's `Origin` is configured in `PUBLIC_ALLOWED_ORIGINS`.

`/`, `/docs`, and `/openapi/v1.yaml` accept `GET`; other methods, including
`OPTIONS`, return `405` with `Allow: GET`. `OPTIONS` is treated as CORS
preflight only inside `/v1/`. For other non-REST paths it returns an empty
`405` response with `Allow: POST`, does not emit a content type, and does not
emit REST CORS headers. This reserves non-REST POST routing for the MCP
transport without exposing it through the public REST CORS policy.

## Data confidence

Judoka can include legacy `sourceUrls` and/or structured `sources`. Structured
sources identify the factual claims they support and when the curator checked
them. They do not endorse game-facing ratings, rarity, or signature moves;
those are editorial attributes.

## Compatibility policy

`/v1` is the stable public contract. Within it, BU-DO-KON may add optional
fields, records, filters, and endpoints without a version bump. Existing field
names, response shapes, filter semantics, deterministic algorithms, and error
envelopes are not removed or changed incompatibly during the v1 lifetime.

A breaking change receives a new path version. A field scheduled for removal is
first documented in the changelog and, where a response can signal it, carries
`Deprecation: true` and a `Sunset` date at least 90 days in the future. Clients
should treat unknown response fields and enum values as forward-compatible.

The exact release behind a response is available from `/v1/version` and
`/v1/status`, including dataset version, source commit, checksum, and draw
algorithm identifiers. `/v1/status` reports Worker/catalogue liveness; it does
not check external dependencies.

## MCP tools

The MCP server returns both JSON text content and structured content, with an
output schema advertised for every tool. Collection tools return at most 50
records by default and include `nextCursor` when more records are available;
continue with the same filters, the same `limit`, and the returned cursor.
Public discovery omits internal visibility controls. Country,
weight-category, technique-search, and public-coverage tools are also available.
Internal JEV tools remain gated by the internal credential; see [JEV assistance](JEV.md).

The public `get_judoka` MCP tool accepts an immutable judoka `id` or `slug` in
an `id` argument. Its JSON content has the shape
`{ "datasetVersion": string, "judoka": Judoka | null }`. When a public record
matches, `judoka` is the same public canonical record exposed by the REST
catalogue. The value is `null` when no public record matches.
