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
  readonly onLoadSample?: () => void;
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

const PULSE_MS = 460;

/**
 * The disc is drawn at the element's own width (up to 360 CSS px) and at device
 * pixel density, so it stays crisp in the rail and at 2x. A new citation grows
 * its dies into place over 460 ms instead of snapping, so the eye follows the
 * claim into the map; reduced motion paints the final frame directly.
 */
export function WaferStage({
  payload,
  highlighted,
  highlightLabel,
  waferIndex,
  onWaferChange,
  onLoadSample,
  className,
}: WaferStageProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const holderRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState(320);
  const cells = React.useMemo(
    () => (payload ? buildCells(payload, waferIndex, highlighted) : []),
    [payload, waferIndex, highlighted],
  );
  const highlightSignature = React.useMemo(
    () => `${highlighted.size}:${Array.from(highlighted).slice(0, 4).join(',')}`,
    [highlighted],
  );

  React.useEffect(() => {
    const holder = holderRef.current;
    if (!holder || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setSize(Math.min(360, Math.round(width)));
    });
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  const paint = React.useCallback(
    (reveal: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !payload) return;
      const wafer = payload.lot.wafers[waferIndex];
      if (!wafer) return;
      const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size, size);

      const styles = getComputedStyle(canvas);
      const passColor = styles.getPropertyValue('--text-disabled').trim() || 'rgba(255,255,255,0.18)';
      const failColor = styles.getPropertyValue('--text-tertiary').trim() || 'rgba(255,255,255,0.5)';
      // The canvas carries `.agent-wafer-cited`, whose color is the console's terracotta.
      const highlightColor = styles.color || 'currentColor';

      const spanX = Math.max(1, wafer.maxX - wafer.minX + 1);
      const spanY = Math.max(1, wafer.maxY - wafer.minY + 1);
      const padding = Math.round(size * 0.08);
      const cell = Math.max(
        2,
        Math.floor(Math.min((size - padding * 2) / spanX, (size - padding * 2) / spanY)),
      );
      const offsetX = (size - cell * spanX) / 2;
      const offsetY = (size - cell * spanY) / 2;
      const gap = cell > 5 ? 1 : 0;

      // Wafer outline
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2 - Math.round(size * 0.02), 0, Math.PI * 2);
      context.strokeStyle = styles.getPropertyValue('--hairline-strong').trim() || 'rgba(255,255,255,0.12)';
      context.lineWidth = 1;
      context.stroke();

      const eased = 1 - Math.pow(1 - reveal, 3);
      for (const die of cells) {
        const px = offsetX + (die.x - wafer.minX) * cell;
        const py = offsetY + (wafer.maxY - die.y) * cell;
        if (die.highlighted) {
          const side = Math.max(1, (cell - gap) * (0.62 + 0.38 * eased));
          const inset = (cell - gap - side) / 2;
          context.globalAlpha = 0.4 + 0.6 * eased;
          context.fillStyle = highlightColor;
          context.fillRect(px + inset, py + inset, side, side);
          continue;
        }
        context.fillStyle = die.pass ? passColor : failColor;
        context.globalAlpha = die.pass ? 0.5 : 0.9;
        context.fillRect(px, py, Math.max(1, cell - gap), Math.max(1, cell - gap));
      }
      context.globalAlpha = 1;
    },
    [cells, payload, waferIndex, size],
  );

  // Base paint whenever the data, wafer, or size changes.
  React.useEffect(() => {
    paint(1);
  }, [paint]);

  // A new citation lights up its dies over one short, interrupted-safe ramp.
  const firstPaintRef = React.useRef(true);
  React.useEffect(() => {
    if (firstPaintRef.current) {
      firstPaintRef.current = false;
      return;
    }
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paint(1);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / PULSE_MS);
      paint(progress);
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [highlightSignature, paint]);

  if (!payload) {
    return (
      <div
        className={cn(
          'flex w-full flex-col items-center gap-4 rounded-2xl bg-fill-1 px-5 py-7 text-center',
          className,
        )}
      >
        <MiniWaferPreview />
        <div className="flex flex-col gap-1">
          <p className="type-subhead text-text-secondary">No lot loaded</p>
          {onLoadSample ? (
            <button
              type="button"
              onClick={onLoadSample}
              className="cursor-pointer rounded-sm type-caption text-text-secondary underline decoration-hairline-strong underline-offset-4 transition-[color] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
            >
              Load the edge-ring sample
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const wafer = payload.lot.wafers[waferIndex];
  const highlightedHere = cells.filter((die) => die.highlighted).length;
  const failing = cells.filter((die) => !die.pass).length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div ref={holderRef} className="overflow-hidden rounded-2xl bg-fill-1 p-3">
        <div className="mx-auto" style={{ width: size, maxWidth: '100%' }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Wafer ${wafer?.waferId ?? ''} defect map with ${highlightedHere} cited dies`}
            className="agent-wafer-cited block h-auto w-full"
            style={{ aspectRatio: '1 / 1' }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-[2px] bg-text-disabled" />
          pass
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-[2px] bg-text-tertiary" />
          fail
        </span>
        <span className="agent-wafer-cited inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-[2px] bg-current" />
          cited
        </span>
        <span className="ml-auto tabular-nums">
          {wafer?.waferId} · {failing} failing
          {highlightedHere > 0 ? ` · ${highlightedHere} cited` : ''}
        </span>
      </div>

      {payload.lot.wafers.length > 1 ? (
        <label className="flex items-center gap-2 type-caption text-text-tertiary">
          <span className="whitespace-nowrap">Wafer</span>
          <input
            type="range"
            min={0}
            max={payload.lot.wafers.length - 1}
            value={waferIndex}
            onChange={(event) => onWaferChange(Number(event.target.value))}
            className="h-1 w-full min-w-0 accent-[var(--ink)]"
            aria-label="Choose a wafer to display"
          />
          <span className="w-8 shrink-0 text-right tabular-nums">{waferIndex + 1}</span>
        </label>
      ) : null}

      {highlightLabel ? (
        <p className="line-clamp-3 type-subhead text-text-secondary">{highlightLabel}</p>
      ) : (
        <p className="type-subhead text-text-tertiary">
          No dies cited yet. Ask for the evidence behind a claim.
        </p>
      )}
    </div>
  );
}

/**
 * The rail's resting state: the same disc `/` opens with — dark silicon, a die
 * grid, and a ring of failing dies at the edge — so the console reads as the
 * same instrument before a lot is loaded.
 */
function MiniWaferPreview(): React.JSX.Element {
  const extent = 12;
  const cells: React.JSX.Element[] = [];
  for (let y = -extent; y <= extent; y += 1) {
    for (let x = -extent; x <= extent; x += 1) {
      const r = Math.hypot(x, y);
      if (r > extent - 0.4) continue;
      const edge = r > extent - 2.6;
      const fail = edge && (x + y + extent) % 5 === 0;
      cells.push(
        <rect
          key={`${x}:${y}`}
          x={60 + x * 3.6 - 1.5}
          y={60 + y * 3.6 - 1.5}
          width={2.6}
          height={2.6}
          rx={0.4}
          className={fail ? 'agent-wafer-cited fill-current' : 'fill-white/12'}
        />,
      );
    }
  }
  return (
    <svg viewBox="0 0 120 120" className="size-[148px]" aria-hidden="true">
      <circle cx="60" cy="60" r="53" className="fill-[var(--color-disc-mid)]" />
      <g>{cells}</g>
      <circle cx="60" cy="60" r="53" className="fill-none stroke-white/12" strokeWidth="0.75" />
      <path d="M60 108l4 6h-8z" className="fill-[var(--color-disc-mid)] stroke-white/12" strokeWidth="0.75" />
    </svg>
  );
}
