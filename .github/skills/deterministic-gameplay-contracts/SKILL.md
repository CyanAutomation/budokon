---
name: deterministic-gameplay-contracts
description: Use when changing seeded judoka or event draws, the draw algorithm, event effects, or gameplay rules that affect replayable results.
---

# Deterministic draws and gameplay contracts

Treat draw output and event-effect vocabulary as consumer contracts. Read the
relevant domain code, canonical schema, existing records, and tests before
changing behavior.

## Contract invariants

- `src/draw/algorithm-contract.json` declares supported draw algorithm IDs;
  `src/draw/algorithm.ts` exposes them. Never silently change the behavior
  behind an existing ID. Introduce and document a new ID for an intentional
  algorithm change, and preserve old behavior when consumers need old replays.
- A seeded draw must remain deterministic for the same seed, dataset, filters,
  exclusions, count, and algorithm. Keep the PRNG and selection order stable
  unless a versioned algorithm change is intended.
- Keep seed, dataset version, and algorithm identity in draw results. Do not
  add hidden records to public draws or alter filtering semantics without
  updating the API/MCP contract and authorization tests.
- Canonical events describe bounded data and typed effects; consumers own
  match state and apply those effects. Keep event actions and targets aligned
  with `src/contracts/event-effects.ts` and `schema/event.schema.json`.
- Do not use JEV or other model output to select draws, determine game results,
  or override deterministic rules.

## Change workflow

1. Read [the draw algorithm contract](../../../src/draw/algorithm-contract.json),
   the relevant draw and event services, schemas, and representative records.
2. Add or update regression tests before changing behavior. For algorithm
   changes, update the golden vectors and tests in
   `tests/draw-v1-golden.test.ts`; for event semantics, cover valid and invalid
   effects in the event validation and service tests.
3. Update OpenAPI/MCP output contracts and docs if the public response or
   parameters change. See [REST and MCP contracts](../api-mcp-contracts/SKILL.md).
4. Run **npm test** and **npm run validate**. Run **npm run check** for wider
   changes. Do not claim a replay-compatible change based only on type checks.
