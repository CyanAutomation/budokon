# BU-DO-KON API guide

The public API is read-only and needs no credential. Use the deployed origin
from the OpenAPI `servers` entry, or your own Worker origin.

## Everyday use

`GET /v1/judoka` returns the public catalogue. Search with `q` and combine
structured filters such as `countryCode`, `gender`, `weightClass`, `rarity`,
`personType`, and `signatureMoveIds`. A multi-value filter may be repeated or
comma-separated; values within a filter are ORed and different filters are
ANDed.

Use `limit` (1--100) to opt into cursor pagination on judoka, technique, and
event lists. The resulting object uses the collection name (`judoka`,
`techniques`, or `events`) and `nextCursor`. Supply that returned value as the
`cursor` query parameter, with the same filters, to fetch the following page:
`/v1/judoka?limit=20&cursor=<nextCursor>`. Without `limit`, list endpoints
continue to return their original array response.

`POST /v1/draw` draws judoka. A supplied `seed`, together with the returned
`datasetVersion` and `algorithm`, makes a draw reproducible. Gameplay events
use the equivalent `POST /v1/events/draw` endpoint and require a `ruleset`.

All public GET responses include `ETag`. Send it as `If-None-Match` to receive
`304 Not Modified` when the representation has not changed. On `429`, honour
`Retry-After` before retrying; that response also includes `RateLimit-Limit`
and `RateLimit-Policy`.

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
algorithm identifiers.

## MCP tools

The public `get_judoka` MCP tool accepts an immutable judoka `id` or `slug` in
an `id` argument. Its text content is JSON with the shape
`{ "datasetVersion": string, "judoka": Judoka | null }`. When a public record
matches, `judoka` is the same public canonical record exposed by the REST
catalogue, including its `id`, `slug`, name, classification, biography, stats,
and signature-move fields. The value is `null` when no public record matches.
