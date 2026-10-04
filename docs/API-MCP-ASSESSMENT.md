# BU-DO-KON API and MCP assessment

**Reviewed:** 2026-10-04

**Review type:** Static source and contract review, followed by the implementation work below. Regression tests and runtime route checks were run locally; no production deployment or live-service check was performed.

## Scope and overall assessment

The review covers the public REST API and OpenAPI document, Worker routing, caching, authentication and rate limits, the Streamable HTTP MCP endpoint, MCP tools, and the API documentation. The current implementation exposes **14 REST operations**, 3 GET discovery routes (`/`, `/docs`, `/openapi/v1.yaml`), one `/mcp` transport, **13 public MCP tools**, and **5 internal JEV tools**.

The API is a good read-only catalogue service. REST and MCP share the same application services; draw results carry dataset and algorithm identity; public/internal visibility is explicitly gated; collections have cursor pagination; and OpenAPI and MCP describe typed responses. I recommend retaining the existing endpoints and tools.

The REST/OpenAPI surface is a reasonable starting point for a ChatGPT GPT Action after running it through the current Action importer. The MCP transport now supports an external OAuth authorization server as a resource server, while the authorization-code and consent experience remains the provider's responsibility. The original conditional GET, equal-secret elevation, and oversized MCP result issues were fixed and covered by regression tests.

## Findings and implementation status

### 1. Conditional GET can return 304 for a missing record or invalid query

**Priority: medium.** `publicNotModifiedResponse` decides eligibility from the URL shape, computes a predictable ETag from release identity and the request, and runs before REST routing. It does not confirm that the route resolves to a resource or that its query parameters validate. The ETag matcher also accepts `If-None-Match: *`. As a result, a request such as `GET /v1/judoka/no-such-record` with `If-None-Match: *` can receive `304` instead of `404`; a malformed query on a recognized collection can similarly bypass its normal `400` validation.

**Resolution:** The pre-route shortcut was removed. A matching cached successful representation can still return `304`; a cache miss now reaches route/query validation first. Conditional misses cache the original successful `200`, avoiding cache poisoning by a `304`. Tests cover missing records, invalid queries, and cache revalidation.

### 2. Static MCP keys do not provide user-connected authorization

**Priority: high for public ChatGPT MCP distribution; acceptable for managed integrations.** Every `/mcp` request needs the shared `API_KEY` or `INTERNAL_API_KEY`. There is no OAuth authorization/discovery, user consent, per-user identity, or scope model. The internal key grants hidden-record access and exposes optional paid JEV tools. A shared key is difficult to distribute, revoke, and constrain for a public ChatGPT connection.

**Resolution:** Static keys remain supported for managed clients. Optional OAuth introspection now validates active tokens, expiry, and resource audience; serves RFC 9728/RFC 8414 discovery; requires `budokon:read`; and separates `budokon:internal` and `budokon:jev`. OAuth calls also receive a principal-specific quota. The external authorization server still must provide consent, client registration, PKCE S256, code/token exchange, scopes, and token revocation. Confirm the current ChatGPT onboarding requirements against the selected provider before distribution.

### 3. Reusing the public and internal MCP keys elevates the public credential

**Priority: medium; configuration hardening.** The Worker checks the internal secret first. If `API_KEY` and `INTERNAL_API_KEY` have the same value, that credential is treated as internal and reveals hidden-record/JEV tools. The code comments and internal API guide explain this, but a deployment mistake silently widens access.

**Resolution:** When the values are equal, the internal MCP key is disabled and the shared value stays public-only. REST hidden-record access also requires a distinct internal key. Deployment-time rejection remains a possible operational improvement, but the collision no longer elevates access.

### 4. Contract checks still depend on duplicate hand-maintained definitions

The OpenAPI document now describes the actual public routes and data fields much better than the earlier baseline. However, the OpenAPI validator compares it with an `expectedResponses` table maintained in the validator itself; that table is not generated from or mechanically linked to the runtime router. MCP tool schemas are separately hand-maintained, and the judoka output schema allows arbitrary extra fields and leaves nested fields such as stats and sources broadly typed.

**Resolution:** OpenAPI validation remains in place and a runtime test now sends valid requests through every documented REST operation. MCP collection output schemas are strict compact-summary contracts; judoka detail output now has closed nested schemas for stats and source claims, and all canonical test-fixture records are checked against it. The validator response table and OpenAPI/MCP schemas are still maintained independently, so generating or mechanically comparing them against canonical domain schemas is a remaining opportunity. Keep internal-only controls out of any GPT Action projection.

### 5. Large collection results can consume a lot of model context

MCP collection tools return results as JSON text and structured content. Full judoka records can contain long biographies and source lists, and draws may contain multiple records.

**Resolution:** MCP collection/search pages are capped at 50 and return compact judoka/technique summaries, with detail tools for full records. Judoka draws are capped at 10; draw algorithms are schema-enumerated. REST v1 behavior remains unchanged. Measure payloads with the target ChatGPT client before choosing final production budgets.

## REST endpoint review

“Keep” means the route serves a distinct public or operational purpose. The recommendations below focus on client clarity and future compatibility.

| Endpoint | Evaluation | Recommendation |
|---|---|---|
| `GET /v1/judoka` | Main catalogue search. Supports normalized name/slug/alias text matching, composable filters, exclusions, hidden-record gating, and optional cursors. Filter values within one field are ORed; fields are ANDed. | **Keep.** Encourage `limit` pagination. Without `limit`, v1 retains its full-array response for compatibility, so response size grows with the catalogue. |
| `GET /v1/judoka/{id}` | Direct lookup by UUID, slug, legacy slug, or supported alias. A hidden record is concealed as `404` unless an internal caller explicitly requests it. | **Keep.** Good complementary lookup route. Keep hidden controls out of public Action schemas. |
| `POST /v1/draw` | Filtered, exclusion-aware draw with optional seed, count, and algorithm. Rejects counts larger than the eligible pool with `409`; returns dataset and algorithm identity. | **Keep.** Clear consumer capability. Clients that need reproducibility should retain the seed, `datasetVersion`, and `algorithm`. Hidden-record request fields remain internal-only. |
| `GET /v1/techniques` | Text search over ID, names, Japanese name, and description; exact normalized category/subcategory filters; optional cursor pagination. | **Keep.** A strong searchable catalogue endpoint. |
| `GET /v1/techniques/{id}` | Direct canonical technique lookup. | **Keep.** Useful for details after a search result. |
| `GET /v1/events` | Lists gameplay events with optional ruleset/category filters and cursor pagination. | **Keep.** Document that event filters are exact-match values, unlike normalized technique filters. |
| `GET /v1/events/{id}` | Direct event lookup with typed effects. | **Keep.** Good detail operation for consumers that apply gameplay effects. |
| `POST /v1/events/draw` | Draws one event; requires a ruleset and accepts category, exclusions, and optional seed. Empty eligible pools return `409`. | **Keep.** Distinct from judoka draw and correctly ruleset-scoped. Preserve event algorithm and dataset metadata with replays. |
| `GET /v1/countries` | Returns the supported country map used by catalogue filters and display. | **Keep.** Useful reference data. |
| `GET /v1/weight-categories` | Returns supported senior weight categories grouped by gender. | **Keep.** Useful reference data for filters and UI. |
| `GET /v1/version` | Returns dataset/service release identity, checksum, source commit, and draw algorithms. | **Keep.** Canonical machine-readable release metadata. |
| `GET /v1/status` | Liveness response with `status: ok` and release metadata. It does not probe external services and overlaps with `/version`. | **Keep.** The distinct liveness meaning is useful; avoid adding dependency-readiness claims unless the handler checks them. |
| `GET /v1/coverage` | Legacy coverage response includes all-record and hidden-record counts, while distributions describe public real judoka. It is deprecated and announces a successor and sunset date. | **Keep through the published migration window, then remove only under the compatibility policy.** Its total/hidden fields disclose internal catalogue counts; migrate clients to the public route. |
| `GET /v1/coverage/public` | Coverage metrics over visible real judoka only; omits all-record and hidden counts. | **Keep.** This is the safer public successor and has clear, limited semantics. |

### OpenAPI and discovery

The OpenAPI document is OpenAPI 3.1, describes the 14 REST operations, includes full catalogue shapes and common errors, and intentionally exposes no hidden-record controls. The public API is anonymous and read-only. The two draw operations are marked non-consequential for OpenAI tooling, which matches their lack of server-side mutation.

The root response, HTML docs, and downloadable YAML are useful discovery surfaces. Keep their GET-only method handling. The current fixed OpenAPI server URL should be checked when deploying a different public origin.

The legacy list response remains an array when `limit` is omitted and becomes a named page object when pagination is requested. This preserves v1 compatibility but is awkward for generated clients and tool callers. Keep it in v1; prefer a single stable envelope if a future major API version is introduced.

## MCP review

### Transport and common behavior

`/mcp` uses the official Streamable HTTP SDK in stateless mode. It checks a configured hostname and request origin, rate-limits MCP separately from REST, authenticates before exposing tools, and returns both text and structured tool results. OAuth discovery and introspection are optional. Public tools require `budokon:read`; the internal scope reveals hidden-record controls; and either `budokon:jev` or the static internal key can expose JEV tools when the model provider is configured. JEV-only OAuth callers do not receive hidden-record controls.

Keep Streamable HTTP. OAuth MCP calls consume both the IP quota and a per-principal quota; static-key calls keep the IP quota. A dedicated lower JEV quota or budget is still advisable before granting paid-model access broadly.

### Public MCP tools

| Tool | Evaluation | Recommendation |
|---|---|---|
| `get_judoka` | Looks up public judoka by immutable ID, slug, legacy slug, or alias; returns a versioned record or `null`. | **Keep.** Output schema and lookup semantics are explicit. |
| `search_judoka` | Search/filter/exclude plus cursor pagination; supports `query` or `q`, rejecting both together. Results are deterministic and compact. | **Keep.** Page size is capped at 50; use `get_judoka` for biography, stats, and sources. |
| `draw_judoka` | Filtered draw with exclusions and optional seed. | **Keep.** Count is capped at 10 and `algorithm` is restricted to supported values in the input schema. |
| `list_techniques` | Stable-order paginated listing of compact summaries. | **Keep.** Use `get_technique` for description and link. |
| `search_techniques` | Text/category/subcategory search with compact summaries and pagination. | **Keep.** Useful and aligned with REST semantics. |
| `get_technique` | Full technique detail by ID. | **Keep.** Good pairing with search/list. |
| `list_events` | Ruleset/category filtering plus pagination. | **Keep.** Results are typed and bounded. |
| `get_event` | Direct event detail with typed effects. | **Keep.** Good pairing with listing/draw. |
| `draw_event` | Ruleset-required event draw with category, exclusions, and seed. | **Keep.** Output includes dataset and algorithm identity. |
| `list_countries` | Versioned country reference map. | **Keep.** Useful model grounding for country filters. |
| `list_weight_categories` | Versioned senior weight groups. | **Keep.** Useful model grounding for weight filters. |
| `get_public_coverage` | Versioned public-only real-judoka coverage. | **Keep.** Avoids the legacy hidden-count leak. |
| `version` | Dataset, service, commit, checksum, and algorithm metadata. | **Keep.** Useful for reproducibility and debugging. |

### Internal JEV MCP tools

These tools call an external model and remain properly separated from public discovery. They are advisory; editorial tools do not mutate catalogue data and require human approval.

| Tool | Evaluation | Recommendation |
|---|---|---|
| `semantic_search_judoka` | Model-ranks a bounded candidate set after catalogue filters; hidden candidates require internal access. | **Keep internal.** Preserve candidate bounds, cost monitoring, and a deterministic search path. |
| `review_proposed_judoka` | Advisory review of one proposed record, supplied evidence, and duplicate candidates. | **Keep internal.** Human approval remains required before applying editorial changes. |
| `review_proposed_judoka_batch` | Bounded review of up to 10 proposals in one call. | **Keep internal.** Useful for editorial throughput; apply explicit spend limits. |
| `review_judoka_playstyle` | Proposes confidence-gated playstyle facets from a catalogue record and supplied evidence. | **Keep internal.** Maintain confidence thresholds and human approval. |
| `interpret_judoka_query` | Suggests catalogue filters from natural language without applying low-confidence suggestions. | **Keep internal initially.** Consider public use only after quality, cost, and per-user quota evaluation. |

## ChatGPT/OpenAI compatibility path

“ChatGPT plugin” can refer to older plugin integrations or newer tool integrations. Do not target the retired legacy plugin manifest. Use one of these current shapes:

- **GPT Action:** expose a public-only OpenAPI contract for the anonymous REST API. Test the actual OpenAPI document with the current Action importer and keep internal visibility controls absent.
- **Remote MCP / ChatGPT app:** retain Streamable HTTP and tool-first APIs. The Worker now validates OAuth tokens and scopes through an external authorization server; the selected provider must still supply consent, PKCE, registration, and token issuance. Static API keys remain appropriate for managed integrations.

Keep tool descriptions action-oriented, result bounds explicit, and draws marked non-consequential. Preserve dataset and algorithm metadata so clients can explain replay limits. Do not expose paid JEV or hidden-record operations to a general public connector.

## Improvement order

1. Select and configure an external OAuth provider that satisfies the MCP resource metadata, audience, introspection, PKCE, registration, and ChatGPT client requirements.
2. Add a dedicated lower JEV rate limit or explicit spend budget before granting `budokon:jev` broadly.
3. Reduce remaining schema drift by deriving or cross-checking OpenAPI and MCP contracts against canonical schemas.
4. Measure MCP payload sizes with the target ChatGPT client and tune page/draw budgets if needed.
5. Keep the legacy coverage sunset and status/readiness semantics current in docs and monitoring.

No endpoint removal is recommended. The existing status/version overlap is modest; the public coverage route is preferable to removing coverage; and the legacy coverage route should follow its already-published deprecation period.

## Verification summary

The follow-up used regression tests before and after the fixes. Targeted checks
covered REST conditional/cache behavior, MCP output bounds and scopes, OAuth
discovery/introspection, equal static credentials, and a runtime request to
each documented REST operation. `npm test` passed all 285 tests. The current
OAuth code is a resource-server integration, not a token issuer; no production
OAuth provider was configured or contacted.
