'use client';

import * as React from 'react';
import type { StoreApi } from 'zustand';
import type { DemoPresetId, DemoPresetMeta } from '@/core/demo';
import { sanitizeReportProseText } from '@/core/report';
import { formatGroupedInt } from '@/ui/format';
import { AutopsyReportCard } from '@/ui/report';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import { WaferMapCanvas } from '@/ui/wafer-map';
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
 * Loaded Verdict & Wafer Stage Workspace (`src/ui/layout/LoadedLotOverview.tsx`, `redesign.md` §3.4):
 * - Desktop (`>= 1280px`, `1440 x 900`): `783fr` boxless Wafer Stage (`783 x 720`, `624 Ø`) +
 *   `64 px` Wafer Strip on columns 1–7, `24 px` gutter, `553fr` independently scrolling Verdict Column
 *   (`padding-top: 56px`, `overflow-y: auto; scrollbar-gutter: stable; overscroll-behavior: contain`)
 *   on columns 8–12. Zero page scroll at `>= 820 px` viewport height.
 * - Mobile (`390 x 844`): single column with Verdict + Confidence + Stats first, full-bleed `390 x 390`
 *   Wafer Stage (`350 Ø`) + `390 x 56` Strip second, and Findings list third.
 */
export function LoadedLotOverview({
  data,
  onParseEverything,
  store = useSelectionStore,
}: LoadedLotOverviewProps): React.JSX.Element {
  const { lot, yieldSummary, facts, verdict, report } = data;

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
        store={store}
        splitForMobileStage
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
