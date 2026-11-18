'use client';

import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { YieldSummary } from '@/core/analytics';
import type { LotModel } from '@/core/model';
import {
  analyzeLotForReport,
  type AutopsyReport,
  type AutopsyVerdictDecision,
  buildStatFacts,
  type EngineFact,
  renderReport,
  renderStatFacts,
  type ReportClaim,
} from '@/core/report';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import {
  type ClaimGlowOrderMode,
  type ClaimHighlightState,
  type SelectionStoreState,
  useSelectionStore,
} from '@/ui/state';
import { ConfidencePill } from './ConfidencePill';
import { FindingsList } from './FindingsList';
import { StatRow } from './StatRow';
import { VerdictHero } from './VerdictHero';

export interface AutopsyReportCardProps {
  readonly lot: LotModel;
  readonly report: AutopsyReport;
  readonly verdict?: AutopsyVerdictDecision;
  readonly facts?: readonly EngineFact[];
  readonly yieldSummary?: YieldSummary;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  /** Initial open state for the `"Possible causes"` disclosure (`false` / collapsed by default). */
  readonly defaultHypothesesOpen?: boolean;
  /** Initial open state for the `ConfidencePill` method popover (`false` by default). */
  readonly defaultConfidenceOpen?: boolean;
  /** Optional post-load bins-only notice rendered directly beneath the confidence pill (§3.8). */
  readonly binsOnlyNotice?: React.ReactNode;
  /**
   * When true (inside `LoadedLotOverview`), splits mobile (`< 1280px`) visual order via
   * `max-xl:contents` so the Wafer Stage + Strip sit between `StatRow` and `FindingsList`
   * on mobile (`redesign.md` §3.4) while staying a single scrollable `553 px` column on desktop.
   */
  readonly splitForMobileStage?: boolean;
  readonly className?: string;
}

export interface ClaimWaferTargetResolution {
  /** Target `waferIndex` to select when clicking this claim (`undefined` keeps current wafer). */
  readonly targetWaferIndex?: number;
  /** True strictly when the claim itself is scoped to a single specific wafer. */
  readonly isSingleWaferClaim: boolean;
}

/**
 * Resolves whether activating `claim` should select a specific wafer on the wafer map:
 * 1. If cited `EngineFact`s carry a single `waferRef` (e.g., Tier 3 single-wafer excursion),
 *    selects that `waferRef.waferIndex` (`isSingleWaferClaim = true`).
 * 2. If all `claim.resolvedDieIndices` reside on a single wafer `w`, selects `w`
 *    (`isSingleWaferClaim = true`).
 * 3. On multi-wafer claims where the currently active wafer has `0` coordinate-bearing
 *    cited dies (e.g., `handling-scratch` `W05–W22` clicked while viewing clean `W01`),
 *    selects the wafer with the highest count of coordinate-bearing cited dies so the
 *    evidence immediately illuminates on `OverlayCanvas`.
 */
export function resolveClaimWaferTarget(
  claim: ReportClaim,
  lot: LotModel,
  activeWaferIndex: number,
  factsById?: ReadonlyMap<string, EngineFact>,
): ClaimWaferTargetResolution {
  const waferCount = lot.wafers.length;
  if (waferCount === 0) {
    return { isSingleWaferClaim: false };
  }

  if (factsById) {
    const refWafers = new Set<number>();
    for (const factId of claim.citedFactIds) {
      const fact = factsById.get(factId);
      if (
        fact?.waferRef &&
        fact.waferRef.waferIndex >= 0 &&
        fact.waferRef.waferIndex < waferCount
      ) {
        refWafers.add(fact.waferRef.waferIndex);
      }
    }
    if (refWafers.size === 1) {
      const [onlyWafer] = refWafers;
      return {
        targetWaferIndex: onlyWafer,
        isSingleWaferClaim: true,
      };
    }
  }

  const { dies } = lot;
  const dieIndices = claim.resolvedDieIndices;
  let distinctWafer = -1;
  let multipleWafers = false;
  const coordCountByWafer = new Uint32Array(waferCount);
  let totalCoordCited = 0;

  for (let i = 0; i < dieIndices.length; i += 1) {
    const dieIdx = dieIndices[i]!;
    if (dieIdx >= dies.count) {
      continue;
    }
    const w = dies.waferIndex[dieIdx]!;
    if (w >= waferCount) {
      continue;
    }
    if (distinctWafer === -1) {
      distinctWafer = w;
    } else if (distinctWafer !== w) {
      multipleWafers = true;
    }
    if (dies.hasValidCoords[dieIdx] !== 0) {
      coordCountByWafer[w]! += 1;
      totalCoordCited += 1;
    }
  }

  if (!multipleWafers && distinctWafer >= 0) {
    return {
      targetWaferIndex: distinctWafer,
      isSingleWaferClaim: waferCount > 1,
    };
  }

  if (totalCoordCited > 0) {
    const safeActive =
      activeWaferIndex >= 0 && activeWaferIndex < waferCount
        ? activeWaferIndex
        : 0;
    let bestWafer = 0;
    let bestCount = 0;
    for (let w = 0; w < waferCount; w += 1) {
      const cnt = coordCountByWafer[w]!;
      if (cnt > bestCount) {
        bestCount = cnt;
        bestWafer = w;
      }
    }
    const activeCount = coordCountByWafer[safeActive]!;
    if (
      bestCount > 0 &&
      (activeCount === 0 || (bestCount >= 4 && activeCount * 4 < bestCount))
    ) {
      return {
        targetWaferIndex: bestWafer,
        isSingleWaferClaim: false,
      };
    }
  }

  return { isSingleWaferClaim: false };
}

function resolveClaimGlowOrderMode(
  claim: ReportClaim,
  spatialPattern?: string,
): ClaimGlowOrderMode {
  if (
    claim.messageKey === 'findings.scratch.headline' ||
    (claim.messageKey === 'verdict.pattern' && spatialPattern === 'Scratch')
  ) {
    return 'principal-axis';
  }
  if (
    claim.messageKey === 'findings.edgeBand.headline' ||
    ((claim.messageKey === 'verdict.pattern' ||
      claim.messageKey === 'findings.excursion.headline') &&
      (spatialPattern === 'Edge-Ring' ||
        spatialPattern === 'Donut' ||
        spatialPattern === 'Center'))
  ) {
    return 'polar-cw';
  }
  if (
    typeof claim.params.pattern === 'string' &&
    (claim.params.pattern === 'Edge-Ring' ||
      claim.params.pattern === 'Donut' ||
      claim.params.pattern === 'Center')
  ) {
    return 'polar-cw';
  }
  if (claim.params.pattern === 'Scratch') {
    return 'principal-axis';
  }
  return 'centroid-distance';
}

/**
 * Builds the `ClaimHighlightState` written to `SelectionStore` when a user activates
 * a headline or body `ReportClaim`.
 */
export function buildClaimHighlightPayload(
  claim: ReportClaim,
  lot: LotModel,
  activeWaferIndex: number,
  factsById?: ReadonlyMap<string, EngineFact>,
  spatialPattern?: string,
): ClaimHighlightState {
  const { targetWaferIndex } = resolveClaimWaferTarget(
    claim,
    lot,
    activeWaferIndex,
    factsById,
  );
  return {
    claimId: claim.claimId,
    dieIndices: claim.resolvedDieIndices,
    citedBins: claim.citedBins,
    citedTestNums: claim.citedTestNums,
    citedSites: claim.citedSites,
    glowOrderMode: resolveClaimGlowOrderMode(claim, spatialPattern),
    ...(targetWaferIndex !== undefined ? { targetWaferIndex } : {}),
  };
}

/**
 * Toggles `claim` in `store` (activating its cited die mask + optional target wafer,
 * or clearing when `claim` is already active).
 */
export function toggleReportClaimInStore(
  store: StoreApi<SelectionStoreState>,
  lot: LotModel,
  claim: ReportClaim,
  factsById?: ReadonlyMap<string, EngineFact>,
  spatialPattern?: string,
): void {
  const state = store.getState();
  if (state.lot !== lot) {
    state.setLot(lot);
  }
  const currentActiveWafer = store.getState().activeWaferIndex;
  const payload = buildClaimHighlightPayload(
    claim,
    lot,
    currentActiveWafer,
    factsById,
    spatialPattern,
  );
  store.getState().toggleClaimHighlight(payload);
}

/**
 * Verdict Column (`src/ui/report/AutopsyReportCard.tsx`, `redesign.md` §3.4, §3.5, §3.8, §4.3–§4.6):
 * Composes `VerdictHero`, `ConfidencePill` (absorbing `NarrationBadge`), `StatRow` (3 big-number stats),
 * and `FindingsList` (borderless rows + `"Possible causes"` disclosure) with zero box borders,
 * zero monospace, and zero uppercase labels.
 */
export function AutopsyReportCard({
  lot,
  report,
  verdict,
  facts,
  yieldSummary,
  store = useSelectionStore,
  defaultHypothesesOpen = false,
  defaultConfidenceOpen = false,
  binsOnlyNotice,
  splitForMobileStage = false,
  className,
}: AutopsyReportCardProps): React.JSX.Element {
  const { locale, t, tPlural } = useT();

  const { storeLot, activeClaimId, hasActiveFilter, selectedDieMask } =
    useStore(
      store,
      useShallow((s) => ({
        storeLot: s.lot,
        activeClaimId: s.claimHighlight?.claimId ?? null,
        hasActiveFilter: s.hasActiveFilter,
        selectedDieMask: s.selectedDieMask,
      })),
    );

  const effectiveActiveClaimId = storeLot === lot ? activeClaimId : null;
  const effectiveSelectionMask =
    storeLot === lot && hasActiveFilter ? selectedDieMask : null;

  const factsById = React.useMemo(() => {
    const map = new Map<string, EngineFact>();
    if (facts) {
      for (const fact of facts) {
        map.set(fact.factId, fact);
      }
    }
    return map;
  }, [facts]);

  const rendered = React.useMemo(
    () => renderReport(report, locale),
    [report, locale],
  );

  // §3.8 Moment 2: Parametric findings rows are not rendered in bins-only mode
  const visibleFindings = React.useMemo(
    () =>
      lot.parseMode === 'bins-only'
        ? rendered.findings.filter(
            (item) =>
              item.claim.citedTestNums.length === 0 &&
              item.claim.messageKey !== 'findings.capability.headline',
          )
        : rendered.findings,
    [rendered.findings, lot.parseMode],
  );

  const analysis = React.useMemo(() => analyzeLotForReport(lot), [lot]);

  const renderedStats = React.useMemo(() => {
    const statFacts = buildStatFacts({
      lot,
      analysis,
      ...(verdict !== undefined ? { verdict } : {}),
      ...(yieldSummary !== undefined ? { yieldSummary } : {}),
      selectionMask: effectiveSelectionMask,
    });
    return renderStatFacts(statFacts, locale);
  }, [lot, analysis, verdict, yieldSummary, effectiveSelectionMask, locale]);

  const handleToggleClaim = React.useCallback(
    (claim: ReportClaim): void => {
      toggleReportClaimInStore(
        store,
        lot,
        claim,
        factsById,
        analysis.primarySpatial.pattern,
      );
    },
    [store, lot, factsById, analysis.primarySpatial.pattern],
  );

  // §3.5: Pressing Escape clears the active finding when no overlay/popover consumed Escape
  React.useEffect(() => {
    if (!effectiveActiveClaimId) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        const current = store.getState();
        if (current.lot === lot && current.claimHighlight !== null) {
          current.setClaimHighlight(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [effectiveActiveClaimId, lot, store]);

  const liveAnnouncement = React.useMemo(() => {
    const fullHeadline = rendered.verdict.fullHeadline;
    if (!effectiveActiveClaimId) {
      return fullHeadline;
    }
    if (effectiveActiveClaimId === report.causeOfDeathHeadline.claimId) {
      const dieCountLabel = tPlural(
        'findings.dieCount',
        report.causeOfDeathHeadline.resolvedDieIndices.length,
      );
      return `${fullHeadline} (${dieCountLabel})`;
    }
    const matchedFinding = visibleFindings.find(
      (f) => f.claimId === effectiveActiveClaimId,
    );
    if (matchedFinding) {
      return `${matchedFinding.headline} (${matchedFinding.dieCountLabel})`;
    }
    return fullHeadline;
  }, [
    rendered.verdict.fullHeadline,
    effectiveActiveClaimId,
    report.causeOfDeathHeadline,
    visibleFindings,
    tPlural,
  ]);

  return (
    <section
      aria-label={rendered.findingsHeading}
      data-testid="autopsy-report-card"
      data-verdict-scroll="true"
      className={cn(
        'flex w-full flex-col xl:pt-14',
        splitForMobileStage && 'max-xl:contents',
        className,
      )}
    >
      <div
        data-testid="verdict-top-block"
        className={cn('flex flex-col', splitForMobileStage && 'order-1 xl:order-none')}
      >
        <div
          data-testid="autopsy-live-region"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {liveAnnouncement}
        </div>

        <VerdictHero
          verdict={rendered.verdict}
          headlineClaim={report.causeOfDeathHeadline}
          causeAria={t('verdict.causeAria')}
          isActive={
            effectiveActiveClaimId === report.causeOfDeathHeadline.claimId
          }
          onToggleClaim={handleToggleClaim}
        />

        <ConfidencePill
          confidence={rendered.confidence}
          defaultOpen={defaultConfidenceOpen}
          className="mt-3 md:mt-5"
        />

        {binsOnlyNotice ? <div className="mt-3">{binsOnlyNotice}</div> : null}

        <StatRow stats={renderedStats} className="mt-6 md:mt-10" />
      </div>

      <FindingsList
        heading={rendered.findingsHeading}
        clearLabel={rendered.clearLabel}
        possibleCausesHeading={rendered.possibleCausesHeading}
        findings={visibleFindings}
        hypotheses={rendered.hypotheses}
        activeClaimId={effectiveActiveClaimId}
        selectionMask={effectiveSelectionMask}
        defaultHypothesesOpen={defaultHypothesesOpen}
        onToggleClaim={handleToggleClaim}
        className={cn(
          'mt-8 md:mt-12',
          splitForMobileStage && 'order-3 xl:order-none',
        )}
      />
    </section>
  );
}
