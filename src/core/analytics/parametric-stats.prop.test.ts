import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParametricTestColumn } from '../model/types';
import {
  computeParametricCapability,
  computeParametricCapabilityFromValues,
  computeParametricHistogram,
} from './parametric-stats';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);

/**
 * Generates a finite measurement vector of length `n >= 2` with strictly positive sample
 * standard deviation (`sigma > 0`), paired with valid two-sided specification limits `lo < hi`.
 */
const arbNonDegenerateVectorAndLimits = fc
  .tuple(
    fc.array(fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }), {
      minLength: 2,
      maxLength: 80,
    }),
    fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0.05, max: 500, noNaN: true, noDefaultInfinity: true }),
  )
  .filter(([xs]) => {
    let min = xs[0]!;
    let max = xs[0]!;
    for (let i = 1; i < xs.length; i += 1) {
      if (xs[i]! < min) min = xs[i]!;
      if (xs[i]! > max) max = xs[i]!;
    }
    return max - min >= 0.05;
  })
  .map(([values, lo, span]) => ({
    values,
    lo,
    hi: lo + span,
  }));

const arbPositiveAffine = fc.record({
  a: fc.double({ min: 0.05, max: 500, noNaN: true, noDefaultInfinity: true }),
  b: fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
});

describe('Property 7: Parametric capability (Cp / Cpk) invariants and affine scale equivariance', () => {
  it('satisfies Cp > 0, Cpk <= Cp, and |Cpk - Cp| < 1e-9 when centered at (LO + HI) / 2', () => {
    fc.assert(
      fc.property(arbNonDegenerateVectorAndLimits, ({ values, lo, hi }) => {
        const res = computeParametricCapabilityFromValues(values, lo, hi);
        expect(res.n).toBe(values.length);
        expect(res.sigma).not.toBeNull();
        expect(res.sigma!).toBeGreaterThan(0);
        expect(res.cp).not.toBeNull();
        expect(res.cpk).not.toBeNull();
        expect(res.cp!).toBeGreaterThan(0);
        expect(res.cpk!).toBeLessThanOrEqual(res.cp! + 1e-12);

        // Center limits symmetrically around the sample mean -> Cpk === Cp within 1e-9
        const halfSpan = (hi - lo) / 2;
        const centered = computeParametricCapabilityFromValues(
          values,
          res.mean! - halfSpan,
          res.mean! + halfSpan,
        );
        expect(centered.cp).not.toBeNull();
        expect(centered.cpk).not.toBeNull();
        expect(Math.abs(centered.cpk! - centered.cp!)).toBeLessThan(1e-9);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps two-sided Cp and Cpk invariant within 1e-9 under any positive affine transform x\' = a*x + b (a > 0)', () => {
    fc.assert(
      fc.property(
        arbNonDegenerateVectorAndLimits,
        arbPositiveAffine,
        ({ values, lo, hi }, { a, b }) => {
          const base = computeParametricCapabilityFromValues(values, lo, hi);
          const transformed = values.map((x) => a * x + b);
          const next = computeParametricCapabilityFromValues(
            transformed,
            a * lo + b,
            a * hi + b,
          );

          expect(base.cp).not.toBeNull();
          expect(base.cpk).not.toBeNull();
          expect(next.cp).not.toBeNull();
          expect(next.cpk).not.toBeNull();

          const cpTol = Math.max(1e-9, Math.abs(base.cp!) * 1e-9);
          const cpkTol = Math.max(1e-9, Math.abs(base.cpk!) * 1e-9);
          expect(Math.abs(next.cp! - base.cp!)).toBeLessThan(cpTol);
          expect(Math.abs(next.cpk! - base.cpk!)).toBeLessThan(cpkTol);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns Cp = null and affine-invariant single-sided Cpk (Cpl / Cpu) when only one limit is valid', () => {
    fc.assert(
      fc.property(
        arbNonDegenerateVectorAndLimits,
        arbPositiveAffine,
        fc.constantFrom<'lo' | 'hi'>('lo', 'hi'),
        ({ values, lo, hi }, { a, b }, side) => {
          const rawLo = side === 'lo' ? lo : null;
          const rawHi = side === 'hi' ? hi : null;
          const base = computeParametricCapabilityFromValues(values, rawLo, rawHi);
          const transformed = values.map((x) => a * x + b);
          const next = computeParametricCapabilityFromValues(
            transformed,
            rawLo !== null ? a * rawLo + b : null,
            rawHi !== null ? a * rawHi + b : null,
          );

          expect(base.cp).toBeNull();
          expect(next.cp).toBeNull();
          expect(base.cpk).not.toBeNull();
          expect(next.cpk).not.toBeNull();
          const tol = Math.max(1e-9, Math.abs(base.cpk!) * 1e-9);
          expect(Math.abs(next.cpk! - base.cpk!)).toBeLessThan(tol);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves Cp > 0, Cpk <= Cp, and histogram count conservation on columnar Float32Array ParametricTestColumns', () => {
    fc.assert(
      fc.property(
        arbNonDegenerateVectorAndLimits,
        fc.integer({ min: 4, max: 32 }),
        ({ values, lo, hi }, binCount) => {
          const col: ParametricTestColumn = {
            testNum: 204,
            testName: 'PROP_TEST',
            units: 'A',
            resScal: 6,
            llmScal: 6,
            hlmScal: 6,
            loLimit: lo,
            hiLimit: hi,
            values: Float32Array.from(values),
          };
          const summary = computeParametricCapability(col);
          if (summary.sigma !== null && summary.sigma > 0) {
            expect(summary.cp).not.toBeNull();
            expect(summary.cpk).not.toBeNull();
            expect(summary.cp!).toBeGreaterThan(0);
            expect(summary.cpk!).toBeLessThanOrEqual(summary.cp! + 1e-9);
          }

          const hist = computeParametricHistogram(col, undefined, { binCount });
          const sum = hist.bins.reduce((acc, bin) => acc + bin.count, 0);
          expect(hist.n).toBe(summary.n);
          expect(sum).toBe(summary.n);
          expect(hist.domainMin).not.toBeNull();
          expect(hist.domainMax).not.toBeNull();
          expect(hist.domainMin!).toBeLessThanOrEqual(lo);
          expect(hist.domainMax!).toBeGreaterThanOrEqual(hi);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns null Cp and Cpk whenever n < 2, sigma === 0, or limits are absent/inverted', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 20 }),
        fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        (constantVal, count, lo, delta) => {
          // Constant vector (sigma === 0 or n < 2)
          const constVec = Array.from({ length: count }, () => constantVal);
          const constRes = computeParametricCapabilityFromValues(
            constVec,
            lo,
            lo + delta + 1,
          );
          expect(constRes.cp).toBeNull();
          expect(constRes.cpk).toBeNull();

          // Inverted limits (lo >= hi)
          const invRes = computeParametricCapabilityFromValues(
            [lo - 1, lo + 1, lo + 2],
            lo + delta,
            lo,
          );
          expect(invRes.cp).toBeNull();
          expect(invRes.cpk).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
