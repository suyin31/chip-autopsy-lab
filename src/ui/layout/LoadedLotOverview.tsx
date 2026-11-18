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
  readPrefersReducedMotionSync,
  WaferMapCanvas,
} from '@/ui/wafer-map';
import { peekLotInitialRevealPlan } from '@/ui/wafer-map/WaferMapCanvas';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { BinsOnlyNotice } from './BinsOnlyNotice';

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
 * - Coordinates the once-per-session §5.1 probe sweep with the §5.2 Verdict rise-in (triggered when
 *   the sweep reaches `85%`, or immediately on skip / subsequent lot load / `prefers-reduced-motion`).
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

  // Premium §6.2: below 1024 the findings sit under the wafer, so activating one scrolls the
  // stage top to 8 px under the nav (smooth; instant under reduced motion). Never on desktop.
  const stageColumnRef = React.useRef<HTMLDivElement | null>(null);
  const prefersReducedRef = React.useRef(prefersReduced);
  prefersReducedRef.current = prefersReduced;
  const handleFindingToggle = React.useCallback((activated: boolean): void => {
    if (!activated || typeof window === 'undefined' || window.innerWidth >= 1024) {
      return;
    }
    const stageEl = stageColumnRef.current?.querySelector<HTMLElement>(
      '[data-testid="wafer-stage"]',
    );
    if (!stageEl) {
      return;
    }
    const navHeight = window.innerWidth < 768 ? 48 : 52;
    const targetScrollY = Math.max(
      0,
      window.scrollY + stageEl.getBoundingClientRect().top - navHeight - 8,
    );
    window.scrollTo({
      top: targetScrollY,
      behavior: prefersReducedRef.current ? 'instant' : 'smooth',
    });
  }, []);

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
            <p
              data-testid="verdict-footer"
              className="mt-12 type-subhead text-text-tertiary lg:mt-24"
            >
              {t('report.footer')}
            </p>
          </>
        }
        onFindingToggle={handleFindingToggle}
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
