# BU-DO-KON

Canonical, version-controlled judo data for game and application developers,
with a public REST API and an MCP interface.

[![Deploy Cloudflare Worker](https://github.com/CyanAutomation/budokon/actions/workflows/deploy-cloudflare.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/budokon/actions/workflows/deploy-cloudflare.yml)
[![Validate](https://github.com/CyanAutomation/budokon/actions/workflows/validate.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/budokon/actions/workflows/validate.yml)

BU-DO-KON is a curated catalogue, not an exhaustive athlete database. It gives
compatible games a shared representation of judoka, techniques, and gameplay
events. Factual profile details are kept distinct from editorial attributes
such as ratings, rarity, and signature techniques. Contributors can help
maintain the catalogue through data updates and code changes reviewed by pull
request.

## Contents

- [Use the public API](#use-the-public-api)
- [What is available](#what-is-available)
- [How the repository is organized](#how-the-repository-is-organized)
- [Develop locally](#develop-locally)
- [Contribute data](#contribute-data)
- [Editorial coverage and rarity policy](#editorial-coverage-and-rarity-policy)
- [Deploy and operate](#deploy-and-operate)
- [Documentation and support](#documentation-and-support)

## Use the public API

The deployed public REST API is read-only and requires no credential. Search is
diacritic-insensitive and accepts structured filters.

```js
const baseUrl = "https://budokon.scheimann.workers.dev";

const response = await fetch(`${baseUrl}/v1/judoka?q=shozo&countryCode=JP`);
if (!response.ok) throw new Error(`BU-DO-KON returned ${response.status}`);

const judoka = await response.json();
console.log(judoka[0]?.slug); // "shozo-fujii"
```

To make a reproducible draw, send a seed and retain the returned dataset and
algorithm versions:

```js
const response = await fetch(`${baseUrl}/v1/draw`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    count: 1,
    seed: "round-42",
    filters: { personType: "real" },
  }),
});
if (!response.ok) throw new Error(`BU-DO-KON returned ${response.status}`);

const draw = await response.json();
```

A successful draw response includes the dataset and algorithm versions needed
to reproduce it. The `judoka` entries contain full catalogue records; shown
here with each record abbreviated to its slug:

```json
{
  "datasetVersion": "2026.08.7",
  "algorithm": "budokon-v1",
  "seed": "round-42",
  "poolSize": 72,
  "judoka": [{ "slug": "francisco-garrigos" }]
}
```

These values came from a local run against dataset `2026.08.7`; other deployed
versions may return different counts or judoka. See the `JudokaDraw` schema in
the [OpenAPI contract](openapi/v1.yaml) for the complete response shape.

Use `limit` to enable cursor pagination. Send the returned `nextCursor` with
the same filters and limit to fetch the next page. For example:

```js
const firstPageUrl = new URL(`${baseUrl}/v1/judoka`);
firstPageUrl.searchParams.set("limit", "20");

const firstPageResponse = await fetch(firstPageUrl);
if (!firstPageResponse.ok) throw new Error(`BU-DO-KON returned ${firstPageResponse.status}`);
const firstPage = await firstPageResponse.json();

if (firstPage.nextCursor) {
  firstPageUrl.searchParams.set("cursor", firstPage.nextCursor);
  const nextPageResponse = await fetch(firstPageUrl);
  if (!nextPageResponse.ok) throw new Error(`BU-DO-KON returned ${nextPageResponse.status}`);
  const nextPage = await nextPageResponse.json();
}
```

Keep any filters and the same `limit` on the URL when requesting later pages.
On `429`, wait for `Retry-After` before retrying. See the [API guide](docs/API.md)
for response shapes, filters, cache behavior, compatibility, and MCP usage; the
full REST contract is [OpenAPI 3.1](openapi/v1.yaml).

## What is available

- Judoka search, lookup, filters, and cursor-paginated lists.
- Seeded, reproducible judoka and gameplay-event draws.
- Technique, event, country, weight-category, version, status, and
  public-coverage endpoints.
- A read-only MCP interface for AI agents and conversational applications.
- Versioned canonical JSON records, validation schemas, and deterministic
  compiled dataset releases.

The public catalogue needs no key. MCP and access to hidden records use
separate credentials and controls; never place a server credential in browser
code. See [internal API access](docs/INTERNAL-API.md) before configuring
protected access.

## How the repository is organized

Canonical JSON under `data/` is the editorial source of truth. JSON Schemas
and validation rules check the records before deterministic build scripts
compile runtime artefacts under `dist/`. TypeScript domain and repository code
is shared by the REST and MCP adapters; the Cloudflare Worker provides the
deployed service.

```text
data/       Canonical judoka, techniques, events, and reference data
schema/     JSON Schemas for canonical records
src/domain/ Shared catalogue and draw behavior
src/api/    REST handlers and request validation
src/mcp/    MCP tools and transport integration
worker/     Cloudflare Worker routes, auth, cache, and rate limits
dist/       Compiled dataset and release manifest
docs/       API, operations, security, and deployment references
```

The package exposes TypeScript core and data exports for local consumers, but
`package.json` marks it private; the supported public integrations are REST
and MCP. Games own their match state, scoring, progression, and player-specific
data. BU-DO-KON owns reusable catalogue content.

## Develop locally

Prerequisites: Node.js `^24.10.0` and npm. From the repository root:

```sh
npm ci
npm run dev
```

The local Worker listens on `http://127.0.0.1:8787`. In another terminal,
verify it with:

```sh
curl 'http://127.0.0.1:8787/v1/judoka?q=shozo&countryCode=JP'
```

The response is a JSON array whose first result has slug `shozo-fujii`. Stop
the local Worker with Ctrl-C. The public REST routes use the checked-in local
Wrangler configuration; protected MCP or hidden-record workflows require
separate local credentials and are not needed for this example.

Useful checks:

```sh
npm test
npm run validate
npm run check:docs
npm run check
```

`npm test` builds runtime code and runs unit/integration tests.
`npm run validate` checks canonical data and repository policies.
`npm run check:docs` checks local Markdown links and lints this README.
`npm run check` runs documentation checks, runtime and tooling type checks, the
TypeScript-only boundary check, tests, and canonical-data validation.
These commands are defined in `package.json`. The docs check validates local
links in this README and the user-facing project docs; it does not request
external URLs.

## Contribute data

Add or update canonical records under `data/`; do not edit generated files in
`dist/` directly. Records are curated for games and applications and are not
intended to mirror an official ranking database. The [judoka contribution
guide](data/judoka/CONTRIBUTING.md) describes record requirements, sourcing,
and coverage checks. Relevant schemas are in `schema/`; `npm run validate`
checks canonical data and repository rules.

For code or data issues, use [GitHub Issues][issues]. Changes are reviewed
through pull requests and the validation workflow. For code changes, run the
checks listed under [Develop locally](#develop-locally) before opening a pull
request. For judoka data changes, follow the [contribution guide](data/judoka/CONTRIBUTING.md).

## Editorial coverage and rarity policy

Rarity is an editorial game-draw attribute, not a statement of an athlete's
worth or an official IJF classification. These target shares apply to public,
visible real judoka; each range is an independent guardrail rather than a fixed
mix.

| Rarity | Target share | Editorial meaning |
| --- | ---: | --- |
| Common | 25–45% | Reliable breadth for ordinary draws. |
| Rare | 20–40% | Specialists and established international competitors. |
| Epic | 15–30% | Major champions and consistently elite judoka. |
| Legendary | 5–20% | Athletes with exceptional, era-defining records. |

The public real-judoka pool must contain at least 20 judoka across at least 10
countries. No country may represent more than 35% of the pool, and no gender may
represent more than 60%. Every listed weight category must be represented by at
least one public real judoka. Run `npm run coverage` to see the current counts
and whether the catalogue satisfies these guardrails.

## Deploy and operate

The production Cloudflare Worker deploys from the protected `main` branch
through the [deployment workflow](.github/workflows/deploy-cloudflare.yml). See
[deployment setup](docs/DEPLOYMENT.md) for required GitHub environment values
and Worker secrets. Do not run a production deployment as part of local
development.

Operational monitoring, release identity, rate limits, cache behavior, and
release procedures are described in [operations](docs/OPERATIONS.md). Optional
internal JEV assistance and its constraints are documented in [JEV
assistance](docs/JEV.md).

## Documentation and support

- [REST and MCP API guide](docs/API.md)
- [OpenAPI contract](openapi/v1.yaml)
- [Internal API credentials and OAuth](docs/INTERNAL-API.md)
- [Deployment setup](docs/DEPLOYMENT.md)
- [Operations and releases](docs/OPERATIONS.md)
- [Judoka contribution guide](data/judoka/CONTRIBUTING.md)
- [License](LICENSE) — GPL-3.0-or-later
- [Report a bug or request a change][issues]

[issues]: https://github.com/CyanAutomation/budokon/issues
