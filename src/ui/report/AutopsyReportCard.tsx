'use client';

import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { LotModel } from '@/core/model';
import {
  type AutopsyReport,
  type AutopsyVerdictDecision,
  type EngineFact,
  formatConfidenceBadgeLabel,
  type ReportClaim,
} from '@/core/report';
import { Badge, Card, CardContent, CardHeader } from '@/ui/primitives';
import { formatGroupedInt } from '@/ui/format';
import {
  type ClaimHighlightState,
  type SelectionStoreState,
  useSelectionStore,
} from '@/ui/state';
import { ClaimInlineButton } from './ClaimInlineButton';
import { NarrationBadge } from './NarrationBadge';

export interface AutopsyReportCardProps {
  readonly lot: LotModel;
  readonly report: AutopsyReport;
  readonly verdict?: AutopsyVerdictDecision;
  readonly facts?: readonly EngineFact[];
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  /** Initial open state for the hedged hypotheses disclosure (`false` / collapsed by default). */
  readonly defaultHypothesesOpen?: boolean;
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

/**
 * Builds the `ClaimHighlightState` written to `SelectionStore` when a user activates
 * a headline or body `ReportClaim`.
 */
export function buildClaimHighlightPayload(
  claim: ReportClaim,
  lot: LotModel,
  activeWaferIndex: number,
  factsById?: ReadonlyMap<string, EngineFact>,
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
  );
  store.getState().toggleClaimHighlight(payload);
}

interface VisibleEvidenceClaimItem {
  readonly claim: ReportClaim;
  readonly displayText: string;
}

interface DisclosedHypothesisItem {
  readonly key: string;
  readonly mechanismText: string;
  readonly checkNextText: string | null;
  readonly combinedDisplayText: string;
  readonly linkedClaim?: ReportClaim;
}

function splitHypothesisClauses(rawText: string): {
  readonly mechanismText: string;
  readonly checkNextText: string | null;
  readonly combinedDisplayText: string;
} {
  const marker = ' Check next:';
  const idx = rawText.indexOf(marker);
  if (idx < 0) {
    const clean = rawText.trim();
    return {
      mechanismText: clean,
      checkNextText: null,
      combinedDisplayText: clean,
    };
  }
  const mechanismText = rawText.slice(0, idx).trim();
  const checkNextText = rawText.slice(idx + 1).trim();
  return {
    mechanismText,
    checkNextText,
    combinedDisplayText: `${mechanismText} ${checkNextText}`,
  };
}

function partitionClaimsAndHypotheses(
  report: AutopsyReport,
  factsById: ReadonlyMap<string, EngineFact>,
): {
  readonly evidenceClaims: readonly VisibleEvidenceClaimItem[];
  readonly hypotheses: readonly DisclosedHypothesisItem[];
} {
  const evidenceClaims: VisibleEvidenceClaimItem[] = [];
  const hypotheses: DisclosedHypothesisItem[] = [];
  const seenHypothesisStrings = new Set<string>();

  for (const claim of report.bodyClaims) {
    if (
      claim.claimId === 'claim:root-cause-hypothesis' ||
      claim.text.startsWith('Candidate mechanism:')
    ) {
      const { mechanismText, checkNextText, combinedDisplayText } =
        splitHypothesisClauses(claim.text);
      seenHypothesisStrings.add(claim.text.trim());
      hypotheses.push({
        key: claim.claimId,
        mechanismText,
        checkNextText,
        combinedDisplayText,
        linkedClaim: claim,
      });

      // Surface secondary hedged candidate mechanisms attached to the cited EngineFact
      for (const factId of claim.citedFactIds) {
        const fact = factsById.get(factId);
        if (!fact?.hypotheses) {
          continue;
        }
        for (let hIdx = 0; hIdx < fact.hypotheses.length; hIdx += 1) {
          const extraRaw = fact.hypotheses[hIdx]!.trim();
          if (seenHypothesisStrings.has(extraRaw)) {
            continue;
          }
          seenHypothesisStrings.add(extraRaw);
          const extraSplit = splitHypothesisClauses(extraRaw);
          hypotheses.push({
            key: `${factId}:hyp-${hIdx}`,
            mechanismText: extraSplit.mechanismText,
            checkNextText: extraSplit.checkNextText,
            combinedDisplayText: extraSplit.combinedDisplayText,
          });
        }
      }
      continue;
    }

    const candMarker = ' Candidate mechanism:';
    const splitPos = claim.text.indexOf(candMarker);
    if (splitPos > 0) {
      const quantitativePrefix = claim.text.slice(0, splitPos).trim();
      const hypothesisTail = claim.text.slice(splitPos + 1).trim();
      evidenceClaims.push({
        claim,
        displayText: quantitativePrefix,
      });
      if (!seenHypothesisStrings.has(hypothesisTail)) {
        seenHypothesisStrings.add(hypothesisTail);
        const splitTail = splitHypothesisClauses(hypothesisTail);
        hypotheses.push({
          key: `${claim.claimId}:hypothesis`,
          mechanismText: splitTail.mechanismText,
          checkNextText: splitTail.checkNextText,
          combinedDisplayText: splitTail.combinedDisplayText,
          linkedClaim: claim,
        });
      }
      continue;
    }

    evidenceClaims.push({
      claim,
      displayText: claim.text,
    });
  }

  return { evidenceClaims, hypotheses };
}

function extractHeadlineConfidenceBadge(
  headlineText: string,
  verdict: AutopsyVerdictDecision | undefined,
  factsById: ReadonlyMap<string, EngineFact>,
  headlineFactIds: readonly string[],
): string {
  if (verdict !== undefined) {
    return formatConfidenceBadgeLabel(verdict.confidence);
  }
  for (const factId of headlineFactIds) {
    const fact = factsById.get(factId);
    const confMetric = fact?.metrics.find((m) => m.key === 'confidence');
    if (confMetric) {
      return formatConfidenceBadgeLabel(confMetric.numericValue);
    }
  }
  const match = /\(confidence (\d\.\d{2})\)/.exec(headlineText);
  return formatConfidenceBadgeLabel(match ? Number(match[1]) : 0.95);
}

function resolveSingleWaferBadgeLabel(
  claim: ReportClaim,
  lot: LotModel,
  factsById: ReadonlyMap<string, EngineFact>,
): string | null {
  const res = resolveClaimWaferTarget(claim, lot, 0, factsById);
  if (!res.isSingleWaferClaim || res.targetWaferIndex === undefined) {
    return null;
  }
  const wf = lot.wafers[res.targetWaferIndex];
  return wf ? `Wafer ${wf.waferId}` : null;
}

/**
 * Verdict-first **Autopsy Report** card rendered at the top of the loaded workspace
 * (`src/ui/report/AutopsyReportCard.tsx`).
 *
 * - Leads with the Requirement 10.1 cause-of-death headline, heuristic confidence score,
 *   and 2–4 quantitative evidence claims grounded in `EngineFact`s.
 * - Collapses hedged engineering root-cause hypotheses and `"Check next:"` verification
 *   steps by default behind an accessible disclosure button (`aria-expanded`).
 * - Clicking any claim or the headline writes its cited die set (`resolvedDieIndices`)
 *   to `SelectionStore` (and selects the relevant wafer when wafer-specific), lighting
 *   those dies on `OverlayCanvas` in `#D6E6FF`; clicking the active claim again clears.
 *
 * Validates: Requirements 2.4, 9.3, 10.1, 10.3, 10.4, 10.5, 14.2, 14.3, 17.1–17.4
 */
export function AutopsyReportCard({
  lot,
  report,
  verdict,
  facts,
  store = useSelectionStore,
  defaultHypothesesOpen = false,
}: AutopsyReportCardProps): React.JSX.Element {
  const [hypothesesOpen, setHypothesesOpen] = React.useState<boolean>(
    defaultHypothesesOpen,
  );
  const hypothesesPanelId = React.useId();

  const { storeLot, activeClaimId } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      activeClaimId: s.claimHighlight?.claimId ?? null,
    })),
  );

  const effectiveActiveClaimId = storeLot === lot ? activeClaimId : null;

  const factsById = React.useMemo(() => {
    const map = new Map<string, EngineFact>();
    if (facts) {
      for (const fact of facts) {
        map.set(fact.factId, fact);
      }
    }
    return map;
  }, [facts]);

  const { evidenceClaims, hypotheses } = React.useMemo(
    () => partitionClaimsAndHypotheses(report, factsById),
    [report, factsById],
  );

  const hasFailures = React.useMemo(() => {
    if (verdict !== undefined) {
      return verdict.totalFailDies > 0;
    }
    return !report.causeOfDeathHeadline.text.startsWith(
      'Cause of death: No failure pattern detected',
    );
  }, [verdict, report.causeOfDeathHeadline.text]);

  const confidenceBadgeText = React.useMemo(
    () =>
      extractHeadlineConfidenceBadge(
        report.causeOfDeathHeadline.text,
        verdict,
        factsById,
        report.causeOfDeathHeadline.citedFactIds,
      ),
    [
      report.causeOfDeathHeadline.text,
      report.causeOfDeathHeadline.citedFactIds,
      verdict,
      factsById,
    ],
  );

  const handleToggleClaim = React.useCallback(
    (claim: ReportClaim): void => {
      toggleReportClaimInStore(store, lot, claim, factsById);
    },
    [store, lot, factsById],
  );

  const headlineWaferLabel = React.useMemo(
    () =>
      resolveSingleWaferBadgeLabel(
        report.causeOfDeathHeadline,
        lot,
        factsById,
      ),
    [report.causeOfDeathHeadline, lot, factsById],
  );

  const waferLabelByClaimId = React.useMemo(() => {
    const map = new Map<string, string | null>();
    for (const { claim } of evidenceClaims) {
      map.set(claim.claimId, resolveSingleWaferBadgeLabel(claim, lot, factsById));
    }
    for (const item of hypotheses) {
      if (item.linkedClaim && !map.has(item.linkedClaim.claimId)) {
        map.set(
          item.linkedClaim.claimId,
          resolveSingleWaferBadgeLabel(item.linkedClaim, lot, factsById),
        );
      }
    }
    return map;
  }, [evidenceClaims, hypotheses, lot, factsById]);

  const liveAnnouncement = React.useMemo(() => {
    const headlineText = report.causeOfDeathHeadline.text;
    if (!effectiveActiveClaimId) {
      return headlineText;
    }
    const activeClaim =
      report.causeOfDeathHeadline.claimId === effectiveActiveClaimId
        ? report.causeOfDeathHeadline
        : report.bodyClaims.find((c) => c.claimId === effectiveActiveClaimId);
    if (!activeClaim) {
      return `${headlineText} Highlighted finding: ${effectiveActiveClaimId}.`;
    }
    const dieCount = activeClaim.resolvedDieIndices.length;
    const dieNoun = dieCount === 1 ? 'die' : 'dies';
    const waferSuffix =
      activeClaim === report.causeOfDeathHeadline
        ? headlineWaferLabel
        : (waferLabelByClaimId.get(activeClaim.claimId) ?? null);
    return `${headlineText} Selected finding (${activeClaim.claimId}): ${formatGroupedInt(dieCount)} cited ${dieNoun} highlighted${waferSuffix ? ` on ${waferSuffix}` : ' on wafer map'}.`;
  }, [
    report.causeOfDeathHeadline,
    report.bodyClaims,
    effectiveActiveClaimId,
    headlineWaferLabel,
    waferLabelByClaimId,
  ]);

  return (
    <Card
      aria-label="Autopsy Report"
      data-testid="autopsy-report-card"
      className="border-hairline bg-panel"
    >
      <div
        data-testid="autopsy-live-region"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveAnnouncement}
      </div>

      <CardHeader className="gap-2.5 p-5 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[12px] tracking-wider text-text-tertiary uppercase">
              Autopsy Report
            </h2>
            <NarrationBadge source={report.source} />
            <Badge
              variant="neutral"
              aria-label={`Confidence ${confidenceBadgeText}`}
              title="Deterministic heuristic feature score (uncalibrated [0, 1] scale, capped at 0.95)"
            >
              {confidenceBadgeText}
            </Badge>
          </div>

          <span className="font-mono text-[12px] text-text-tertiary">
            Click a finding to light its dies
          </span>
        </div>

        <ClaimInlineButton
          claim={report.causeOfDeathHeadline}
          variant="headline"
          hasFailures={hasFailures}
          targetWaferLabel={headlineWaferLabel}
          isActive={
            effectiveActiveClaimId === report.causeOfDeathHeadline.claimId
          }
          onToggle={handleToggleClaim}
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-2.5 px-5 pt-0 pb-5">
        {/* 2–4 quantitative evidence claims grounded in deterministic EngineFacts */}
        <div
          role="group"
          aria-label="Diagnostic evidence claims"
          className="flex flex-col gap-2"
        >
          {evidenceClaims.map(({ claim, displayText }) => (
            <ClaimInlineButton
              key={claim.claimId}
              claim={claim}
              displayText={displayText}
              variant="body"
              targetWaferLabel={waferLabelByClaimId.get(claim.claimId) ?? null}
              isActive={effectiveActiveClaimId === claim.claimId}
              onToggle={handleToggleClaim}
            />
          ))}
        </div>

        {/* Hedged engineering root-cause hypotheses & check-next steps (collapsed by default) */}
        {hypotheses.length > 0 ? (
          <div className="mt-0.5 border-t border-hairline pt-2.5">
            <button
              type="button"
              data-testid="autopsy-hypotheses-toggle"
              aria-expanded={hypothesesOpen}
              aria-controls={hypothesesPanelId}
              onClick={() => setHypothesesOpen((prev) => !prev)}
              className="inline-flex w-full cursor-pointer items-center justify-between gap-3 rounded-control border border-transparent px-2.5 py-1.5 text-left text-[13px] text-text-secondary transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)] hover:bg-raised hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="font-mono text-[12px] text-text-tertiary"
                >
                  {hypothesesOpen ? '▾' : '▸'}
                </span>
                <span>Candidate root-cause hypotheses &amp; check-next steps</span>
              </span>
              <Badge variant="neutral">
                {hypotheses.length}{' '}
                {hypotheses.length === 1 ? 'hypothesis' : 'hypotheses'}
              </Badge>
            </button>

            <div
              id={hypothesesPanelId}
              role="region"
              aria-label="Candidate root-cause hypotheses"
              hidden={!hypothesesOpen}
              className={hypothesesOpen ? 'mt-2.5 flex flex-col gap-2' : 'hidden'}
            >
              {hypothesesOpen
                ? hypotheses.map((item) => {
                    if (
                      item.linkedClaim &&
                      item.linkedClaim.claimId === 'claim:root-cause-hypothesis'
                    ) {
                      return (
                        <div key={item.key} className="flex flex-col gap-1">
                          <ClaimInlineButton
                            claim={item.linkedClaim}
                            displayText={item.combinedDisplayText}
                            variant="body"
                            targetWaferLabel={
                              waferLabelByClaimId.get(item.linkedClaim.claimId) ??
                              null
                            }
                            isActive={
                              effectiveActiveClaimId === item.linkedClaim.claimId
                            }
                            onToggle={handleToggleClaim}
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.key}
                        className="rounded-control border border-hairline bg-raised/40 px-3.5 py-2.5 text-[14px] leading-relaxed"
                      >
                        <p className="text-text-secondary">{item.mechanismText}</p>
                        {item.checkNextText ? (
                          <p className="mt-1 text-text-primary">
                            {item.checkNextText}
                          </p>
                        ) : null}
                      </div>
                    );
                  })
                : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
