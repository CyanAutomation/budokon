# Migration notes

## JU-DO-KON judoka import contract

`ju-do-kon-judoka-import.json` preserves consumer-owned game state removed from
canonical judoka. A JU-DO-KON migration consumer looks up an entry by the
canonical judoka's immutable `id` and carries its `cardCode`, `matchesWon`,
`matchesLost`, and `matchesDrawn` values into the converted consumer record
unchanged. The import is a compatibility artifact for existing saves, not a
canonical data source.

## Judoka signature techniques and names (2026-08-21)

The scalar `signatureMoveId` field was replaced by the required, non-empty
`signatureMoveIds` array. Consumers should migrate an existing value `value` to
`signatureMoveIds: [value]`. Filters in the catalogue, REST query translation,
draw requests, and MCP `filters` now use the `signatureMoveIds` key. When a
filter contains multiple technique IDs, a record matches if it contains any of
them.

`aliases` now contains only unique, non-blank, human-readable alternative names.
Do not store URL handles there. Retired canonical handles used by existing links
are stored in `legacySlugs`, which uses the same strict kebab-case validation as
`slug` and remains supported by lookup and search. Immutable UUIDs remain the
preferred persisted identifier. The legacy numeric ID maps are unchanged.
