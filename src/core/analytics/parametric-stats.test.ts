import { describe, expect, it } from 'vitest';
import { generateDemoLot } from '../demo/demo-generator';
import { buildLotModel } from '../model/lot-builder';
import type { ParametricTestColumn } from '../model/types';
import { parseStdfBytes } from '../stdf/stdf-parser';
import {
  computeLotParametricSummaries,
  computeParametricCapability,
  computeParametricCapabilityFromValues,
  computeParametricHistogram,
  formatCapabilityIndex,
  formatScaledMeasurement,
  resolveScaledUnitLabel,
} from './parametric-stats';

function makeColumn(
  values: readonly number[],
  overrides: Partial<Omit<ParametricTestColumn, 'values'>> = {},
): ParametricTestColumn {
  return {
    testNum: overrides.testNum ?? 204,
    testName: overrides.testName ?? 'IDDQ_LEAK',
    units: overrides.units ?? 'A',
    resScal: overrides.resScal ?? 6,
    llmScal: overrides.llmScal ?? 6,
    hlmScal: overrides.hlmScal ?? 6,
    loLimit: overrides.loLimit !== undefined ? overrides.loLimit : 0.2e-6,
    hiLimit: overrides.hiLimit !== undefined ? overrides.hiLimit : 15e-6,
    values: Float32Array.from(values),
  };
}

describe('parametric-stats (Task 13.1)', () => {
  it('computes Welford mean, sample sigma, two-sided Cp/Cpk, and out-of-spec fail counts', () => {
    // Symmetric samples around 10: [8, 9, 10, 11, 12], mean = 10, sample variance = 10/4 = 2.5, sigma = sqrt(2.5)
    const stats = computeParametricCapabilityFromValues(
      [8, 9, 10, 11, 12],
      4,
      16,
    );
    const expectedSigma = Math.sqrt(2.5);
    const expectedCp = (16 - 4) / (6 * expectedSigma);

    expect(stats.n).toBe(5);
    expect(stats.failCount).toBe(0);
    expect(stats.mean).toBeCloseTo(10, 12);
    expect(stats.sigma).toBeCloseTo(expectedSigma, 12);
    expect(stats.cp).toBeCloseTo(expectedCp, 12);
    expect(stats.cpk).toBeCloseTo(expectedCp, 12);
  });

  it('remains numerically stable under large constant offsets (Welford stability)', () => {
    const base = 1e9;
    const stats = computeParametricCapabilityFromValues(
      [base + 1, base + 2, base + 3, base + 4],
      base,
      base + 5,
    );
    expect(stats.mean).toBeCloseTo(base + 2.5, 9);
    expect(stats.sigma).toBeCloseTo(Math.sqrt(5 / 3), 9);
    expect(stats.cp).toBeCloseTo(5 / (6 * Math.sqrt(5 / 3)), 9);
    expect(stats.cpk).toBeCloseTo(stats.cp!, 9);
  });

  it('handles single-sided limits (Cpu / Cpl) with Cp = null (Requirement 8.4)', () => {
    const hiOnly = computeParametricCapabilityFromValues([1, 2, 3, 4], null, 10);
    const sigma = Math.sqrt(5 / 3);
    expect(hiOnly.cp).toBeNull();
    expect(hiOnly.cpk).toBeCloseTo((10 - 2.5) / (3 * sigma), 12);
    expect(hiOnly.loLimit).toBeNull();
    expect(hiOnly.hiLimit).toBe(10);

    const loOnly = computeParametricCapabilityFromValues([1, 2, 3, 4], 0, null);
    expect(loOnly.cp).toBeNull();
    expect(loOnly.cpk).toBeCloseTo((2.5 - 0) / (3 * sigma), 12);
    expect(loOnly.loLimit).toBe(0);
    expect(loOnly.hiLimit).toBeNull();
  });

  it('returns null Cp and Cpk for n < 2, sigma === 0, missing limits, or inverted limits (Requirement 8.4)', () => {
    const empty = computeParametricCapabilityFromValues([Number.NaN], 0, 10);
    expect(empty.n).toBe(0);
    expect(empty.mean).toBeNull();
    expect(empty.sigma).toBeNull();
    expect(empty.cp).toBeNull();
    expect(empty.cpk).toBeNull();

    const single = computeParametricCapabilityFromValues([5], 0, 10);
    expect(single.n).toBe(1);
    expect(single.mean).toBe(5);
    expect(single.sigma).toBeNull();
    expect(single.cp).toBeNull();
    expect(single.cpk).toBeNull();

    const constant = computeParametricCapabilityFromValues([7.3, 7.3, 7.3, 7.3], 0, 10);
    expect(constant.n).toBe(4);
    expect(constant.sigma).toBe(0);
    expect(constant.cp).toBeNull();
    expect(constant.cpk).toBeNull();

    const noLimits = computeParametricCapabilityFromValues([1, 2, 3], null, null);
    expect(noLimits.cp).toBeNull();
    expect(noLimits.cpk).toBeNull();

    const inverted = computeParametricCapabilityFromValues([1, 2, 3], 10, 5);
    expect(inverted.loLimit).toBeNull();
    expect(inverted.hiLimit).toBeNull();
    expect(inverted.failCount).toBe(0);
    expect(inverted.cp).toBeNull();
    expect(inverted.cpk).toBeNull();
  });

  it('respects selectionMask and ignores non-finite values', () => {
    const col = makeColumn([1e-6, 2e-6, 20e-6, Number.NaN, 3e-6], {
      loLimit: 0.5e-6,
      hiLimit: 10e-6,
    });
    const mask = new Uint8Array([1, 1, 0, 1, 1]);
    const summary = computeParametricCapability(col, mask);
    expect(summary.n).toBe(3);
    expect(summary.failCount).toBe(0);
    expect(summary.mean).toBeCloseTo(2e-6, 10);
    expect(summary.cp).not.toBeNull();
    expect(summary.cpk).not.toBeNull();
  });

  it('computes histogram bins with exact count conservation and limit-covering domain', () => {
    const col = makeColumn([1, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 11], {
      units: 'V',
      resScal: 0,
      loLimit: 0,
      hiLimit: 12,
    });
    const hist = computeParametricHistogram(col, undefined, { binCount: 10 });
    const total = hist.bins.reduce((acc, b) => acc + b.count, 0);
    expect(hist.n).toBe(12);
    expect(total).toBe(12);
    expect(hist.bins).toHaveLength(10);
    expect(hist.domainMin).toBe(0);
    expect(hist.domainMax).toBe(12);
    expect(hist.bins[0]!.x0).toBeCloseTo(1, 6);
    expect(hist.bins[hist.bins.length - 1]!.x1).toBeCloseTo(11, 6);

    // Constant vector produces one bin holding all samples
    const constCol = makeColumn([4.5, 4.5, 4.5], { loLimit: 1, hiLimit: 10 });
    const constHist = computeParametricHistogram(constCol);
    expect(constHist.bins).toHaveLength(1);
    expect(constHist.bins[0]!.count).toBe(3);
    expect(constHist.domainMin).toBeLessThanOrEqual(1);
    expect(constHist.domainMax).toBeGreaterThanOrEqual(10);
  });

  it('formats measurements with SI prefixes from display exponents and 2-decimal capability indices', () => {
    expect(formatScaledMeasurement(0.0035, 'V', 3)).toBe('3.50 mV');
    expect(formatScaledMeasurement(10.22e-6, 'A', 6)).toBe('10.22 uA');
    expect(formatScaledMeasurement(5.5e-9, 'A', 9)).toBe('5.50 nA');
    expect(formatScaledMeasurement(2.4e9, 'Hz', -9)).toBe('2.40 GHz');
    expect(formatScaledMeasurement(1250e-3, 'V', 3)).toBe('1,250.00 mV');
    expect(formatScaledMeasurement(1.42, 'Ohm', 0)).toBe('1.42 Ohm');
    expect(formatScaledMeasurement(42.5, '', 6)).toBe('42.50');

    expect(resolveScaledUnitLabel('A', 6).unitLabel).toBe('uA');
    expect(resolveScaledUnitLabel('V', 3).unitLabel).toBe('mV');
    expect(resolveScaledUnitLabel('Hz', -9).unitLabel).toBe('GHz');

    expect(formatCapabilityIndex(1.334)).toBe('1.33');
    expect(formatCapabilityIndex(null)).toBe('N/A');
    expect(formatCapabilityIndex(Number.NaN)).toBe('N/A');
  });

  it('summarizes all 4 tests on the edge-ring-etch demo lot with low Cpk on IDDQ_LEAK', () => {
    const demo = generateDemoLot('edge-ring-etch');
    const parsed = parseStdfBytes(demo.stdfBytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const lot = buildLotModel(parsed.value);
    const summaries = computeLotParametricSummaries(lot);

    expect(summaries.map((s) => s.testNum)).toEqual([101, 204, 302, 410]);
    const iddq = summaries.find((s) => s.testNum === 204)!;
    expect(iddq.testName).toBe('IDDQ_LEAK');
    expect(iddq.n).toBe(lot.dies.count);
    expect(iddq.failCount).toBeGreaterThan(0);
    expect(iddq.cpk).not.toBeNull();
    expect(iddq.cpk!).toBeLessThan(1.0);
  });
});
