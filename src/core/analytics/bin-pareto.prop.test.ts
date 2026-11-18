import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbDieMask, arbLotModel } from '../__test-utils__/arbitraries';
import type { BinMode, LotModel } from '../model/types';
import { computeBinPareto } from './bin-pareto';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);

const arbLotModeMask: fc.Arbitrary<{
  lot: LotModel;
  mode: BinMode;
  mask: Uint8Array | undefined;
}> = arbLotModel.chain((lot) =>
  fc.record({
    lot: fc.constant(lot),
    mode: fc.constantFrom<BinMode>('SBIN', 'HBIN'),
    mask: fc.oneof(
      fc.constant<Uint8Array | undefined>(undefined),
      arbDieMask(lot.dies.count),
    ),
  }),
);

function selectedCountOf(lot: LotModel, mask: Uint8Array | undefined): number {
  if (mask === undefined) {
    return lot.dies.count;
  }
  let n = 0;
  for (let i = 0; i < lot.dies.count; i += 1) {
    if (mask[i] !== 0) {
      n += 1;
    }
  }
  return n;
}

describe('Property 5: Bin Pareto count conservation and monotonic ordering', () => {
  it('conserves counts: passingCount + sum(entries.count) === |selection|', () => {
    fc.assert(
      fc.property(arbLotModeMask, ({ lot, mode, mask }) => {
        const result = computeBinPareto(lot, mode, mask);
        const selected = selectedCountOf(lot, mask);
        const sum = result.entries.reduce((acc, e) => acc + e.count, 0);

        expect(result.passingCount + sum).toBe(selected);
        expect(result.failCount).toBe(sum);
        expect(result.testedCount).toBe(selected);
        for (const entry of result.entries) {
          expect(entry.dieIndices).toHaveLength(entry.count);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('orders failing entries by non-increasing positive count with unique bin codes', () => {
    fc.assert(
      fc.property(arbLotModeMask, ({ lot, mode, mask }) => {
        const { entries } = computeBinPareto(lot, mode, mask);
        const seen = new Set<number>();
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i]!;
          expect(entry.count).toBeGreaterThan(0);
          expect(seen.has(entry.binCode)).toBe(false);
          seen.add(entry.binCode);
          if (i > 0) {
            const prev = entries[i - 1]!;
            expect(prev.count).toBeGreaterThanOrEqual(entry.count);
            if (prev.count === entry.count) {
              expect(prev.binCode).toBeLessThan(entry.binCode);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('increases cumulativeFailShare monotonically to exactly 1.0 when any failure exists', () => {
    fc.assert(
      fc.property(arbLotModeMask, ({ lot, mode, mask }) => {
        const { entries } = computeBinPareto(lot, mode, mask);
        if (entries.length === 0) {
          return;
        }
        let prevCumulative = 0;
        let shareSum = 0;
        for (const entry of entries) {
          expect(entry.cumulativeFailShare).toBeGreaterThan(prevCumulative);
          expect(entry.cumulativeFailShare).toBeLessThanOrEqual(1);
          expect(entry.shareOfFailures).toBeGreaterThan(0);
          expect(entry.shareOfTested).toBeGreaterThan(0);
          expect(entry.shareOfTested).toBeLessThanOrEqual(entry.shareOfFailures);
          prevCumulative = entry.cumulativeFailShare;
          shareSum += entry.shareOfFailures;
        }
        expect(entries[entries.length - 1]!.cumulativeFailShare).toBe(1);
        expect(shareSum).toBeCloseTo(1, 9);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('lists exactly the selected failing dies, each once, in the entry for its bin', () => {
    fc.assert(
      fc.property(arbLotModeMask, ({ lot, mode, mask }) => {
        const { entries } = computeBinPareto(lot, mode, mask);
        const binArr = mode === 'SBIN' ? lot.dies.sbin : lot.dies.hbin;
        const seen = new Set<number>();
        for (const entry of entries) {
          let last = -1;
          for (const idx of entry.dieIndices) {
            expect(idx).toBeGreaterThan(last);
            last = idx;
            expect(seen.has(idx)).toBe(false);
            seen.add(idx);
            expect(lot.dies.finalPass[idx]).toBe(0);
            expect(binArr[idx]).toBe(entry.binCode);
            if (mask !== undefined) {
              expect(mask[idx]).toBe(1);
            }
          }
        }
        let expected = 0;
        for (let i = 0; i < lot.dies.count; i += 1) {
          if (lot.dies.finalPass[i] === 0 && (mask === undefined || mask[i] !== 0)) {
            expected += 1;
          }
        }
        expect(seen.size).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
