# Duplication Survey (DRY review)

Survey ran across `src/`, `scripts/`, `worker/`, and `tests/`. Duplication is
ranked by maintenance cost: how many spots must change together when the
underlying knowledge changes, and how silently the copies can diverge.

## Ranked candidates

1. **Event effect semantics (consolidated)** — `EventAction`/`EventTarget`
   string unions in `src/domain/types.ts` describe the same knowledge as the
   `numericEventTargets`/`stateEventTargets` Sets in
   `src/validation/canonical-rules.ts`. Adding a target required editing three
   spots, and the type unions and runtime Sets could diverge without a
   compiler error. Consolidated into `src/contracts/event-effects.ts`, which
   follows the repo's established contracts pattern (already consumed by both
   validation and domain layers via `game-state.ts`/`text-normalization.ts`).
   Highest drift cost, clearest maintenance benefit, no behavioral change:
   every string literal moved byte-for-byte.

2. **`FilterField` union vs `FILTER_FIELDS` Set** (`src/domain/types.ts` vs
   `src/domain/catalog-filters.ts`) — same knowledge, but single-module
   locality and a purely type-level drift (the compiler protects the union).
   Rejected: lower value, higher coupling to a filter-tagging implementation.

3. **Hidden-visibility rule** (`includeHidden && authorizedInternal` in
   `filter-service.ts`, `catalog-service.ts`, coverage paths) — three small
   call sites of one boolean expression. Rejected: the rule is a single
   predicate; extraction adds indirection without reducing drift.

4. **Seeded-random seed construction** (`draw-service.ts` vs
   `event-draw-service.ts`) — similar-looking but procedurally distinct
   algorithms. Rejected: separate knowledge that must evolve independently.

5. **Rarity labels in JEV prompt criteria** (`query-interpreter-facets.ts`)
   — rarity is treated as opaque strings elsewhere (`coverage.ts` counts
   them; no shared enum exists). Rejected: prompt wording, not domain
   knowledge.

## Decision

Candidate 1 applied; candidates 2–5 intentionally left untouched.