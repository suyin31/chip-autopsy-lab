import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbMultiWaferLot } from '../__test-utils__/arbitraries';
import { type LotModel, packWaferCoord } from '../model/types';
import { STDF_MISSING_COORD, STDF_MISSING_U2 } from '../stdf/types';
import { computeStackedHeatmap } from './stacked-heatmap';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);

const arbMultiWaferLotAndSubset: fc.Arbitrary<{
  readonly lot: LotModel;
  readonly waferSubset: ReadonlySet<number> | undefined;
}> = arbMultiWaferLot.chain((lot) =>
  fc.record({
    lot: fc.constant(lot),
    waferSubset: fc.oneof(
      fc.constant<ReadonlySet<number> | undefined>(undefined),
      fc
        .uniqueArray(fc.integer({ min: 0, max: lot.wafers.length - 1 }), {
          minLength: 0,
          maxLength: lot.wafers.length,
        })
        .map((indices) => new Set<number>(indices) as ReadonlySet<number>),
    ),
  }),
);

function includedWafersOf(
  lot: LotModel,
  waferSubset: ReadonlySet<number> | undefined,
): Set<number> {
  const included = new Set<number>();
  for (let w = 0; w < lot.wafers.length; w += 1) {
    if (waferSubset === undefined || waferSubset.has(w)) {
      included.add(w);
    }
  }
  return included;
}

describe('Property 6: Stacked Multi-Wafer Heatmap failure conservation', () => {
  it('enforces 0 <= failCount(x,y) <= testedWaferCount(x,y) <= W and exact per-wafer final fail agreement', () => {
    fc.assert(
      fc.property(arbMultiWaferLotAndSubset, ({ lot, waferSubset }) => {
        expect(lot.wafers.length).toBeGreaterThanOrEqual(2);
        const cells = computeStackedHeatmap(lot, waferSubset);
        const included = includedWafersOf(lot, waferSubset);
        const activeWaferCount = included.size;

        // Independent reference aggregation per (x, y) across included wafers
        const refTestedWafers = new Map<number, Set<number>>();
        const refFailingWafers = new Map<number, Set<number>>();
        const refFailingIndices = new Map<number, number[]>();
        let totalCoordFails = 0;
        let totalCoordTested = 0;

        for (let w = 0; w < lot.wafers.length; w += 1) {
          if (!included.has(w)) {
            continue;
          }
          const wafer = lot.wafers[w]!;
          for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
            if (
              lot.dies.hasValidCoords[i] === 0 ||
              lot.dies.x[i] === STDF_MISSING_COORD ||
              lot.dies.y[i] === STDF_MISSING_COORD
            ) {
              continue;
            }
            const key = packWaferCoord(lot.dies.x[i]!, lot.dies.y[i]!);
            totalCoordTested += 1;
            let testedSet = refTestedWafers.get(key);
            if (!testedSet) {
              testedSet = new Set<number>();
              refTestedWafers.set(key, testedSet);
            }
            testedSet.add(w);

            if (lot.dies.finalPass[i] === 0) {
              totalCoordFails += 1;
              let failSet = refFailingWafers.get(key);
              if (!failSet) {
                failSet = new Set<number>();
                refFailingWafers.set(key, failSet);
              }
              failSet.add(w);

              let indices = refFailingIndices.get(key);
              if (!indices) {
                indices = [];
                refFailingIndices.set(key, indices);
              }
              indices.push(i);
            }
          }
        }

        expect(cells.length).toBe(refTestedWafers.size);

        const seenCoords = new Set<number>();
        let sumFailCount = 0;
        let sumTestedCount = 0;
        let prevKey = -1;

        for (const cell of cells) {
          const key = packWaferCoord(cell.x, cell.y);
          expect(seenCoords.has(key)).toBe(false);
          seenCoords.add(key);
          // Deterministic ascending packed coordinate order
          expect(key).toBeGreaterThan(prevKey);
          prevKey = key;

          expect(cell.failCount).toBeGreaterThanOrEqual(0);
          expect(cell.failCount).toBeLessThanOrEqual(cell.testedWaferCount);
          expect(cell.testedWaferCount).toBeLessThanOrEqual(activeWaferCount);
          expect(cell.testedWaferCount).toBeLessThanOrEqual(lot.wafers.length);

          const expectedTested = refTestedWafers.get(key)?.size ?? 0;
          const expectedFailed = refFailingWafers.get(key)?.size ?? 0;
          expect(cell.testedWaferCount).toBe(expectedTested);
          expect(cell.failCount).toBe(expectedFailed);

          expect(cell.failRate).toBe(cell.failCount / cell.testedWaferCount);
          expect(cell.failRate).toBeGreaterThanOrEqual(0);
          expect(cell.failRate).toBeLessThanOrEqual(1);

          const expectedIdx = refFailingIndices.get(key) ?? [];
          expect(Array.from(cell.failingDieIndices)).toEqual(expectedIdx);

          sumFailCount += cell.failCount;
          sumTestedCount += cell.testedWaferCount;
        }

        expect(sumFailCount).toBe(totalCoordFails);
        expect(sumTestedCount).toBe(totalCoordTested);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves exact dominant failing SBIN and HBIN per coordinate (lowest code breaks ties)', () => {
    fc.assert(
      fc.property(arbMultiWaferLotAndSubset, ({ lot, waferSubset }) => {
        const cells = computeStackedHeatmap(lot, waferSubset);
        for (const cell of cells) {
          if (cell.failCount === 0) {
            expect(cell.dominantSbin).toBeNull();
            expect(cell.dominantHbin).toBeNull();
            continue;
          }

          const sbinCounts = new Map<number, number>();
          const hbinCounts = new Map<number, number>();
          for (const dieIdx of cell.failingDieIndices) {
            expect(lot.dies.finalPass[dieIdx]).toBe(0);
            expect(lot.dies.x[dieIdx]).toBe(cell.x);
            expect(lot.dies.y[dieIdx]).toBe(cell.y);

            const h = lot.dies.hbin[dieIdx]!;
            hbinCounts.set(h, (hbinCounts.get(h) ?? 0) + 1);

            const s = lot.dies.sbin[dieIdx]!;
            if (s !== STDF_MISSING_U2) {
              sbinCounts.set(s, (sbinCounts.get(s) ?? 0) + 1);
            }
          }

          const pickDominant = (counts: Map<number, number>): number | null => {
            let bestCode: number | null = null;
            let bestCount = 0;
            for (const [code, count] of counts.entries()) {
              if (
                count > bestCount ||
                (count === bestCount && bestCode !== null && code < bestCode)
              ) {
                bestCount = count;
                bestCode = code;
              }
            }
            return bestCode;
          };

          expect(cell.dominantHbin).toBe(pickDominant(hbinCounts));
          expect(cell.dominantSbin).toBe(pickDominant(sbinCounts));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
