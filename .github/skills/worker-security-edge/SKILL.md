---
name: worker-security-edge
description: Use when changing Cloudflare Worker authentication, OAuth, CORS, rate limits, request routing, or edge-cache behavior.
---

# Worker security and edge behavior

The Worker is the security and delivery boundary for REST and MCP. Before
changing it, read [operations invariants](../../../docs/OPERATIONS.md),
[internal API and OAuth rules](../../../docs/INTERNAL-API.md), and the relevant
modules under `worker/`. For REST or MCP contract changes, also follow
[REST and MCP contracts](../api-mcp-contracts/SKILL.md).

## Security and cache invariants

- Keep public REST, internal REST, static MCP credentials, and OAuth scopes
  distinct. Do not expose hidden-record controls or secrets through public
  discovery, browser code, logs, or cacheable responses.
- Preserve separate `PUBLIC_RATE_LIMITER` and `MCP_RATE_LIMITER` bindings.
  MCP fails closed when its required limiter is unavailable; public REST keeps
  its documented availability behavior.
- Cache only successful responses explicitly marked public. Authorization,
  hidden-record, non-GET, error, and draw responses bypass the public cache.
  Preserve dataset and source-commit identity in cache keys.
- Apply request-specific CORS headers after shared-cache lookup and response
  storage. Changing this order can leak one caller's origin to another.
- Cache failures are fail-open for REST and must remain observable. Preserve
  conditional request behavior so invalid requests and missing records keep
  their normal error responses.
- Validate OAuth discovery configuration and every required token claim,
  including expiry, audience, subject/client identity, and scopes. The Worker
  validates tokens; the external authorization server issues them.

## Change workflow

1. Trace the request through routing, authentication, limiter selection, cache
   behavior, response/CORS handling, and the applicable runbook.
2. Add or update tests for both allowed and denied paths, including unavailable
   limiter/cache cases and cross-origin behavior where affected. Relevant
   coverage is in `tests/worker-*.test.ts` and `tests/edge-cache.test.ts`.
3. Update [operations](../../../docs/OPERATIONS.md),
   [internal API documentation](../../../docs/INTERNAL-API.md), and OpenAPI
   where the behavior or public contract changes.
4. Run **npm test**. Run **npm run validate:openapi** for public contract
   changes and **npm run check** for broader changes. Workflow edits also need
   **npm run check:deployment-workflow**.
