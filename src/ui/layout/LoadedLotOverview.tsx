'use client';

import * as React from 'react';
import type { DemoPresetId, DemoPresetMeta } from '@/core/demo';
import {
  formatByteSize,
  formatGroupedInt,
  formatScore2,
  formatYieldPct,
} from '@/ui/format';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives';
import type { AutopsyWorkerLoadedPayload } from '@/workers';

export interface LoadedLotOverviewProps {
  readonly data: AutopsyWorkerLoadedPayload;
  readonly presets: readonly DemoPresetMeta[];
  readonly selectedPresetId: DemoPresetId;
  readonly onSelectPreset: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot: (presetId: DemoPresetId) => void;
  readonly onSelectFile: (file: File) => void;
}

/**
 * Clinical lot telemetry summary rendered once `autopsy.worker.ts` resolves
 * a `LotModel` and `YieldSummary` (ahead of Tasks 5–7 adding the Canvas2D
 * wafer map and `AutopsyReportCard`).
 *
 * All STDF strings (`lotId`, `partTyp`, `jobNam`, warning details) render
 * strictly via React plain-text nodes (Requirement 2.4).
 */
export function LoadedLotOverview({
  data,
  presets,
  selectedPresetId,
  onSelectPreset,
  onLoadDemoLot,
  onSelectFile,
}: LoadedLotOverviewProps): React.JSX.Element {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { lot, yieldSummary, siteAnomalies } = data;
  const overall = yieldSummary.overall;

  const anomalyBySiteIndex = React.useMemo(() => {
    const map = new Map<number, (typeof siteAnomalies)[number]>();
    for (const anomaly of siteAnomalies) {
      map.set(anomaly.site.siteIndex, anomaly);
    }
    return map;
  }, [siteAnomalies]);

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      onSelectFile(file);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card aria-label="Autopsy Report Lot Summary">
        <CardHeader className="border-b border-hairline pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] tracking-wider text-text-tertiary uppercase">
                Autopsy Report · Lot Telemetry
              </span>
              <Badge variant="accent">
                {data.source.kind === 'demo'
                  ? `Demo · ${data.source.preset.id}`
                  : `File · ${data.source.fileName}`}
              </Badge>
              <Badge variant="neutral">
                {lot.endianness === 'little' ? 'LE' : 'BE'} ·{' '}
                {lot.parseMode === 'bins-only' ? 'Bins-Only' : 'Full Mode'}
              </Badge>
            </div>

            <span className="font-mono text-[12px] text-text-tertiary tabular-nums">
              {formatByteSize(data.uncompressedByteLength)} ·{' '}
              {formatGroupedInt(data.recordsDecoded)} records ·{' '}
              {Math.round(data.elapsedMs)} ms
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <CardTitle className="text-[28px] leading-snug">
                Lot {lot.lotId} · Final Yield {formatYieldPct(overall.finalYield)}
              </CardTitle>
              <CardDescription className="mt-1 font-mono text-[12px] text-text-secondary">
                Part {lot.partTyp || 'N/A'} · Job {lot.jobNam || 'N/A'} ·{' '}
                {formatGroupedInt(lot.wafers.length)} wafers ·{' '}
                {formatGroupedInt(lot.tests.size)} parametric tests
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".stdf,.std,.gz,application/gzip,application/octet-stream"
                onChange={handleFileChange}
                className="sr-only"
                aria-label="Choose another STDF V4 file"
              />
              <label className="sr-only" htmlFor="cal-preset-switcher">
                Select synthetic demo lot preset
              </label>
              <select
                id="cal-preset-switcher"
                value={selectedPresetId}
                onChange={(e) => onSelectPreset(e.target.value as DemoPresetId)}
                className="h-9 rounded-control border border-hairline bg-raised px-3 font-mono text-[12px] text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {presets.map((preset) => (
                  <option
                    key={preset.id}
                    value={preset.id}
                    className="bg-panel text-text-primary"
                  >
                    {preset.title}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="md"
                onClick={() => onLoadDemoLot(selectedPresetId)}
              >
                Load demo lot
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose STDF file
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-control border border-hairline bg-raised p-3.5">
              <dt className="text-[12px] text-text-tertiary">Final Yield</dt>
              <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
                {formatYieldPct(overall.finalYield)}
              </dd>
            </div>

            <div className="rounded-control border border-hairline bg-raised p-3.5">
              <dt className="text-[12px] text-text-tertiary">First-Pass Yield</dt>
              <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
                {formatYieldPct(overall.firstPassYield)}
              </dd>
            </div>

            <div className="rounded-control border border-hairline bg-raised p-3.5">
              <dt className="text-[12px] text-text-tertiary">Tested Dies</dt>
              <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
                {formatGroupedInt(overall.testedDies)}
              </dd>
            </div>

            <div className="rounded-control border border-hairline bg-raised p-3.5">
              <dt className="text-[12px] text-text-tertiary">Failing Dies</dt>
              <dd
                className={`mt-1 font-mono text-[20px] tabular-nums ${
                  overall.finalFailDies > 0 ? 'text-failure' : 'text-text-primary'
                }`}
              >
                {formatGroupedInt(overall.finalFailDies)}
              </dd>
            </div>

            <div className="rounded-control border border-hairline bg-raised p-3.5">
              <dt className="text-[12px] text-text-tertiary">Retests</dt>
              <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
                {formatGroupedInt(overall.retestExecutions)}
              </dd>
            </div>

            <div className="rounded-control border border-hairline bg-raised p-3.5">
              <dt className="text-[12px] text-text-tertiary">Wafers</dt>
              <dd className="mt-1 font-mono text-[20px] text-text-primary tabular-nums">
                {formatGroupedInt(lot.wafers.length)}
              </dd>
            </div>
          </dl>

          {/* Test Site breakdown table */}
          {lot.sites.length > 0 ? (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-2 pb-2">
                <h3 className="text-[16px] text-text-primary">
                  Test Site Yield Breakdown
                </h3>
                {siteAnomalies.length > 0 ? (
                  <Badge variant="failure">
                    Site {siteAnomalies[0]?.site.label} concentration anomaly (
                    confidence {formatScore2(siteAnomalies[0]?.confidence ?? null)})
                  </Badge>
                ) : null}
              </div>

              <div className="overflow-x-auto rounded-control border border-hairline">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline bg-raised text-[12px] text-text-tertiary">
                      <th className="px-3.5 py-2 font-medium">Test Site</th>
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
                      return (
                        <tr
                          key={site.label}
                          className="border-b border-hairline last:border-b-0"
                        >
                          <td className="px-3.5 py-2 font-mono text-text-primary">
                            Head {site.headNum} · Site {site.siteNum}
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
                                {anomaly.yieldDeltaPp.toFixed(1)} pp)
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
            </div>
          ) : null}

          {/* Non-blocking parse warnings if present */}
          {lot.warnings.length > 0 ? (
            <div className="mt-6 rounded-control border border-hairline bg-raised p-4">
              <p className="font-mono text-[12px] text-text-secondary">
                Recovered with {formatGroupedInt(lot.warnings.length)} stream
                warning{lot.warnings.length === 1 ? '' : 's'}:
              </p>
              <ul className="mt-2 space-y-1 font-mono text-[12px] text-text-tertiary">
                {lot.warnings.slice(0, 5).map((w, i) => (
                  <li key={`${w.byteOffset}-${i}`}>
                    [{w.code}] byte {formatGroupedInt(w.byteOffset)} (REC_TYP{' '}
                    {w.recTyp}, REC_SUB {w.recSub}): {w.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
