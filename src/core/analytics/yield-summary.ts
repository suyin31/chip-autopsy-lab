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
  readonly testedDies: number;
  readonly firstPassDies: number;
  readonly finalPassDies: number;
  readonly finalFailDies: number;
  readonly retestExecutions: number;
  /** Ratio in `[0, 1]`, or `null` when `testedDies === 0` (never `NaN` or `±Infinity`). */
  readonly firstPassYield: number | null;
  /** Ratio in `[0, 1]`, or `null` when `testedDies === 0` (never `NaN` or `±Infinity`). */
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
  readonly otherSitesFinalYield: number;
  /** Negative percentage-point delta (`< -5.0`). */
  readonly yieldDeltaPp: number;
  /** Pooled two-proportion z-statistic (`>= 3.0`). */
  readonly twoProportionZ: number;
  readonly excessFailCount: number;
  /** `excessFailCount / totalLotFailingDies` in `[0, 1]`. */
  readonly excessFailShare: number;
  /** Deterministic heuristic score rounded to 2 decimals in `[0.65, 0.99]`. */
  readonly confidence: number;
  readonly failingDieIndices: Uint32Array;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function buildYieldMetrics(
  testedDies: number,
  firstPassDies: number,
  finalPassDies: number,
  retestExecutions: number,
): YieldMetrics {
  if (testedDies === 0) {
    return {
      testedDies: 0,
      firstPassDies: 0,
      finalPassDies: 0,
      finalFailDies: 0,
      retestExecutions: 0,
      firstPassYield: null,
      finalYield: null,
    };
  }

  return {
    testedDies,
    firstPassDies,
    finalPassDies,
    finalFailDies: testedDies - finalPassDies,
    retestExecutions,
    firstPassYield: firstPassDies / testedDies,
    finalYield: finalPassDies / testedDies,
  };
}

/**
 * Computes tested, first-pass, final-pass, final-fail, and retest execution metrics
 * at overall Lot, per-Wafer, and per-Test-Site granularity in a single linear pass
 * over `LotModel.dies` (optionally filtered by `selectionMask`).
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

  const siteTested = new Float64Array(siteCount);
  const siteFirstPass = new Float64Array(siteCount);
  const siteFinalPass = new Float64Array(siteCount);
  const siteRetest = new Float64Array(siteCount);

  const waferIndexArr = dies.waferIndex;
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
    const s = siteIndexArr[i]!;

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

    if (s < siteCount) {
      siteTested[s] += 1;
      siteFirstPass[s] += fp;
      siteFinalPass[s] += fin;
      siteRetest[s] += rt;
    }
  }

  const byWafer: YieldMetrics[] = new Array<YieldMetrics>(waferCount);
  for (let w = 0; w < waferCount; w += 1) {
    byWafer[w] = buildYieldMetrics(
      waferTested[w]!,
      waferFirstPass[w]!,
      waferFinalPass[w]!,
      waferRetest[w]!,
    );
  }

  const bySite: YieldMetrics[] = new Array<YieldMetrics>(siteCount);
  for (let s = 0; s < siteCount; s += 1) {
    bySite[s] = buildYieldMetrics(
      siteTested[s]!,
      siteFirstPass[s]!,
      siteFinalPass[s]!,
      siteRetest[s]!,
    );
  }

  return {
    overall: buildYieldMetrics(
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
 * Flags Test Sites exhibiting statistically and practically significant yield drops
 * per Requirement 7.4:
 * - At least 2 Test Sites in the Lot have `>= 30` tested Dies each
 * - Candidate Test Site has `>= 30` tested Dies
 * - Candidate Final Yield is strictly more than `5.0` percentage points below the
 *   pooled Final Yield of all other Test Sites (`yieldDeltaPp < -5.0`)
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

  if (overall.testedDies === 0 || overall.finalFailDies === 0) {
    return [];
  }

  let qualifyingSiteCount = 0;
  for (let s = 0; s < bySite.length; s += 1) {
    if (bySite[s]!.testedDies >= SITE_ANOMALY_THRESHOLDS.MIN_SITE_TESTED_DIES) {
      qualifyingSiteCount += 1;
    }
  }

  if (qualifyingSiteCount < SITE_ANOMALY_THRESHOLDS.MIN_QUALIFYING_SITES) {
    return [];
  }

  const pooledPassRate = overall.finalPassDies / overall.testedDies;
  if (pooledPassRate <= 0 || pooledPassRate >= 1) {
    return [];
  }

  const dieCount = lot.dies.count;
  const siteIndexArr = lot.dies.siteIndex;
  const finalPassArr = lot.dies.finalPass;
  const hasMask = selectionMask !== undefined;
  const maskLen = selectionMask ? selectionMask.length : 0;

  const anomalies: SiteAnomalyFactInput[] = [];

  for (let s = 0; s < bySite.length; s += 1) {
    const siteMetrics = bySite[s]!;
    if (
      siteMetrics.testedDies < SITE_ANOMALY_THRESHOLDS.MIN_SITE_TESTED_DIES ||
      siteMetrics.finalYield === null
    ) {
      continue;
    }

    const otherTested = overall.testedDies - siteMetrics.testedDies;
    if (otherTested <= 0) {
      continue;
    }
    const otherPass = overall.finalPassDies - siteMetrics.finalPassDies;
    const otherSitesFinalYield = otherPass / otherTested;
    const siteFinalYield = siteMetrics.finalYield;

    const denom = siteMetrics.testedDies * otherTested;
    const exactNumPp =
      100 * (siteMetrics.finalPassDies * otherTested - otherPass * siteMetrics.testedDies);
    const yieldDeltaPp =
      Math.abs(exactNumPp) <= Number.MAX_SAFE_INTEGER && denom <= Number.MAX_SAFE_INTEGER
        ? exactNumPp / denom
        : (siteFinalYield - otherSitesFinalYield) * 100;

    if (!(yieldDeltaPp < -SITE_ANOMALY_THRESHOLDS.MIN_YIELD_DROP_PP)) {
      continue;
    }

    const se = Math.sqrt(
      pooledPassRate *
        (1 - pooledPassRate) *
        (1 / siteMetrics.testedDies + 1 / otherTested),
    );
    if (!(se > 0)) {
      continue;
    }

    const twoProportionZ = (otherSitesFinalYield - siteFinalYield) / se;
    if (!(twoProportionZ >= SITE_ANOMALY_THRESHOLDS.MIN_TWO_PROPORTION_Z)) {
      continue;
    }

    const expectedFailsOnSite = siteMetrics.testedDies * (1 - otherSitesFinalYield);
    const rawExcessFails = siteMetrics.finalFailDies - expectedFailsOnSite;
    const excessFailCount = Math.max(
      1,
      Math.min(siteMetrics.finalFailDies, Math.round(rawExcessFails)),
    );
    const excessFailShare = Math.min(
      1,
      Math.max(0, excessFailCount / overall.finalFailDies),
    );

    const failingDieIndices = new Uint32Array(siteMetrics.finalFailDies);
    let writePos = 0;
    for (let i = 0; i < dieCount; i += 1) {
      if (hasMask && (i >= maskLen || selectionMask![i] === 0)) {
        continue;
      }
      if (siteIndexArr[i] === s && finalPassArr[i] === 0) {
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
      otherSitesFinalYield,
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
