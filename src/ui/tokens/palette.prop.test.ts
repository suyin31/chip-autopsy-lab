import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  COLOR_TOKENS,
  getFailBinColor,
  MAGMA_LUT_256,
  parseHexColor,
  relativeLuminance,
  sampleMagmaHex,
  sampleMagmaRgb,
  wcagContrastRatio,
  wcagHexContrastRatio,
} from './index';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);

const arbRgb = fc.record({
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
});

describe('Design token & colour scale properties (fast-check)', () => {
  it('WCAG contrast ratio is symmetric, reflexive at 1.0, and bounded within [1, 21]', () => {
    fc.assert(
      fc.property(arbRgb, arbRgb, (a, b) => {
        const ab = wcagContrastRatio(a, b);
        const ba = wcagContrastRatio(b, a);
        const aa = wcagContrastRatio(a, a);

        expect(Math.abs(ab - ba)).toBeLessThan(1e-12);
        expect(Math.abs(aa - 1)).toBeLessThan(1e-12);
        expect(ab).toBeGreaterThanOrEqual(1);
        expect(ab).toBeLessThanOrEqual(21 + 1e-9);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('categorical fail-bin colour assignment is deterministic, >= 3:1 on bg, and never uses accent or pass-die fills', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 5_000 }), (rank) => {
        const first = getFailBinColor(rank);
        const second = getFailBinColor(rank);
        expect(first).toBe(second);
        expect(first).not.toBe(COLOR_TOKENS.accent);
        expect(first).not.toBe(COLOR_TOKENS.passDie);
        expect(wcagHexContrastRatio(first, COLOR_TOKENS.bg)).toBeGreaterThanOrEqual(
          3.0,
        );
        if (rank <= 0) {
          expect(first).toBe(COLOR_TOKENS.failure);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('magma LUT sampling is total over arbitrary IEEE-754 floats and monotonically increases in luminance', () => {
    for (let i = 1; i < MAGMA_LUT_256.length; i += 1) {
      const prevLum = relativeLuminance(parseHexColor(MAGMA_LUT_256[i - 1]));
      const currLum = relativeLuminance(parseHexColor(MAGMA_LUT_256[i]));
      expect(currLum).toBeGreaterThanOrEqual(prevLum);
    }

    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (value) => {
        const hex = sampleMagmaHex(value);
        const rgb = sampleMagmaRgb(value);

        expect(hex).toMatch(/^#[0-9A-F]{6}$/);
        expect(rgb.r).toBeGreaterThanOrEqual(0);
        expect(rgb.r).toBeLessThanOrEqual(255);
        expect(rgb.g).toBeGreaterThanOrEqual(0);
        expect(rgb.g).toBeLessThanOrEqual(255);
        expect(rgb.b).toBeGreaterThanOrEqual(0);
        expect(rgb.b).toBeLessThanOrEqual(255);

        if (!Number.isFinite(value) || value <= 0) {
          expect(hex).toBe(MAGMA_LUT_256[0]);
        } else if (value >= 1) {
          expect(hex).toBe(MAGMA_LUT_256[255]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
