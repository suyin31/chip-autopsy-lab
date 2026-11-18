/**
 * Offline deterministic Autopsy Report generator (`src/core/report/template-report.ts`).
 *
 * Produces the verdict-first `AutopsyReport` (`causeOfDeathHeadline` + 2–4 clinical
 * `bodyClaims`) exclusively from deterministic `EngineFact`s and `AutopsyVerdictDecision`.
 * Every claim binds to valid `factId`s resolving to a non-empty, sorted `Uint32Array`
 * of `LotModel.dies` indices (`resolvedDieIndices`) and canonical `DieId`s
 * (`resolvedDieIds`), plus typed `messageKey` and raw `params` for deterministic
 * per-locale rendering via `renderReport(report, locale)` (`redesign.md` §6.9).
 *
 * Pure deterministic TypeScript with zero React, Next.js, network, or DOM imports.
 * Validates: Requirements 9.3, 10.1, 10.2, 10.3, 10.5, 17.4, 17.7
 */

import type { MessageKey } from '../i18n';
import type { BinMode, DieId, LotModel } from '../model/types';
import {
  formatPatternCandidateHypotheses,
  formatSiteConcentrationHypotheses,
} from '../patterns/root-causes';
import { CLASSIFIER_THRESHOLDS } from '../patterns/wm811k-classifier';
import {
  analyzeLotForReport,
  buildEngineFacts,
  capDisplayedConfidence,
  type EngineFact,
  formatGroupedInt,
  type LotAnalysisBundle,
  resolveDieIdsFromIndices,
  sanitizeReportProseText,
} from './engine-facts';
import {
  boundedStatRatio,
  isHealthyVerdictDecision,
  resolveSiteDisplayToken,
} from './stat-facts';
import {
  type AutopsyVerdictDecision,
  selectPrimaryVerdict,
} from './verdict-precedence';

export type ClaimParamValue = string | number;

export type ClaimParams = Readonly<Record<string, ClaimParamValue>>;

export type HypothesisTemplateId =
  | 'etchUniformity'
  | 'mechanical'
  | 'probeCard'
  | 'random';

export interface ReportHypothesisSpec {
  readonly id: HypothesisTemplateId;
  readonly titleKey:
    | 'hypothesis.etchUniformity'
    | 'hypothesis.mechanical'
    | 'hypothesis.probeCard'
    | 'hypothesis.random';
  readonly checkKey:
    | 'hypothesis.etchUniformity.check'
    | 'hypothesis.mechanical.check'
    | 'hypothesis.probeCard.check'
    | 'hypothesis.random.check';
  readonly params: ClaimParams;
}

export interface ReportClaim {
  readonly claimId: string;
  readonly text: string;
  readonly isHeadline: boolean;
  readonly messageKey: MessageKey;
  readonly subMessageKey?: MessageKey;
  readonly params: ClaimParams;
  readonly citedFactIds: readonly string[];
  /** Sorted ascending unique indices into `LotModel.dies`; guaranteed `length >= 1`. */
  readonly resolvedDieIndices: Uint32Array;
  /** Canonical `DieId`s matching `resolvedDieIndices` 1-to-1; guaranteed `length >= 1`. */
  readonly resolvedDieIds: readonly DieId[];
  readonly citedBins: ReadonlyArray<{ readonly mode: BinMode; readonly code: number }>;
  readonly citedTestNums: readonly number[];
  readonly citedSites: ReadonlyArray<{
    readonly headNum: number;
    readonly siteNum: number;
  }>;
}

export interface AutopsyReport {
  /** Cause-of-death headline strictly conforming to Requirement 10.1. */
  readonly causeOfDeathHeadline: ReportClaim;
  /** 2–4 concise clinical supporting claims grounded in `EngineFact`s. */
  readonly bodyClaims: readonly ReportClaim[];
  readonly source: 'deterministic-template' | 'llm-verified';
  readonly fallbackReason?: string;
  /** Verdict takeaway message key (`takeaway.*`, premium §9.3). Never names bin codes or test names. */
  readonly sublineKey?: TakeawayMessageKey;
  /** Raw numbers and untranslated tokens for `sublineKey`. */
  readonly sublineParams?: ClaimParams;
  /** WM-811K class behind the confidence score (`"Match with {pattern}"`, premium §7.4); absent for site and baseline verdicts. */
  readonly matchPattern?: string;
  /** Capped heuristic confidence score in `[0, 0.95]`. */
  readonly confidence?: number;
  /** Ordered 3 hedged hypotheses for the `"Possible causes"` disclosure (`redesign.md` §4.6). */
  readonly hypotheses?: readonly ReportHypothesisSpec[];
}

export interface OfflineAutopsyPipelineResult {
  readonly analysis: LotAnalysisBundle;
  readonly facts: readonly EngineFact[];
  readonly verdict: AutopsyVerdictDecision;
  readonly report: AutopsyReport;
}

export type TakeawayMessageKey =
  | 'takeaway.edgeRing'
  | 'takeaway.scratch'
  | 'takeaway.center'
  | 'takeaway.donut'
  | 'takeaway.edgeLoc'
  | 'takeaway.loc'
  | 'takeaway.nearFull'
  | 'takeaway.site'
  | 'takeaway.random'
  | 'takeaway.healthy';

const PATTERN_TAKEAWAY_KEYS: Readonly<Record<string, TakeawayMessageKey>> = {
  'Edge-Ring': 'takeaway.edgeRing',
  Scratch: 'takeaway.scratch',
  Center: 'takeaway.center',
  Donut: 'takeaway.donut',
  'Edge-Loc': 'takeaway.edgeLoc',
  Loc: 'takeaway.loc',
  'Near-full': 'takeaway.nearFull',
};

/**
 * Selects the plain-language verdict takeaway (premium §7.3, §9.3) and the WM-811K class
 * behind the confidence score. Params carry raw ratios and counts; `renderReport` formats them.
 */
export function resolveTakeawaySpec(
  lot: LotModel,
  verdict: AutopsyVerdictDecision,
  factsById: ReadonlyMap<string, EngineFact>,
): {
  readonly key: TakeawayMessageKey;
  readonly params: ClaimParams;
  readonly matchPattern?: string;
} {
  if (isHealthyVerdictDecision(verdict)) {
    return {
      key: 'takeaway.healthy',
      params: {
        passed: Math.max(0, verdict.testedDies - verdict.totalFailDies),
        total: verdict.testedDies,
      },
    };
  }

  const finalYield = verdict.finalYield;

  if (verdict.tier === 1 && verdict.siteAnomaly) {
    const { headNum, siteNum } = verdict.siteAnomaly.site;
    const siteFact = factsById.get(`fact:site:${headNum}-${siteNum}`);
    const fpYieldPct = getFactMetricValue(
      siteFact,
      'firstPassYieldPct',
      (verdict.siteAnomaly.siteMetrics.firstPassYield ?? 1) * 100,
    );
    const otherFpYieldPct = getFactMetricValue(
      siteFact,
      'otherSitesFirstPassYieldPct',
      verdict.siteAnomaly.otherSitesFirstPassYield * 100,
    );
    return {
      key: 'takeaway.site',
      params: {
        site: resolveSiteDisplayToken(lot, headNum, siteNum),
        rate: Math.min(1, Math.max(0, 1 - fpYieldPct / 100)),
        otherRate: Math.min(1, Math.max(0, 1 - otherFpYieldPct / 100)),
        yield: finalYield,
      },
    };
  }

  const isExcursion = verdict.tier === 3 && verdict.waferExcursion !== undefined;
  const pattern = isExcursion
    ? verdict.waferExcursion!.classification.pattern
    : verdict.tier === 2
      ? verdict.spatialPattern
      : undefined;
  const patternKey = pattern !== undefined ? PATTERN_TAKEAWAY_KEYS[pattern] : undefined;

  if (pattern !== undefined && patternKey !== undefined) {
    if (patternKey === 'takeaway.edgeRing') {
      return {
        key: patternKey,
        params: { rings: CLASSIFIER_THRESHOLDS.EDGE_RING_BAND, yield: finalYield },
        matchPattern: pattern,
      };
    }
    if (patternKey === 'takeaway.scratch') {
      const total = Math.max(1, lot.wafers.length);
      const count = isExcursion
        ? 1
        : getFactMetricValue(
            factsById.get('fact:spatial:primary'),
            'signatureWaferCount',
            total,
          );
      return {
        key: patternKey,
        params: { count: Math.min(total, Math.max(1, count)), total, yield: finalYield },
        matchPattern: pattern,
      };
    }
    return { key: patternKey, params: { yield: finalYield }, matchPattern: pattern };
  }

  return {
    key: 'takeaway.random',
    params: { yield: finalYield },
    ...(verdict.tier === 4 ? { matchPattern: 'Random' } : {}),
  };
}

const DEFAULT_BASELINE_HYPOTHESIS =
  'Candidate mechanism: low-density baseline point defects or isolated test-limit guardband excursions below spatial clustering thresholds. Check next: inspect dominant failing bin counts and parametric Cp/Cpk margin distributions before lot disposition.';

/**
 * Formats an untranslated bin identifier without parentheses (`"SBIN 7 IDDQ_EDGE_LEAK"` or `"SBIN 7"`, `redesign.md` §3.4, §6.6).
 */
export function formatCleanBinToken(bin: {
  readonly mode: BinMode;
  readonly code: number;
  readonly name: string;
}): string {
  const cleanName = sanitizeReportProseText(bin.name);
  return cleanName.length > 0
    ? `${bin.mode} ${bin.code} ${cleanName}`
    : `${bin.mode} ${bin.code}`;
}

/**
 * Computes the sorted, strictly ascending, deduplicated union of non-empty
 * `Uint32Array` die-index sets across cited `EngineFact`s.
 */
export function unionFactDieIndices(
  citedFacts: readonly EngineFact[],
  totalDies: number,
): Uint32Array {
  if (citedFacts.length === 0 || totalDies <= 0) {
    return new Uint32Array(0);
  }
  if (citedFacts.length === 1) {
    return citedFacts[0]!.dieIndices;
  }

  let totalLen = 0;
  for (let i = 0; i < citedFacts.length; i += 1) {
    totalLen += citedFacts[i]!.dieIndices.length;
  }
  if (totalLen === 0) {
    return new Uint32Array(0);
  }

  if (totalLen <= 2048 || totalLen * 4 < totalDies) {
    const merged = new Uint32Array(totalLen);
    let offset = 0;
    for (let i = 0; i < citedFacts.length; i += 1) {
      const arr = citedFacts[i]!.dieIndices;
      merged.set(arr, offset);
      offset += arr.length;
    }
    merged.sort();

    let uniqueCount = 1;
    for (let i = 1; i < merged.length; i += 1) {
      if (merged[i]! !== merged[i - 1]!) {
        merged[uniqueCount] = merged[i]!;
        uniqueCount += 1;
      }
    }
    return uniqueCount === merged.length ? merged : merged.slice(0, uniqueCount);
  }

  const mask = new Uint8Array(totalDies);
  let uniqueCount = 0;
  for (let i = 0; i < citedFacts.length; i += 1) {
    const arr = citedFacts[i]!.dieIndices;
    for (let k = 0; k < arr.length; k += 1) {
      const idx = arr[k]!;
      if (idx < totalDies && mask[idx] === 0) {
        mask[idx] = 1;
        uniqueCount += 1;
      }
    }
  }

  const out = new Uint32Array(uniqueCount);
  let writePos = 0;
  for (let idx = 0; idx < totalDies; idx += 1) {
    if (mask[idx] !== 0) {
      out[writePos] = idx;
      writePos += 1;
    }
  }
  return out;
}

function getFactMetricValue(
  fact: EngineFact | undefined,
  key: string,
  fallback = 0,
): number {
  if (!fact) {
    return fallback;
  }
  const found = fact.metrics.find((m) => m.key === key);
  return found ? found.numericValue : fallback;
}

function countDistinctWafersForIndices(
  dieIndices: Uint32Array,
  lot: LotModel,
): number {
  const waferCount = lot.wafers.length;
  if (waferCount <= 0 || dieIndices.length === 0) {
    return 0;
  }
  const seen = new Uint8Array(waferCount);
  let count = 0;
  for (let i = 0; i < dieIndices.length; i += 1) {
    const idx = dieIndices[i]!;
    if (idx < lot.dies.count) {
      const w = lot.dies.waferIndex[idx]!;
      if (w < waferCount && seen[w] === 0) {
        seen[w] = 1;
        count += 1;
      }
    }
  }
  return count;
}

function countLotRetestedDies(lot: LotModel): number {
  let count = 0;
  for (let i = 0; i < lot.dies.count; i += 1) {
    if (lot.dies.retestCount[i]! > 0) {
      count += 1;
    }
  }
  return count;
}

function countSiteRetestExecutions(
  lot: LotModel,
  headNum: number,
  siteNum: number,
): number {
  const siteMeta = lot.sites.find(
    (s) => s.headNum === headNum && s.siteNum === siteNum,
  );
  if (!siteMeta) {
    return 0;
  }
  let executions = 0;
  for (let i = 0; i < lot.dies.count; i += 1) {
    if (lot.dies.siteIndex[i] === siteMeta.siteIndex) {
      executions += lot.dies.retestCount[i]!;
    }
  }
  return executions;
}

function computeLotMedianWaferYield(lot: LotModel): number {
  const waferCount = lot.wafers.length;
  if (waferCount === 0) {
    return 0;
  }
  const yields: number[] = [];
  for (let w = 0; w < waferCount; w += 1) {
    const wf = lot.wafers[w]!;
    const tested = wf.dieEndIndex - wf.dieStartIndex;
    if (tested <= 0) {
      continue;
    }
    let pass = 0;
    for (let i = wf.dieStartIndex; i < wf.dieEndIndex; i += 1) {
      if (lot.dies.finalPass[i] !== 0) {
        pass += 1;
      }
    }
    yields.push(pass / tested);
  }
  if (yields.length === 0) {
    return 0;
  }
  yields.sort((a, b) => a - b);
  const mid = Math.floor(yields.length / 2);
  return yields.length % 2 === 1
    ? yields[mid]!
    : (yields[mid - 1]! + yields[mid]!) / 2;
}

function resolveVerdictMessageSpec(
  lot: LotModel,
  verdict: AutopsyVerdictDecision,
): {
  readonly messageKey: MessageKey;
  readonly params: ClaimParams;
} {
  if (isHealthyVerdictDecision(verdict)) {
    return {
      messageKey: 'verdict.healthy',
      params: { yield: verdict.finalYield },
    };
  }

  if (verdict.tier === 1 && verdict.siteAnomaly) {
    const { headNum, siteNum } = verdict.siteAnomaly.site;
    const site = resolveSiteDisplayToken(lot, headNum, siteNum);
    return {
      messageKey: 'verdict.site',
      params: { site },
    };
  }

  if (verdict.tier === 2 && verdict.spatialPattern) {
    return {
      messageKey: 'verdict.pattern',
      params: { pattern: verdict.spatialPattern },
    };
  }

  if (verdict.tier === 3 && verdict.waferExcursion) {
    return {
      messageKey: 'verdict.pattern',
      params: { pattern: verdict.waferExcursion.classification.pattern },
    };
  }

  return {
    messageKey: 'verdict.random',
    params: {},
  };
}

function resolveFactFindingMessageSpec(
  fact: EngineFact,
  lot: LotModel,
  verdict: AutopsyVerdictDecision,
  factsById: ReadonlyMap<string, EngineFact>,
): {
  readonly messageKey: MessageKey;
  readonly subMessageKey: MessageKey;
  readonly params: ClaimParams;
} {
  const lotYieldFact = factsById.get('fact:lot-yield');
  const lotFinalYield =
    getFactMetricValue(lotYieldFact, 'finalYieldPct', verdict.finalYield * 100) /
    100;
  const lotFirstPassYield =
    getFactMetricValue(
      lotYieldFact,
      'firstPassYieldPct',
      verdict.finalYield * 100,
    ) / 100;

  switch (fact.kind) {
    case 'spatial-pattern': {
      const pattern = verdict.spatialPattern;
      const totalFails = Math.max(1, verdict.totalFailDies);
      const sigCount = getFactMetricValue(
        fact,
        'signatureDieCount',
        fact.dieIndices.length,
      );
      const sigWafers = getFactMetricValue(
        fact,
        'signatureWaferCount',
        countDistinctWafersForIndices(fact.dieIndices, lot),
      );
      const edgeBandFails = getFactMetricValue(fact, 'edgeBandFailDies', 0);

      if (
        pattern === 'Edge-Ring' ||
        (pattern === 'Edge-Loc' && edgeBandFails > 0)
      ) {
        const edgeNumerator = edgeBandFails > 0 ? edgeBandFails : sigCount;
        const share = boundedStatRatio(edgeNumerator, totalFails);
        const edgeRatePct = getFactMetricValue(fact, 'edgeBandDieFailRatePct', 0);
        const interiorRatePct = getFactMetricValue(
          fact,
          'interiorDieFailRatePct',
          0,
        );
        return {
          messageKey: 'findings.edgeBand.headline',
          subMessageKey: 'findings.edgeBand.sub',
          params: {
            share,
            rings: CLASSIFIER_THRESHOLDS.EDGE_RING_BAND,
            edgeRate: edgeRatePct / 100,
            interiorRate: interiorRatePct / 100,
            wafers: sigWafers,
            total: lot.wafers.length,
          },
        };
      }

      if (pattern === 'Scratch') {
        const share = boundedStatRatio(sigCount, totalFails);
        return {
          messageKey: 'findings.scratch.headline',
          subMessageKey: 'findings.scratch.sub',
          params: {
            wafers: sigWafers,
            dies: sigCount,
            share,
          },
        };
      }

      // Premium §9.3: one plain-language title per shaped WM-811K class
      const shapedKey: MessageKey | null =
        pattern === 'Center'
          ? 'findings.center.headline'
          : pattern === 'Donut'
            ? 'findings.donut.headline'
            : pattern === 'Edge-Loc'
              ? 'findings.edgeLoc.headline'
              : pattern === 'Loc'
                ? 'findings.loc.headline'
                : pattern === 'Near-full'
                  ? 'findings.nearFull.headline'
                  : null;
      if (shapedKey !== null) {
        return {
          messageKey: shapedKey,
          subMessageKey: 'findings.pattern.sub',
          params: {
            dies: sigCount,
            share: boundedStatRatio(sigCount, totalFails),
            wafers: sigWafers,
            total: lot.wafers.length,
          },
        };
      }

      return {
        messageKey: 'findings.lotYield.headline',
        subMessageKey: 'findings.lotYield.sub',
        params: {
          yield: lotFinalYield,
          firstPass: lotFirstPassYield,
          retests: countLotRetestedDies(lot),
        },
      };
    }

    case 'dominant-bin': {
      const binLabel = fact.binRef
        ? formatCleanBinToken(fact.binRef)
        : 'HBIN 0';
      const dies = getFactMetricValue(fact, 'dieCount', fact.dieIndices.length);
      const totalFails = Math.max(1, verdict.totalFailDies);
      return {
        messageKey: 'findings.dominantBin.headline',
        subMessageKey: 'findings.dominantBin.sub',
        params: {
          bin: binLabel,
          dies,
          share: boundedStatRatio(dies, totalFails),
        },
      };
    }

    case 'secondary-bin': {
      const binLabel = fact.binRef
        ? formatCleanBinToken(fact.binRef)
        : 'HBIN 0';
      const dies = getFactMetricValue(fact, 'dieCount', fact.dieIndices.length);
      const totalFails = Math.max(1, verdict.totalFailDies);
      const wafers = countDistinctWafersForIndices(fact.dieIndices, lot);
      return {
        messageKey: 'findings.secondaryBin.headline',
        subMessageKey: 'findings.secondaryBin.sub',
        params: {
          bin: binLabel,
          share: boundedStatRatio(dies, totalFails),
          dies,
          wafers: Math.max(1, wafers),
        },
      };
    }

    case 'parametric-capability': {
      const testNum = fact.testRef?.testNum ?? 0;
      const cleanName = sanitizeReportProseText(fact.testRef?.testName ?? '');
      const testLabel =
        cleanName.length > 0 ? `${testNum} ${cleanName}` : `${testNum}`;
      const col = lot.tests.get(testNum);
      const cpk = getFactMetricValue(fact, 'cpk', 0);

      let meanBase = 0;
      if (col) {
        let count = 0;
        for (let i = 0; i < Math.min(col.values.length, lot.dies.count); i += 1) {
          const v = col.values[i]!;
          if (Number.isFinite(v)) {
            count += 1;
            meanBase += (v - meanBase) / count;
          }
        }
      }

      const cleanUnits = sanitizeReportProseText(col?.units ?? '');
      const hasLo = col?.loLimit !== null && col?.loLimit !== undefined && Number.isFinite(col.loLimit);
      const hasHi = col?.hiLimit !== null && col?.hiLimit !== undefined && Number.isFinite(col.hiLimit);

      return {
        messageKey: 'findings.capability.headline',
        subMessageKey: 'findings.capability.sub',
        params: {
          test: testLabel,
          testNum,
          testName: cleanName,
          cpk,
          mean: meanBase,
          hasLo: hasLo ? 1 : 0,
          lo: hasLo && col?.loLimit !== null && col?.loLimit !== undefined ? col.loLimit : 0,
          hasHi: hasHi ? 1 : 0,
          hi: hasHi && col?.hiLimit !== null && col?.hiLimit !== undefined ? col.hiLimit : 0,
          units: cleanUnits,
          resScal: col?.resScal ?? 0,
          llmScal: col?.llmScal ?? 0,
          hlmScal: col?.hlmScal ?? 0,
        },
      };
    }

    case 'site-anomaly': {
      const headNum = fact.siteRef?.headNum ?? 1;
      const siteNum = fact.siteRef?.siteNum ?? 1;
      const site = resolveSiteDisplayToken(lot, headNum, siteNum);
      const fpYieldPct = getFactMetricValue(fact, 'firstPassYieldPct', 100);
      const otherFpYieldPct = getFactMetricValue(
        fact,
        'otherSitesFirstPassYieldPct',
        100,
      );
      const siteFailRate = Math.min(0.999, Math.max(0.001, 1 - fpYieldPct / 100));
      const otherFailRate = Math.max(0, 1 - otherFpYieldPct / 100);
      const ratio =
        otherFailRate > 1e-4
          ? Math.max(1, siteFailRate / otherFailRate)
          : Math.max(1, siteFailRate * 100);
      const retests = countSiteRetestExecutions(lot, headNum, siteNum);

      return {
        messageKey: 'findings.site.headline',
        subMessageKey: 'findings.site.sub',
        params: {
          site,
          ratio,
          rate: siteFailRate,
          other: otherFailRate,
          retests,
        },
      };
    }

    case 'wafer-excursion': {
      const waferId =
        sanitizeReportProseText(fact.waferRef?.waferId ?? '') ||
        `W${String((fact.waferRef?.waferIndex ?? 0) + 1).padStart(2, '0')}`;
      const waferYield =
        getFactMetricValue(fact, 'waferFinalYieldPct', 0) / 100;
      const medianYield = computeLotMedianWaferYield(lot);
      const delta = Math.max(0, medianYield - waferYield);

      return {
        messageKey: 'findings.excursion.headline',
        subMessageKey: 'findings.excursion.sub',
        params: {
          wafer: waferId,
          yield: waferYield,
          delta,
        },
      };
    }

    case 'lot-yield':
    case 'retest-recovery': {
      const retests =
        fact.kind === 'retest-recovery'
          ? getFactMetricValue(fact, 'retestedDies', fact.dieIndices.length)
          : countLotRetestedDies(lot);
      return {
        messageKey: 'findings.lotYield.headline',
        subMessageKey: 'findings.lotYield.sub',
        params: {
          yield: lotFinalYield,
          firstPass: lotFirstPassYield,
          retests,
        },
      };
    }
  }
}

function buildOrderedHypothesisSpecs(
  lot: LotModel,
  verdict: AutopsyVerdictDecision,
  facts: readonly EngineFact[],
): readonly ReportHypothesisSpec[] {
  const topSiteFact = facts.find((f) => f.kind === 'site-anomaly');
  const siteToken = verdict.siteAnomaly
    ? resolveSiteDisplayToken(
        lot,
        verdict.siteAnomaly.site.headNum,
        verdict.siteAnomaly.site.siteNum,
      )
    : topSiteFact?.siteRef
      ? resolveSiteDisplayToken(
          lot,
          topSiteFact.siteRef.headNum,
          topSiteFact.siteRef.siteNum,
        )
      : lot.sites[0]
        ? resolveSiteDisplayToken(
            lot,
            lot.sites[0].headNum,
            lot.sites[0].siteNum,
          )
        : 1;

  const etchSpec: ReportHypothesisSpec = {
    id: 'etchUniformity',
    titleKey: 'hypothesis.etchUniformity',
    checkKey: 'hypothesis.etchUniformity.check',
    params: {},
  };
  const mechSpec: ReportHypothesisSpec = {
    id: 'mechanical',
    titleKey: 'hypothesis.mechanical',
    checkKey: 'hypothesis.mechanical.check',
    params: {},
  };
  const probeSpec: ReportHypothesisSpec = {
    id: 'probeCard',
    titleKey: 'hypothesis.probeCard',
    checkKey: 'hypothesis.probeCard.check',
    params: { site: siteToken },
  };
  const randomSpec: ReportHypothesisSpec = {
    id: 'random',
    titleKey: 'hypothesis.random',
    checkKey: 'hypothesis.random.check',
    params: {},
  };

  if (verdict.tier === 0) {
    return topSiteFact ? [probeSpec, randomSpec, etchSpec] : [];
  }

  if (verdict.tier === 1) {
    return [probeSpec, mechSpec, randomSpec];
  }

  const pattern =
    verdict.tier === 3 && verdict.waferExcursion
      ? verdict.waferExcursion.classification.pattern
      : verdict.spatialPattern;

  if (pattern === 'Scratch' || pattern === 'Edge-Loc') {
    return [mechSpec, etchSpec, randomSpec];
  }

  if (
    pattern === 'Edge-Ring' ||
    pattern === 'Center' ||
    pattern === 'Donut' ||
    pattern === 'Loc'
  ) {
    return [etchSpec, mechSpec, randomSpec];
  }

  if (pattern === 'Near-full') {
    return [probeSpec, etchSpec, randomSpec];
  }

  return lot.sites.length >= 2
    ? [randomSpec, probeSpec, etchSpec]
    : [randomSpec, etchSpec, mechSpec];
}

function createGroundedClaim(
  claimId: string,
  text: string,
  isHeadline: boolean,
  messageKey: MessageKey,
  params: ClaimParams,
  rawCitedFactIds: readonly string[],
  factsById: ReadonlyMap<string, EngineFact>,
  lot: LotModel,
  subMessageKey?: MessageKey,
): ReportClaim {
  const dedupedFactIds: string[] = [];
  const seenFactIds = new Set<string>();
  const citedFacts: EngineFact[] = [];

  for (const factId of rawCitedFactIds) {
    if (seenFactIds.has(factId)) {
      continue;
    }
    const fact = factsById.get(factId);
    if (!fact) {
      throw new Error(
        `Claim "${claimId}" cites unknown EngineFact ID "${factId}".`,
      );
    }
    seenFactIds.add(factId);
    dedupedFactIds.push(factId);
    citedFacts.push(fact);
  }

  if (citedFacts.length === 0) {
    throw new Error(`Claim "${claimId}" must cite at least one valid EngineFact.`);
  }

  const resolvedDieIndices = unionFactDieIndices(citedFacts, lot.dies.count);
  if (resolvedDieIndices.length === 0) {
    throw new Error(
      `Claim "${claimId}" resolved to an empty die set across [${dedupedFactIds.join(', ')}].`,
    );
  }

  const citedBins: Array<{ readonly mode: BinMode; readonly code: number }> = [];
  const seenBins = new Set<string>();
  const citedTestNums: number[] = [];
  const seenTests = new Set<number>();
  const citedSites: Array<{ readonly headNum: number; readonly siteNum: number }> = [];
  const seenSites = new Set<string>();

  for (const fact of citedFacts) {
    if (fact.binRef) {
      const key = `${fact.binRef.mode}:${fact.binRef.code}`;
      if (!seenBins.has(key)) {
        seenBins.add(key);
        citedBins.push({ mode: fact.binRef.mode, code: fact.binRef.code });
      }
    }
    if (fact.testRef && !seenTests.has(fact.testRef.testNum)) {
      seenTests.add(fact.testRef.testNum);
      citedTestNums.push(fact.testRef.testNum);
    }
    if (fact.siteRef) {
      const key = `${fact.siteRef.headNum}:${fact.siteRef.siteNum}`;
      if (!seenSites.has(key)) {
        seenSites.add(key);
        citedSites.push({
          headNum: fact.siteRef.headNum,
          siteNum: fact.siteRef.siteNum,
        });
      }
    }
  }

  return {
    claimId,
    text,
    isHeadline,
    messageKey,
    ...(subMessageKey !== undefined ? { subMessageKey } : {}),
    params,
    citedFactIds: dedupedFactIds,
    resolvedDieIndices,
    resolvedDieIds: resolveDieIdsFromIndices(resolvedDieIndices, lot.dieIds),
    citedBins,
    citedTestNums,
    citedSites,
  };
}

function resolveHypothesisTextAndFactId(
  verdict: AutopsyVerdictDecision,
  factsById: ReadonlyMap<string, EngineFact>,
  dominantBinFactId: string,
): { readonly factId: string; readonly text: string } {
  if (verdict.tier === 1 && verdict.siteAnomaly) {
    const { headNum, siteNum } = verdict.siteAnomaly.site;
    const siteFactId = `fact:site:${headNum}-${siteNum}`;
    const siteFact = factsById.get(siteFactId);
    const hyp =
      siteFact?.hypotheses?.[0] ??
      formatSiteConcentrationHypotheses({ headNum, siteNum })[0] ??
      DEFAULT_BASELINE_HYPOTHESIS;
    return { factId: siteFact ? siteFactId : dominantBinFactId, text: hyp };
  }

  if (
    (verdict.tier === 2 || verdict.tier === 4) &&
    factsById.has('fact:spatial:primary')
  ) {
    const spatialFact = factsById.get('fact:spatial:primary')!;
    const fallbackPattern = verdict.spatialPattern ?? 'Random';
    const hyp =
      spatialFact.hypotheses?.[0] ??
      formatPatternCandidateHypotheses(fallbackPattern)[0] ??
      DEFAULT_BASELINE_HYPOTHESIS;
    return { factId: 'fact:spatial:primary', text: hyp };
  }

  if (verdict.tier === 3 && verdict.waferExcursion) {
    const excFactId = `fact:wafer-excursion:${verdict.waferExcursion.wafer.waferIndex}`;
    const excFact = factsById.get(excFactId);
    const hyp =
      excFact?.hypotheses?.[0] ??
      formatPatternCandidateHypotheses(
        verdict.waferExcursion.classification.pattern,
      )[0] ??
      DEFAULT_BASELINE_HYPOTHESIS;
    return { factId: excFact ? excFactId : dominantBinFactId, text: hyp };
  }

  const domFact = factsById.get(dominantBinFactId);
  const lotFact = factsById.get('fact:lot-yield');
  const hyp =
    domFact?.hypotheses?.[0] ??
    lotFact?.hypotheses?.[0] ??
    DEFAULT_BASELINE_HYPOTHESIS;
  return { factId: dominantBinFactId, text: hyp };
}

/**
 * Generates the offline deterministic `AutopsyReport` from `lot`, `facts`, and `verdict`.
 *
 * Preconditions:
 * - `lot.dies.count >= 1`
 * - `facts` contains all canonical facts referenced by `verdict.citedFactIds`
 */
export function buildTemplateAutopsyReport(
  lot: LotModel,
  facts: readonly EngineFact[],
  verdict: AutopsyVerdictDecision,
): AutopsyReport {
  if (lot.dies.count === 0) {
    throw new RangeError(
      'buildTemplateAutopsyReport requires a LotModel with at least one tested die.',
    );
  }

  const factsById = new Map<string, EngineFact>();
  for (const fact of facts) {
    factsById.set(fact.factId, fact);
  }

  const headlineMsgSpec = resolveVerdictMessageSpec(lot, verdict);
  const causeOfDeathHeadline = createGroundedClaim(
    'claim:cause-of-death',
    verdict.headlineText,
    true,
    headlineMsgSpec.messageKey,
    headlineMsgSpec.params,
    verdict.citedFactIds,
    factsById,
    lot,
  );

  const hypotheses = buildOrderedHypothesisSpecs(lot, verdict, facts);
  const cappedConfidence = capDisplayedConfidence(verdict.confidence);

  const takeawaySpec = resolveTakeawaySpec(lot, verdict, factsById);
  const sublineKey = takeawaySpec.key;
  const sublineParams = takeawaySpec.params;
  const matchPattern = takeawaySpec.matchPattern;

  const bodyClaims: ReportClaim[] = [];
  const retestFact = factsById.get('fact:retest-recovery') ?? null;
  const topParamFact =
    facts.find((f) => f.kind === 'parametric-capability') ?? null;
  const topSecondaryBinFact =
    facts.find((f) => f.kind === 'secondary-bin') ?? null;
  const topSiteFact = facts.find((f) => f.kind === 'site-anomaly') ?? null;

  // Tier 0: Zero final failing dies (`totalFailDies === 0`)
  if (verdict.tier === 0) {
    const lotYieldFact = factsById.get('fact:lot-yield');
    if (!lotYieldFact) {
      throw new Error('Missing required "fact:lot-yield" for Tier 0 report.');
    }

    const yieldSpec = resolveFactFindingMessageSpec(
      lotYieldFact,
      lot,
      verdict,
      factsById,
    );
    bodyClaims.push(
      createGroundedClaim(
        'claim:yield-overview',
        lotYieldFact.summary,
        false,
        yieldSpec.messageKey,
        yieldSpec.params,
        ['fact:lot-yield'],
        factsById,
        lot,
        yieldSpec.subMessageKey,
      ),
    );

    if (retestFact) {
      const retestSpec = resolveFactFindingMessageSpec(
        retestFact,
        lot,
        verdict,
        factsById,
      );
      bodyClaims.push(
        createGroundedClaim(
          'claim:retest-recovery',
          retestFact.summary,
          false,
          retestSpec.messageKey,
          retestSpec.params,
          [retestFact.factId],
          factsById,
          lot,
          retestSpec.subMessageKey,
        ),
      );
    }

    if (topParamFact) {
      const paramSpec = resolveFactFindingMessageSpec(
        topParamFact,
        lot,
        verdict,
        factsById,
      );
      bodyClaims.push(
        createGroundedClaim(
          'claim:parametric-margin',
          topParamFact.summary,
          false,
          paramSpec.messageKey,
          paramSpec.params,
          [topParamFact.factId],
          factsById,
          lot,
          paramSpec.subMessageKey,
        ),
      );
    }

    if (topSiteFact) {
      const siteHyp =
        topSiteFact.hypotheses?.[0] ??
        formatSiteConcentrationHypotheses(topSiteFact.siteRef)[0]!;
      const siteSpec = resolveFactFindingMessageSpec(
        topSiteFact,
        lot,
        verdict,
        factsById,
      );
      bodyClaims.push(
        createGroundedClaim(
          'claim:disposition-guidance',
          `${topSiteFact.summary} ${siteHyp}`,
          false,
          siteSpec.messageKey,
          siteSpec.params,
          [topSiteFact.factId],
          factsById,
          lot,
          siteSpec.subMessageKey,
        ),
      );
    } else {
      const siteCount = lot.sites.length;
      const siteNoun = siteCount === 1 ? 'test site' : 'test sites';
      bodyClaims.push(
        createGroundedClaim(
          'claim:disposition-guidance',
          `Zero failing bins or spatial defect signatures exceeded detection thresholds across ${formatGroupedInt(siteCount)} ${siteNoun}. Candidate mechanism: nominal wafer fabrication and probe execution within specification limits. Check next: verify parametric Cp/Cpk capability margins across monitor tests prior to assembly release.`,
          false,
          'hypothesis.random',
          {},
          ['fact:lot-yield'],
          factsById,
          lot,
          'hypothesis.random.check',
        ),
      );
    }

    return {
      causeOfDeathHeadline,
      bodyClaims: bodyClaims.slice(0, 4),
      source: 'deterministic-template',
      sublineKey,
      sublineParams,
      ...(matchPattern !== undefined ? { matchPattern } : {}),
      confidence: cappedConfidence,
      hypotheses,
    };
  }

  // Tiers 1–5: Lot has >= 1 final failing die
  const dominantBinFactId = verdict.dominantBin?.factId;
  if (!dominantBinFactId || !factsById.has(dominantBinFactId)) {
    throw new Error(
      `Missing dominant bin EngineFact "${String(dominantBinFactId)}" for Tier ${verdict.tier} report.`,
    );
  }
  const dominantBinFact = factsById.get(dominantBinFactId)!;

  // Claim 1: Primary verdict diagnostic evidence
  let primaryEvidenceFact: EngineFact | undefined;
  if (verdict.tier === 1 && verdict.siteAnomaly) {
    const { headNum, siteNum } = verdict.siteAnomaly.site;
    primaryEvidenceFact = factsById.get(`fact:site:${headNum}-${siteNum}`);
  } else if (verdict.tier === 2 || verdict.tier === 4) {
    primaryEvidenceFact = factsById.get('fact:spatial:primary');
  } else if (verdict.tier === 3 && verdict.waferExcursion) {
    primaryEvidenceFact = factsById.get(
      `fact:wafer-excursion:${verdict.waferExcursion.wafer.waferIndex}`,
    );
  } else {
    primaryEvidenceFact = factsById.get('fact:lot-yield');
  }

  if (!primaryEvidenceFact) {
    primaryEvidenceFact = factsById.get('fact:lot-yield') ?? dominantBinFact;
  }

  const primarySpec = resolveFactFindingMessageSpec(
    primaryEvidenceFact,
    lot,
    verdict,
    factsById,
  );
  bodyClaims.push(
    createGroundedClaim(
      'claim:primary-evidence',
      primaryEvidenceFact.summary,
      false,
      primarySpec.messageKey,
      primarySpec.params,
      [primaryEvidenceFact.factId],
      factsById,
      lot,
      primarySpec.subMessageKey,
    ),
  );

  // Claim 2: Dominant failing bin loss breakdown
  const domBinSpec = resolveFactFindingMessageSpec(
    dominantBinFact,
    lot,
    verdict,
    factsById,
  );
  bodyClaims.push(
    createGroundedClaim(
      'claim:dominant-bin',
      dominantBinFact.summary,
      false,
      domBinSpec.messageKey,
      domBinSpec.params,
      [dominantBinFact.factId],
      factsById,
      lot,
      domBinSpec.subMessageKey,
    ),
  );

  // Claim 3 (optional): Parametric test capability, retest recovery, or secondary bin
  const supportingFact = topParamFact ?? retestFact ?? topSecondaryBinFact;
  if (supportingFact) {
    const supSpec = resolveFactFindingMessageSpec(
      supportingFact,
      lot,
      verdict,
      factsById,
    );
    bodyClaims.push(
      createGroundedClaim(
        'claim:supporting-evidence',
        supportingFact.summary,
        false,
        supSpec.messageKey,
        supSpec.params,
        [supportingFact.factId],
        factsById,
        lot,
        supSpec.subMessageKey,
      ),
    );
  }

  // Claim 4: Hedged engineering root-cause hypothesis + Check next step
  const hypothesisChoice = resolveHypothesisTextAndFactId(
    verdict,
    factsById,
    dominantBinFact.factId,
  );
  const leadHypSpec = hypotheses[0] ?? {
    id: 'random' as const,
    titleKey: 'hypothesis.random' as const,
    checkKey: 'hypothesis.random.check' as const,
    params: {},
  };
  bodyClaims.push(
    createGroundedClaim(
      'claim:root-cause-hypothesis',
      hypothesisChoice.text,
      false,
      leadHypSpec.titleKey,
      leadHypSpec.params,
      [hypothesisChoice.factId],
      factsById,
      lot,
      leadHypSpec.checkKey,
    ),
  );

  return {
    causeOfDeathHeadline,
    bodyClaims,
    source: 'deterministic-template',
    sublineKey,
    sublineParams,
    ...(matchPattern !== undefined ? { matchPattern } : {}),
    confidence: cappedConfidence,
    hypotheses,
  };
}

/**
 * Convenience end-to-end deterministic report pipeline (`LotModel -> Analysis -> Facts -> Verdict -> Report`).
 */
export function generateOfflineAutopsyReport(
  lot: LotModel,
  precomputedAnalysis?: LotAnalysisBundle,
): OfflineAutopsyPipelineResult {
  const analysis = precomputedAnalysis ?? analyzeLotForReport(lot);
  const facts = buildEngineFacts(lot, analysis);
  const verdict = selectPrimaryVerdict(
    lot,
    analysis.primarySpatial,
    analysis.perWaferPatterns,
    analysis.siteAnomalies,
    analysis.yieldSummary,
  );
  const report = buildTemplateAutopsyReport(lot, facts, verdict);
  return { analysis, facts, verdict, report };
}
