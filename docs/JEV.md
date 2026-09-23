# JEV assistance

JEV is an optional, internal-only assistant for bounded semantic judgements. It is not part of canonical validation, compilation, REST search, deterministic draws, or release generation. Existing validators and human Git review remain authoritative. JEV never writes catalogue data or fetches source pages.

## Enablement

Configure Worker secrets; never commit their values or put them in `wrangler.toml`:

```sh
npx wrangler secret put JEV_OPENROUTER_API_KEY
npx wrangler secret put JEV_MODEL       # optional; defaults to ~typesafe/jev-latest
npx wrangler secret put JEV_TIMEOUT_MS  # optional; defaults to 15000
```

The JEV MCP tools are absent unless `JEV_OPENROUTER_API_KEY` is configured. They are registered only for MCP requests authenticated with `INTERNAL_API_KEY`; a regular `API_KEY` cannot discover or call them. The Worker does not log the credential. Responses are checked against the requested answer types and candidate options. Network errors, timeouts, HTTP 429, 502, 503, 504, and 529 are retried a bounded number of times, honoring `Retry-After` up to a 10-second delay.

## Internal MCP tools

`semantic_search_judoka` ranks at most 20 judoka from an already-filtered candidate pool, with a 1,000-character query and 64 KB serialized-input cap. Ordinary catalogue filters should narrow broad requests first. JEV complements, but never changes, deterministic catalogue search.

`interpret_judoka_query` maps a natural-language query onto the catalogue's existing country, gender, weight, rarity, and person-type filters. Only choices meeting the confidence threshold (0.7 by default) are applied; lower-confidence choices are returned as suggestions. The caller should show or retain those suggestions rather than silently narrowing results. The final lookup still uses Budokon's deterministic catalogue filters.

`review_proposed_judoka` reviews a proposed canonical-shaped record against supplied source excerpts and up to ten duplicate candidates. It returns separate editorial signals for biography quality, factual support, stats, rarity, signature techniques, duplicates, and human review. Inputs are bounded and schema-checked. A URL without an excerpt is not evidence. Its recommendation is advisory and always has `requiresHumanApproval: true`.

All tools return the resolved model and provider usage metadata. Treat answers as review signals, not facts. Review low-confidence, duplicate, unsupported-claim, and attribute-fit results manually.

## Manual GitHub advisory and evaluation

The manually dispatched [JEV Advisory Review workflow](../.github/workflows/jev-advisory.yaml) can review up to 10 changed judoka JSON records in an open PR targeting the default branch, or run the small semantic-search evaluation. It checks out trusted default-branch code, reads PR metadata and proposed JSON through GitHub's read-only API, and writes only to the Actions step summary. It does not execute PR code, post comments, approve/merge PRs, or alter repository data. PR review intentionally supplies no source excerpts, so factual-support scores are explicitly reported as an evidence gap; it is not a fact-check.

To enable it, add `JEV_OPENROUTER_API_KEY` as a repository Actions secret. Optionally set the Actions variable `JEV_MODEL` to select a model. Then choose Actions → JEV Advisory Review → Run workflow on the default branch and select `review-pr` (with a PR number) or `evaluate-search`.

The three hand-labeled search cases live in `tests/fixtures/jev-evaluation.json`. Run the same live evaluation locally with:

```sh
JEV_OPENROUTER_API_KEY=… npm run jev:evaluate
```

It reports precision, recall, model IDs, ranking scores, and provider usage. The fixture is intentionally small and non-gating: use its results for regression visibility and threshold comparison, not as a statistically robust accuracy claim. Keep the model alias configurable until repeated, labeled evaluation supports pinning it. Do not use JEV to create or modify canonical records, select draws, calculate game outcomes, or make release decisions.
