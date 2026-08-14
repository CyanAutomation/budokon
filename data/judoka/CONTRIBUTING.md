# Canonical judoka ownership

Files in this directory contain only shared, editorial judoka attributes. A
consumer may transform these records, but match results, card identifiers,
progression, save data, and other game-specific state belong to that consumer
and must not be added here or to the judoka schema.

## Catalogue policy

The catalogue may retain a fictional judoka when the character is useful to a
consumer and can be identified editorially. Such records must use
`personType: "fictional"` and `isHidden: true`; validation enforces the latter
so default catalogue views never mix fictional characters with real athletes.
`personType: "real"` is reserved for verifiable people. An unverified biography
or profile must be `null`, not filler presented as finished copy.

Country and weight class describe the character where the source establishes
them. For legacy fictional records whose source does not establish those facts,
the retained values are catalogue classifications and are called out in the
review ledger rather than represented as biographical facts.

When removing consumer-owned data from a canonical record, first preserve it in
the consumer's migration/import artifact, keyed by the judoka's immutable
`id`. Historical JU-DO-KON values are stored in
`../../migrations/ju-do-kon-judoka-import.json`; keep that artifact for existing
saves, but do not use it as a canonical data source.
