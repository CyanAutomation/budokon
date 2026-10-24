---
name: api-mcp-contracts
description: Use when changing or reviewing the REST API, OpenAPI contract, MCP tools, authentication, pagination, caching, rate limits, or public and internal response behavior.
---

# REST and MCP contracts

Treat the public REST and MCP interfaces as versioned consumer contracts.
Before changing behavior, read:

- [API guide](../../../docs/API.md)
- [Internal API and OAuth rules](../../../docs/INTERNAL-API.md)
- [Operations and cache invariants](../../../docs/OPERATIONS.md)
- [OpenAPI contract](../../../openapi/v1.yaml)

## Contract rules

- Public REST reads are unauthenticated and read-only. Keep hidden-record and
  internal controls out of public schemas and browser clients.
- Keep public and internal credentials distinct. Never expose credentials in
  source control or browser code.
- Preserve v1 response shapes, filters, error envelopes, and deterministic
  behavior. Add optional fields and endpoints compatibly; use a new API path
  version for a breaking change and document deprecations with a sunset date.
- Keep REST routing and CORS behavior separate from the MCP transport.
- Preserve cursor pagination semantics. Clients must repeat the same filters
  and limit when continuing with a cursor.
- Keep authorization-sensitive responses out of the public cache. Preserve
  cache ordering, ETag behavior, and separate REST and MCP rate-limit bindings.
- MCP tools should return the advertised structured content and output schema.
  Keep public discovery free of internal visibility controls.

## Change workflow

1. Trace the affected route or tool through its contract, implementation,
   authentication path, cache/rate-limit path, and tests.
2. Update OpenAPI and the relevant API documentation whenever the external
   contract changes.
3. Add or update tests for success, invalid input, auth boundaries, and
   compatibility behavior affected by the change.
4. Run **npm run validate:openapi** and **npm test**. For broader changes, run
   **npm run check**.
5. Do not treat /v1/status as an external dependency health check; it reports
   Worker and bundled catalogue liveness.
