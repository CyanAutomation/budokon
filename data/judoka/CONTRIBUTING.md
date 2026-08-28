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

## Adding a real judoka

BU-DO-KON is a small, curated game catalogue. Add a person because they make a
recognisable or enjoyable game card, not to make the catalogue exhaustive or to
mirror an external ranking database. Work in small batches and use
`npm run coverage` before choosing the next one. It is an enforced policy gate:
the public catalogue must retain country, gender, weight-class, and rarity
coverage. Rarity is a game-distribution label, not an official assessment of
an athlete; follow the tier definitions and target ranges in the root README.

Every record needs the stable identity and gameplay-routing fields required by
the schema: UUID, slug, name, real/fictional type, country, gender, primary
weight class, visibility, and `lastUpdated`. Every record also needs complete
game enrichment:

* `stats`
* `rarity`
* `signatureMoveIds`
* `bio`
* `profileUrl`
* `sourceUrls` for every newly added real judoka (prefer an IJF athlete or results page)

These values must be complete and valid. Do not invent a signature move,
biography, or rating merely to fill a field; make a deliberate editorial choice
before publishing the record.

Before committing, confirm that the name and basic sporting association are
credible, add useful aliases where a spelling is common, and run `npm test`,
`npm run validate`, and `npm run coverage`.
