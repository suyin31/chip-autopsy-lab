'use client';

/**
 * Evidence stage for the agent console: one wafer of the loaded lot, drawn from
 * the columnar die model, with the dies an agent cited lit up.
 *
 * It is deliberately small and independent of the workbench's layered Canvas2D
 * renderer: the console only has to show *which* dies a claim points at, and
 * that the agent's citations are real dies of this lot.
 */

import * as React from 'react';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { cn } from '@/ui/primitives';

export interface WaferStageProps {
  readonly payload: AutopsyWorkerLoadedPayload | null;
  readonly highlighted: ReadonlySet<string>;
  readonly highlightLabel?: string;
  readonly waferIndex: number;
  readonly onWaferChange: (index: number) => void;
  readonly className?: string;
}

interface DieCell {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly pass: boolean;
  readonly highlighted: boolean;
}

function buildCells(
  payload: AutopsyWorkerLoadedPayload,
  waferIndex: number,
  highlighted: ReadonlySet<string>,
): DieCell[] {
  const wafer = payload.lot.wafers[waferIndex];
  if (!wafer) return [];
  const cells: DieCell[] = [];
  const { dies } = payload.lot;
  for (let index = wafer.dieStartIndex; index < wafer.dieEndIndex; index += 1) {
    if (dies.waferIndex[index] !== waferIndex) continue;
    const id = payload.lot.dieIds[index];
    if (id === undefined) continue;
    cells.push({
      id,
      x: dies.x[index],
      y: dies.y[index],
      pass: dies.finalPass[index] === 1,
      highlighted: highlighted.has(id),
    });
  }
  return cells;
}

export function WaferStage({
  payload,
  highlighted,
  highlightLabel,
  waferIndex,
  onWaferChange,
  className,
}: WaferStageProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const cells = React.useMemo(
    () => (payload ? buildCells(payload, waferIndex, highlighted) : []),
    [payload, waferIndex, highlighted],
  );

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    const wafer = payload.lot.wafers[waferIndex];
    if (!wafer) return;
    const size = 320;
    const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);

    const styles = getComputedStyle(canvas);
    const passColor = styles.getPropertyValue('--text-disabled').trim() || 'rgba(255,255,255,0.18)';
    const failColor = styles.getPropertyValue('--text-tertiary').trim() || 'rgba(255,255,255,0.5)';
    const highlightColor = styles.getPropertyValue('--ink').trim() || 'currentColor';

    const spanX = Math.max(1, wafer.maxX - wafer.minX + 1);
    const spanY = Math.max(1, wafer.maxY - wafer.minY + 1);
    const padding = 26;
    const cell = Math.max(
      2,
      Math.floor(Math.min((size - padding * 2) / spanX, (size - padding * 2) / spanY)),
    );
    const offsetX = (size - cell * spanX) / 2;
    const offsetY = (size - cell * spanY) / 2;
    const gap = cell > 5 ? 1 : 0;

    // Wafer outline
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
    context.strokeStyle = styles.getPropertyValue('--hairline-strong').trim() || 'rgba(255,255,255,0.12)';
    context.lineWidth = 1;
    context.stroke();

    for (const die of cells) {
      const px = offsetX + (die.x - wafer.minX) * cell;
      const py = offsetY + (wafer.maxY - die.y) * cell;
      context.fillStyle = die.highlighted ? highlightColor : die.pass ? passColor : failColor;
      context.globalAlpha = die.highlighted ? 1 : die.pass ? 0.55 : 0.9;
      context.fillRect(px, py, Math.max(1, cell - gap), Math.max(1, cell - gap));
    }
    context.globalAlpha = 1;
  }, [cells, payload, waferIndex]);

  if (!payload) {
    return (
      <div
        className={cn(
          'flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-hairline p-6 text-center',
          className,
        )}
      >
        <p className="text-[13px] text-text-secondary">No lot loaded.</p>
        <p className="text-[12px] text-text-tertiary">
          Ask the agent to list the demo lots, or open one from the console.
        </p>
      </div>
    );
  }

  const wafer = payload.lot.wafers[waferIndex];
  const highlightedHere = cells.filter((die) => die.highlighted).length;
  const failing = cells.filter((die) => !die.pass).length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative overflow-hidden rounded-panel border border-hairline bg-surface-sunken">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Wafer ${wafer?.waferId ?? ''} defect map with ${highlightedHere} cited dies`}
          className="block h-auto w-full"
          style={{ aspectRatio: '1 / 1' }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-[var(--text-disabled)]" aria-hidden="true" /> pass
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-[var(--text-tertiary)]" aria-hidden="true" /> fail
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-[var(--ink)]" aria-hidden="true" /> cited by the agent
        </span>
        <span className="ml-auto font-mono tabular-nums">
          {wafer?.waferId} · {failing} failing · {highlightedHere} cited
        </span>
      </div>
      {payload.lot.wafers.length > 1 ? (
        <label className="flex items-center gap-2 text-[11px] text-text-tertiary">
          <span className="whitespace-nowrap">Wafer</span>
          <input
            type="range"
            min={0}
            max={payload.lot.wafers.length - 1}
            value={waferIndex}
            onChange={(event) => onWaferChange(Number(event.target.value))}
            className="h-1 w-full accent-[var(--ink)]"
            aria-label="Choose a wafer to display"
          />
          <span className="w-10 text-right font-mono tabular-nums">{waferIndex + 1}</span>
        </label>
      ) : null}
      {highlightLabel ? (
        <p className="text-[12px] leading-relaxed text-text-secondary">{highlightLabel}</p>
      ) : null}
    </div>
  );
}
