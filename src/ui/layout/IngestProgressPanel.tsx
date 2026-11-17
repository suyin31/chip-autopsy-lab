'use client';

import * as React from 'react';
import { formatByteSize, formatGroupedInt } from '@/ui/format';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
} from '@/ui/primitives';
import type { WorkerParsePhase, WorkerParseProgress } from '@/workers';

export interface IngestProgressPanelProps {
  readonly label: string;
  readonly progress: WorkerParseProgress;
}

const PHASE_COPY: Readonly<Record<WorkerParsePhase, string>> = {
  'generating-demo': 'Generating 25-wafer synthetic sort log',
  decompressing: 'Decompressing gzip stream in Web Worker',
  parsing: 'Decoding STDF V4 binary records in Web Worker',
  modeling: 'Resolving retests, edge-ring classification, and multi-site yield',
};

/**
 * Live off-main-thread Web Worker parse progress panel showing bytes processed,
 * records decoded, and resolved dies in `Geist Mono` tabular numerals.
 *
 * Validates: Requirements 1.10, 14.4, 15.2, 17.3, 17.4
 */
export function IngestProgressPanel({
  label,
  progress,
}: IngestProgressPanelProps): React.JSX.Element {
  const pct =
    progress.totalBytes !== null && progress.totalBytes > 0
      ? Math.min(100, (progress.bytesProcessed / progress.totalBytes) * 100)
      : null;

  const phaseText = PHASE_COPY[progress.phase];
  const valueText =
    pct !== null && progress.totalBytes !== null
      ? `${phaseText}: ${pct.toFixed(1)}% (${formatByteSize(progress.bytesProcessed)} of ${formatByteSize(progress.totalBytes)}, ${formatGroupedInt(progress.diesResolved)} dies resolved)`
      : `${phaseText}: ${formatByteSize(progress.bytesProcessed)} processed, ${formatGroupedInt(progress.diesResolved)} dies resolved`;

  return (
    <Card aria-busy="true" aria-label="STDF V4 Worker Parse Progress">
      <CardHeader className="border-b border-hairline pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[12px] tracking-wider text-text-tertiary uppercase">
            Autopsy Report · Web Worker Ingest
          </span>
          <Badge variant="accent">
            {pct !== null ? `${pct.toFixed(1)}%` : progress.phase}
          </Badge>
        </div>
        <CardTitle className="mt-1 text-[20px]">{label}</CardTitle>
        <div aria-live="polite" aria-atomic="true">
          <CardDescription>{phaseText}</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <Progress
          value={pct}
          valueText={valueText}
          label={`STDF V4 worker parse progress for ${label}`}
        />

        <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-control border border-hairline bg-raised p-3.5">
            <dt className="text-[12px] text-text-tertiary">Bytes Processed</dt>
            <dd className="mt-1 font-mono text-[16px] text-text-primary tabular-nums">
              {progress.totalBytes !== null
                ? `${formatByteSize(progress.bytesProcessed)} / ${formatByteSize(progress.totalBytes)}`
                : formatByteSize(progress.bytesProcessed)}
            </dd>
          </div>

          <div className="rounded-control border border-hairline bg-raised p-3.5">
            <dt className="text-[12px] text-text-tertiary">Records Decoded</dt>
            <dd className="mt-1 font-mono text-[16px] text-text-primary tabular-nums">
              {formatGroupedInt(progress.recordsDecoded)}
            </dd>
          </div>

          <div className="rounded-control border border-hairline bg-raised p-3.5">
            <dt className="text-[12px] text-text-tertiary">Dies Resolved</dt>
            <dd className="mt-1 font-mono text-[16px] text-text-primary tabular-nums">
              {formatGroupedInt(progress.diesResolved)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
