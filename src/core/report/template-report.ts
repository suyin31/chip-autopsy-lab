/**
 * Offline deterministic Autopsy Report generator (`src/core/report/template-report.ts`).
 *
 * Produces the verdict-first `AutopsyReport` (`causeOfDeathHeadline` + 2–4 clinical
 * `bodyClaims`) exclusively from deterministic `EngineFact`s and `AutopsyVerdictDecision`.
 * Every claim binds to valid `factId`s resolving to a non-empty, sorted `Uint32Array`
 * of `LotModel.dies` indices (`resolvedDieIndices`) and canonical `DieId`s
 * (`resolvedDieIds`), plus any cited bins, parametric `TEST_NUM`s, and Test Sites.
 *
 * Pure deterministic TypeScript with zero React, Next.js, network, or DOM imports.
 * Validates: Requirements 9.3, 10.1, 10.2, 10.3, 10.5, 17.4, 17.7
 */

import type { BinMode, DieId, LotModel } from '../model/types';
import {
  formatPatternCandidateHypotheses,
  formatSiteConcentrationHypotheses,
} from '../patterns/root-causes';
import {
  analyzeLotForReport,
  buildEngineFacts,
  type EngineFact,
  formatGroupedInt,
  type LotAnalysisBundle,
  resolveDieIdsFromIndices,
} from './engine-facts';
import {
  type AutopsyVerdictDecision,
  selectPrimaryVerdict,
} from './verdict-precedence';

export interface ReportClaim {
  readonly claimId: string;
  readonly text: string;
  readonly isHeadline: boolean;
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
}

export interface OfflineAutopsyPipelineResult {
  readonly analysis: LotAnalysisBundle;
  readonly facts: readonly EngineFact[];
  readonly verdict: AutopsyVerdictDecision;
  readonly report: AutopsyReport;
}

const DEFAULT_BASELINE_HYPOTHESIS =
  'Candidate mechanism: low-density baseline point defects or isolated test-limit guardband excursions below spatial clustering thresholds. Check next: inspect dominant failing bin counts and parametric Cp/Cpk margin distributions before lot disposition.';

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

function createGroundedClaim(
  claimId: string,
  text: string,
  isHeadline: boolean,
  rawCitedFactIds: readonly string[],
  factsById: ReadonlyMap<string, EngineFact>,
  lot: LotModel,
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

  const causeOfDeathHeadline = createGroundedClaim(
    'claim:cause-of-death',
    verdict.headlineText,
    true,
    verdict.citedFactIds,
    factsById,
    lot,
  );

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

    bodyClaims.push(
      createGroundedClaim(
        'claim:yield-overview',
        lotYieldFact.summary,
        false,
        ['fact:lot-yield'],
        factsById,
        lot,
      ),
    );

    if (retestFact) {
      bodyClaims.push(
        createGroundedClaim(
          'claim:retest-recovery',
          retestFact.summary,
          false,
          [retestFact.factId],
          factsById,
          lot,
        ),
      );
    }

    if (topParamFact) {
      bodyClaims.push(
        createGroundedClaim(
          'claim:parametric-margin',
          topParamFact.summary,
          false,
          [topParamFact.factId],
          factsById,
          lot,
        ),
      );
    }

    if (topSiteFact) {
      const siteHyp =
        topSiteFact.hypotheses?.[0] ??
        formatSiteConcentrationHypotheses(topSiteFact.siteRef)[0]!;
      bodyClaims.push(
        createGroundedClaim(
          'claim:disposition-guidance',
          `${topSiteFact.summary} ${siteHyp}`,
          false,
          [topSiteFact.factId],
          factsById,
          lot,
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
          ['fact:lot-yield'],
          factsById,
          lot,
        ),
      );
    }

    return {
      causeOfDeathHeadline,
      bodyClaims: bodyClaims.slice(0, 4),
      source: 'deterministic-template',
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

  bodyClaims.push(
    createGroundedClaim(
      'claim:primary-evidence',
      primaryEvidenceFact.summary,
      false,
      [primaryEvidenceFact.factId],
      factsById,
      lot,
    ),
  );

  // Claim 2: Dominant failing bin loss breakdown
  bodyClaims.push(
    createGroundedClaim(
      'claim:dominant-bin',
      dominantBinFact.summary,
      false,
      [dominantBinFact.factId],
      factsById,
      lot,
    ),
  );

  // Claim 3 (optional): Parametric test capability, retest recovery, or secondary bin
  const supportingFact = topParamFact ?? retestFact ?? topSecondaryBinFact;
  if (supportingFact) {
    bodyClaims.push(
      createGroundedClaim(
        'claim:supporting-evidence',
        supportingFact.summary,
        false,
        [supportingFact.factId],
        factsById,
        lot,
      ),
    );
  }

  // Claim 4: Hedged engineering root-cause hypothesis + Check next step
  const hypothesisChoice = resolveHypothesisTextAndFactId(
    verdict,
    factsById,
    dominantBinFact.factId,
  );
  bodyClaims.push(
    createGroundedClaim(
      'claim:root-cause-hypothesis',
      hypothesisChoice.text,
      false,
      [hypothesisChoice.factId],
      factsById,
      lot,
    ),
  );

  return {
    causeOfDeathHeadline,
    bodyClaims,
    source: 'deterministic-template',
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
