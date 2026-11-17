import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbDieMask, arbLotModel } from '../__test-utils__/arbitraries';
import type { LotModel } from '../model/types';
import {
  computeYieldSummary,
  detectSiteAnomalies,
  SITE_ANOMALY_THRESHOLDS,
  type YieldMetrics,
} from './yield-summary';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);
const ADDITIVITY_TOLERANCE = 1e-12;

function assertMetricsInvariants(metrics: YieldMetrics): void {
  expect(metrics.testedDies).toBeGreaterThanOrEqual(0);
  expect(metrics.firstPassTestedDies).toBeGreaterThanOrEqual(0);
  expect(metrics.firstPassDies).toBeGreaterThanOrEqual(0);
  expect(metrics.firstPassFailDies).toBeGreaterThanOrEqual(0);
  expect(metrics.firstPassDies + metrics.firstPassFailDies).toBe(
    metrics.firstPassTestedDies,
  );
  expect(metrics.finalPassDies).toBeGreaterThanOrEqual(0);
  expect(metrics.finalFailDies).toBeGreaterThanOrEqual(0);
  expect(metrics.finalPassDies + metrics.finalFailDies).toBe(metrics.testedDies);
  expect(metrics.retestExecutions).toBeGreaterThanOrEqual(0);

  if (metrics.firstPassTestedDies === 0) {
    expect(metrics.firstPassDies).toBe(0);
    expect(metrics.firstPassFailDies).toBe(0);
    expect(metrics.firstPassYield).toBeNull();
  } else {
    expect(metrics.firstPassYield).not.toBeNull();
    expect(Number.isFinite(metrics.firstPassYield)).toBe(true);
    expect(metrics.firstPassYield!).toBeGreaterThanOrEqual(0);
    expect(metrics.firstPassYield!).toBeLessThanOrEqual(1);
    expect(metrics.firstPassYield).toBe(
      metrics.firstPassDies / metrics.firstPassTestedDies,
    );
  }

  if (metrics.testedDies === 0) {
    expect(metrics.finalPassDies).toBe(0);
    expect(metrics.finalFailDies).toBe(0);
    expect(metrics.retestExecutions).toBe(0);
    expect(metrics.finalYield).toBeNull();
  } else {
    expect(metrics.finalYield).not.toBeNull();
    expect(Number.isFinite(metrics.finalYield)).toBe(true);
    expect(metrics.finalYield!).toBeGreaterThanOrEqual(0);
    expect(metrics.finalYield!).toBeLessThanOrEqual(1);
    expect(metrics.finalYield).toBe(metrics.finalPassDies / metrics.testedDies);
  }
}

function assertPartitionAdditivity(
  overall: YieldMetrics,
  partitions: readonly YieldMetrics[],
): void {
  let sumTested = 0;
  let sumFirstPassTested = 0;
  let sumFirstPass = 0;
  let sumFirstFail = 0;
  let sumFinalPass = 0;
  let sumFinalFail = 0;
  let sumRetests = 0;
  let weightedFirstPassNumerator = 0;
  let weightedFinalNumerator = 0;

  for (const part of partitions) {
    assertMetricsInvariants(part);
    sumTested += part.testedDies;
    sumFirstPassTested += part.firstPassTestedDies;
    sumFirstPass += part.firstPassDies;
    sumFirstFail += part.firstPassFailDies;
    sumFinalPass += part.finalPassDies;
    sumFinalFail += part.finalFailDies;
    sumRetests += part.retestExecutions;

    if (part.firstPassTestedDies > 0) {
      weightedFirstPassNumerator += part.firstPassTestedDies * part.firstPassYield!;
    }
    if (part.testedDies > 0) {
      weightedFinalNumerator += part.testedDies * part.finalYield!;
    }
  }

  expect(sumTested).toBe(overall.testedDies);
  expect(sumFirstPassTested).toBe(overall.firstPassTestedDies);
  expect(sumFirstPass).toBe(overall.firstPassDies);
  expect(sumFirstFail).toBe(overall.firstPassFailDies);
  expect(sumFinalPass).toBe(overall.finalPassDies);
  expect(sumFinalFail).toBe(overall.finalFailDies);
  expect(sumRetests).toBe(overall.retestExecutions);

  if (overall.firstPassTestedDies > 0) {
    const weightedFirstPassYield =
      weightedFirstPassNumerator / overall.firstPassTestedDies;
    expect(
      Math.abs(weightedFirstPassYield - overall.firstPassYield!),
    ).toBeLessThanOrEqual(ADDITIVITY_TOLERANCE);
  }
  if (overall.testedDies > 0) {
    const weightedFinalYield = weightedFinalNumerator / overall.testedDies;
    expect(Math.abs(weightedFinalYield - overall.finalYield!)).toBeLessThanOrEqual(
      ADDITIVITY_TOLERANCE,
    );
  }
}

describe('Property 4: Yield Bounds and Partition Additivity (fast-check)', () => {
  it('enforces [0, 1] bounds, pass + fail === tested, null on empty selection, and exact Wafer & Site partition additivity', () => {
    const arbLotAndMask: fc.Arbitrary<{
      readonly lot: LotModel;
      readonly mask: Uint8Array | undefined;
    }> = arbLotModel.chain((lot) =>
      fc.oneof(
        fc.constant({ lot, mask: undefined }),
        arbDieMask(lot.dies.count).map((mask) => ({ lot, mask })),
      ),
    );

    fc.assert(
      fc.property(arbLotAndMask, ({ lot, mask }) => {
        const summary = computeYieldSummary(lot, mask);

        expect(summary.byWafer).toHaveLength(lot.wafers.length);
        expect(summary.bySite).toHaveLength(lot.sites.length);

        assertMetricsInvariants(summary.overall);
        expect(summary.overall.firstPassTestedDies).toBe(summary.overall.testedDies);
        for (const wfMetrics of summary.byWafer) {
          expect(wfMetrics.firstPassTestedDies).toBe(wfMetrics.testedDies);
        }
        assertPartitionAdditivity(summary.overall, summary.byWafer);
        assertPartitionAdditivity(summary.overall, summary.bySite);

        // Explicit empty-selection check on every generated lot
        const zeroMask = new Uint8Array(lot.dies.count);
        const emptySummary = computeYieldSummary(lot, zeroMask);
        assertMetricsInvariants(emptySummary.overall);
        expect(emptySummary.overall.testedDies).toBe(0);
        expect(emptySummary.overall.firstPassYield).toBeNull();
        expect(emptySummary.overall.finalYield).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('guarantees every detected site anomaly satisfies first-pass sample-size, delta-pp, z-score, confidence, and die-index invariants (with cross-site retests)', () => {
    const arbMultiSiteYieldScenario = fc
      .integer({ min: 2, max: 5 })
      .chain((siteCount) =>
        fc.record({
          siteCount: fc.constant(siteCount),
          perSiteTested: fc.array(fc.integer({ min: 20, max: 120 }), {
            minLength: siteCount,
            maxLength: siteCount,
          }),
          perSiteFailRate: fc.array(
            fc.double({ min: 0, max: 0.7, noNaN: true, noDefaultInfinity: true }),
            { minLength: siteCount, maxLength: siteCount },
          ),
          retestRecoveryRate: fc.double({
            min: 0,
            max: 1,
            noNaN: true,
            noDefaultInfinity: true,
          }),
          crossSiteShift: fc.integer({ min: 0, max: siteCount - 1 }),
        }),
      )
      .map(
        ({
          siteCount,
          perSiteTested,
          perSiteFailRate,
          retestRecoveryRate,
          crossSiteShift,
        }): LotModel => {
          const total = perSiteTested.reduce((a, b) => a + b, 0);

          const waferIndex = new Uint16Array(total);
          const x = new Int16Array(total);
          const y = new Int16Array(total);
          const hasValidCoords = new Uint8Array(total).fill(1);
          const firstSiteIndex = new Uint8Array(total);
          const siteIndex = new Uint8Array(total);
          const firstPass = new Uint8Array(total);
          const finalPass = new Uint8Array(total);
          const hbin = new Uint16Array(total);
          const sbin = new Uint16Array(total);
          const retestCount = new Uint16Array(total);
          const ringIndex = new Uint16Array(total).fill(1);
          const firstPrrOrder = new Uint32Array(total);
          const dieIds: string[] = new Array<string>(total);
          const dieIndexById = new Map<string, number>();

          let cursor = 0;
          for (let s = 0; s < siteCount; s += 1) {
            const n = perSiteTested[s]!;
            const fails = Math.min(n, Math.round(n * perSiteFailRate[s]!));
            const recoveredCount = Math.min(fails, Math.round(fails * retestRecoveryRate));
            for (let i = 0; i < n; i += 1) {
              const fp = i >= fails ? 1 : 0;
              const recovered = fp === 0 && i < recoveredCount;
              const fin = fp === 1 || recovered ? 1 : 0;
              const finalSite = fp === 0 ? (s + crossSiteShift) % siteCount : s;
              const cx = (cursor % 64) - 32;
              const cy = Math.floor(cursor / 64) - 32;
              const id = `W01:${cx},${cy}`;
              x[cursor] = cx;
              y[cursor] = cy;
              firstSiteIndex[cursor] = s;
              siteIndex[cursor] = finalSite;
              firstPass[cursor] = fp;
              finalPass[cursor] = fin;
              retestCount[cursor] = fp === 0 && (recovered || crossSiteShift > 0) ? 1 : 0;
              hbin[cursor] = fin === 1 ? 1 : 2;
              sbin[cursor] = fin === 1 ? 1 : 5;
              firstPrrOrder[cursor] = cursor;
              dieIds[cursor] = id;
              dieIndexById.set(id, cursor);
              cursor += 1;
            }
          }

          return {
            lotId: 'PROP-SITE',
            partTyp: 'PART',
            jobNam: 'JOB',
            parseMode: 'bins-only',
            endianness: 'little',
            wafers: [
              {
                waferIndex: 0,
                waferId: 'W01',
                dieStartIndex: 0,
                dieEndIndex: total,
                minX: -32,
                maxX: 31,
                minY: -32,
                maxY: 31,
                maxRingIndex: 1,
                geometry: { wfFlat: 'D', posX: 'R', posY: 'U' },
              },
            ],
            sites: Array.from({ length: siteCount }, (_, s) => ({
              siteIndex: s,
              headNum: 1,
              siteNum: s + 1,
              label: `1:${s + 1}`,
            })),
            hbins: new Map(),
            sbins: new Map(),
            dies: {
              count: total,
              waferIndex,
              x,
              y,
              hasValidCoords,
              firstSiteIndex,
              siteIndex,
              firstPass,
              finalPass,
              hbin,
              sbin,
              retestCount,
              ringIndex,
              firstPrrOrder,
            },
            dieIds,
            dieIndexById,
            waferCoordIndex: [new Map()],
            tests: new Map(),
            warnings: [],
          };
        },
      );

    fc.assert(
      fc.property(arbMultiSiteYieldScenario, (lot) => {
        const summary = computeYieldSummary(lot);
        const anomalies = detectSiteAnomalies(lot);

        const qualifyingSites = summary.bySite.filter(
          (m) => m.firstPassTestedDies >= SITE_ANOMALY_THRESHOLDS.MIN_SITE_TESTED_DIES,
        );
        if (qualifyingSites.length < SITE_ANOMALY_THRESHOLDS.MIN_QUALIFYING_SITES) {
          expect(anomalies).toEqual([]);
          return;
        }

        for (let i = 0; i < anomalies.length; i += 1) {
          const a = anomalies[i]!;
          expect(a.siteMetrics.firstPassTestedDies).toBeGreaterThanOrEqual(
            SITE_ANOMALY_THRESHOLDS.MIN_SITE_TESTED_DIES,
          );
          expect(a.yieldDeltaPp).toBeLessThan(
            -SITE_ANOMALY_THRESHOLDS.MIN_YIELD_DROP_PP,
          );
          expect(a.twoProportionZ).toBeGreaterThanOrEqual(
            SITE_ANOMALY_THRESHOLDS.MIN_TWO_PROPORTION_Z,
          );
          expect(a.excessFailCount).toBeGreaterThanOrEqual(1);
          expect(a.excessFailShare).toBeGreaterThanOrEqual(0);
          expect(a.excessFailShare).toBeLessThanOrEqual(1);
          expect(a.confidence).toBeGreaterThanOrEqual(
            SITE_ANOMALY_THRESHOLDS.CONFIDENCE_MIN,
          );
          expect(a.confidence).toBeLessThanOrEqual(
            SITE_ANOMALY_THRESHOLDS.CONFIDENCE_MAX,
          );
          expect(a.failingDieIndices.length).toBe(a.siteMetrics.firstPassFailDies);
          expect(a.failingDieIndices.length).toBeGreaterThanOrEqual(1);

          for (const dieIdx of a.failingDieIndices) {
            expect(lot.dies.firstSiteIndex[dieIdx]).toBe(a.site.siteIndex);
            expect(lot.dies.firstPass[dieIdx]).toBe(0);
          }

          if (i > 0) {
            expect(anomalies[i - 1]!.excessFailCount).toBeGreaterThanOrEqual(
              a.excessFailCount,
            );
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
