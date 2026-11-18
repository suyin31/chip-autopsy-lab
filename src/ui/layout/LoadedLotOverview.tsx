'use client';

import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { DemoPresetId, DemoPresetMeta } from '@/core/demo';
import { sanitizeReportProseText } from '@/core/report';
import {
  formatGroupedInt,
  formatScore2,
  formatYieldPct,
} from '@/ui/format';
import {
  Badge,
  Card,
  CardContent,
  cn,
} from '@/ui/primitives';
import { AutopsyReportCard } from '@/ui/report';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import { WaferMapCanvas } from '@/ui/wafer-map';
import type { AutopsyWorkerLoadedPayload } from '@/workers';

export interface LoadedLotOverviewProps {
  readonly data: AutopsyWorkerLoadedPayload;
  readonly presets?: readonly DemoPresetMeta[];
  readonly selectedPresetId?: DemoPresetId;
  readonly onSelectPreset?: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot?: (presetId: DemoPresetId) => void;
  readonly onDownloadDemoLot?: (presetId: DemoPresetId) => void;
  readonly downloadingPresetId?: DemoPresetId | null;
  readonly onSelectFile?: (file: File) => void;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
}

/**
 * Loaded-lot diagnostic workspace:
 * 1. Above-the-fold hero row: side-by-side at `>= 1280 px` (`AutopsyReportCard` left ~44%,
 *    `WaferMapCanvas` + 25-wafer lot strip right ~56%) so the verdict and cited dies are
 *    simultaneously visible at `1440x900`; stacked verdict-first below `1280 px`.
 * 2. Supporting lot KPI tiles, interactive Test Site yield breakdown table, and stream warnings below.
 *
 * Lot switching and file opening live in `NavBar` / `LotPicker` (redesign §0, §4.1, §4.2).
 * All STDF strings (`lotId`, `partTyp`, `jobNam`, warning details, report claims)
 * are sanitized and rendered strictly via React plain-text nodes (Requirement 2.4).
 */
export function LoadedLotOverview({
  data,
  store = useSelectionStore,
}: LoadedLotOverviewProps): React.JSX.Element {
  const { lot, yieldSummary, siteAnomalies, facts, verdict, report } = data;
  const overall = yieldSummary.overall;
  const primaryAnomaly = siteAnomalies[0];

  const { storeLot, rawSiteFilter } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawSiteFilter: s.siteFilter,
    })),
  );
  const activeSiteFilter = storeLot === lot ? rawSiteFilter : null;

  React.useEffect(() => {
    store.getState().setLot(lot);
  }, [lot, store]);

  const anomalyBySiteIndex = React.useMemo(() => {
    const map = new Map<number, (typeof siteAnomalies)[number]>();
    for (const anomaly of siteAnomalies) {
      map.set(anomaly.site.siteIndex, anomaly);
    }
    return map;
  }, [siteAnomalies]);

  const visibleWarnings = React.useMemo(
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

  const handleToggleSite = React.useCallback(
    (siteIndex: number): void => {
      const state = store.getState();
      if (state.lot !== lot) {
        state.setLot(lot);
      }
      store.getState().toggleSiteFilter(siteIndex);
    },
    [lot, store],
  );

  return (
    <div className="flex flex-col gap-4">
      {lot.parseMode === 'bins-only' ? (
        <div
          role="status"
          data-testid="bins-only-notice"
          className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-hairline bg-panel px-4 py-2.5 text-[13px] text-text-secondary"
        >
          <span>
            <span className="font-medium text-text-primary">
              Bins-only mode active:
            </span>{' '}
            Parametric records (PTR, MPR, FTR) were skipped above 200 MB. Wafer
            map, bin Pareto inputs, yield, and spatial diagnosis remain intact.
          </span>
          <span className="font-mono text-[12px] text-text-tertiary tabular-nums">
            {formatGroupedInt(data.skippedRecordCount)} records skipped
          </span>
        </div>
      ) : null}

      {/* Hero row: >=1280px side-by-side (verdict left ~44%, wafer map + lot strip right ~56%); <1280px stacked verdict-first */}
      <div
        data-testid="verdict-wafer-hero-grid"
        className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,44fr)_minmax(0,56fr)]"
      >
        <AutopsyReportCard
          lot={lot}
          report={report}
          verdict={verdict}
          facts={facts}
          store={store}
        />

        <Card aria-label="Wafer Map and Lot Strip">
          <CardContent className="p-4 sm:p-5">
            <WaferMapCanvas
              lot={lot}
              byWaferYield={yieldSummary.byWafer}
              store={store}
            />
          </CardContent>
        </Card>
      </div>

      {/* Lot KPI tiles below hero row */}
      <section aria-label="Lot Yield Summary">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-panel border border-hairline bg-panel p-3.5">
            <dt className="text-[12px] text-text-tertiary">Final Yield</dt>
            <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
              {formatYieldPct(overall.finalYield)}
            </dd>
          </div>

          <div className="rounded-panel border border-hairline bg-panel p-3.5">
            <dt className="text-[12px] text-text-tertiary">First-Pass Yield</dt>
            <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
              {formatYieldPct(overall.firstPassYield)}
            </dd>
          </div>

          <div className="rounded-panel border border-hairline bg-panel p-3.5">
            <dt className="text-[12px] text-text-tertiary">Tested Dies</dt>
            <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
              {formatGroupedInt(overall.testedDies)}
            </dd>
          </div>

          <div className="rounded-panel border border-hairline bg-panel p-3.5">
            <dt className="text-[12px] text-text-tertiary">Failing Dies</dt>
            <dd
              className={cn(
                'mt-1 font-mono text-[20px] tabular-nums',
                overall.finalFailDies > 0 ? 'text-failure' : 'text-text-primary',
              )}
            >
              {formatGroupedInt(overall.finalFailDies)}
            </dd>
          </div>

          <div className="rounded-panel border border-hairline bg-panel p-3.5">
            <dt className="text-[12px] text-text-tertiary">Retests</dt>
            <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
              {formatGroupedInt(overall.retestExecutions)}
            </dd>
          </div>

          <div className="rounded-panel border border-hairline bg-panel p-3.5">
            <dt className="text-[12px] text-text-tertiary">Wafers</dt>
            <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
              {formatGroupedInt(lot.wafers.length)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Interactive Test Site yield breakdown table below KPI tiles */}
      {lot.sites.length > 0 ? (
        <Card aria-label="Test Site Yield Breakdown">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h3 className="text-[16px] text-text-primary">
                  Test Site Yield Breakdown
                </h3>
                <span className="font-mono text-[12px] text-text-tertiary">
                  Click a site row to light its dies
                </span>
              </div>
              {primaryAnomaly ? (
                <Badge variant="failure">
                  {`Head ${primaryAnomaly.site.headNum} · Site ${primaryAnomaly.site.siteNum} — site concentration anomaly · confidence ${formatScore2(primaryAnomaly.confidence)}`}
                </Badge>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-control border border-hairline">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-hairline bg-raised text-[12px] text-text-tertiary">
                    <th className="py-2 pr-3.5 pl-4 font-medium">Test Site</th>
                    <th className="px-3.5 py-2 text-right font-medium">
                      Tested Dies
                    </th>
                    <th className="px-3.5 py-2 text-right font-medium">
                      First-Pass Yield
                    </th>
                    <th className="px-3.5 py-2 text-right font-medium">
                      Final Yield
                    </th>
                    <th className="px-3.5 py-2 text-right font-medium">
                      Retests
                    </th>
                    <th className="px-3.5 py-2 text-right font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lot.sites.map((site, idx) => {
                    const metrics = yieldSummary.bySite[idx];
                    if (!metrics) {
                      return null;
                    }
                    const anomaly = anomalyBySiteIndex.get(site.siteIndex);
                    const isSiteSelected =
                      activeSiteFilter === site.siteIndex;
                    return (
                      <tr
                        key={site.label}
                        data-testid="site-breakdown-row"
                        onClick={() => handleToggleSite(site.siteIndex)}
                        className={cn(
                          'group cursor-pointer border-b border-hairline last:border-b-0',
                          isSiteSelected ? 'bg-accent/8' : 'hover:bg-raised',
                        )}
                      >
                        <td className="relative py-2 pr-3.5 pl-4">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-accent transition-opacity duration-150 ease-[var(--ease-clinical)]',
                              isSiteSelected
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-65 group-focus-within:opacity-65',
                            )}
                          />
                          <button
                            type="button"
                            data-testid="site-row-toggle-button"
                            aria-pressed={isSiteSelected}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSite(site.siteIndex);
                            }}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-xs py-0.5 text-left font-mono text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          >
                            <span>
                              Head {site.headNum} · Site {site.siteNum}
                            </span>
                            {isSiteSelected ? (
                              <Badge variant="accent">Highlighted</Badge>
                            ) : null}
                          </button>
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono text-text-secondary tabular-nums">
                          {formatGroupedInt(metrics.testedDies)}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono text-text-secondary tabular-nums">
                          {formatYieldPct(metrics.firstPassYield)}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono text-text-primary tabular-nums">
                          {formatYieldPct(metrics.finalYield)}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono text-text-secondary tabular-nums">
                          {formatGroupedInt(metrics.retestExecutions)}
                        </td>
                        <td className="px-3.5 py-2 text-right">
                          {anomaly ? (
                            <Badge variant="failure">
                              z = {anomaly.twoProportionZ.toFixed(1)} (
                              {anomaly.yieldDeltaPp.toFixed(1)} pp yield drop)
                            </Badge>
                          ) : (
                            <span className="font-mono text-[12px] text-text-tertiary">
                              Nominal
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Non-blocking parse warnings if present */}
      {visibleWarnings.length > 0 ? (
        <div className="rounded-panel border border-hairline bg-panel p-4">
          <p className="font-mono text-[12px] text-text-secondary">
            Recovered with {formatGroupedInt(lot.warnings.length)} stream
            warning{lot.warnings.length === 1 ? '' : 's'}:
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[12px] text-text-tertiary">
            {visibleWarnings.map((w, i) => (
              <li key={`${w.byteOffset}-${i}`}>
                [{w.code}] byte {formatGroupedInt(w.byteOffset)} (REC_TYP{' '}
                {w.recTyp}, REC_SUB {w.recSub}): {w.cleanDetail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
