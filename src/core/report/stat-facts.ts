/**
 * Deterministic 3-item verdict stat selector and localized formatter
 * (`src/core/report/stat-facts.ts`).
 *
 * Implements `redesign.md` §3.4, §3.6, §4.5, and §6.8:
 * - Always returns a 3-tuple of `StatFact` items (`{ value, format, captionKey, params, emphasis }`).
 * - Selects the lead diagnostic stat from the primary verdict type (`Edge-Ring`,
 *   `Scratch`, `site-anomaly`, or general yield/failure summary).
 * - Emphasizes (`emphasis: true`) at most one key failure number per screen, and
 *   zero numbers when the lot is healthy (`tier === 0`, `totalFailDies === 0`, or
 *   sub-threshold baseline loss with `finalYield >= 0.99`).
 * - Supports selection-linked recomputation (`selectionMask`) with `stats.inSelection`.
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 */

import { computeYieldSummary, type YieldSummary } from '../analytics/yield-summary';
import { formatInteger, formatPercent, type Locale, t } from '../i18n';
import type { LotModel } from '../model/types';
import { CLASSIFIER_THRESHOLDS } from '../patterns/wm811k-classifier';
import {
  analyzeLotForReport,
  computeSpatialDieBreakdown,
  type LotAnalysisBundle,
} from './engine-facts';
import {
  type AutopsyVerdictDecision,
  selectPrimaryVerdict,
} from './verdict-precedence';

export type StatValueFormat = 'percent' | 'integer';

export type StatCaptionKey =
  | 'stats.edgeShare'
  | 'stats.scratchShare'
  | 'stats.siteRate'
  | 'stats.finalYield'
  | 'stats.failingDies';

export type StatParams = Readonly<Record<string, string | number>>;

/** Ignite order for a stat's evidence dies (same literals as the UI `ClaimGlowOrderMode`). */
export type StatEvidenceOrder = 'polar-cw' | 'principal-axis' | 'centroid-distance';

/**
 * Dies behind a stat number (premium §7.5: every number on the page is traceable). Activating a
 * stat lights these dies through the selection store.
 */
export interface StatEvidence {
  /** Stable highlight ID (`stat:<captionKey>`), unique within a stat tuple. */
  readonly claimId: string;
  readonly dieIndices: Uint32Array;
  readonly order: StatEvidenceOrder;
  readonly sites: ReadonlyArray<{ readonly headNum: number; readonly siteNum: number }>;
}

export interface StatFact {
  readonly value: number;
  readonly format: StatValueFormat;
  readonly captionKey: StatCaptionKey;
  readonly params: StatParams;
  /**
   * Lead diagnostic number. Kept for selection logic only; the UI never colours it
   * (premium §7.5, A4: stat numbers are never orange).
   */
  readonly emphasis: boolean;
  readonly inSelection?: boolean;
  readonly evidence: StatEvidence;
}

export type StatFactTuple = readonly [StatFact, StatFact, StatFact];

export interface RenderedStatFact {
  readonly valueText: string;
  readonly captionText: string;
  /** Optional second caption line (premium §7.5, e.g. "81.5% on the first test"). */
  readonly captionSecondaryText: string | null;
  /** Caption message key; the UI picks the caption's glossary terms from it (premium §2.2). */
  readonly captionKey: StatCaptionKey;
  readonly evidence: StatEvidence;
  readonly emphasis: boolean;
  readonly numericValue: number;
  readonly format: StatValueFormat;
}

export type RenderedStatFactTuple = readonly [
  RenderedStatFact,
  RenderedStatFact,
  RenderedStatFact,
];

export interface BuildStatFactsOptions {
  readonly lot: LotModel;
  readonly verdict?: AutopsyVerdictDecision;
  readonly analysis?: LotAnalysisBundle;
  readonly yieldSummary?: YieldSummary;
  /** Active selection mask (`1` = included) when a spatial brush or filter is active (§3.6). */
  readonly selectionMask?: Uint8Array | null;
}

export function boundedStatRatio(numerator: number, denominator: number): number {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    numerator <= 0
  ) {
    return 0;
  }
  if (numerator >= denominator) {
    return 1;
  }
  const raw = numerator / denominator;
  return Math.min(0.999, Math.max(0.001, raw));
}

export function resolveSiteDisplayToken(
  lot: LotModel,
  headNum: number,
  siteNum: number,
): number | string {
  let distinctHead = -1;
  let multiHead = false;
  for (let i = 0; i < lot.sites.length; i += 1) {
    const h = lot.sites[i]!.headNum;
    if (distinctHead === -1) {
      distinctHead = h;
    } else if (distinctHead !== h) {
      multiHead = true;
      break;
    }
  }
  return multiHead ? `${headNum}:${siteNum}` : siteNum;
}

export function isHealthyVerdictDecision(
  verdict: AutopsyVerdictDecision,
): boolean {
  return (
    verdict.tier === 0 ||
    verdict.totalFailDies === 0 ||
    (verdict.tier === 5 && verdict.finalYield >= 0.99)
  );
}

interface ScopedCounts {
  readonly testedDies: number;
  readonly firstPassPassDies: number;
  readonly finalPassDies: number;
  readonly finalFailDies: number;
  readonly edgeBandFailDies: number;
  readonly finalFailIndices: Uint32Array;
  readonly edgeBandFailIndices: Uint32Array;
}

function computeScopedCounts(
  lot: LotModel,
  mask: Uint8Array | null | undefined,
): ScopedCounts {
  const { dies } = lot;
  const maxRing = CLASSIFIER_THRESHOLDS.EDGE_RING_BAND;
  let testedDies = 0;
  let firstPassPassDies = 0;
  let finalPassDies = 0;
  let finalFailDies = 0;
  let edgeBandFailDies = 0;
  const finalFailIndices: number[] = [];
  const edgeBandFailIndices: number[] = [];

  const total = dies.count;
  for (let i = 0; i < total; i += 1) {
    if (mask && mask[i] === 0) {
      continue;
    }
    testedDies += 1;
    if (dies.firstPass[i] !== 0) {
      firstPassPassDies += 1;
    }
    if (dies.finalPass[i] !== 0) {
      finalPassDies += 1;
    } else {
      finalFailDies += 1;
      finalFailIndices.push(i);
      if (
        dies.hasValidCoords[i] !== 0 &&
        dies.ringIndex[i]! >= 1 &&
        dies.ringIndex[i]! <= maxRing
      ) {
        edgeBandFailDies += 1;
        edgeBandFailIndices.push(i);
      }
    }
  }

  return {
    testedDies,
    firstPassPassDies,
    finalPassDies,
    finalFailDies,
    edgeBandFailDies,
    finalFailIndices: Uint32Array.from(finalFailIndices),
    edgeBandFailIndices: Uint32Array.from(edgeBandFailIndices),
  };
}

/** Dies whose first test failed on `targetSiteIndex` (the numerator of the site fail rate). */
function collectSiteFirstFailDies(
  lot: LotModel,
  targetSiteIndex: number,
  mask: Uint8Array | null | undefined,
): Uint32Array {
  const { dies } = lot;
  const out: number[] = [];
  for (let i = 0; i < dies.count; i += 1) {
    if (mask && mask[i] === 0) {
      continue;
    }
    if (dies.firstSiteIndex[i] === targetSiteIndex && dies.firstPass[i] === 0) {
      out.push(i);
    }
  }
  return Uint32Array.from(out);
}

function statEvidence(
  captionKey: StatCaptionKey,
  dieIndices: Uint32Array,
  order: StatEvidenceOrder,
  sites: StatEvidence['sites'] = [],
): StatEvidence {
  return { claimId: `stat:${captionKey}`, dieIndices, order, sites };
}

function computeSiteFailComparison(
  lot: LotModel,
  targetSiteIndex: number,
  mask: Uint8Array | null | undefined,
): { readonly siteFailRate: number; readonly otherFailRate: number } {
  const { dies } = lot;
  let siteTested = 0;
  let siteFailed = 0;
  let otherTested = 0;
  let otherFailed = 0;

  for (let i = 0; i < dies.count; i += 1) {
    if (mask && mask[i] === 0) {
      continue;
    }
    const isFirstFail = dies.firstPass[i] === 0;
    if (dies.firstSiteIndex[i] === targetSiteIndex) {
      siteTested += 1;
      if (isFirstFail) {
        siteFailed += 1;
      }
    } else {
      otherTested += 1;
      if (isFirstFail) {
        otherFailed += 1;
      }
    }
  }

  return {
    siteFailRate: boundedStatRatio(siteFailed, siteTested),
    otherFailRate: boundedStatRatio(otherFailed, otherTested),
  };
}

/**
 * Selects the 3 big-number stats for the verdict column (`redesign.md` §4.5).
 */
export function buildStatFacts(options: BuildStatFactsOptions): StatFactTuple {
  const { lot, selectionMask } = options;
  const resolvedAnalysis = options.analysis ?? analyzeLotForReport(lot);
  const resolvedYield = options.yieldSummary ?? resolvedAnalysis.yieldSummary ?? computeYieldSummary(lot);
  const resolvedVerdict =
    options.verdict ??
    selectPrimaryVerdict(
      lot,
      resolvedAnalysis.primarySpatial,
      resolvedAnalysis.perWaferPatterns,
      resolvedAnalysis.siteAnomalies,
      resolvedYield,
    );

  const inSelection = selectionMask !== undefined && selectionMask !== null;
  const counts = computeScopedCounts(lot, selectionMask);

  const finalYieldRatio =
    counts.testedDies > 0 ? counts.finalPassDies / counts.testedDies : 0;
  const firstPassYieldRatio =
    counts.testedDies > 0 ? counts.firstPassPassDies / counts.testedDies : 0;

  const isHealthy =
    isHealthyVerdictDecision(resolvedVerdict) || counts.finalFailDies === 0;

  const activePattern =
    resolvedVerdict.tier === 3 && resolvedVerdict.waferExcursion
      ? resolvedVerdict.waferExcursion.classification.pattern
      : (resolvedVerdict.spatialPattern ?? resolvedAnalysis.primarySpatial.pattern);

  const finalYieldStat: StatFact = {
    value: finalYieldRatio,
    format: 'percent',
    captionKey: 'stats.finalYield',
    params: { firstPass: firstPassYieldRatio },
    emphasis: false,
    ...(inSelection ? { inSelection: true } : {}),
    // Final yield traces to the dies that cost it (the final failing dies)
    evidence: statEvidence('stats.finalYield', counts.finalFailIndices, 'centroid-distance'),
  };

  const failingDiesStat = (emphasis: boolean): StatFact => ({
    value: counts.finalFailDies,
    format: 'integer',
    captionKey: 'stats.failingDies',
    params: { tested: counts.testedDies },
    emphasis: emphasis && !isHealthy,
    ...(inSelection ? { inSelection: true } : {}),
    evidence: statEvidence('stats.failingDies', counts.finalFailIndices, 'centroid-distance'),
  });

  // Case 1: Test-site concentration anomaly (Tier 1)
  if (resolvedVerdict.tier === 1 && resolvedVerdict.siteAnomaly) {
    const { site } = resolvedVerdict.siteAnomaly;
    const { siteFailRate, otherFailRate } = computeSiteFailComparison(
      lot,
      site.siteIndex,
      selectionMask,
    );
    const siteToken = resolveSiteDisplayToken(lot, site.headNum, site.siteNum);
    const leadSiteStat: StatFact = {
      value: siteFailRate,
      format: 'percent',
      captionKey: 'stats.siteRate',
      params: { site: siteToken, other: otherFailRate },
      emphasis: !isHealthy,
      ...(inSelection ? { inSelection: true } : {}),
      evidence: statEvidence(
        'stats.siteRate',
        collectSiteFirstFailDies(lot, site.siteIndex, selectionMask),
        'centroid-distance',
        [{ headNum: site.headNum, siteNum: site.siteNum }],
      ),
    };
    return [leadSiteStat, finalYieldStat, failingDiesStat(false)];
  }

  // Case 2: Edge-Ring (or Edge-Loc with outer-band failures)
  if (
    activePattern === 'Edge-Ring' ||
    (activePattern === 'Edge-Loc' && counts.edgeBandFailDies > 0)
  ) {
    const edgeShare = boundedStatRatio(
      counts.edgeBandFailDies,
      counts.finalFailDies,
    );
    const leadEdgeStat: StatFact = {
      value: edgeShare,
      format: 'percent',
      captionKey: 'stats.edgeShare',
      params: { rings: CLASSIFIER_THRESHOLDS.EDGE_RING_BAND },
      emphasis: !isHealthy,
      ...(inSelection ? { inSelection: true } : {}),
      evidence: statEvidence('stats.edgeShare', counts.edgeBandFailIndices, 'polar-cw'),
    };
    return [leadEdgeStat, finalYieldStat, failingDiesStat(false)];
  }

  // Case 3: Scratch
  if (activePattern === 'Scratch') {
    const spatialSource =
      resolvedVerdict.tier === 3 && resolvedVerdict.waferExcursion
        ? resolvedVerdict.waferExcursion.classification
        : resolvedAnalysis.primarySpatial;
    const spatialBreakdown = computeSpatialDieBreakdown(lot, spatialSource);
    let scratchFailCount = 0;
    let scratchDies: Uint32Array;
    if (inSelection && selectionMask) {
      const inMask: number[] = [];
      for (let i = 0; i < spatialBreakdown.spatialDieIndices.length; i += 1) {
        const dieIdx = spatialBreakdown.spatialDieIndices[i]!;
        if (selectionMask[dieIdx] !== 0) {
          scratchFailCount += 1;
          inMask.push(dieIdx);
        }
      }
      scratchDies = Uint32Array.from(inMask);
    } else {
      scratchFailCount = spatialBreakdown.sigCount;
      scratchDies = spatialBreakdown.spatialDieIndices;
    }
    const scratchShare = boundedStatRatio(
      scratchFailCount,
      counts.finalFailDies,
    );
    const leadScratchStat: StatFact = {
      value: scratchShare,
      format: 'percent',
      captionKey: 'stats.scratchShare',
      params: {},
      emphasis: !isHealthy,
      ...(inSelection ? { inSelection: true } : {}),
      evidence: statEvidence('stats.scratchShare', scratchDies, 'principal-axis'),
    };
    return [leadScratchStat, finalYieldStat, failingDiesStat(false)];
  }

  // Case 4: Other spatial classes, Random defects, Baseline loss, or Healthy zero-fail
  let thirdStat: StatFact;
  if (lot.sites.length >= 2) {
    let worstSiteIdx = 0;
    let worstRate = -1;
    for (let s = 0; s < lot.sites.length; s += 1) {
      const cmp = computeSiteFailComparison(lot, lot.sites[s]!.siteIndex, selectionMask);
      if (cmp.siteFailRate > worstRate) {
        worstRate = cmp.siteFailRate;
        worstSiteIdx = s;
      }
    }
    const chosenSite = lot.sites[worstSiteIdx]!;
    const cmp = computeSiteFailComparison(
      lot,
      chosenSite.siteIndex,
      selectionMask,
    );
    const siteToken = resolveSiteDisplayToken(
      lot,
      chosenSite.headNum,
      chosenSite.siteNum,
    );
    thirdStat = {
      value: cmp.siteFailRate,
      format: 'percent',
      captionKey: 'stats.siteRate',
      params: { site: siteToken, other: cmp.otherFailRate },
      emphasis: false,
      ...(inSelection ? { inSelection: true } : {}),
      evidence: statEvidence(
        'stats.siteRate',
        collectSiteFirstFailDies(lot, chosenSite.siteIndex, selectionMask),
        'centroid-distance',
        [{ headNum: chosenSite.headNum, siteNum: chosenSite.siteNum }],
      ),
    };
  } else {
    const edgeShare = boundedStatRatio(
      counts.edgeBandFailDies,
      counts.finalFailDies,
    );
    thirdStat = {
      value: edgeShare,
      format: 'percent',
      captionKey: 'stats.edgeShare',
      params: { rings: CLASSIFIER_THRESHOLDS.EDGE_RING_BAND },
      emphasis: false,
      ...(inSelection ? { inSelection: true } : {}),
      evidence: statEvidence('stats.edgeShare', counts.edgeBandFailIndices, 'polar-cw'),
    };
  }

  return [finalYieldStat, failingDiesStat(true), thirdStat];
}

function formatStatCaption(stat: StatFact, locale: Locale): string {
  let baseCaption: string;
  switch (stat.captionKey) {
    case 'stats.edgeShare': {
      const rings = Number(stat.params.rings ?? CLASSIFIER_THRESHOLDS.EDGE_RING_BAND);
      baseCaption = t(locale, 'stats.edgeShare', {
        rings: formatInteger(locale, rings),
      });
      break;
    }
    case 'stats.scratchShare': {
      baseCaption = t(locale, 'stats.scratchShare');
      break;
    }
    case 'stats.siteRate': {
      const rawSite = stat.params.site ?? 1;
      const siteStr =
        typeof rawSite === 'number'
          ? formatInteger(locale, rawSite)
          : String(rawSite);
      const otherRatio = Number(stat.params.other ?? 0);
      baseCaption = t(locale, 'stats.siteRate', {
        site: siteStr,
        other: formatPercent(locale, otherRatio),
      });
      break;
    }
    case 'stats.finalYield': {
      baseCaption = t(locale, 'stats.finalYield');
      break;
    }
    case 'stats.failingDies': {
      const tested = Number(stat.params.tested ?? 0);
      baseCaption = t(locale, 'stats.failingDies', {
        tested: formatInteger(locale, tested),
      });
      break;
    }
  }

  return stat.inSelection
    ? t(locale, 'stats.inSelection', { caption: baseCaption })
    : baseCaption;
}

/** Second caption line (premium §7.5): final yield names the first-test yield under it. */
function formatStatSecondaryCaption(stat: StatFact, locale: Locale): string | null {
  if (stat.captionKey !== 'stats.finalYield') {
    return null;
  }
  return t(locale, 'stats.firstPass', {
    firstPass: formatPercent(locale, Number(stat.params.firstPass ?? 0)),
  });
}

/**
 * Formats a 3-tuple of `StatFact`s for `locale` using cached `Intl` formatters (`redesign.md` §6.5).
 */
export function renderStatFacts(
  stats: StatFactTuple,
  locale: Locale,
): RenderedStatFactTuple {
  const renderOne = (stat: StatFact): RenderedStatFact => ({
    valueText:
      stat.format === 'percent'
        ? formatPercent(locale, stat.value)
        : formatInteger(locale, stat.value),
    captionText: formatStatCaption(stat, locale),
    captionSecondaryText: formatStatSecondaryCaption(stat, locale),
    captionKey: stat.captionKey,
    evidence: stat.evidence,
    emphasis: stat.emphasis,
    numericValue: stat.value,
    format: stat.format,
  });

  return [renderOne(stats[0]), renderOne(stats[1]), renderOne(stats[2])];
}
