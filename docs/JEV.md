# JEV assistance

JEV is an optional, internal-only assistant for bounded semantic judgements. It is not part of canonical validation, compilation, REST search, deterministic draws, or release generation. Existing validators and human Git review remain authoritative. JEV never writes catalogue data or fetches source pages.

## Enablement

Configure Worker secrets; never commit their values or put them in `wrangler.toml`:

```sh
npx wrangler secret put JEV_OPENROUTER_API_KEY
npx wrangler secret put JEV_MODEL       # optional; defaults to ~typesafe/jev-latest
npx wrangler secret put JEV_TIMEOUT_MS  # optional; defaults to 15000
```

Optional Worker variables tune the advisory thresholds: `JEV_MINIMUM_RELEVANCE` (default `0.5`), `JEV_EDITORIAL_THRESHOLD` (default `0.8`), `JEV_QUERY_MINIMUM_CONFIDENCE` (default `0.7`), and `JEV_PLAYSTYLE_THRESHOLD` (default `0.78`). Each must be between 0 and 1; invalid values fall back to the documented default. Calibrate them against labeled Budokon examples before relying on a policy recommendation.

The JEV MCP tools are absent unless `JEV_OPENROUTER_API_KEY` is configured. They are registered only for MCP requests authenticated with `INTERNAL_API_KEY`; a regular `API_KEY` cannot discover or call them. The Worker does not log the credential. Responses are checked against the requested answer types and candidate options. Network errors, timeouts, HTTP 429, 502, 503, 504, and 529 are retried a bounded number of times, honoring `Retry-After` up to a 10-second delay.

## Internal MCP tools

`semantic_search_judoka` ranks up to 100 judoka in one JEV request, with a 1,000-character query and 64 KB serialized-input cap. The current catalogue fits in one request; if it grows beyond the limit, use ordinary catalogue filters to narrow the candidate pool. JEV complements, but never changes, deterministic catalogue search.

`interpret_judoka_query` maps a natural-language query onto the catalogue's existing country, gender, weight, rarity, and person-type filters. Only choices meeting the confidence threshold (0.7 by default) are applied; lower-confidence choices are returned as suggestions. The caller should show or retain those suggestions rather than silently narrowing results. The final lookup still uses Budokon's deterministic catalogue filters.

`review_proposed_judoka` reviews a proposed canonical-shaped record against supplied source excerpts and a deterministic shortlist of likely catalogue duplicates. It returns separate signals for biography quality, identity, nationality, weight class, biography claim support, stats, rarity, signature techniques, duplicates, and human review. `review_proposed_judoka_batch` applies the same review to up to 10 proposals in one JEV request. Inputs are bounded and schema-checked. A URL without an excerpt is not evidence. Recommendations are advisory and always require human approval.

`review_judoka_playstyle` classifies one existing judoka through five choice questions in one JEV decision request. It accepts a canonical judoka ID or slug and up to 10 explicitly supplied HTTPS source excerpts. Budokon resolves the signature technique IDs before the model call and sends only the judoka identity, biography, signature IDs, relevant editorial ratings, resolved technique names/categories/descriptions, and supplied excerpts. JEV does not fetch the URLs. Editorial ratings are weak context, not objective match facts.

The facets are:

- **Tactical style:** `pressure`, `counter`, `balanced`, or `insufficient_evidence`.
- **Tempo:** `patient`, `balanced`, `aggressive`, or `insufficient_evidence`.
- **Grip style:** `dominant`, `adaptive`, `defensive`, `mixed`, or `insufficient_evidence`.
- **Ne-waza emphasis:** `low`, `medium`, `high`, or `insufficient_evidence`.
- **Standing preference:** the existing technique taxonomy values `ashi_waza`, `te_waza`, `koshi_waza`, `ma_sutemi_waza`, `yoko_sutemi_waza`, `mixed`, or `insufficient_evidence`.

Every facet returns the proposed value and its confidence. `policyAccepted` is populated only for a non-abstaining choice at or above `JEV_PLAYSTYLE_THRESHOLD`; it is a suggestion for editorial review, not a human approval or historical fact. `insufficient_evidence` is an expected successful result and is never stored in canonical data. A human must review evidence and explicitly add any accepted values to an optional `playstyle` object in `data/judoka/*.json`. Facets can be approved independently. The canonical schema rejects empty playstyle objects, unsupported values, and `insufficient_evidence`.

Budokon compiles approved metadata into its ordinary judoka records, and the REST API returns it only when present. Public REST reads remain deterministic and do not call JEV. Downstream games can consume the approved values as stable input and decide how to interpret them for their own rules. JEV cannot write canonical files or initiate a commit.

All tools return the resolved model and provider usage metadata. Treat answers as review signals, not facts. Review low-confidence, duplicate, unsupported-claim, and attribute-fit results manually.

## Manual GitHub evaluation

The manually dispatched [JEV Advisory Evaluation workflow](../.github/workflows/jev-advisory.yaml) runs the small semantic-search and playstyle evaluations on the default branch and writes their reports to the Actions step summary. It does not inspect or review pull requests.

To enable it, add the repository Actions secret `OPENROUTER_API_KEY` (the workflow maps it to `JEV_OPENROUTER_API_KEY`). Optionally set the Actions variable `JEV_MODEL` to select a model. Then choose Actions → JEV Advisory Evaluation → Run workflow on the default branch.

The three hand-labeled search cases live in `tests/fixtures/jev-evaluation.json`. Run the same live evaluation locally with:

```sh
JEV_OPENROUTER_API_KEY=… npm run jev:evaluate
```

The synthetic playstyle cases live in `tests/fixtures/playstyle-evaluation.json`. Run the live evaluation locally with:

```sh
JEV_OPENROUTER_API_KEY=… npm run jev:evaluate:playstyle
```

The search report includes precision, recall, model IDs, ranking scores, and provider usage. The playstyle report includes per-facet accuracy, abstention accuracy, proposed values and confidence, threshold-gated suggestions, model IDs, and provider usage. These fixtures are deliberately small and non-gating. The playstyle examples are synthetic scenarios, not judgments about real athletes; use the reports to compare models and thresholds, not as claims about real-world accuracy. Keep the model alias configurable until broader, repeated human-labeled evaluation supports pinning it. JEV provides review signals and semantic judgements; deterministic code and human editorial review remain authoritative. Do not use JEV to create or modify canonical records, select draws, calculate game outcomes, or make release decisions.

Run the offline repository suite, including fake-client JEV tests, with `npm run check`. It does not call OpenRouter.
