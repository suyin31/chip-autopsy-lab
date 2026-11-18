import { describe, expect, it } from 'vitest';
import type { BinParetoEntry } from '@/core/analytics';
import { generateDemoStdfBytes } from '@/core/demo';
import { buildLotModel } from '@/core/model/lot-builder';
import type { LotModel } from '@/core/model';
import { parseStdfBytes } from '@/core/stdf/stdf-parser';
import { computeBinPareto } from '@/core/analytics';
import { createSelectionStore } from '@/ui/state';
import {
  PARETO_COLLAPSED_ROW_COUNT,
  PARETO_MIN_BAR_PERCENT,
  resolveParetoBarPercent,
  resolveParetoBarTone,
  resolveClaimMatchedBinCode,
  resolveClaimParetoMode,
  resolveParetoMask,
  selectParetoRows,
} from './bin-pareto-view';

function loadLot(): LotModel {
  const parsed = parseStdfBytes(generateDemoStdfBytes('edge-ring-etch'), {
    mode: 'full',
  });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

function entry(binCode: number): BinParetoEntry {
  return {
    binCode,
    binName: '',
    count: 1,
    shareOfTested: 0,
    shareOfFailures: 0,
    cumulativeFailShare: 0,
    dieIndices: new Uint32Array(0),
  };
}

describe('resolveParetoMask', () => {
  const lot = loadLot();

  it('counts the whole lot when no filter is active', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);
    const s = store.getState();
    expect(resolveParetoMask(lot, s)).toBeUndefined();
  });

  it('ignores the Pareto bin filter so the other bars stay available', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);
    const whole = computeBinPareto(lot, 'SBIN');
    const topCode = whole.entries[0]!.binCode;

    store.getState().toggleBinFilter({ mode: 'SBIN', code: topCode });
    const s = store.getState();
    expect(s.hasActiveFilter).toBe(true);
    const mask = resolveParetoMask(lot, s);
    expect(mask).toBeUndefined();
    expect(computeBinPareto(lot, 'SBIN', mask).entries).toHaveLength(
      whole.entries.length,
    );
  });

  it('keeps a brush or site selection while a bin filter is on', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);
    store.getState().toggleSiteFilter(0);
    const siteOnly = store.getState();
    const siteMask = resolveParetoMask(lot, siteOnly)!;
    expect(siteMask).toBe(siteOnly.selectedDieMask);

    const topCode = computeBinPareto(lot, 'SBIN', siteMask).entries[0]!.binCode;
    store.getState().toggleBinFilter({ mode: 'SBIN', code: topCode });
    const both = store.getState();
    const mask = resolveParetoMask(lot, both)!;
    expect(mask).toBeDefined();
    expect(Array.from(mask)).toEqual(Array.from(siteMask));
  });
});

describe('resolveParetoMask with a wafer scope', () => {
  const lot = loadLot();

  it('counts only the scoped wafer, with or without a bin filter', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);
    store.getState().toggleWaferFilter(2);
    const wafer = lot.wafers[2]!;
    const waferMask = resolveParetoMask(lot, store.getState())!;
    expect(waferMask).toBe(store.getState().selectedDieMask);
    const scoped = computeBinPareto(lot, 'SBIN', waferMask);
    expect(scoped.failCount).toBeLessThanOrEqual(
      wafer.dieEndIndex - wafer.dieStartIndex,
    );
    expect(scoped.failCount).toBeLessThan(
      computeBinPareto(lot, 'SBIN').failCount,
    );

    const topCode = scoped.entries[0]!.binCode;
    store.getState().toggleBinFilter({ mode: 'SBIN', code: topCode });
    const both = resolveParetoMask(lot, store.getState())!;
    expect(Array.from(both)).toEqual(Array.from(waferMask));
  });
});

describe('selectParetoRows', () => {
  const entries = Array.from({ length: 12 }, (_, i) => entry(i + 1));

  it('shows the first rows when collapsed and everything when expanded', () => {
    expect(selectParetoRows(entries, false, () => false)).toHaveLength(
      PARETO_COLLAPSED_ROW_COUNT,
    );
    expect(selectParetoRows(entries, true, () => false)).toHaveLength(12);
  });

  it('keeps pinned rows beyond the cut-off, in rank order', () => {
    const rows = selectParetoRows(entries, false, (e) => e.binCode === 11);
    expect(rows.map((e) => e.binCode)).toEqual([1, 2, 3, 4, 5, 6, 11]);
  });
});

describe('resolveParetoBarTone', () => {
  it('keeps the top-loss bin ember, inks a selected bin, and ghosts the rest', () => {
    expect(resolveParetoBarTone(0, false)).toBe('dominant');
    expect(resolveParetoBarTone(0, true)).toBe('dominant');
    expect(resolveParetoBarTone(3, true)).toBe('selected');
    expect(resolveParetoBarTone(3, false)).toBe('neutral');
    expect(resolveParetoBarTone(undefined, false)).toBe('neutral');
  });
});

describe('resolveParetoBarPercent', () => {
  it('scales to the largest loss share with a visible floor', () => {
    expect(resolveParetoBarPercent(50, 50)).toBe(100);
    expect(resolveParetoBarPercent(25, 50)).toBe(50);
    expect(resolveParetoBarPercent(1, 100_000)).toBe(PARETO_MIN_BAR_PERCENT);
    expect(resolveParetoBarPercent(0, 50)).toBe(0);
    expect(resolveParetoBarPercent(3, 0)).toBe(0);
  });
});

describe('resolveClaimParetoMode', () => {
  it('switches only when no cited bin belongs to the current mode', () => {
    expect(resolveClaimParetoMode('SBIN', undefined)).toBeNull();
    expect(resolveClaimParetoMode('SBIN', [])).toBeNull();
    expect(resolveClaimParetoMode('SBIN', [{ mode: 'SBIN', code: 7 }])).toBeNull();
    expect(resolveClaimParetoMode('SBIN', [{ mode: 'HBIN', code: 3 }])).toBe('HBIN');
    expect(
      resolveClaimParetoMode('SBIN', [
        { mode: 'HBIN', code: 3 },
        { mode: 'SBIN', code: 7 },
      ]),
    ).toBeNull();
  });
});

describe('resolveClaimMatchedBinCode', () => {
  it('returns the bin holding most of the cited failing dies, ignoring passing dies', () => {
    const lot = loadLot();
    const { dies } = lot;
    const all = Uint32Array.from({ length: dies.count }, (_, i) => i);
    const top = computeBinPareto(lot, 'SBIN').entries[0]!.binCode;
    expect(resolveClaimMatchedBinCode(dies, 'SBIN', all)).toBe(top);

    const passing = Uint32Array.from(
      Array.from(all).filter((i) => dies.finalPass[i] !== 0).slice(0, 10),
    );
    expect(resolveClaimMatchedBinCode(dies, 'SBIN', passing)).toBeNull();
    expect(resolveClaimMatchedBinCode(dies, 'SBIN', new Uint32Array())).toBeNull();
  });
});
