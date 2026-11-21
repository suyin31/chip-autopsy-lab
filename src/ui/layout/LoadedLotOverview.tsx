'use client';

import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { DemoPresetId, DemoPresetMeta } from '@/core/demo';
import { formatFilterDslSummary } from '@/core/query';
import { sanitizeReportProseText } from '@/core/report';
import { BinParetoChart, ParametricPanel, YieldSummaryPanel } from '@/ui/charts';
import { useT } from '@/ui/i18n';
import {
  buildWorkspaceSelectionAnnouncement,
  type WorkspaceSelectionSnapshot,
} from './a11y-announcements';
import {
  readPrefersReducedMotionSync,
  resolveViewMorphTransition,
  WAFER_MORPH_LAYOUT_ID,
} from '@/ui/motion';
import { Button } from '@/ui/primitives/button';
import { AutopsyReportCard } from '@/ui/report';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import {
  EVIDENCE_SCROLL_NAV_GAP_PX,
  navBarHeightPx,
  shouldDeferEvidenceForStage,
  StackedWaferPanel,
  WaferMapCanvas,
} from '@/ui/wafer-map';
import { peekLotInitialRevealPlan } from '@/ui/wafer-map/WaferMapCanvas';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { BinsOnlyNotice } from './BinsOnlyNotice';
import { CoachMarks } from './CoachMarks';

export interface LoadedLotOverviewProps {
  readonly data: AutopsyWorkerLoadedPayload;
  readonly presets?: readonly DemoPresetMeta[];
  readonly selectedPresetId?: DemoPresetId;
  readonly onSelectPreset?: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot?: (presetId: DemoPresetId) => void;
  readonly onDownloadDemoLot?: (presetId: DemoPresetId) => void;
  readonly downloadingPresetId?: DemoPresetId | null;
  readonly onSelectFile?: (file: File) => void;
  readonly onParseEverything?: () => void;
  /** Server-safe boolean indicating whether optional LLM narration is configured. */
  readonly narrationEnabled?: boolean;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
}

/**
 * Loaded Verdict & Wafer Stage Workspace (`src/ui/layout/LoadedLotOverview.tsx`, `redesign.md` §3.4, §5.1–§5.3):
 * - Coordinates the once-per-session probe sweep (premium §8.1) with the verdict rise-in (§8.2),
 *   triggered at ignite start, or at once on skip / subsequent lot load / `prefers-reduced-motion`.
 * - Desktop (`>= 1280px`, premium §6.2): 12-column grid with a `24 px` gutter. The sticky stage
 *   column (cols 1–7, `top: 52px`, `calc(100dvh - 52px)` tall, min 640, padding 20 / 16) holds the
 *   header, flex-1 wafer area, control row, and strip; the verdict column (cols 8–12) scrolls with
 *   the page and ends with the privacy footer line (96 above, 64 below).
 * - md (`1024–1279`): two columns, stage fixed 540 + 20 gutter + verdict column; stage stays sticky.
 * - sm (`640–1023`): one centred 640 px column. xs (`< 640`): full-bleed `390 x 390` stage.
 *   Both order verdict, takeaway, action row, stage (header, wafer, controls, strip), stats,
 *   findings, possible causes, sections. A finding click scrolls the stage to 8 px under the nav.
 */
export function LoadedLotOverview({
  data,
  selectedPresetId = 'edge-ring-etch',
  onLoadDemoLot,
  onParseEverything,
  narrationEnabled = false,
  store = useSelectionStore,
}: LoadedLotOverviewProps): React.JSX.Element {
  const { lot, probeOrderByWafer, yieldSummary, facts, verdict, report } = data;
  const { locale, t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const prefersReduced = readPrefersReducedMotionSync(shouldReduceMotion);

  const {
    storeLot,
    hasActiveFilter,
    selectedDieCount,
    dslFilter,
    activeWaferIndex,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      hasActiveFilter: s.hasActiveFilter,
      selectedDieCount: s.selectedDieCount,
      dslFilter: s.dslFilter,
      activeWaferIndex: s.activeWaferIndex,
    })),
  );
  const [selectionAnnouncement, setSelectionAnnouncement] = React.useState('');
  const prevSelectionRef = React.useRef<{
    readonly lotId: string;
    readonly snapshot: WorkspaceSelectionSnapshot;
  } | null>(null);

  React.useEffect(() => {
    if (storeLot !== lot) {
      return;
    }
    const nextSnapshot: WorkspaceSelectionSnapshot = {
      hasActiveFilter,
      selectedDieCount,
      activeWaferIndex,
      pinnedDieIndex: null,
    };
    const prevEntry = prevSelectionRef.current;
    const prevSnapshot =
      prevEntry && prevEntry.lotId === lot.lotId ? prevEntry.snapshot : null;
    prevSelectionRef.current = { lotId: lot.lotId, snapshot: nextSnapshot };
    const message = buildWorkspaceSelectionAnnouncement({
      lot,
      byWaferYield: yieldSummary.byWafer,
      locale,
      prev: prevSnapshot,
      next: nextSnapshot,
    });
    if (message !== null) {
      setSelectionAnnouncement(message);
    }
  }, [
    storeLot,
    lot,
    yieldSummary.byWafer,
    locale,
    hasActiveFilter,
    selectedDieCount,
    activeWaferIndex,
  ]);
  const isZeroMatches =
    storeLot === lot && hasActiveFilter && selectedDieCount === 0;
  const noResultsFilterSummary = React.useMemo(() => {
    if (!isZeroMatches || dslFilter === null) {
      return '';
    }
    return formatFilterDslSummary(dslFilter, lot);
  }, [isZeroMatches, dslFilter, lot]);

  const [revealedLot, setRevealedLot] = React.useState<typeof lot | null>(() => {
    if (typeof window === 'undefined') {
      return lot;
    }
    const plan = peekLotInitialRevealPlan(lot, prefersReduced);
    return plan.mode === 'sweep' ? null : lot;
  });

  // Sync synchronously when switching to a new lot
  const prevLotRef = React.useRef(lot);
  if (prevLotRef.current !== lot) {
    prevLotRef.current = lot;
    const plan =
      typeof window === 'undefined'
        ? { mode: 'reduced' as const }
        : peekLotInitialRevealPlan(lot, prefersReduced);
    const nextRevealed = plan.mode === 'sweep' ? null : lot;
    if (revealedLot !== nextRevealed) {
      setRevealedLot(nextRevealed);
    }
  }

  const handleVerdictRevealTrigger = React.useCallback((): void => {
    setRevealedLot((prev) => (prev === lot ? prev : lot));
  }, [lot]);

  const verdictRevealed = prefersReduced || revealedLot === lot;

  const [morphSettledLot, setMorphSettledLot] = React.useState<
    typeof lot | null
  >(() => (prefersReduced ? lot : null));
  const morphSettled = prefersReduced || morphSettledLot === lot;

  React.useEffect(() => {
    if (prefersReduced) {
      setMorphSettledLot(lot);
      return;
    }
    const timer = window.setTimeout(() => {
      setMorphSettledLot(lot);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [lot, prefersReduced]);

  React.useEffect(() => {
    store.getState().setLot(lot);
  }, [lot, store]);

  // Requirement 11.5: pressing Escape anywhere (when no dialog, menu, popover, or text input
  // is open) clears the active spatial brush and filters, restoring full-scope aggregations.
  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleGlobalEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable)
      ) {
        return;
      }
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [data-testid="coach-mark-bubble"], [data-testid="term-popover"]',
        ) !== null
      ) {
        return;
      }
      const state = store.getState();
      if (state.hasActiveFilter || state.dslFilter !== null) {
        event.preventDefault();
        state.setBrush(null);
        state.setBinFilter(null);
        state.setSiteFilter(null);
        state.setWaferFilter(null);
        state.setDslFilter(null);
        return;
      }
      if (state.claimHighlight !== null) {
        event.preventDefault();
        state.setClaimHighlight(null);
      }
    };
    window.addEventListener('keydown', handleGlobalEscape);
    return () => window.removeEventListener('keydown', handleGlobalEscape);
  }, [store]);

  // Premium §6.2, §8.3: below 1024 the findings, Pareto, and yield rows sit under the wafer, so
  // any new evidence (one store, every trigger) scrolls the stage top to 8 px under the nav when
  // less than 50 % of the stage is visible (smooth; instant under reduced motion). Never on desktop.
  const stageColumnRef = React.useRef<HTMLDivElement | null>(null);
  const prefersReducedRef = React.useRef(prefersReduced);
  prefersReducedRef.current = prefersReduced;
  React.useEffect(() => {
    return store.subscribe((state, prev) => {
      const nextId = state.claimHighlight?.claimId ?? null;
      if (
        nextId === null ||
        nextId === (prev.claimHighlight?.claimId ?? null) ||
        typeof window === 'undefined'
      ) {
        return;
      }
      const stageEl = stageColumnRef.current?.querySelector<HTMLElement>(
        '[data-testid="wafer-stage"]',
      );
      if (!stageEl) {
        return;
      }
      const rect = stageEl.getBoundingClientRect();
      if (
        !shouldDeferEvidenceForStage(
          window.innerWidth,
          window.innerHeight,
          rect.top,
          rect.height,
        )
      ) {
        return;
      }
      const targetScrollY = Math.max(
        0,
        window.scrollY +
          rect.top -
          navBarHeightPx(window.innerWidth) -
          EVIDENCE_SCROLL_NAV_GAP_PX,
      );
      window.scrollTo({
        top: targetScrollY,
        behavior: prefersReducedRef.current ? 'instant' : 'smooth',
      });
    });
  }, [store]);

  const sanitizedWarnings = React.useMemo(
    () =>
      lot.warnings.slice(0, 5).map((w) => ({
        code: w.code,
        byteOffset: w.byteOffset,
        recTyp: w.recTyp,
        recSub: w.recSub,
        cleanDetail: sanitizeReportProseText(w.detail),
      })),
    [lot.warnings],
  );

  return (
    <>
      {isZeroMatches ? (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="no-results-empty-state"
          className="mb-5 flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between lg:mt-5 lg:mb-0"
        >
          <div className="min-w-0">
            <h2 className="type-headline text-text-primary">
              {t('empty.noResults.title')}
            </h2>
            <p className="mt-1 type-subhead text-pretty text-text-secondary">
              {noResultsFilterSummary
                ? t('empty.noResults.bodyFilter', {
                    filter: noResultsFilterSummary,
                  })
                : t('empty.noResults.body')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button
              variant="secondary"
              size="md"
              data-testid="no-results-clear-filters"
              onClick={() => store.getState().clearFilters()}
            >
              {t('empty.noResults.clear')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              data-testid="no-results-load-demo"
              onClick={() => onLoadDemoLot?.(selectedPresetId)}
              disabled={!onLoadDemoLot}
            >
              {t('landing.primary')}
            </Button>
          </div>
        </div>
      ) : null}
      <div
        data-testid="verdict-wafer-hero-grid"
        className="flex w-full flex-col sm:max-lg:mx-auto sm:max-lg:max-w-[640px] lg:grid lg:grid-cols-[540px_minmax(0,1fr)] lg:items-start lg:gap-x-5 xl:grid-cols-12 xl:gap-x-6"
      >
      <AutopsyReportCard
        lot={lot}
        report={report}
        verdict={verdict}
        facts={facts}
        yieldSummary={yieldSummary}
        verdictRevealed={verdictRevealed}
        narrationEnabled={narrationEnabled}
        store={store}
        splitForMobileStage
        belowFindings={
          <>
            <BinParetoChart lot={lot} store={store} />
            <YieldSummaryPanel
              lot={lot}
              yieldSummary={yieldSummary}
              facts={facts}
              store={store}
              className="mt-10 lg:mt-16"
            />
            {lot.wafers.length >= 2 ? (
              <StackedWaferPanel
                lot={lot}
                byWaferYield={yieldSummary.byWafer}
                store={store}
                className="mt-10 lg:mt-16"
              />
            ) : null}
            {lot.tests.size > 0 ? (
              <ParametricPanel
                lot={lot}
                store={store}
                className="mt-10 lg:mt-16"
              />
            ) : null}
            <p
              data-testid="verdict-footer"
              className="mt-10 type-subhead text-text-tertiary lg:mt-16"
            >
              {t('report.footer')}
            </p>
          </>
        }
        className="lg:col-start-2 lg:row-start-1 xl:col-span-5 xl:col-start-8"
        binsOnlyNotice={
          lot.parseMode === 'bins-only' ? (
            <BinsOnlyNotice
              {...(onParseEverything !== undefined
                ? { onParseEverything }
                : {})}
            />
          ) : undefined
        }
      />

      <div
        ref={stageColumnRef}
        data-testid="stage-column"
        className="order-2 -mx-4 mt-5 w-[calc(100%+2rem)] sm:mx-0 sm:w-full lg:sticky lg:top-[52px] lg:order-none lg:col-start-1 lg:row-start-1 lg:mt-0 lg:h-[calc(100dvh-52px)] lg:min-h-[640px] lg:pt-5 lg:pb-4 xl:col-span-7"
      >
        <div className="relative h-full w-full">
          <motion.div
            key={lot.lotId}
            aria-hidden="true"
            data-testid="wafer-shared-morph"
            data-morph-state={morphSettled ? 'settled' : 'morphing'}
            layoutId={prefersReduced ? undefined : WAFER_MORPH_LAYOUT_ID}
            transition={resolveViewMorphTransition(prefersReduced)}
            onLayoutAnimationComplete={() => setMorphSettledLot(lot)}
            className="pointer-events-none absolute inset-0 rounded-full"
          />
          <WaferMapCanvas
            lot={lot}
            byWaferYield={yieldSummary.byWafer}
            probeOrderByWafer={probeOrderByWafer}
            enableInitialReveal
            onVerdictRevealTrigger={handleVerdictRevealTrigger}
            store={store}
          />
        </div>
      </div>

      {/* Premium §2.4, §7.18: first-use hints (portalled; at most one visible) */}
      <CoachMarks lot={lot} verdictRevealed={verdictRevealed} store={store} />

      {/* Persistent polite live region for filter, wafer, and die selection changes (Req 14.4) */}
      <div
        data-testid="selection-live-region"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {selectionAnnouncement}
      </div>

      {sanitizedWarnings.length > 0 ? (
        <div className="sr-only" role="status">
          Recovered with {formatInteger(lot.warnings.length)} stream warning
          {lot.warnings.length === 1 ? '' : 's'}:{' '}
          {sanitizedWarnings
            .map(
              (w) =>
                `[${w.code}] byte ${formatInteger(w.byteOffset)} (REC_TYP ${w.recTyp}, REC_SUB ${w.recSub}): ${w.cleanDetail}`,
            )
            .join(' | ')}
        </div>
      ) : null}
    </div>
    </>
  );
}
