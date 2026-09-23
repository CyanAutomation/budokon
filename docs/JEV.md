# JEV assistance

JEV is an optional, internal-only assistant for bounded semantic judgements. It is not part of canonical validation, compilation, REST search, deterministic draws, or release generation. Existing validators and human Git review remain authoritative. JEV never writes catalogue data or fetches source pages.

## Enablement

Configure Worker secrets; never commit their values or put them in `wrangler.toml`:

```sh
npx wrangler secret put JEV_OPENROUTER_API_KEY
npx wrangler secret put JEV_MODEL       # optional; defaults to ~typesafe/jev-latest
npx wrangler secret put JEV_TIMEOUT_MS  # optional; defaults to 15000
```

Optional Worker variables tune the advisory thresholds: `JEV_MINIMUM_RELEVANCE` (default `0.5`), `JEV_EDITORIAL_THRESHOLD` (default `0.8`), and `JEV_QUERY_MINIMUM_CONFIDENCE` (default `0.7`). Each must be between 0 and 1; invalid values fall back to the documented default. Calibrate them against labeled Budokon examples before relying on an automatic recommendation.

The JEV MCP tools are absent unless `JEV_OPENROUTER_API_KEY` is configured. They are registered only for MCP requests authenticated with `INTERNAL_API_KEY`; a regular `API_KEY` cannot discover or call them. The Worker does not log the credential. Responses are checked against the requested answer types and candidate options. Network errors, timeouts, HTTP 429, 502, 503, 504, and 529 are retried a bounded number of times, honoring `Retry-After` up to a 10-second delay.

## Internal MCP tools

`semantic_search_judoka` ranks up to 100 judoka in one JEV request, with a 1,000-character query and 64 KB serialized-input cap. The current catalogue fits in one request; if it grows beyond the limit, use ordinary catalogue filters to narrow the candidate pool. JEV complements, but never changes, deterministic catalogue search.

`interpret_judoka_query` maps a natural-language query onto the catalogue's existing country, gender, weight, rarity, and person-type filters. Only choices meeting the confidence threshold (0.7 by default) are applied; lower-confidence choices are returned as suggestions. The caller should show or retain those suggestions rather than silently narrowing results. The final lookup still uses Budokon's deterministic catalogue filters.

`review_proposed_judoka` reviews a proposed canonical-shaped record against supplied source excerpts and a deterministic shortlist of likely catalogue duplicates. It returns separate signals for biography quality, identity, nationality, weight class, biography claim support, stats, rarity, signature techniques, duplicates, and human review. `review_proposed_judoka_batch` applies the same review to up to 10 proposals in one JEV request. Inputs are bounded and schema-checked. A URL without an excerpt is not evidence. Recommendations are advisory and always require human approval.

All tools return the resolved model and provider usage metadata. Treat answers as review signals, not facts. Review low-confidence, duplicate, unsupported-claim, and attribute-fit results manually.

## Manual GitHub evaluation

The manually dispatched [JEV Search Evaluation workflow](../.github/workflows/jev-advisory.yaml) runs only the small semantic-search evaluation on the default branch and writes its report to the Actions step summary. It does not inspect or review pull requests.

To enable it, add `JEV_OPENROUTER_API_KEY` as a repository Actions secret. Optionally set the Actions variable `JEV_MODEL` to select a model. Then choose Actions → JEV Search Evaluation → Run workflow on the default branch.

The three hand-labeled search cases live in `tests/fixtures/jev-evaluation.json`. Run the same live evaluation locally with:

```sh
JEV_OPENROUTER_API_KEY=… npm run jev:evaluate
```

It reports precision, recall, model IDs, ranking scores, and provider usage. The fixture is intentionally small and non-gating: use its results for regression visibility and threshold comparison, not as a statistically robust accuracy claim. Keep the model alias configurable until repeated, labeled evaluation supports pinning it. Do not use JEV to create or modify canonical records, select draws, calculate game outcomes, or make release decisions.
