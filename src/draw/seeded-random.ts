/**
 * Seeded random number generator using FNV-1a hash (32-bit) + Mulberry32 PRNG.
 * Provides deterministic pseudo-random values for reproducible draws.
 *
 * @param seed - The seed string to generate consistent random values
 * @returns A function that returns values in [0, 1)
 */
export function createSeededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.codePointAt(0)!;
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
