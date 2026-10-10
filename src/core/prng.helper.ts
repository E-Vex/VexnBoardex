/**
 * Seeded PRNG for property tests (T-006 R9).
 *
 * Deterministic mulberry32 — no dependencies, no DOM. Lives inside `src/core/`
 * so both unit and property tests can import it. Only used by test files;
 * the determinism lint rule (D-23) excludes `*.test.ts` and `*.helper.ts`.
 */

/** A deterministic PRNG function returning [0, 1). */
export type Rng = () => number;

/** Create a seeded mulberry32 PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [min, max] inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick a random element from a non-empty array. */
export function randPick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Pick a random non-empty subset (as indices) of `arr`. */
export function randSubset<T>(rng: Rng, arr: T[]): T[] {
  const indices = arr.map((_, i) => i);
  // Shuffle (Fisher-Yates).
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  const count = 1 + Math.floor(rng() * indices.length);
  return indices.slice(0, count).map((i) => arr[i]!);
}
