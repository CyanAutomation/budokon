# BU-DO-KON API and MCP assessment

> Baseline snapshot before the implementation follow-up dated 2026-10-03.
> The completed changes are summarized at the end of this report.

**Scope:** static review of the REST router, published OpenAPI document, Worker entry points, MCP server/tools, and the API/MCP documentation. This reviews 13 REST operations, 3 discovery routes, the `/mcp` transport, 9 public MCP tools, and 4 internal JEV tools.

## Recommendation summary

| Action | Recommendation |
|---|---|
| Remove | **None.** The current endpoints serve separate catalogue, draw, reference-data, or release-metadata needs. The overlap between `/v1/status` and `/v1/version` is small and does not justify breaking the stable `/v1` contract. |
| Update | Bring OpenAPI in line with runtime behavior and canonical data schemas; clarify internal-only visibility/authentication; improve MCP output schemas and bound list/search results; narrow the public coverage response; clarify status semantics. |
| Add | Add a technique search/filter operation and MCP reference-data/search tools. Consider a dedicated readiness check only if deployment monitoring needs one. |

The foundation is sound: REST and MCP use the same catalog/draw services; REST is read-only; draws can be reproduced with a seed and returned algorithm/data versions; MCP uses the official Streamable HTTP SDK; hidden-record access and JEV tools have internal gates. The main readiness gap is contract quality: the OpenAPI schemas materially underdescribe returned records and omit some behavior the router accepts. The MCP tool layer has useful capabilities but is not yet optimized for bounded, typed, broadly authenticated ChatGPT use.

## REST endpoint review

“Keep” means retain as part of the current contract. “Update” means retain the route and improve its contract or behavior. No row recommends removing an endpoint.

| Endpoint | Assessment | Recommendation |
|---|---|---|
| `GET /v1/judoka` | Strong central endpoint: deterministic text matching, composable filters, exclusions, hidden-record gate, and optional cursor pagination. | **Keep; update the OpenAPI contract.** Describe repeated and comma-separated filter values, OR-within/AND-between filter semantics, pagination, and actual response fields. Define how internal credentials are supplied, or omit hidden-record controls from a public ChatGPT Action schema. |
| `GET /v1/judoka/{id}` | Useful direct lookup by UUID/slug/legacy slug/alias. Hidden records are concealed as `404` unless the internal key and `includeHidden=true` are supplied. | **Keep; update OpenAPI.** Add the supported `includeHidden` query parameter to the internal contract and document its authorization and 404 behavior. Keep it out of a public-only ChatGPT schema. |
| `POST /v1/draw` | Clear consumer capability; filters/exclusions and deterministic seeds are appropriate. Runtime accepts `includeHidden`, but rejects it without internal authorization. | **Keep; update OpenAPI.** Add or explicitly exclude the internal-only body field in a separate internal contract. Document supported algorithms, seed reproducibility, `409` error shape, and the count/pool limit. |
| `GET /v1/techniques` | Useful collection route with cursor pagination. | **Keep; update schema.** Runtime records include Japanese name, style, category, subcategory, description, and link; the published schema only specifies `id` and `name`. Add query filters/search as a separate additive enhancement (see missing endpoints). |
| `GET /v1/techniques/{id}` | Useful direct lookup. | **Keep; update schema.** Use the full canonical technique shape and document not-found and validation responses. |
| `GET /v1/events` | Good ruleset/category filters and pagination. | **Keep; update schema.** Specify the actual event/effect structure and supported query encoding; event effects are currently described as arbitrary objects. |
| `GET /v1/events/{id}` | Useful event detail route. | **Keep; update schema.** Reuse the complete event/effect schema. |
| `POST /v1/events/draw` | Correctly requires a ruleset and supports category, exclusions, and a seed. | **Keep; update OpenAPI.** Define the complete event/effect response and the JSON error body for `409`; document that an empty eligible pool causes a conflict. |
| `GET /v1/countries` | Appropriate reference-data endpoint for country filters and display. | **Keep; update schema.** Replace the generic object-of-objects response with the country fields actually returned. |
| `GET /v1/weight-categories` | Appropriate reference-data endpoint for weight-class filters and display. | **Keep; update schema.** Specify the gender/category group structure rather than generic objects. |
| `GET /v1/version` | Useful immutable release identity, including data checksum and draw algorithm identifiers. | **Keep.** Keep as the stable machine-readable version endpoint. Ensure the OpenAPI document describes all fields. |
| `GET /v1/status` | Currently returns `status: "ok"` plus the same release metadata as `/version`; it is a useful lightweight liveness check. | **Keep; clarify semantics.** Call this liveness/release status unless it checks dependencies/readiness. If readiness is needed, add a distinct operational check instead of removing either stable route. |
| `GET /v1/coverage` | Useful public catalogue-coverage summary, but `total` and `hidden` count all records while the other distributions are computed only from public real judoka. | **Keep; update deliberately.** Review whether hidden-record totals should be public. Removing or changing `hidden`/`total` would break the documented v1 compatibility promise, so deprecate first and change only through an explicitly versioned transition. |

### OpenAPI contract corrections

The published OpenAPI 3.1 document is a good foundation for a GPT Action, but it should not yet be treated as a complete generated client contract:

- The `Judoka` schema includes only a small subset of fields returned by the API (for example, it omits `stats`, `bio`, `gender`, `rarity`, `isHidden`, `profileUrl`, and `lastUpdated`). The `Technique` schema omits most canonical fields; `Event.effects`, countries, and weight categories are too generic to guide a model reliably.
- `includeHidden` is documented only for `GET /v1/judoka`, while the implementation also accepts it on judoka lookup and judoka draw. The lookup route returns `404` for an unauthorized hidden record, while list/draw return `403` for an unauthorized explicit request.
- `POST /v1/draw` accepts `includeHidden` and the OpenAPI request body does not describe it. Do not expose this internal control in the public ChatGPT Action schema; if internal clients need it, publish a separate internal contract with explicit authentication.
- Several real response cases are missing or inconsistently listed: validation `400`, visibility `403`, `404`, draw `409`, unsupported-method `405`, and server errors. The `ETag` is described for `304` but should also be documented on successful GET responses. Draw conflict responses should use the same error envelope schema as other failures.
- Filter query serialization supports both repeated values and comma-separated values, while the OpenAPI definitions currently describe each as one string. State both accepted forms or standardize on one form in a future version.
- The `oneOf` list response (legacy array without `limit`, named page object with `limit`) is backward compatible but more complex for generated clients and GPT Actions. Keep it in v1; consider always returning a stable envelope in a future major version.
- The repository's OpenAPI validator checks selected response references and visibility placement, but it does not currently assert complete route/parameter/response parity with the runtime. In particular, its visibility rule enshrines the current list-only OpenAPI view despite lookup/draw behavior.

Prefer generating or checking OpenAPI component schemas against the canonical JSON schemas and runtime request validators. Keep a public contract for ChatGPT Actions free of internal-only controls; document the internal credential path separately. For optional internal visibility on REST, define the accepted `X-API-Key` and Bearer mechanisms without making authentication appear mandatory for ordinary public reads.

## MCP review

The server at `/mcp` is a stateless Streamable HTTP endpoint. It authenticates every request with `API_KEY` or `INTERNAL_API_KEY`, validates Host/Origin, applies its own rate limit, and registers public tools plus optional internal JEV tools. It currently returns both JSON text content and `structuredContent`, which is useful for clients that can consume structured results.

### Transport

| Surface | Assessment | Recommendation |
|---|---|---|
| `POST /mcp` (MCP Streamable HTTP) | Protocol/tool discovery and tool calls are implemented through the MCP SDK. A shared static key is required for every client; there is no OAuth authorization/discovery flow. | **Keep; update auth before broad ChatGPT distribution.** Static credentials can work for controlled server-to-server clients, but are not a portable user sign-in/consent path. Confirm the target ChatGPT MCP client’s current auth requirements; add OAuth 2.1/OIDC-compatible authorization and scopes if user-connected access is required. Retain shared keys only for managed integrations. |
| `GET /`, `GET /docs`, `GET /openapi/v1.yaml` | Useful landing, human documentation, and machine contract routes. They are outside `/v1` and not part of the OpenAPI operation list. | **Keep.** Add method handling/`Allow` behavior consistently if these routes are intended to be GET-only; currently discovery is selected by path before method validation. |

The REST API is the lower-friction ChatGPT path today: it is public, uses ordinary HTTP, and already publishes OpenAPI. For a GPT Action, import a public-only OpenAPI contract and add ChatGPT-specific action metadata where supported. For ChatGPT’s MCP path, keep Streamable HTTP and tool-first design, but do not assume a shared internal API key is an appropriate consumer authentication model. The retired legacy “ChatGPT plugin” manifest format should not be the target; use OpenAPI Actions and/or remote MCP instead.

### Public MCP tools

| Tool | Assessment | Recommendation |
|---|---|---|
| `get_judoka` | Direct ID/slug lookup; returns `{datasetVersion, judoka}` and `null` on no public match. | **Keep; add output schema and state accepted IDs/null behavior.** Keep hidden lookup internal. |
| `search_judoka` | Main search/filter tool. `query` and `q` are both accepted; if both are sent, `query` silently wins. It returns all matches with no page size/cursor. | **Keep; update.** Choose one argument name, describe deterministic name/slug/alias matching, and add bounded pagination/limit before catalogue growth. |
| `draw_judoka` | Useful bounded draw tool with filters, exclusions, seed, and algorithm. | **Keep; add output schema and explicit supported algorithm/error description.** Do not expose hidden draw to public ChatGPT clients. |
| `list_techniques` | Returns the complete technique catalogue without pagination/filtering. | **Keep; update or pair with search.** Add pagination and/or category/subcategory filtering so models need not ingest the whole collection. |
| `get_technique` | Useful direct detail lookup. | **Keep; add output schema describing the full canonical technique record.** |
| `list_events` | Supports ruleset/category filters but returns all matching records. | **Keep; add output schema and pagination.** |
| `get_event` | Useful direct detail lookup. | **Keep; add output schema with typed effect action/target/value.** |
| `draw_event` | Useful ruleset-required draw and deterministic seed. | **Keep; add output schema and describe empty-pool behavior.** |
| `version` | Useful release/draw compatibility metadata. | **Keep; add output schema.** A separate MCP status tool is optional if a client has an operational use case. |

### Internal JEV MCP tools

| Tool | Assessment | Recommendation |
|---|---|---|
| `semantic_search_judoka` | Bounded, model-ranked search over a filtered candidate set; limited to internal credentials and at most 100 candidates. | **Keep internal-only.** Document provider/cost/latency behavior and preserve the deterministic search fallback. Promote only after labeled quality evaluation and per-user quotas. |
| `review_proposed_judoka` | Bounded advisory review using caller-supplied evidence and duplicate candidates; does not mutate the catalogue. | **Keep internal-only.** This is editorial workflow functionality, not a public consumer ChatGPT tool. Preserve explicit human approval. |
| `review_proposed_judoka_batch` | Same review for up to 10 proposals in one bounded request. | **Keep internal-only.** It is not redundant with single review for batch workflow/cost reasons; retain the documented size limits. |
| `interpret_judoka_query` | Suggests existing filters and returns low-confidence choices without silently applying them. | **Keep internal-only initially.** It could be a later consumer-facing convenience after quality/cost evaluation and user-level rate limits. |

Across all MCP tools, the implementation registers descriptions and input schemas but no MCP `outputSchema`, display `title`, or tool annotations. Add output schemas for successful results and MCP metadata such as read-only/idempotent hints where accurate. This improves client validation and helps ChatGPT choose tools safely. Keep descriptions short but specific about search semantics, result bounds, deterministic behavior, and whether a call invokes a paid model.

## Implementation status (2026-10-03)

The follow-up implementing the recommendations above is complete on the working
branch. It adds REST technique search and public-safe coverage, deprecates the
legacy coverage response with migration headers, bounds and paginates MCP
collections, adds public reference/search/coverage MCP tools, gives each MCP
tool an output schema/title/annotations, tightens discovery method handling,
expands OpenAPI schemas and response contracts, and validates documented route
parity. The public contract intentionally omits internal visibility controls.

No existing endpoint or tool was removed. Static MCP credentials remain in
place for managed integrations; a user-connected ChatGPT MCP deployment still
needs an OAuth 2.1-compatible authorization design and scopes. Public REST with
OpenAPI Actions remains the near-term ChatGPT integration path.

## Primary consumer review: `judokon-2600`

Reviewed `CyanAutomation/judokon-2600` at its current `main` revision
`35b265d`. Its `BudokonRequestBuilder` calls only `POST /v1/draw`, sending
`count`, `seed`, optional `filters.weightClass`, and `exclude`. Those fields and
the `{ judoka, ...metadata }` response envelope remain compatible. The consumer
validates the required game fields, tolerates additive judoka fields, and reads
only `judoka`; it does not call coverage, technique, reference-data, or MCP
operations. The worker is configured with wildcard public CORS, so the browser
integration does not need an origin change.

No consumer API migration is required for this service update. The consumer got
a regression test for the versioned draw envelope and additive judoka fields,
and its stale comment about optional API rarity was corrected while preserving
the game's deliberate tolerance for older or incomplete fixtures.

One replay limitation remains: the game stores/displays its seed, but currently
discards the draw response's `datasetVersion` and `algorithm`. The same seed
reproduces draws only against the same dataset release and algorithm. The UI
now states this limitation. A later replay-integrity improvement should retain
and display that release identity alongside the seed. Exact replay after a
catalogue update would also require the service to support selecting or
retaining historical dataset versions; merely saving the metadata can detect a
mismatch, but cannot retrieve an old draw pool.

## Remaining improvement opportunities

- **ChatGPT MCP authorization.** The current server uses a static credential. Add a user-consented OAuth 2.1-compatible flow and scopes before broad user-connected MCP distribution. Keep the shared key for managed server-to-server use.
- **Replay integrity in the primary consumer.** `judokon-2600` now explains that replay depends on the data release, but still does not retain or display `datasetVersion` and `algorithm`. Saving these would let it detect a mismatch. Exact replay across catalogue updates additionally needs historical dataset selection or retention in the service.
- **Readiness monitoring.** `/v1/status` is documented as liveness. Add a distinct readiness probe only if deployment monitoring gains dependencies that need checking.
- **Long-term pagination ergonomics.** V1 keeps its original array shape when `limit` is omitted and switches to an object for paged calls. Preserve that behavior for compatibility; use a new API version if a consistent envelope is later preferred.
- **Schema generation.** The OpenAPI validator now verifies route and response parity, and contract tests cover representative runtime behavior. A future build step could generate or mechanically compare schemas against canonical JSON schemas to reduce remaining manual drift.

## ChatGPT compatibility path

- **GPT Actions:** the public REST/OpenAPI contract is the near-term integration path. It is anonymous and excludes internal visibility controls. The draw operations carry non-consequential metadata, and list pagination behavior is documented.
- **Remote MCP:** `/mcp` remains Streamable HTTP and advertises typed tool results and annotations. OAuth and user scopes remain future work; internal visibility and JEV operations stay gated.
- **Legacy plugins:** target GPT Actions and/or remote MCP rather than the retired ChatGPT plugin manifest format.

## Review limits

The endpoint baseline was reviewed from source. The implementation follow-up was
verified with `npm run check` (including 263 service tests) and
`npm run validate:openapi`. The downstream consumer was checked at `main`
revision `35b265d`; its `npm run check` passed (277 tests, lint, and build). The
consumer repository declares Node 22 while this workspace ran Node 24, so npm
reported an engine warning during dependency installation; the checks passed
under the available runtime.
