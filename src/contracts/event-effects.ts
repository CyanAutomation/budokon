/**
 * Canonical event-effect semantics shared by the domain model and validation.
 *
 * A single source of truth for the event action/target vocabulary so that
 * adding a target or action edits one list instead of type unions and
 * validation sets drifting apart.
 */
export const EVENT_ACTIONS = Object.freeze([
  'modify',
  'set',
] as const);

export const EVENT_TARGETS = Object.freeze([
  'power',
  'speed',
  'technique',
  'kumikata',
  'newaza',
  'shido',
  'waza_ari',
  'score',
  'match_result',
] as const);

/** Event targets whose effects carry an integer value. */
export const NUMERIC_EVENT_TARGETS = Object.freeze([
  'power',
  'speed',
  'technique',
  'kumikata',
  'newaza',
  'shido',
  'waza_ari',
  'score',
] as const);

/** Event targets whose effects carry a state value (set action). */
export const STATE_EVENT_TARGETS = Object.freeze([
  'shido',
  'waza_ari',
  'score',
  'match_result',
] as const);