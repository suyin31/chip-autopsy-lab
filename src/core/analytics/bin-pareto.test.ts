import { describe, expect, it } from 'vitest';
import { generateDemoStdfBytes } from '../demo';
import { buildLotModel } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import { parseStdfBytes } from '../stdf/stdf-parser';
import { computeBinPareto } from './bin-pareto';

function loadDemoLot(): LotModel {
  const parsed = parseStdfBytes(generateDemoStdfBytes('edge-ring-etch'), {
    mode: 'full',
  });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

describe('computeBinPareto', () => {
  const lot = loadDemoLot();

  it('ranks the demo lot failing bins with names, shares, and a cumulative share ending at 1', () => {
    const result = computeBinPareto(lot, 'SBIN');
    expect(result.testedCount).toBe(lot.dies.count);
    expect(result.entries.length).toBeGreaterThan(0);
    const top = result.entries[0]!;
    expect(top.count).toBeGreaterThanOrEqual(result.entries[1]?.count ?? 0);
    expect(top.binName).toBe(lot.sbins.get(top.binCode)?.name ?? '');
    expect(top.shareOfTested).toBeCloseTo(top.count / lot.dies.count, 12);
    expect(result.entries.at(-1)!.cumulativeFailShare).toBe(1);
  });

  it('returns no entries for an empty selection and tolerates a short mask', () => {
    const empty = computeBinPareto(lot, 'HBIN', new Uint8Array(lot.dies.count));
    expect(empty.entries).toEqual([]);
    expect(empty.testedCount).toBe(0);

    const short = computeBinPareto(lot, 'HBIN', new Uint8Array(3).fill(1));
    expect(short.testedCount).toBeLessThanOrEqual(3);
  });

  it('restricts counts to the selection mask', () => {
    const full = computeBinPareto(lot, 'SBIN');
    const wafer0 = lot.wafers[0]!;
    const mask = new Uint8Array(lot.dies.count);
    mask.fill(1, wafer0.dieStartIndex, wafer0.dieEndIndex);
    const scoped = computeBinPareto(lot, 'SBIN', mask);
    expect(scoped.testedCount).toBe(wafer0.dieEndIndex - wafer0.dieStartIndex);
    expect(scoped.failCount).toBeLessThanOrEqual(full.failCount);
  });
});
