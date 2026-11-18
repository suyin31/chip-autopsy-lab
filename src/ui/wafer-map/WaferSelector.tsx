'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { YieldMetrics } from '@/core/analytics';
import type { ColumnarDies, WaferSummaryMeta } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { paintWaferThumbnail, resolveCanvasPixelSize } from './wafer-geometry';

export const WAFER_THUMB_BUTTON_PX = 48 as const;
export const WAFER_THUMB_CANVAS_PX = 48 as const;

export interface WaferSelectOptions {
  readonly instant?: boolean;
}

export interface WaferSelectorProps {
  readonly lotId?: string;
  readonly wafers: readonly WaferSummaryMeta[];
  readonly dies: ColumnarDies;
  readonly byWaferYield: readonly YieldMetrics[];
  readonly activeWaferIndex: number;
  /**
   * Optional per-wafer boolean mask when a finding is active (`redesign.md` §3.5):
   * - `false` -> thumbnail drops to `40%` opacity
   * - `true` -> wafer gets a `4 px` ice (`#D6E6FF`) dot beneath it
   */
  readonly evidencePresence?: readonly boolean[] | null;
  readonly dpr?: number;
  readonly onSelectWafer: (
    waferIndex: number,
    options?: WaferSelectOptions,
  ) => void;
  readonly className?: string;
}

/**
 * Boxless horizontal wafer strip (`redesign.md` §0 #6, §3.4, §3.5, §4.9, §5.8):
 * - `role="listbox"` `aria-orientation="horizontal"` with `scroll-snap-type: x proximity`,
 *   native momentum, hidden scrollbar, and `24 px` horizontal edge-fade mask
 * - `48 x 48` desktop (`40 x 40` mobile) circle wafer canvas + `caption` wafer label (`W01`)
 * - Rest opacity `0.72`, hover `1.0` + `accent-soft` ring, active `1.0` + `2 px` `#D6E6FF` ring
 *   at `3 px` offset, pressed `scale(0.94)`
 * - Finding evidence state: zero-evidence thumbnails drop to `0.40` opacity; wafers with evidence
 *   render a `4 px` `#D6E6FF` dot beneath them
 * - Roving `tabIndex`: `ArrowLeft`/`ArrowRight` ±1, `PageUp`/`PageDown` ±5, `Home`/`End`;
 *   held key-repeat (`event.repeat === true`) passes `{ instant: true }` for `0 ms` stage swap
 */
export const WaferSelector = React.memo(function WaferSelector({
  lotId = 'LOT',
  wafers,
  dies,
  byWaferYield,
  activeWaferIndex,
  evidencePresence = null,
  dpr,
  onSelectWafer,
  className,
}: WaferSelectorProps): React.JSX.Element | null {
  const { t, formatPercent } = useT();
  const shouldReduceMotion = useReducedMotion();
  const listRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const canvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const ctxRefs = React.useRef<Array<CanvasRenderingContext2D | null>>([]);
  const didMountRef = React.useRef(false);
  const lastSelectWasRepeatRef = React.useRef(false);

  const count = wafers.length;
  const safeActive =
    count > 0 ? Math.min(Math.max(0, activeWaferIndex), count - 1) : 0;

  React.useEffect(() => {
    if (count === 0) {
      return;
    }
    const resolvedDpr =
      dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const dims = resolveCanvasPixelSize(
      WAFER_THUMB_CANVAS_PX,
      WAFER_THUMB_CANVAS_PX,
      resolvedDpr,
    );

    const drawIndices = (startIdx: number, endIdx: number): void => {
      for (let i = startIdx; i < endIdx && i < count; i += 1) {
        const canvas = canvasRefs.current[i];
        const wafer = wafers[i];
        if (!canvas || !wafer) {
          continue;
        }
        let ctx = ctxRefs.current[i] ?? null;
        if (!ctx || ctx.canvas !== canvas) {
          ctx = canvas.getContext('2d');
          ctxRefs.current[i] = ctx;
        }
        if (!ctx) {
          continue;
        }
        if (canvas.width !== dims.pixelWidth) {
          canvas.width = dims.pixelWidth;
        }
        if (canvas.height !== dims.pixelHeight) {
          canvas.height = dims.pixelHeight;
        }
        paintWaferThumbnail(ctx, {
          wafer,
          dies,
          cssSize: dims.cssWidth,
          dpr: dims.dpr,
        });
      }
    };

    // Draw initial visible thumbnails immediately; batch remaining in 5-item idle slices (§5.10)
    const immediateEnd = Math.min(count, 15);
    drawIndices(0, immediateEnd);

    if (immediateEnd >= count) {
      return;
    }

    let nextStart = immediateEnd;
    let cancelled = false;
    let idleHandle: number | null = null;
    const ric =
      typeof window !== 'undefined' &&
      typeof (
        window as Window & {
          requestIdleCallback?: (cb: () => void) => number;
        }
      ).requestIdleCallback === 'function'
        ? (
            window as Window & {
              requestIdleCallback: (cb: () => void) => number;
              cancelIdleCallback: (id: number) => void;
            }
          )
        : null;

    const scheduleBatch = (): void => {
      const runBatch = (): void => {
        if (cancelled) {
          return;
        }
        drawIndices(nextStart, nextStart + 5);
        nextStart += 5;
        if (nextStart < count) {
          scheduleBatch();
        }
      };
      if (ric) {
        idleHandle = ric.requestIdleCallback(runBatch);
      } else if (typeof requestAnimationFrame === 'function') {
        idleHandle = requestAnimationFrame(runBatch);
      } else {
        drawIndices(nextStart, count);
      }
    };

    scheduleBatch();

    return () => {
      cancelled = true;
      if (idleHandle !== null) {
        if (ric) {
          ric.cancelIdleCallback(idleHandle);
        } else if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(idleHandle);
        }
      }
    };
  }, [count, wafers, dies, dpr]);

  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const listEl = listRef.current;
    const itemEl = itemRefs.current[safeActive];
    const instant = Boolean(shouldReduceMotion) || lastSelectWasRepeatRef.current;
    lastSelectWasRepeatRef.current = false;

    if (listEl && itemEl && typeof listEl.scrollTo === 'function') {
      const targetLeft =
        itemEl.offsetLeft - listEl.clientWidth / 2 + itemEl.offsetWidth / 2;
      listEl.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: instant ? 'instant' : 'smooth',
      });
    }
  }, [safeActive, shouldReduceMotion]);

  if (count === 0) {
    return null;
  }

  const focusAndSelect = (nextIndex: number, isRepeat: boolean): void => {
    const clamped = Math.min(count - 1, Math.max(0, nextIndex));
    lastSelectWasRepeatRef.current = isRepeat;
    onSelectWafer(clamped, {
      instant: isRepeat || Boolean(shouldReduceMotion),
    });
    itemRefs.current[clamped]?.focus({ preventScroll: true });
  };

  const handleItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (typeof performance !== 'undefined') {
      event.currentTarget.dataset.ack = String(performance.now());
    }
    const repeat = event.repeat === true;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        focusAndSelect(Math.min(count - 1, index + 1), repeat);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        focusAndSelect(Math.max(0, index - 1), repeat);
        break;
      }
      case 'PageDown': {
        event.preventDefault();
        focusAndSelect(Math.min(count - 1, index + 5), repeat);
        break;
      }
      case 'PageUp': {
        event.preventDefault();
        focusAndSelect(Math.max(0, index - 5), repeat);
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusAndSelect(0, repeat);
        break;
      }
      case 'End': {
        event.preventDefault();
        focusAndSelect(count - 1, repeat);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-orientation="horizontal"
      aria-label={t('strip.aria', { lotId })}
      data-testid="wafer-strip"
      className={cn(
        'flex h-14 w-full flex-nowrap items-center gap-3 overflow-x-auto px-4 md:h-16 md:px-3',
        '[scroll-snap-type:x_proximity] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        '[mask-image:linear-gradient(90deg,transparent,#000_24px,#000_calc(100%-24px),transparent)]',
        className,
      )}
    >
      {wafers.map((wafer, idx) => {
        const isSelected = idx === safeActive;
        const yieldRatio = byWaferYield[idx]?.finalYield ?? 0;
        const yieldLabel = formatPercent(yieldRatio);
        const hasFindingActive = evidencePresence !== null;
        const waferHasEvidence =
          hasFindingActive && Boolean(evidencePresence[idx]);
        const isZeroEvidenceDimmed =
          hasFindingActive && !waferHasEvidence;

        return (
          <button
            key={`${wafer.waferId}-${wafer.waferIndex}`}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-label={t('strip.itemAria', {
              wafer: wafer.waferId,
              yield: yieldLabel,
            })}
            data-wafer-index={idx}
            data-has-evidence={
              hasFindingActive ? (waferHasEvidence ? 'true' : 'false') : undefined
            }
            tabIndex={isSelected ? 0 : -1}
            onPointerDown={(e) => {
              if (typeof performance !== 'undefined') {
                e.currentTarget.dataset.ack = String(performance.now());
              }
            }}
            onClick={() => {
              lastSelectWasRepeatRef.current = false;
              onSelectWafer(idx, { instant: Boolean(shouldReduceMotion) });
            }}
            onKeyDown={(e) => handleItemKeyDown(e, idx)}
            className={cn(
              'group relative inline-flex h-14 w-12 shrink-0 [scroll-snap-align:center] cursor-pointer flex-col items-center justify-center gap-0.5 pt-1 rounded-xs select-none md:h-16 md:w-14',
              'transition-transform duration-[100ms] ease-[var(--ease-out)] active:scale-[0.94]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <span
              data-testid="wafer-strip-thumb-ring"
              className={cn(
                'relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-opacity duration-[120ms] ease-[var(--ease-out)] md:h-12 md:w-12',
                isSelected
                  ? isZeroEvidenceDimmed
                    ? 'opacity-40 ring-2 ring-accent ring-offset-2 ring-offset-bg'
                    : 'opacity-100 ring-2 ring-accent ring-offset-2 ring-offset-bg'
                  : isZeroEvidenceDimmed
                    ? 'opacity-40 hover:opacity-70 hover:ring-2 hover:ring-[var(--color-accent-soft)]'
                    : 'opacity-[0.72] hover:opacity-100 hover:ring-2 hover:ring-[var(--color-accent-soft)]',
              )}
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[idx] = el;
                }}
                data-testid="wafer-lot-strip-thumb"
                aria-hidden="true"
                className="pointer-events-none block h-10 w-10 rounded-full select-none md:h-12 md:w-12"
              />
            </span>
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  'type-caption leading-none tabular-nums',
                  isSelected
                    ? 'text-text-primary'
                    : 'hidden text-text-tertiary md:inline',
                )}
              >
                <Untranslated>{wafer.waferId}</Untranslated>
              </span>
              {waferHasEvidence ? (
                <span
                  data-testid="wafer-strip-evidence-dot"
                  aria-hidden="true"
                  className="inline-block h-1 w-1 shrink-0 rounded-full bg-accent"
                />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
});
