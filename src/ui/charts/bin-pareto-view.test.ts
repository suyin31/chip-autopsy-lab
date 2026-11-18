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
    expect(rows.map((e) => e.binCode)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11]);
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
