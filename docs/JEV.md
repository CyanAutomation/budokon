# JEV editorial assistance

JEV is an optional, internal-only assistant for bounded semantic judgements. It is not part of canonical validation, compilation, REST search, deterministic draws, or release generation. Git review and the existing validators remain authoritative.

## Enablement

Configure the following Worker secrets; never commit their values or place them in `wrangler.toml`:

```sh
npx wrangler secret put JEV_OPENROUTER_API_KEY
# Optional aliases with conservative defaults:
npx wrangler secret put JEV_MODEL       # defaults to ~typesafe/jev-latest
npx wrangler secret put JEV_TIMEOUT_MS  # defaults to 15000
```

The AI tools are absent unless `JEV_OPENROUTER_API_KEY` is configured. They are also registered only for an MCP request authenticated with `INTERNAL_API_KEY`; a regular `API_KEY` cannot discover or call them. The Worker does not log the credential. The client validates every returned answer against the question types it submitted, retries only transient failures, and applies a timeout.

## MCP tools

`review_proposed_judoka` accepts a proposed record, source URLs, and excerpts. It evaluates biography publishability, support for factual claims, potential duplicate candidates, and whether game attributes such as rarity, stats, and signature techniques are internally coherent. The latter is an editorial suggestion, never an objective ranking. Its result is advisory and always has `requiresHumanApproval: true`; it never writes data or retrieves sources.

`semantic_search_judoka` ranks a query against an already-filtered candidate pool. It has a hard limit of 20 candidates, so callers must use ordinary catalogue filters to narrow broad requests. This protects cost and latency and means the tool supplements, rather than replaces, the deterministic `search_judoka` API.

Both tools return the resolved JEV model, typed answers or relevance probabilities, and provider usage metadata. They must be treated as review signals, not as factual sources.

## Operating guidance

Use supplied source excerpts rather than allowing model-driven web fetching. Review low-confidence, duplicate, and unsupported-claim results manually. Do not use JEV to create or modify canonical records, select draws, calculate game outcomes, or make release decisions.
