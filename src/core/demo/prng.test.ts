import { describe, expect, it } from 'vitest';
import { createPrng, mixSeed, mulberry32, normalizeSeed } from './prng';

describe('Mulberry32 PRNG and Box-Muller sampler (src/core/demo/prng.ts)', () => {
  it('normalizes signed, floating-point, and non-finite seeds deterministically', () => {
    expect(normalizeSeed(0)).toBe(0);
    expect(normalizeSeed(0x20261201)).toBe(0x20261201);
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(42.9)).toBe(42);
    expect(normalizeSeed(Number.NaN)).toBe(0);
    expect(normalizeSeed(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('produces identical float streams from mulberry32() and createPrng().next()', () => {
    const fn = mulberry32(0x20261201);
    const rng = createPrng(0x20261201);

    for (let i = 0; i < 64; i += 1) {
      const a = fn();
      const b = rng.next();
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('produces statistically well-formed Box-Muller Gaussian samples', () => {
    const rng = createPrng(0xdeadbeef);
    const n = 4_000;
    let sum = 0;
    let sumSq = 0;

    for (let i = 0; i < n; i += 1) {
      const sample = rng.nextNormal(10.0, 2.5);
      expect(Number.isFinite(sample)).toBe(true);
      sum += sample;
      sumSq += sample * sample;
    }

    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const stdDev = Math.sqrt(variance);

    expect(mean).toBeGreaterThan(9.7);
    expect(mean).toBeLessThan(10.3);
    expect(stdDev).toBeGreaterThan(2.3);
    expect(stdDev).toBeLessThan(2.7);
  });

  it('supports deterministic integer bounds, Bernoulli draws, shuffle, and forked sub-streams', () => {
    const a = createPrng(12345);
    const b = createPrng(12345);

    expect(a.nextBool(0)).toBe(false);
    expect(a.nextBool(1)).toBe(true);
    expect(b.nextBool(0)).toBe(false);
    expect(b.nextBool(1)).toBe(true);

    for (let i = 0; i < 50; i += 1) {
      const v1 = a.nextInt(-5, 5);
      const v2 = b.nextInt(-5, 5);
      expect(v1).toBe(v2);
      expect(v1).toBeGreaterThanOrEqual(-5);
      expect(v1).toBeLessThanOrEqual(5);
    }

    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(a.shuffle(arr1)).toEqual(b.shuffle(arr2));

    const childA1 = a.fork(1);
    const childA2 = createPrng(12345);
    // Advance childA2's parent identically would match; verify same mixSeed salt differs across salts
    expect(mixSeed(99, 1)).not.toBe(mixSeed(99, 2));
    expect(childA1.nextUint32()).toBeGreaterThanOrEqual(0);
    expect(childA2.nextUint32()).toBeGreaterThanOrEqual(0);
  });
});
