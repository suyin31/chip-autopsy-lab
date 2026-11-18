'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { StoreApi } from 'zustand';
import type { DemoPresetId, DemoPresetMeta } from '@/core/demo';
import { sanitizeReportProseText } from '@/core/report';
import { BinParetoChart } from '@/ui/charts';
import { formatGroupedInt } from '@/ui/format';
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
 * - Desktop (`>= 1280px`, `1440 x 900`): `783fr` boxless Wafer Stage + `64 px` Strip on columns 1–7,
 *   `24 px` gutter, `553fr` Verdict Column on columns 8–12.
 * - Mobile (`390 x 844`): single column with Verdict + Stats first, full-bleed `390 x 456` Stage +
 *   Strip second, and Findings list third.
 */
export function LoadedLotOverview({
  data,
  onParseEverything,
  store = useSelectionStore,
}: LoadedLotOverviewProps): React.JSX.Element {
  const { lot, probeOrderByWafer, yieldSummary, facts, verdict, report } = data;
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
      className="flex w-full flex-col xl:grid xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,783fr)_minmax(0,553fr)] xl:gap-6"
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
        belowFindings={<BinParetoChart lot={lot} store={store} />}
        className="xl:col-start-2 xl:row-start-1 xl:h-full xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:[scrollbar-gutter:stable]"
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

      <div className="order-2 -mx-4 mt-6 w-[calc(100%+2rem)] md:mx-0 md:w-full xl:order-none xl:col-start-1 xl:row-start-1 xl:mt-0 xl:h-full xl:min-h-0">
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
