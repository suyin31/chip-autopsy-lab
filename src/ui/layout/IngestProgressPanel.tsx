'use client';

import * as React from 'react';
import { formatByteSize, formatGroupedInt } from '@/ui/format';
import { Untranslated, useT } from '@/ui/i18n';
import type { WorkerParseProgress } from '@/workers';

export interface IngestProgressPanelProps {
  readonly label: string;
  readonly progress: WorkerParseProgress;
}

/**
 * Loading state matching the loaded two-column grid (`redesign.md` §3.3):
 * - Left 7 columns (`783fr`): boxless wafer stage with a `624 px` (`350 px` mobile)
 *   silicon disc outline (`ring` only) so nothing jumps when parsing ends.
 * - Right 5 columns (`553fr`, top-aligned with verdict position):
 *   1. `headline` primary: file/lot label (1 line, ellipsis)
 *   2. `8 px` gap, `body` secondary: `"Reading records"` (`aria-live="polite"`)
 *   3. `16 px` gap, `2 px` progress track (`rgba(255,255,255,0.12)`) driven by
 *      `transform: scaleX(p)` (`transform-origin: left`), zero layout animation
 *   4. `8 px` gap, `footnote` tertiary tabular byte readout (`"4.2 of 9.8 MB"`).
 * - Zero `uppercase` labels and zero monospace labels (§0 #2).
 */
export function IngestProgressPanel({
  label,
  progress,
}: IngestProgressPanelProps): React.JSX.Element {
  const { t } = useT();

  const ratio =
    progress.totalBytes !== null && progress.totalBytes > 0
      ? Math.min(1, Math.max(0, progress.bytesProcessed / progress.totalBytes))
      : null;
  const pct = ratio !== null ? ratio * 100 : null;
  const pctLabel = pct !== null ? `${pct.toFixed(1)}%` : null;

  const statusCopy = t('loading.readingRecords');
  const bytesCopy =
    progress.totalBytes !== null && progress.totalBytes > 0
      ? t('loading.bytes', {
          done: formatByteSize(progress.bytesProcessed),
          total: formatByteSize(progress.totalBytes),
        })
      : formatByteSize(progress.bytesProcessed);

  const valueText =
    pctLabel !== null
      ? `${statusCopy} · ${pctLabel} (${bytesCopy}, ${formatGroupedInt(progress.diesResolved)} dies)`
      : `${statusCopy} · ${bytesCopy} (${formatGroupedInt(progress.diesResolved)} dies)`;

  return (
    <div
      data-testid="ingest-loading-view"
      aria-busy="true"
      className="flex w-full flex-col xl:grid xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,783fr)_minmax(0,553fr)] xl:gap-6"
    >
      {/* Right column on desktop / first on mobile: file name + progress stack (§3.3) */}
      <div className="order-1 flex w-full flex-col xl:order-none xl:col-start-2 xl:row-start-1 xl:pt-14">
        <p className="truncate type-headline text-text-primary">
          <Untranslated>{label}</Untranslated>
        </p>

        <p
          aria-live="polite"
          aria-atomic="true"
          className="mt-2 type-body text-text-secondary"
        >
          {statusCopy}
          {pctLabel !== null ? (
            <span className="sr-only"> ({pctLabel})</span>
          ) : null}
        </p>

        <div
          role="progressbar"
          aria-label={t('loading.progressAria', {
            percent: pctLabel ?? '0%',
          })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct !== null ? Math.round(pct) : undefined}
          aria-valuetext={valueText}
          className="mt-4 h-0.5 w-full overflow-hidden rounded-pill bg-white/12"
        >
          <div
            style={{
              transform: `scaleX(${ratio !== null ? Number(ratio.toFixed(4)) : 0.15})`,
              transformOrigin: 'left',
            }}
            className="h-full w-full rounded-pill bg-text-primary transition-transform duration-[120ms] ease-[var(--ease-out)]"
          />
        </div>

        <p className="mt-2 type-footnote text-text-tertiary tabular-nums">
          {bytesCopy}
        </p>
      </div>

      {/* Left column on desktop / second on mobile: 624px / 350px wafer disc outline with ring only (§3.3) */}
      <div className="order-2 -mx-4 mt-6 flex h-[456px] w-[calc(100%+2rem)] items-center justify-center bg-bg md:mx-0 md:h-auto md:aspect-square md:w-full md:max-w-[680px] xl:order-none xl:col-start-1 xl:row-start-1 xl:mt-0 xl:aspect-auto xl:h-full xl:min-h-[600px] xl:max-w-none">
        <div
          aria-hidden="true"
          className="h-[350px] w-[350px] rounded-full ring-surface xl:h-[624px] xl:w-[624px]"
        />
      </div>
    </div>
  );
}
