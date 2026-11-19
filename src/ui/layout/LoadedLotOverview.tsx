'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { StoreApi } from 'zustand';
import type { DemoPresetId, DemoPresetMeta } from '@/core/demo';
import { sanitizeReportProseText } from '@/core/report';
import { BinParetoChart, YieldSummaryPanel } from '@/ui/charts';
import { formatGroupedInt } from '@/ui/format';
import { useT } from '@/ui/i18n';
import { AutopsyReportCard } from '@/ui/report';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import {
  EVIDENCE_SCROLL_NAV_GAP_PX,
  navBarHeightPx,
  readPrefersReducedMotionSync,
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
  onParseEverything,
  store = useSelectionStore,
}: LoadedLotOverviewProps): React.JSX.Element {
  const { lot, probeOrderByWafer, yieldSummary, facts, verdict, report } = data;
  const { t } = useT();
  const shouldReduceMotion = useReducedMotion();
  const prefersReduced = readPrefersReducedMotionSync(shouldReduceMotion);

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

  React.useEffect(() => {
    store.getState().setLot(lot);
  }, [lot, store]);

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
              className="mt-12 lg:mt-24"
            />
            {lot.wafers.length >= 2 ? (
              <StackedWaferPanel
                lot={lot}
                byWaferYield={yieldSummary.byWafer}
                store={store}
                className="mt-12 lg:mt-24"
              />
            ) : null}
            <p
              data-testid="verdict-footer"
              className="mt-12 type-subhead text-text-tertiary lg:mt-24"
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
        <WaferMapCanvas
          lot={lot}
          byWaferYield={yieldSummary.byWafer}
          probeOrderByWafer={probeOrderByWafer}
          enableInitialReveal
          onVerdictRevealTrigger={handleVerdictRevealTrigger}
          store={store}
        />
      </div>

      {/* Premium §2.4, §7.18: first-use hints (portalled; at most one visible) */}
      <CoachMarks lot={lot} verdictRevealed={verdictRevealed} store={store} />

      {sanitizedWarnings.length > 0 ? (
        <div className="sr-only" role="status">
          Recovered with {formatGroupedInt(lot.warnings.length)} stream warning
          {lot.warnings.length === 1 ? '' : 's'}:{' '}
          {sanitizedWarnings
            .map(
              (w) =>
                `[${w.code}] byte ${formatGroupedInt(w.byteOffset)} (REC_TYP ${w.recTyp}, REC_SUB ${w.recSub}): ${w.cleanDetail}`,
            )
            .join(' | ')}
        </div>
      ) : null}
    </div>
  );
}
