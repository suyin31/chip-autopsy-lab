'use client';

/**
 * Evidence stage for the agent console:
 * - Before a lot is loaded, presents a 4-channel obsidian forensic standby deck
 *   (no decorative silicon wafer hero; wafer plots only appear when real data loads).
 * - Once a lot is open, renders the real columnar die map inside an obsidian optical
 *   chuck with cited dies illuminated over a 460 ms ramp.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { DatumTicks } from '@/ui/atelier/SpecimenDropTray';
import { Untranslated, useT } from '@/ui/i18n';
import { TILT_TOKENS, useTactileTilt } from '@/ui/motion';
import { cn } from '@/ui/primitives';
import type { AutopsyWorkerLoadedPayload } from '@/workers';

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

const STANDBY_CHANNELS = [
  { code: 'CH-01', name: 'SBIN / HBIN PARETO', bars: [78, 52, 34, 22] },
  { code: 'CH-02', name: 'SPATIAL XY MATRIX', bars: [42, 86, 64, 48] },
  { code: 'CH-03', name: 'PTR CPK LIMITS', bars: [62, 44, 88, 30] },
  { code: 'CH-04', name: 'FACT DIE CITATION', bars: [50, 68, 54, 76] },
] as const;

const WaferDiscFrame = React.forwardRef<
  HTMLDivElement,
  { readonly className?: string; readonly children: React.ReactNode }
>(function WaferDiscFrame({ className, children }, forwardedRef) {
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const [pointerDown, setPointerDown] = React.useState(false);

  React.useImperativeHandle(forwardedRef, () => frameRef.current as HTMLDivElement, []);
  useTactileTilt(frameRef, {
    maxDeg: TILT_TOKENS.maxDegWafer,
    liftPx: 0,
    disabled: pointerDown,
  });

  const releasePointer = React.useCallback(() => setPointerDown(false), []);

  return (
    <div
      ref={frameRef}
      className={cn('cal-tactile', className)}
      onPointerDown={() => setPointerDown(true)}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onPointerLeave={releasePointer}
    >
      {children}
    </div>
  );
});

export function WaferStage({
  payload,
  highlighted,
  highlightLabel,
  waferIndex,
  onWaferChange,
  onLoadSample,
  className,
}: WaferStageProps) {
  const { t } = useT();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const holderRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState(300);
  const cells = React.useMemo(
    () => (payload ? buildCells(payload, waferIndex, highlighted) : []),
    [payload, waferIndex, highlighted],
  );
  const highlightSignature = React.useMemo(
    () => `${highlighted.size}:${Array.from(highlighted).slice(0, 4).join(',')}`,
    [highlighted],
  );

  const hasPayload = payload !== null;
  React.useEffect(() => {
    const holder = holderRef.current;
    if (!holder || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setSize(Math.min(340, Math.round(width)));
    });
    observer.observe(holder);
    return () => observer.disconnect();
  }, [hasPayload]);

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
      const passColor = styles.getPropertyValue('--text-disabled').trim() || 'rgba(255,255,255,0.22)';
      const failColor = styles.getPropertyValue('--text-tertiary').trim() || 'rgba(255,255,255,0.58)';
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

      context.beginPath();
      context.arc(size / 2, size / 2, size / 2 - Math.round(size * 0.02), 0, Math.PI * 2);
      context.strokeStyle =
        styles.getPropertyValue('--hairline-strong').trim() || 'rgba(255,255,255,0.16)';
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
        context.globalAlpha = die.pass ? 0.52 : 0.92;
        context.fillRect(px, py, Math.max(1, cell - gap), Math.max(1, cell - gap));
      }
      context.globalAlpha = 1;
    },
    [cells, payload, waferIndex, size],
  );

  React.useEffect(() => {
    paint(1);
  }, [paint]);

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
      <WaferDiscFrame
        key="empty"
        className={cn(
          'at-obsidian-well relative flex w-full flex-col gap-3.5 overflow-hidden rounded-[22px] p-4',
          className,
        )}
      >
        <DatumTicks />
        <span aria-hidden="true" className="at-scanline" />

        <div className="relative z-[1] flex items-center justify-between gap-2 px-1">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="at-dot-iris at-live-pulse size-1.5 rounded-full" />
            <Untranslated className="font-mono text-[10.5px] text-text-secondary">
              STDF V4 · 4CH STANDBY
            </Untranslated>
          </span>
          <Untranslated className="font-mono text-[10.5px] text-text-tertiary">
            0 DIES
          </Untranslated>
        </div>

        <div
          aria-hidden="true"
          className="relative z-[1] grid grid-cols-2 gap-2"
        >
          {STANDBY_CHANNELS.map((ch) => (
            <div
              key={ch.code}
              className="flex flex-col gap-1.5 rounded-[12px] bg-fill-1 px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--hairline)]"
            >
              <div className="flex items-center justify-between gap-1">
                <Untranslated className="font-mono text-[10px] text-text-tertiary">
                  {ch.code}
                </Untranslated>
                <span className="inline-flex items-end gap-0.5">
                  {ch.bars.map((h, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-[1px] bg-fill-3"
                      style={{ height: `${Math.round(h * 0.12)}px` }}
                    />
                  ))}
                </span>
              </div>
              <Untranslated className="truncate font-mono text-[10.5px] text-text-secondary">
                {ch.name}
              </Untranslated>
            </div>
          ))}
        </div>

        <div className="relative z-[1] flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5 px-1">
          <p className="type-subhead text-text-secondary">{t('agents.wafer.empty')}</p>
          {onLoadSample ? (
            <button
              type="button"
              onClick={onLoadSample}
              className={cn(
                'at-pill-iris inline-flex cursor-pointer touch-manipulation items-center gap-1.5 rounded-pill px-3 py-1 type-caption',
                'transition-[opacity,scale,transform] duration-[140ms] ease-[var(--ease-out)]',
                '[@media(hover:hover)]:hover:opacity-90 active:scale-[0.97] motion-reduce:active:scale-100',
                'focus-visible:shadow-focus-ring focus-visible:outline-none',
              )}
            >
              <Sparkles className="size-3" strokeWidth={1.75} aria-hidden="true" />
              {t('agents.wafer.load')}
            </button>
          ) : null}
        </div>
      </WaferDiscFrame>
    );
  }

  const wafer = payload.lot.wafers[waferIndex];
  const highlightedHere = cells.filter((die) => die.highlighted).length;
  const failing = cells.filter((die) => !die.pass).length;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <WaferDiscFrame
        key="loaded"
        ref={holderRef}
        className="at-obsidian-well relative overflow-hidden rounded-[22px] p-3.5"
      >
        <DatumTicks />
        <div className="relative z-[1] mx-auto" style={{ width: size, maxWidth: '100%' }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={t('agents.wafer.mapAria', {
              wafer: wafer?.waferId ?? '',
              count: highlightedHere,
            })}
            className="agent-wafer-cited block h-auto w-full"
            style={{ aspectRatio: '1 / 1' }}
          />
        </div>
      </WaferDiscFrame>

      <div className="at-well-crisp flex flex-wrap items-center gap-x-3 gap-y-1 rounded-pill px-3 py-1.5 type-caption text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-[2px] bg-text-disabled" />
          {t('agents.wafer.pass')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-[2px] bg-text-tertiary" />
          {t('agents.wafer.fail')}
        </span>
        <span className="agent-wafer-cited inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-[2px] bg-current" />
          {t('agents.wafer.cited')}
        </span>
        <span className="ml-auto tabular-nums text-text-secondary">
          {wafer?.waferId} · {t('agents.wafer.failingCount', { count: failing })}
          {highlightedHere > 0
            ? ` · ${t('agents.wafer.citedCount', { count: highlightedHere })}`
            : ''}
        </span>
      </div>

      {payload.lot.wafers.length > 1 ? (
        <label className="at-well-crisp flex items-center gap-2.5 rounded-pill px-3 py-1.5 type-caption text-text-tertiary">
          <span className="whitespace-nowrap">{t('agents.wafer.label')}</span>
          <input
            type="range"
            min={0}
            max={payload.lot.wafers.length - 1}
            value={waferIndex}
            onChange={(event) => onWaferChange(Number(event.target.value))}
            className="h-1 w-full min-w-0 accent-[var(--chroma)]"
            aria-label={t('agents.wafer.choose')}
          />
          <span className="w-8 shrink-0 text-right tabular-nums text-text-secondary">
            {waferIndex + 1}
          </span>
        </label>
      ) : null}

      {highlightLabel ? (
        <p className="line-clamp-3 type-subhead text-text-secondary">{highlightLabel}</p>
      ) : (
        <p className="type-subhead text-text-tertiary">{t('agents.wafer.noCitations')}</p>
      )}
    </div>
  );
}
