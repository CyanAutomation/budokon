---
name: canonical-data-curation
description: Use when adding or editing canonical judoka, judo events, techniques, countries, weight categories, or dataset metadata. Covers sourcing, editorial policy, schemas, validation, and generated artifacts.
---

# Canonical data curation

Canonical JSON under data is the source of truth. Read the relevant schema and
existing records before editing. Do not edit compiled files under dist directly.

## Editorial and evidence rules

- Keep canonical catalogue content separate from consumer-owned state such as
  match results, card IDs, progression, and saves.
- Distinguish factual identity and sporting details from game-facing choices
  such as stats, rarity, biography copy, and signature techniques.
- For each newly added real judoka, include sourceUrls and prefer an IJF athlete
  or results page. A URL alone does not support a specific claim; use the
  source material available and do not invent details to fill required fields.
- Use deliberate gameplay classifications for fictional characters. Do not
  present fictional or unverifiable identities as real people.
- Preserve immutable IDs and aliases when correcting a record. If removing
  consumer-owned fields, preserve migration data by immutable ID and do not
  copy it back into canonical records.
- Keep text meaningful and specific. Do not use placeholder values.

## Editing and validation

1. Read the applicable guide, schema, and related records:
   - [Judoka contribution guide](../../../data/judoka/CONTRIBUTING.md)
   - [Dataset and record schemas](../../../schema)
   - [Coverage and rarity policy](../../../README.md#editorial-coverage-and-rarity-policy)
2. Make the smallest canonical JSON change. Keep IDs, slugs, taxonomy values,
   and cross-record references consistent.
3. Run **npm test**, **npm run validate**, and **npm run coverage** for data
   changes. Do not claim validation from schema inspection alone.
4. Regenerate artifacts only when the task requires them, using the repository
   build workflow. Never hand-edit dist output.

For new real judoka, also confirm the name and basic sporting association,
add useful spelling aliases when supported, and review the catalogue coverage
impact before selecting more records.
