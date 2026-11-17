/**
 * Lot, Wafer, and Test Site yield aggregations plus two-proportion z-test
 * site-concentration anomaly detection (`src/core/analytics/yield-summary.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 15.5, 17.7
 */

import type { LotModel, TestSiteMeta } from '../model/types';

export const SITE_ANOMALY_THRESHOLDS = {
  MIN_QUALIFYING_SITES: 2,
  MIN_SITE_TESTED_DIES: 30,
  MIN_YIELD_DROP_PP: 5.0,
  MIN_TWO_PROPORTION_Z: 3.0,
  CONFIDENCE_MIN: 0.65,
  CONFIDENCE_MAX: 0.99,
} as const;

export interface YieldMetrics {
  /**
   * Count of Dies in the final-PRR partition (`ColumnarDies.siteIndex` for `bySite`;
   * equal to `firstPassTestedDies` for `overall` and `byWafer`).
   */
  readonly testedDies: number;
  /**
   * Count of Dies in the first-PRR partition (`ColumnarDies.firstSiteIndex` for `bySite`;
   * equal to `testedDies` for `overall` and `byWafer`).
   */
  readonly firstPassTestedDies: number;
  readonly firstPassDies: number;
  readonly firstPassFailDies: number;
  readonly finalPassDies: number;
  readonly finalFailDies: number;
  readonly retestExecutions: number;
  /**
   * Ratio `firstPassDies / firstPassTestedDies` in `[0, 1]`, or `null` when
   * `firstPassTestedDies === 0` (never `NaN` or `±Infinity`).
   */
  readonly firstPassYield: number | null;
  /**
   * Ratio `finalPassDies / testedDies` in `[0, 1]`, or `null` when
   * `testedDies === 0` (never `NaN` or `±Infinity`).
   */
  readonly finalYield: number | null;
}

export interface YieldSummary {
  readonly overall: YieldMetrics;
  readonly byWafer: readonly YieldMetrics[];
  readonly bySite: readonly YieldMetrics[];
}

export interface SiteAnomalyFactInput {
  readonly site: TestSiteMeta;
  readonly siteMetrics: YieldMetrics;
  /** Pooled first-pass yield across all other Test Sites (`firstSiteIndex !== site.siteIndex`). */
  readonly otherSitesFirstPassYield: number;
  /** Negative first-pass percentage-point delta (`< -5.0`). */
  readonly yieldDeltaPp: number;
  /** Pooled two-proportion z-statistic on first-pass results (`>= 3.0`). */
  readonly twoProportionZ: number;
  readonly excessFailCount: number;
  /** `excessFailCount / totalLotFirstPassFailingDies` in `[0, 1]`. */
  readonly excessFailShare: number;
  /** Deterministic heuristic score rounded to 2 decimals in `[0.65, 0.99]`. */
  readonly confidence: number;
  /** Die indices where `firstSiteIndex === site.siteIndex && firstPass === 0`. */
  readonly failingDieIndices: Uint32Array;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function buildYieldMetrics(
  testedDies: number,
  firstPassTestedDies: number,
  firstPassDies: number,
  finalPassDies: number,
  retestExecutions: number,
): YieldMetrics {
  return {
    testedDies,
    firstPassTestedDies,
    firstPassDies,
    firstPassFailDies: firstPassTestedDies - firstPassDies,
    finalPassDies,
    finalFailDies: testedDies - finalPassDies,
    retestExecutions,
    firstPassYield: firstPassTestedDies > 0 ? firstPassDies / firstPassTestedDies : null,
    finalYield: testedDies > 0 ? finalPassDies / testedDies : null,
  };
}

/**
 * Computes tested, first-pass, final-pass, fail, and retest execution metrics
 * at overall Lot, per-Wafer, and per-Test-Site granularity in a single linear pass
 * over `LotModel.dies` (optionally filtered by `selectionMask`).
 *
 * **Per-Test-Site Dual Partitioning Semantics (`bySite`):**
 * - **Per-site first-pass yield** (`firstPassTestedDies`, `firstPassDies`, `firstPassFailDies`,
 *   `firstPassYield`) is partitioned by `ColumnarDies.firstSiteIndex` — the Test Site of each
 *   Die's chronologically **first** `PRR`. In ATE failure triage, a degraded probe card site,
 *   dirty contactor socket, or faulty tester channel must be judged by the dies *it* tested
 *   first; if a die fails first pass on Site 1 and later passes retest on Site 2, Site 1's
 *   first-pass yield counts it as a fail rather than transferring the failure to Site 2.
 * - **Per-site final yield** (`testedDies`, `finalPassDies`, `finalFailDies`,
 *   `retestExecutions`, `finalYield`) remains partitioned by `ColumnarDies.siteIndex` — the
 *   Test Site of each Die's chronologically **last** `PRR`, reflecting final bin disposition
 *   by closing site.
 * - At `overall` and `byWafer` granularity, every resolved Die stays on a single Wafer across
 *   retests, so `firstPassTestedDies === testedDies`.
 */
export function computeYieldSummary(
  lot: LotModel,
  selectionMask?: Uint8Array,
): YieldSummary {
  const { dies, wafers, sites } = lot;
  const dieCount = dies.count;
  const waferCount = wafers.length;
  const siteCount = sites.length;

  let overallTested = 0;
  let overallFirstPass = 0;
  let overallFinalPass = 0;
  let overallRetest = 0;

  const waferTested = new Float64Array(waferCount);
  const waferFirstPass = new Float64Array(waferCount);
  const waferFinalPass = new Float64Array(waferCount);
  const waferRetest = new Float64Array(waferCount);

  const siteFirstTested = new Float64Array(siteCount);
  const siteFirstPass = new Float64Array(siteCount);
  const siteFinalTested = new Float64Array(siteCount);
  const siteFinalPass = new Float64Array(siteCount);
  const siteRetest = new Float64Array(siteCount);

  const waferIndexArr = dies.waferIndex;
  const firstSiteIndexArr = dies.firstSiteIndex;
  const siteIndexArr = dies.siteIndex;
  const firstPassArr = dies.firstPass;
  const finalPassArr = dies.finalPass;
  const retestArr = dies.retestCount;

  const hasMask = selectionMask !== undefined;
  const maskLen = selectionMask ? selectionMask.length : 0;

  for (let i = 0; i < dieCount; i += 1) {
    if (hasMask && (i >= maskLen || selectionMask![i] === 0)) {
      continue;
    }

    const fp = firstPassArr[i]! !== 0 ? 1 : 0;
    const fin = finalPassArr[i]! !== 0 ? 1 : 0;
    const rt = retestArr[i]!;
    const w = waferIndexArr[i]!;
    const fs = firstSiteIndexArr[i]!;
    const ls = siteIndexArr[i]!;

    overallTested += 1;
    overallFirstPass += fp;
    overallFinalPass += fin;
    overallRetest += rt;

    if (w < waferCount) {
      waferTested[w] += 1;
      waferFirstPass[w] += fp;
      waferFinalPass[w] += fin;
      waferRetest[w] += rt;
    }

    if (fs < siteCount) {
      siteFirstTested[fs] += 1;
      siteFirstPass[fs] += fp;
    }

    if (ls < siteCount) {
      siteFinalTested[ls] += 1;
      siteFinalPass[ls] += fin;
      siteRetest[ls] += rt;
    }
  }

  const byWafer: YieldMetrics[] = new Array<YieldMetrics>(waferCount);
  for (let w = 0; w < waferCount; w += 1) {
    const wt = waferTested[w]!;
    byWafer[w] = buildYieldMetrics(
      wt,
      wt,
      waferFirstPass[w]!,
      waferFinalPass[w]!,
      waferRetest[w]!,
    );
  }

  const bySite: YieldMetrics[] = new Array<YieldMetrics>(siteCount);
  for (let s = 0; s < siteCount; s += 1) {
    bySite[s] = buildYieldMetrics(
      siteFinalTested[s]!,
      siteFirstTested[s]!,
      siteFirstPass[s]!,
      siteFinalPass[s]!,
      siteRetest[s]!,
    );
  }

  return {
    overall: buildYieldMetrics(
      overallTested,
      overallTested,
      overallFirstPass,
      overallFinalPass,
      overallRetest,
    ),
    byWafer,
    bySite,
  };
}

function computeSiteAnomalyConfidence(
  twoProportionZ: number,
  yieldDeltaPp: number,
  excessFailShare: number,
): number {
  const zTerm = clamp01((twoProportionZ - 3.0) / 12.0);
  const extremeZTerm = clamp01((twoProportionZ - 60.0) / 60.0);
  const deltaTerm = clamp01((Math.abs(yieldDeltaPp) - 5.0) / 25.0);
  const shareTerm = clamp01(excessFailShare / 0.75);

  const raw =
    0.65 + 0.15 * zTerm + 0.1 * deltaTerm + 0.06 * shareTerm + 0.02 * extremeZTerm;
  const rounded = Math.round(raw * 100) / 100;
  return Math.min(
    SITE_ANOMALY_THRESHOLDS.CONFIDENCE_MAX,
    Math.max(SITE_ANOMALY_THRESHOLDS.CONFIDENCE_MIN, rounded),
  );
}

/**
 * Flags Test Sites exhibiting statistically and practically significant first-pass
 * yield drops per Requirement 7.4:
 * - Evaluates **first-pass** results partitioned by `ColumnarDies.firstSiteIndex`
 *   (the site of each Die's chronologically first `PRR`), so cross-site or same-site
 *   retest recovery cannot mask degraded probe needles, sockets, or tester channels
 * - At least 2 Test Sites in the Lot have `firstPassTestedDies >= 30`
 * - Candidate Test Site has `firstPassTestedDies >= 30`
 * - Candidate `firstPassYield` is strictly more than `5.0` percentage points below the
 *   pooled first-pass yield of all other Test Sites (`yieldDeltaPp < -5.0`)
 * - Pooled two-proportion z-statistic satisfies `twoProportionZ >= 3.0`
 *
 * Returned anomalies are sorted deterministically by `excessFailCount` descending,
 * then `twoProportionZ` descending, then `site.siteIndex` ascending.
 */
export function detectSiteAnomalies(
  lot: LotModel,
  selectionMask?: Uint8Array,
): readonly SiteAnomalyFactInput[] {
  const summary = computeYieldSummary(lot, selectionMask);
  const { overall, bySite } = summary;

  if (overall.firstPassTestedDies === 0 || overall.firstPassFailDies === 0) {
    return [];
  }

  let qualifyingSiteCount = 0;
  for (let s = 0; s < bySite.length; s += 1) {
    if (bySite[s]!.firstPassTestedDies >= SITE_ANOMALY_THRESHOLDS.MIN_SITE_TESTED_DIES) {
      qualifyingSiteCount += 1;
    }
  }

  if (qualifyingSiteCount < SITE_ANOMALY_THRESHOLDS.MIN_QUALIFYING_SITES) {
    return [];
  }

  const pooledPassRate = overall.firstPassDies / overall.firstPassTestedDies;
  if (pooledPassRate <= 0 || pooledPassRate >= 1) {
    return [];
  }

  const dieCount = lot.dies.count;
  const firstSiteIndexArr = lot.dies.firstSiteIndex;
  const firstPassArr = lot.dies.firstPass;
  const hasMask = selectionMask !== undefined;
  const maskLen = selectionMask ? selectionMask.length : 0;

  const anomalies: SiteAnomalyFactInput[] = [];

  for (let s = 0; s < bySite.length; s += 1) {
    const siteMetrics = bySite[s]!;
    const siteTested = siteMetrics.firstPassTestedDies;
    if (
      siteTested < SITE_ANOMALY_THRESHOLDS.MIN_SITE_TESTED_DIES ||
      siteMetrics.firstPassYield === null
    ) {
      continue;
    }

    const otherTested = overall.firstPassTestedDies - siteTested;
    if (otherTested <= 0) {
      continue;
    }
    const sitePass = siteMetrics.firstPassDies;
    const siteFail = siteMetrics.firstPassFailDies;
    const otherPass = overall.firstPassDies - sitePass;
    const otherSitesFirstPassYield = otherPass / otherTested;
    const siteFirstPassYield = siteMetrics.firstPassYield;

    const denom = siteTested * otherTested;
    const exactNumPp =
      100 * (sitePass * otherTested - otherPass * siteTested);
    const yieldDeltaPp =
      Math.abs(exactNumPp) <= Number.MAX_SAFE_INTEGER && denom <= Number.MAX_SAFE_INTEGER
        ? exactNumPp / denom
        : (siteFirstPassYield - otherSitesFirstPassYield) * 100;

    if (!(yieldDeltaPp < -SITE_ANOMALY_THRESHOLDS.MIN_YIELD_DROP_PP)) {
      continue;
    }

    const se = Math.sqrt(
      pooledPassRate * (1 - pooledPassRate) * (1 / siteTested + 1 / otherTested),
    );
    if (!(se > 0)) {
      continue;
    }

    const twoProportionZ = (otherSitesFirstPassYield - siteFirstPassYield) / se;
    if (!(twoProportionZ >= SITE_ANOMALY_THRESHOLDS.MIN_TWO_PROPORTION_Z)) {
      continue;
    }

    const expectedFailsOnSite = siteTested * (1 - otherSitesFirstPassYield);
    const rawExcessFails = siteFail - expectedFailsOnSite;
    const excessFailCount = Math.max(
      1,
      Math.min(siteFail, Math.round(rawExcessFails)),
    );
    const excessFailShare = Math.min(
      1,
      Math.max(0, excessFailCount / overall.firstPassFailDies),
    );

    const failingDieIndices = new Uint32Array(siteFail);
    let writePos = 0;
    for (let i = 0; i < dieCount; i += 1) {
      if (hasMask && (i >= maskLen || selectionMask![i] === 0)) {
        continue;
      }
      if (firstSiteIndexArr[i] === s && firstPassArr[i] === 0) {
        failingDieIndices[writePos] = i;
        writePos += 1;
      }
    }

    const confidence = computeSiteAnomalyConfidence(
      twoProportionZ,
      yieldDeltaPp,
      excessFailShare,
    );

    anomalies.push({
      site: lot.sites[s]!,
      siteMetrics,
      otherSitesFirstPassYield,
      yieldDeltaPp,
      twoProportionZ,
      excessFailCount,
      excessFailShare,
      confidence,
      failingDieIndices:
        writePos === failingDieIndices.length
          ? failingDieIndices
          : failingDieIndices.subarray(0, writePos),
    });
  }

  anomalies.sort((a, b) => {
    if (b.excessFailCount !== a.excessFailCount) {
      return b.excessFailCount - a.excessFailCount;
    }
    if (b.twoProportionZ !== a.twoProportionZ) {
      return b.twoProportionZ - a.twoProportionZ;
    }
    return a.site.siteIndex - b.site.siteIndex;
  });

  return anomalies;
}
