🥋 BU-DO-KON

Canonical judoka data for judo games and applications.

BU-DO-KON is a structured, version-controlled library of judoka and related judo data. It is designed to act as a shared source of truth for multiple games and applications that need to select, display, compare, or otherwise work with judoka.

Games should consume BU-DO-KON through an API or MCP interface rather than maintaining their own separate judoka datasets.

BU-DO-KON deliberately includes both factual attributes and a curated set of editorial/game-friendly attributes such as ratings, rarity, signature techniques, and biography text. These values are part of the shared BU-DO-KON representation of each judoka and can be reused consistently across different games.

⸻

🎯 Purpose

BU-DO-KON exists to:

* Maintain a clean, shared catalogue of judoka
* Avoid duplicating judoka data between individual games
* Provide consistent attributes that games can reuse
* Support random and filtered selection of judoka
* Keep dataset changes version-controlled and reviewable
* Allow deterministic dataset releases
* Separate shared judo content from individual game logic
* Support both conventional APIs and AI-oriented MCP integrations

Think of BU-DO-KON as the shared judoka library that sits underneath multiple games.

⸻

🧱 Architecture

flowchart TD
    A[BU-DO-KON Repository<br/>Canonical Data] --> B[Validation & Build]
    B --> C[BU-DO-KON Service]
    C --> D[REST API]
    C --> E[MCP Server]
    D --> F[JU-DO-KON]
    D --> G[Future Judo Game]
    D --> H[Quiz / Card / Simulation Game]
    E --> I[AI Agents]
    E --> J[Conversational Applications]

The architecture is based on three layers:

Canonical data

The Git repository is the editorial source of truth.

Judoka, techniques, countries, and weight categories are maintained as structured data and reviewed through normal Git workflows.

BU-DO-KON service

A lightweight service provides runtime access to the catalogue.

The service may use a generated JSON dataset, SQLite database, or another derived read model internally, but these are not the canonical source of truth.

Consumers

Games and other applications consume BU-DO-KON rather than maintaining duplicate judoka records themselves.

Individual games remain responsible for their own:

* rules
* scoring systems
* match state
* progression
* player data
* game-specific mechanics

⸻

📂 Proposed Repository Structure

.
├── data/
│   ├── judoka/
│   │   ├── shozo-fujii.json
│   │   ├── ilia-sulamanidze.json
│   │   └── ...
│   │
│   ├── techniques/
│   │   ├── uchi-mata.json
│   │   ├── seoi-nage.json
│   │   └── ...
│   │
│   └── reference/
│       ├── countries.json
│       └── weight-categories.json
│
├── schema/
│   ├── judoka.schema.json
│   ├── technique.schema.json
│   ├── countries.schema.json
│   └── weight-categories.schema.json
│
├── src/
│   ├── domain/
│   ├── repository/
│   ├── draw/
│   ├── api/
│   └── mcp/
│
├── tests/
│
├── README.md
└── LICENSE

Generated distribution files may also be produced during releases:

dist/
├── judoka.json
├── techniques.json
└── budukon.sqlite

These generated files are runtime artefacts rather than the primary editorial source.

### Editing and building the data

The individual JSON records under `data/judoka/` and `data/techniques/`, together
with the files under `data/reference/`, are the canonical editorial sources. Do
not edit generated files in `dist/` directly.

After changing source data, rebuild the runtime aggregates with:

```sh
npm run build
```

Run `npm run validate` before building. The validator parses every canonical
JSON source and applies the four schemas before checking cross-record identity,
references, gender-specific weight classes, and timestamps. Timestamps must be
valid RFC 3339 UTC instants and must not be in the future.

### Canonical content policy

Canonical records must be publishable content, not scaffolding. Required text
must be non-empty (biographies have a 20-character minimum), and values that
begin with common placeholder markers (`TODO`, `TBD`, `unknown`, `N/A`, `none`,
or `more info to come`) are rejected case-insensitively. URLs must be absolute
HTTPS URLs; stats are integer ratings from 0 through 10. Unknown properties are
rejected so misspellings and application-specific fields cannot silently enter
the editorial source. Fictional judoka may be retained when they represent an
identifiable judo character and contain complete, intentional content. They
have `personType: "fictional"` and must set `isHidden: true`; consumers should
exclude hidden records unless explicitly requested. Unverifiable people and
invented filler identities do not belong in the canonical catalogue. Real
people use `personType: "real"` and have an independent visibility decision.

The build reads every source record, validates judoka UUIDs, slugs, aliases,
country references, and their uniqueness, sorts each aggregate by its stable `id`, and writes
deterministic `dist/judoka.json` and `dist/techniques.json` artifacts. The
canonical `data/dataset.json` calendar version is independent of the service
package version. Each build also writes `dist/manifest.json` with both versions,
the source commit, record counts, and SHA-256 artifact checksums. Builds contain
no wall-clock timestamp; release tags use `dataset-v<datasetVersion>`.
one-time `migrations/judoka-legacy-id-map.json` file maps IDs from the legacy
aggregate to immutable UUIDs. `migrations/technique-legacy-id-map.json` likewise
maps legacy numeric technique IDs to stable slugs. Both files must be retained
for downstream migrations.

⸻

🧑‍🤝‍🧑 Judoka Data Model

Each judoka contains a curated representation intended to be useful across multiple games.

Example:

{
  "id": "57a86958-73c3-4dd3-b8b8-f0bbaab58b67",
  "slug": "shozo-fujii",
  "firstname": "Shōzō",
  "surname": "Fujii",
  "countryCode": "JP",
  "weightClass": "-81",
  "category": "Judo",
  "gender": "male",
  "stats": {
    "power": 8,
    "speed": 8,
    "technique": 8,
    "kumikata": 7,
    "newaza": 8
  },
  "signatureMoveId": "seoi-nage",
  "rarity": "Epic",
  "bio": "Biography text...",
  "profileUrl": "https://example.com",
  "isHidden": false,
  "lastUpdated": "2026-08-13T00:00:00Z"
}

⸻

🎮 Shared Editorial Attributes

BU-DO-KON intentionally contains some attributes that are not purely objective biographical facts.

Examples include:

* stats.power
* stats.speed
* stats.technique
* stats.kumikata
* stats.newaza
* rarity
* signatureMoveId
* biography text

These are editorial values maintained as part of the BU-DO-KON dataset.

The purpose of storing them centrally is to avoid every consuming game maintaining its own interpretation of the same judoka.

Individual games remain free to:

* ignore attributes they do not need
* transform shared attributes
* derive new values
* apply their own scoring formulas
* introduce additional game-specific state

BU-DO-KON therefore defines a useful shared baseline rather than attempting to model every possible game mechanic.

⸻

🆔 Identity

Judoka use immutable UUID identifiers. Legacy numeric identifiers are retained
only in `migrations/judoka-legacy-id-map.json` for consumer migrations.

Recommended structure:

{
  "id": "38690882-06a3-4d98-9b06-2789da1015db",
  "slug": "ilia-sulamanidze"
}

id

An immutable UUID assigned in the canonical source record. UUIDs are stored
explicitly and must not be derived dynamically during builds.

It should never change once assigned.

slug

A human-readable identifier suitable for URLs and developer-facing APIs.

For example:

/v1/judoka/ilia-sulamanidze

If a name correction requires a slug change, the UUID remains unchanged
and the previous slug may optionally be retained as an alias.

⸻

🌍 Countries

Judoka should reference countries using ISO 3166-1 alpha-2 codes.

For example:

{
  "countryCode": "JP"
}

Country names and other descriptive information are maintained separately in the reference dataset.

{
  "JP": {
    "country": "Japan",
    "code": "JP",
    "active": true
  }
}

This prevents duplicate country names from becoming independent sources of truth.

The catalogue is the subset of ISO 3166-1 alpha-2 countries supported by
BU-DO-KON; it is not required to contain the complete ISO set and may contain
countries not currently referenced by a judoka. Keys and embedded `code` values
must be identical uppercase alpha-2 codes.

Inactive entries may be retained for historical compatibility and display, but
canonical judoka must reference a country that exists and is active. Generated
judoka views resolve `country` display names from this catalogue, so canonical
judoka records must not duplicate the `country` property.

⸻

⚖️ Weight Classes

BU-DO-KON uses the current senior IJF weight categories.

Men

* -60
* -66
* -73
* -81
* -90
* -100
* +100

Women

* -48
* -52
* -57
* -63
* -70
* -78
* +78

Each judoka is assigned one primary weight class.

Where a judoka has competed in multiple divisions, BU-DO-KON uses an editorial judgement to select the division most strongly associated with that judoka.

Historical weight-class modelling is deliberately outside the current scope.

⸻

🥋 Techniques

Techniques are maintained independently from judoka so they can be reused throughout the dataset.

Example:

{
  "id": "uchi-mata",
  "name": "Uchi-mata",
  "japanese": "内股",
  "style": "Judo",
  "category": "Nage-waza",
  "subCategory": "Ashi-waza",
  "description": "Inner-thigh throw."
}

Judoka reference techniques by identifier:

{
  "signatureMoveId": "uchi-mata"
}

Technique identifiers are stable kebab-case slugs. `signatureMoveId` must equal
the string `id` of a record under `data/techniques/`. Technique names are
display values and must not be used as foreign keys. Legacy numeric identifiers
are retained only in `migrations/technique-legacy-id-map.json`; a `null` mapping
means the legacy record was not a recognized technique and has no direct
equivalent.

Technique terminology and classification should normally follow recognised Kodokan or IJF conventions.

⸻

✍️ Editorial Philosophy

BU-DO-KON is a curated passion project rather than an academic or encyclopaedic database.

Some values are therefore intentionally editorial.

This includes decisions such as:

* which weight class best represents a judoka
* which technique is regarded as their signature technique
* relative ratings
* rarity
* biography wording
* which athletes should be included
* whether an athlete is hidden or available to consumers

Not every individual field requires formal provenance.

Where practical, profile URLs may provide useful external references, but BU-DO-KON does not require source citations for every editorial judgement.

The objective is a consistent, interesting and useful dataset rather than exhaustive historical documentation.

⸻

🎲 Drawing Judoka

A primary BU-DO-KON capability is selecting one or more judoka from the catalogue.

The draw operation should support:

* random selection
* filtering
* exclusions
* multiple draws
* deterministic seeded draws

Example:

POST /v1/draw
{
  "count": 1,
  "filters": {
    "countryCode": ["JP", "GE"],
    "gender": "male",
    "weightClass": ["-81", "-90"]
  },
  "exclude": [],
  "seed": "match-472-round-3"
}

Example response:

{
  "datasetVersion": "2026.08.1",
  "seed": "match-472-round-3",
  "poolSize": 37,
  "judoka": [
    {
      "id": "9cc78bb7-...",
      "slug": "example-judoka",
      "firstname": "Example",
      "surname": "Judoka"
    }
  ]
}

⸻

🎯 Deterministic Randomness

Draw operations may optionally accept a seed.

Given:

* the same dataset version
* the same filters
* the same exclusions
* the same seed

BU-DO-KON should return the same result.

This enables games to:

* replay rounds
* synchronise multiplayer clients
* reproduce bugs
* audit selections
* regenerate historical game state

Applications that do not require deterministic behaviour may omit the seed.

⸻

🌐 REST API

The REST API is the primary integration mechanism for conventional games and applications.

Potential endpoints include:

GET  /v1/judoka
GET  /v1/judoka/:id
GET  /v1/techniques
GET  /v1/techniques/:id
GET  /v1/countries
GET  /v1/weight-categories
POST /v1/draw
GET  /v1/version

Judoka queries

Consumers should eventually be able to filter by attributes such as:

GET /v1/judoka?countryCode=JP
GET /v1/judoka?gender=female
GET /v1/judoka?weightClass=-81
GET /v1/judoka?rarity=Legendary

Filters may be combined where appropriate.

⸻

🤖 MCP

BU-DO-KON may expose the same core capabilities through MCP for use by AI agents and conversational applications.

Potential MCP tools include:

get_judoka
search_judoka
draw_judoka
list_techniques
get_technique

Example:

{
  "count": 2,
  "countryCode": "JP",
  "weightClass": "-81",
  "exclude": ["shozo-fujii"]
}

MCP and REST must use the same underlying domain services.

Business logic should not be duplicated between the two interfaces.

flowchart LR
    A[REST API] --> C[Application Services]
    B[MCP] --> C
    C --> D[Budukon Repository]

⸻

💾 Storage Strategy

The Git repository is the canonical source of truth.

This provides:

* human-readable data
* clear pull-request review
* full change history
* easy rollback
* deterministic versions
* straightforward backups
* reproducible builds

A runtime service does not need to read individual source files for every request.

During the build process the canonical data may be compiled into:

* aggregate JSON
* SQLite
* another optimised read representation

For the expected size and read-heavy workload of BU-DO-KON, SQLite is a suitable runtime option if indexed querying becomes useful.

PostgreSQL or another external database should only be introduced if runtime requirements justify the additional complexity.

⸻

✅ Validation

All data changes should pass automated validation before being merged.

Validation should include several layers.

JSON validation

Every file must contain valid JSON.

Schema validation

Records must conform to their relevant JSON Schema.

Examples:

schema/judoka.schema.json
schema/technique.schema.json
schema/countries.schema.json

Referential validation

References between datasets must exist.

For example:

judoka.signatureMoveId
        ↓
techniques.id

A judoka must not reference a technique that does not exist.

Semantic validation

Additional rules should verify domain consistency.

Examples:

* IDs must be unique
* slugs must be unique
* stat values must remain within their defined range
* rarity must use an allowed value
* country codes must exist
* weight classes must be valid for the specified gender
* referenced techniques must exist

⸻

📦 Dataset Releases

BU-DO-KON distinguishes between service versions and dataset versions.

Service version

Describes behaviour of the API, MCP server, or application code.

Example:

v1.4.0

Dataset version

Describes a particular release of the judoka catalogue.

Example:

2026.08.1

API responses may expose both:

{
  "budukonVersion": "1.4.0",
  "datasetVersion": "2026.08.1"
}

This allows games to pin or record the dataset used for a particular match, tournament, season, or save game.

Dataset releases should be associated with the corresponding Git commit.

⸻

🔄 Build and Release Flow

flowchart LR
    A[Edit Data] --> B[Pull Request]
    B --> C[JSON Validation]
    C --> D[Schema Validation]
    D --> E[Referential Validation]
    E --> F[Semantic Validation]
    F --> G[Merge]
    G --> H[Dataset Release]
    H --> I[Generate Runtime Data]
    I --> J[BU-DO-KON Service]

A failed validation should prevent the dataset from being released.

⸻

🛡️ Design Principles

BU-DO-KON follows these principles:

One shared judoka catalogue

Games should not need to maintain duplicate judoka records.

Git is the editorial authority

The repository remains the canonical representation of the dataset.

Runtime storage is derived

Databases and aggregate files are implementation details and can be rebuilt from the canonical repository.

Shared attributes belong in BU-DO-KON

Useful attributes such as ratings, rarity and signature techniques can be centrally curated and reused between games.

Game state belongs in games

Match progress, player ownership, scores, progression and other runtime state remain outside BU-DO-KON.

Editorial judgement is allowed

BU-DO-KON is intended to be useful and enjoyable rather than attempting to become a complete historical judo database.

Interfaces share business logic

REST and MCP expose the same underlying capabilities rather than implementing separate selection behaviour.

Releases are reproducible

A dataset version and seed should be sufficient to reproduce deterministic selections.

⸻

🚀 Potential Future Capabilities

Future development may include:

* richer judoka search
* multiple signature or notable techniques
* historical and retired judoka
* Olympic and World Championship metadata
* competition achievements
* aliases and alternative name spellings
* image metadata
* curated collections
* eras or generations
* expansion sets
* weighted draw modes
* tournament-specific pools
* dataset snapshots
* public API hosting
* MCP integration
* automated dataset quality checks

These should be introduced without compromising BU-DO-KON’s role as a simple, reusable shared judoka catalogue.

⸻

🥋 Guiding Principle

BU-DO-KON maintains the shared representation of a judoka. Games decide what to do with them.

The goal is to make adding a judoka once sufficient for that judoka to become available to every compatible game and application.
