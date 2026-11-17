/**
 * Seeded deterministic 32-bit Mulberry32 PRNG and Box-Muller Gaussian sampler
 * (`src/core/demo/prng.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 3.1, 17.7
 */

const UINT32_SCALE = 4_294_967_296; // 2^32
const MIN_BOX_MULLER_U = 1e-12;
const TWO_PI = 2.0 * Math.PI;

export interface SeededPrng {
  /** Normalized 32-bit unsigned initial seed (`seed >>> 0`). */
  readonly initialSeed: number;
  /** Next deterministic unsigned 32-bit integer in `[0, 0xffffffff]`. */
  nextUint32(): number;
  /** Next deterministic uniform float in `[0, 1)`. */
  next(): number;
  /** Next deterministic uniform float in `[min, max)`. */
  nextRange(min: number, max: number): number;
  /** Next deterministic uniform integer in `[min, max]` (inclusive). */
  nextInt(min: number, max: number): number;
  /** Deterministic Bernoulli draw returning `true` with probability `probability`. */
  nextBool(probability: number): boolean;
  /** Deterministic Gaussian sample (`mean`, `stdDev`) via Box-Muller transform. */
  nextNormal(mean?: number, stdDev?: number): number;
  /** Deterministically shuffles `items` in place (Fisher-Yates) and returns it. */
  shuffle<T>(items: T[]): T[];
  /** Forks an independent deterministic child `SeededPrng` mixed with `salt`. */
  fork(salt?: number): SeededPrng;
}

/**
 * Coerces any numeric seed to a canonical unsigned 32-bit integer (`0` on non-finite).
 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 0;
  }
  return Math.trunc(seed) >>> 0;
}

/**
 * Avalanches a 32-bit `seed` and integer `salt` via a MurmurHash3 `fmix32` finalizer
 * so adjacent seeds (`0`, `1`, `2`, ...) produce uncorrelated sub-streams.
 */
export function mixSeed(seed: number, salt = 0): number {
  let h = (normalizeSeed(seed) ^ Math.imul((normalizeSeed(salt) + 1) | 0, 0x9e3779b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Canonical Mulberry32 32-bit PRNG returning uniform floats in `[0, 1)`.
 */
export function mulberry32(seed: number): () => number {
  let state = normalizeSeed(seed);
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_SCALE;
  };
}

/**
 * Creates a stateful, deterministic `SeededPrng` backed by Mulberry32 and a paired
 * Box-Muller normal sampler.
 */
export function createPrng(seed: number): SeededPrng {
  const initialSeed = normalizeSeed(seed);
  let state = initialSeed;
  let hasSpareNormal = false;
  let spareNormal = 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  const next = (): number => nextUint32() / UINT32_SCALE;

  const nextRange = (min: number, max: number): number => min + (max - min) * next();

  const nextInt = (min: number, max: number): number => {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    const span = hi - lo + 1;
    if (span <= 1) {
      return lo;
    }
    return lo + Math.floor(next() * span);
  };

  const nextBool = (probability: number): boolean => {
    if (probability <= 0) {
      return false;
    }
    if (probability >= 1) {
      return true;
    }
    return next() < probability;
  };

  const nextStandardNormal = (): number => {
    if (hasSpareNormal) {
      hasSpareNormal = false;
      return spareNormal;
    }

    let u1 = next();
    while (u1 <= MIN_BOX_MULLER_U) {
      u1 = next();
    }
    const u2 = next();
    const radius = Math.sqrt(-2.0 * Math.log(u1));
    const theta = TWO_PI * u2;
    spareNormal = radius * Math.sin(theta);
    hasSpareNormal = true;
    return radius * Math.cos(theta);
  };

  const nextNormal = (mean = 0, stdDev = 1): number =>
    mean + stdDev * nextStandardNormal();

  const shuffle = <T>(items: T[]): T[] => {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  };

  const fork = (salt = 0): SeededPrng => createPrng(mixSeed(nextUint32(), salt));

  return {
    initialSeed,
    nextUint32,
    next,
    nextRange,
    nextInt,
    nextBool,
    nextNormal,
    shuffle,
    fork,
  };
}
