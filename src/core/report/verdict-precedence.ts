/**
 * Deterministic 6-tier primary cause-of-death verdict selector
 * (`src/core/report/verdict-precedence.ts`).
 *
 * Implements the exact 6-tier precedence hierarchy (`Tiers 0–5`) specified in
 * `design.md` Section 3.5 to arbitrate between zero-failure lots, multi-site ATE
 * hardware concentration anomalies, multi-wafer spatial defect signatures, diluted
 * single-wafer excursions, spatially random defectivity, and sub-threshold baseline loss.
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 7.4, 9.1, 10.1, 10.2, 10.3, 17.4, 17.7
 */

import {
  computeYieldSummary,
  type SiteAnomalyFactInput,
  type YieldSummary,
} from '../analytics/yield-summary';
import type { BinMode, LotModel } from '../model/types';
import type { Wm811kClass } from '../patterns/root-causes';
import type { PatternClassification } from '../patterns/wm811k-classifier';
import {
  findQualifyingWaferExcursions,
  formatFixed2,
  formatRatioPct1,
  normalizeDieIndices,
  type QualifyingWaferExcursion,
  STRUCTURED_SPATIAL_CLASSES,
  sanitizeReportProseText,
  selectFailingBinRanking,
  WAFER_EXCURSION_THRESHOLDS,
} from './engine-facts';

export type VerdictTier = 0 | 1 | 2 | 3 | 4 | 5;

export type VerdictKind =
  | 'no-failure'
  | 'site-anomaly'
  | 'spatial-pattern'
  | 'wafer-excursion'
  | 'random-defect'
  | 'baseline-loss';

export const VERDICT_PRECEDENCE_THRESHOLDS = {
  /** Site anomaly overrides structured spatial patterns when excessFailShare >= 0.50. */
  SITE_OVERRIDE_EXCESS_FAIL_SHARE: 0.5,
  /** Diluted single-wafer excursion minimum classifier confidence (`design.md` 3.5 Tier 3). */
  WAFER_EXCURSION_MIN_CONFIDENCE: WAFER_EXCURSION_THRESHOLDS.MIN_CONFIDENCE,
  /** Diluted single-wafer excursion minimum share of total lot failures (`design.md` 3.5 Tier 3). */
  WAFER_EXCURSION_MIN_LOT_FAIL_SHARE: WAFER_EXCURSION_THRESHOLDS.MIN_LOT_FAIL_SHARE,
} as const;

export interface DominantBinSelection {
  readonly mode: BinMode;
  readonly code: number;
  readonly name: string;
  readonly count: number;
  readonly factId: string;
}

export interface AutopsyVerdictDecision {
  readonly tier: VerdictTier;
  readonly kind: VerdictKind;
  /** Verdict phrase in `Cause of death: <verdict> (confidence <0.00>)...`. */
  readonly verdict: string;
  /** Rounded 2-decimal confidence score in `[0, 1]`. */
  readonly confidence: number;
  /** Final lot yield ratio in `[0, 1]`. */
  readonly finalYield: number;
  readonly testedDies: number;
  readonly totalFailDies: number;
  /** Dominant failing bin (`null` if and only if `tier === 0` / `totalFailDies === 0`). */
  readonly dominantBin: DominantBinSelection | null;
  /** Canonical `EngineFact.factId`s cited by the cause-of-death headline. */
  readonly citedFactIds: readonly string[];
  /** Exact cause-of-death sentence conforming to Requirement 10.1. */
  readonly headlineText: string;
  /** Active WM-811K class when `kind` is `'spatial-pattern'` or `'random-defect'`. */
  readonly spatialPattern?: Wm811kClass;
  /** Winning site-concentration anomaly when `tier === 1`. */
  readonly siteAnomaly?: SiteAnomalyFactInput;
  /** Winning diluted single-wafer excursion when `tier === 3`. */
  readonly waferExcursion?: QualifyingWaferExcursion;
}

/**
 * Returns `true` when `pattern` is one of the 7 structured WM-811K spatial classes
 * (`Center`, `Donut`, `Edge-Loc`, `Edge-Ring`, `Loc`, `Near-full`, `Scratch`).
 */
export function isStructuredWm811kPattern(pattern: Wm811kClass): boolean {
  return STRUCTURED_SPATIAL_CLASSES.has(pattern);
}

/**
 * Selects the dominant failing bin for Tiers 1–5 (`SBIN` whenever any failing die
 * has `sbin !== 65535`, else `HBIN`; ties broken by lowest numeric code).
 * Returns `null` when `totalFailDies === 0`.
 */
export function selectDominantFailingBin(lot: LotModel): DominantBinSelection | null {
  const ranked = selectFailingBinRanking(lot);
  if (ranked.length === 0) {
    return null;
  }
  const top = ranked[0]!;
  return {
    mode: top.mode,
    code: top.code,
    name: top.name,
    count: top.count,
    factId: top.factId,
  };
}

function formatFailingHeadline(
  verdict: string,
  confidence: number,
  finalYield: number,
  dominantBin: DominantBinSelection,
): string {
  return `Cause of death: ${verdict} (confidence ${formatFixed2(confidence)}). Yield ${formatRatioPct1(finalYield)}, most loss in ${dominantBin.mode} ${dominantBin.code}.`;
}

function selectTopValidSiteAnomaly(
  siteAnomalies: readonly SiteAnomalyFactInput[],
  totalDies: number,
): SiteAnomalyFactInput | null {
  if (siteAnomalies.length === 0 || totalDies <= 0) {
    return null;
  }

  // `detectSiteAnomalies` already sorts by excessFailCount desc, twoProportionZ desc,
  // siteIndex asc; re-apply deterministic sort defensively for arbitrary caller arrays.
  const valid = siteAnomalies.filter(
    (a) => normalizeDieIndices(a.failingDieIndices, totalDies).length > 0,
  );
  if (valid.length === 0) {
    return null;
  }

  valid.sort((a, b) => {
    if (b.excessFailCount !== a.excessFailCount) {
      return b.excessFailCount - a.excessFailCount;
    }
    if (b.twoProportionZ !== a.twoProportionZ) {
      return b.twoProportionZ - a.twoProportionZ;
    }
    return a.site.siteIndex - b.site.siteIndex;
  });

  return valid[0]!;
}

/**
 * Applies the 6-tier deterministic verdict precedence rule (`design.md` Section 3.5):
 *
 * - **Tier 0**: `totalFailDies === 0` -> `"No failure pattern detected"` (`confidence 1.00`),
 *   cites `fact:lot-yield`, omits bin clause (`Yield 100.0%.`).
 * - **Tier 1**: Top site anomaly exists AND (`primarySpatial` is `'Random'`/`'None'` OR
 *   `excessFailShare >= 0.50`) -> `"Test Site <head>:<site> concentration anomaly"`,
 *   cites `fact:site:<head>-<site>` and `fact:bin:<dominant>`.
 * - **Tier 2**: `primarySpatial.pattern` is structured (`Center`, `Donut`, `Edge-Loc`,
 *   `Edge-Ring`, `Loc`, `Near-full`, `Scratch`) -> `"<pattern> failure"`,
 *   cites `fact:spatial:primary` and `fact:bin:<dominant>`.
 * - **Tier 3**: Multi-wafer lot (`wafers.length >= 2`) with qualifying single-wafer
 *   structured excursion (`confidence >= 0.70`, `>= 25%` of lot fails) while stacked map
 *   is `'Random'`/`'None'` -> `"<pattern> excursion on Wafer <waferId>"`,
 *   cites `fact:wafer-excursion:<waferIndex>` and `fact:bin:<dominant>`.
 * - **Tier 4**: `primarySpatial.pattern === 'Random'` -> `"Random defect failure"`,
 *   cites `fact:spatial:primary` and `fact:bin:<dominant>`.
 * - **Tier 5**: Fallback (`totalFailDies >= 1` and `primarySpatial.pattern === 'None'`) ->
 *   `"Baseline low-density loss"`, cites `fact:lot-yield` and `fact:bin:<dominant>`.
 */
export function selectPrimaryVerdict(
  lot: LotModel,
  primarySpatial: PatternClassification,
  perWaferPatterns: readonly PatternClassification[],
  siteAnomalies: readonly SiteAnomalyFactInput[],
  yieldSummary?: YieldSummary,
): AutopsyVerdictDecision {
  const resolvedYield = yieldSummary ?? computeYieldSummary(lot);
  const { overall } = resolvedYield;
  const testedDies = overall.testedDies;
  const totalFailDies = overall.finalFailDies;

  // Tier 0 — Zero Failing Dies
  if (totalFailDies === 0) {
    const cleanFinalYield = testedDies > 0 ? 1.0 : 0.0;
    const verdict = 'No failure pattern detected';
    const confidence = 1.0;
    return {
      tier: 0,
      kind: 'no-failure',
      verdict,
      confidence,
      finalYield: cleanFinalYield,
      testedDies,
      totalFailDies: 0,
      dominantBin: null,
      citedFactIds: ['fact:lot-yield'],
      headlineText: `Cause of death: ${verdict} (confidence 1.00). Yield ${formatRatioPct1(cleanFinalYield)}.`,
    };
  }

  const finalYield = overall.finalYield ?? 0;
  const dominantBin = selectDominantFailingBin(lot);
  if (dominantBin === null) {
    // Unreachable whenever `totalFailDies >= 1` because every die carries an HBIN (0..65535).
    throw new Error(
      'Invariant violation: Lot has final failing dies but no dominant failing bin.',
    );
  }

  const topSiteAnomaly = selectTopValidSiteAnomaly(siteAnomalies, lot.dies.count);

  // Tier 1 — Dominant Test-Site Hardware Anomaly
  if (
    topSiteAnomaly !== null &&
    (primarySpatial.pattern === 'Random' ||
      primarySpatial.pattern === 'None' ||
      topSiteAnomaly.excessFailShare >=
        VERDICT_PRECEDENCE_THRESHOLDS.SITE_OVERRIDE_EXCESS_FAIL_SHARE)
  ) {
    const { headNum, siteNum } = topSiteAnomaly.site;
    const verdict = `Test Site ${headNum}:${siteNum} concentration anomaly`;
    const confidence = topSiteAnomaly.confidence;
    const siteFactId = `fact:site:${headNum}-${siteNum}`;
    return {
      tier: 1,
      kind: 'site-anomaly',
      verdict,
      confidence,
      finalYield,
      testedDies,
      totalFailDies,
      dominantBin,
      citedFactIds: [siteFactId, dominantBin.factId],
      headlineText: formatFailingHeadline(verdict, confidence, finalYield, dominantBin),
      siteAnomaly: topSiteAnomaly,
    };
  }

  // Tier 2 — Structured Primary Spatial Signature
  if (isStructuredWm811kPattern(primarySpatial.pattern)) {
    const verdict = `${primarySpatial.pattern} failure`;
    const confidence = primarySpatial.confidence;
    return {
      tier: 2,
      kind: 'spatial-pattern',
      verdict,
      confidence,
      finalYield,
      testedDies,
      totalFailDies,
      dominantBin,
      citedFactIds: ['fact:spatial:primary', dominantBin.factId],
      headlineText: formatFailingHeadline(verdict, confidence, finalYield, dominantBin),
      spatialPattern: primarySpatial.pattern,
    };
  }

  // Tier 3 — Diluted Single-Wafer Excursion (Multi-Wafer Lots)
  if (lot.wafers.length >= 2) {
    const excursions = findQualifyingWaferExcursions(
      lot,
      perWaferPatterns,
      resolvedYield,
    );
    if (excursions.length > 0) {
      const topExcursion = excursions[0]!;
      const cleanWaferId =
        sanitizeReportProseText(topExcursion.wafer.waferId) ||
        `W${String(topExcursion.wafer.waferIndex + 1).padStart(2, '0')}`;
      const verdict = `${topExcursion.classification.pattern} excursion on Wafer ${cleanWaferId}`;
      const confidence = topExcursion.classification.confidence;
      const excursionFactId = `fact:wafer-excursion:${topExcursion.wafer.waferIndex}`;
      return {
        tier: 3,
        kind: 'wafer-excursion',
        verdict,
        confidence,
        finalYield,
        testedDies,
        totalFailDies,
        dominantBin,
        citedFactIds: [excursionFactId, dominantBin.factId],
        headlineText: formatFailingHeadline(
          verdict,
          confidence,
          finalYield,
          dominantBin,
        ),
        waferExcursion: topExcursion,
      };
    }
  }

  // Tier 4 — Unclustered Spatial Random Loss
  if (primarySpatial.pattern === 'Random') {
    const verdict = 'Random defect failure';
    const confidence = primarySpatial.confidence;
    return {
      tier: 4,
      kind: 'random-defect',
      verdict,
      confidence,
      finalYield,
      testedDies,
      totalFailDies,
      dominantBin,
      citedFactIds: ['fact:spatial:primary', dominantBin.factId],
      headlineText: formatFailingHeadline(verdict, confidence, finalYield, dominantBin),
      spatialPattern: 'Random',
    };
  }

  // Tier 5 — Sub-Threshold Baseline Loss (`totalFailDies >= 1` and `primarySpatial.pattern === 'None'`)
  const verdict = 'Baseline low-density loss';
  const confidence = primarySpatial.confidence;
  return {
    tier: 5,
    kind: 'baseline-loss',
    verdict,
    confidence,
    finalYield,
    testedDies,
    totalFailDies,
    dominantBin,
    citedFactIds: ['fact:lot-yield', dominantBin.factId],
    headlineText: formatFailingHeadline(verdict, confidence, finalYield, dominantBin),
    spatialPattern: 'None',
  };
}
