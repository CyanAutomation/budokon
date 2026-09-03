/**
 * Consumer-owned game-state properties that must never become canonical data.
 *
 * Import artifacts may carry these properties across consumer migrations, but
 * canonical records and generated catalogue artifacts must remain stateless.
 */
export const prohibitedGameStatePropertyNames = Object.freeze([
  'cardCode',
  'matchesWon',
  'matchesLost',
  'matchesDrawn',
  'playerOwnership',
  'experiencePoints',
  'cardInstanceId',
  'gameScore',
] as const);

const prohibitedGameStateProperties: ReadonlySet<string> = new Set(
  prohibitedGameStatePropertyNames,
);

export function isProhibitedGameStatePropertyName(property: string): boolean {
  return prohibitedGameStateProperties.has(property);
}
