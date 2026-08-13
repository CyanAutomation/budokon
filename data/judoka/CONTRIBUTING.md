# Canonical judoka ownership

Files in this directory contain only shared, editorial judoka attributes. A
consumer may transform these records, but match results, card identifiers,
progression, save data, and other game-specific state belong to that consumer
and must not be added here or to the judoka schema.

When removing consumer-owned data from a canonical record, first preserve it in
the consumer's migration/import artifact, keyed by the judoka's immutable
`id`. Historical JU-DO-KON values are stored in
`../../migrations/ju-do-kon-judoka-import.json`; keep that artifact for existing
saves, but do not use it as a canonical data source.
