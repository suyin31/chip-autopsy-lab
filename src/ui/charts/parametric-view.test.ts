import { describe, expect, it } from 'vitest';
import type {
  ParametricCapabilitySummary,
  ParametricHistogram,
} from '@/core/analytics';
import {
  DEFAULT_PARAMETRIC_SORT,
  resolveActiveParametricTestNum,
  resolveLimitLabelAnchor,
  resolveParametricTakeaway,
  resolveScrubBinAtX,
  sortParametricSummaries,
  toggleParametricSort,
} from './parametric-view';

function makeSummary(
  overrides: Partial<ParametricCapabilitySummary> & { testNum: number },
): ParametricCapabilitySummary {
  return {
    testName: `TEST_${overrides.testNum}`,
    units: 'V',
    displayScaleExp: 3,
    llmScal: 3,
    hlmScal: 3,
    n: 100,
    failCount: 0,
    mean: 0.5,
    sigma: 0.02,
    min: 0.4,
    max: 0.6,
    loLimit: 0.3,
    hiLimit: 0.7,
    cp: 3.33,
    cpk: 3.33,
    ...overrides,
  };
}

describe('parametric-view helpers (Task 13.2)', () => {
  it('sorts summaries by Cpk ascending with null Cpk rows kept at the bottom', () => {
    const rows = [
      makeSummary({ testNum: 101, cpk: 1.85 }),
      makeSummary({ testNum: 204, cpk: 0.14 }),
      makeSummary({ testNum: 302, cpk: null }),
      makeSummary({ testNum: 410, cpk: 1.12 }),
    ];

    const asc = sortParametricSummaries(rows, DEFAULT_PARAMETRIC_SORT);
    expect(asc.map((r) => r.testNum)).toEqual([204, 410, 101, 302]);

    const desc = sortParametricSummaries(rows, {
      key: 'cpk',
      direction: 'desc',
    });
    expect(desc.map((r) => r.testNum)).toEqual([101, 410, 204, 302]);
  });

  it('toggles sort direction on repeat clicks and defaults failCount/n to desc', () => {
    const next1 = toggleParametricSort(DEFAULT_PARAMETRIC_SORT, 'cpk');
    expect(next1).toEqual({ key: 'cpk', direction: 'desc' });

    const next2 = toggleParametricSort(next1, 'failCount');
    expect(next2).toEqual({ key: 'failCount', direction: 'desc' });

    const next3 = toggleParametricSort(next2, 'testName');
    expect(next3).toEqual({ key: 'testName', direction: 'asc' });
  });

  it('resolves the active test and takeaway cleanly for low-Cpk, healthy, and no-limit lots', () => {
    const lowRows = [
      makeSummary({ testNum: 101, testName: 'VDD_CONT_R', cpk: 1.9 }),
      makeSummary({ testNum: 204, testName: 'IDDQ_LEAK', cpk: 0.14 }),
    ];
    expect(resolveActiveParametricTestNum(lowRows, null)).toBe(204);
    expect(resolveActiveParametricTestNum(lowRows, 101)).toBe(101);
    expect(resolveActiveParametricTestNum(lowRows, 999)).toBe(204);

    expect(resolveParametricTakeaway(lowRows)).toEqual({
      kind: 'lowCpk',
      testName: 'IDDQ_LEAK',
      testNum: 204,
      cpk: 0.14,
    });

    const healthyRows = [
      makeSummary({ testNum: 101, cpk: 1.9 }),
      makeSummary({ testNum: 204, cpk: 1.55 }),
    ];
    expect(resolveParametricTakeaway(healthyRows)).toEqual({
      kind: 'healthy',
      count: 2,
    });

    const noLimitRows = [makeSummary({ testNum: 101, cpk: null, cp: null })];
    expect(resolveParametricTakeaway(noLimitRows)).toEqual({
      kind: 'noLimits',
      count: 1,
    });
  });

  it('maps pointer X coordinates to the exact histogram bin and aligns edge limit labels', () => {
    const hist: ParametricHistogram = {
      testNum: 204,
      n: 10,
      min: 0,
      max: 10,
      domainMin: 0,
      domainMax: 10,
      loLimit: 1,
      hiLimit: 9,
      maxBinCount: 5,
      bins: [
        { index: 0, x0: 0, x1: 2.5, count: 2, outOfSpec: false },
        { index: 1, x0: 2.5, x1: 5, count: 3, outOfSpec: false },
        { index: 2, x0: 5, x1: 7.5, count: 4, outOfSpec: false },
        { index: 3, x0: 7.5, x1: 10, count: 1, outOfSpec: false },
      ],
    };

    expect(resolveScrubBinAtX(hist, 0, 400)?.index).toBe(0);
    expect(resolveScrubBinAtX(hist, 150, 400)?.index).toBe(1);
    expect(resolveScrubBinAtX(hist, 250, 400)?.index).toBe(2);
    expect(resolveScrubBinAtX(hist, 400, 400)?.index).toBe(3);

    expect(resolveLimitLabelAnchor(12, 400)).toBe('start');
    expect(resolveLimitLabelAnchor(200, 400)).toBe('middle');
    expect(resolveLimitLabelAnchor(388, 400)).toBe('end');
  });
});
