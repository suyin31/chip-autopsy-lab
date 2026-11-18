'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { YieldMetrics } from '@/core/analytics';
import type { ColumnarDies, WaferSummaryMeta } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { registerPendingWaferCommit } from '@/ui/state';
import { usePrefersMoreContrast } from './use-prefers-more-contrast';
import { paintWaferThumbnail, resolveCanvasPixelSize } from './wafer-geometry';

export const WAFER_THUMB_BUTTON_PX = 48 as const;
export const WAFER_THUMB_CANVAS_PX = 48 as const;

/** Idle time after the last keyboard step before the strip commits the wafer to the store. */
export const WAFER_KEY_COMMIT_DELAY_MS = 140 as const;

export interface WaferSelectOptions {
  readonly instant?: boolean;
  /** True when `onPreviewWafer` already painted this wafer; only the store commit remains. */
  readonly previewed?: boolean;
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
  /**
   * Keyboard stepping paints the stage imperatively through this callback inside the
   * keydown handler; the store commit (`onSelectWafer` with `previewed: true`) follows once
   * stepping pauses for `WAFER_KEY_COMMIT_DELAY_MS`, on a pointer selection, or when a store
   * reader calls `flushPendingWaferCommits()`. Blur does not flush synchronously: a blur caused
   * by clicking a finding would otherwise add a second full render to the click's frame.
   */
  readonly onPreviewWafer?: (
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
 * - Keyboard steps never render React or read layout in the keydown handler: selection
 *   attributes flip imperatively, the stage repaints via `onPreviewWafer`, the strip scrolls in
 *   the next frame from cached item offsets, and the store commit is deferred until stepping pauses
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
  onPreviewWafer,
  className,
}: WaferSelectorProps): React.JSX.Element | null {
  const { t, formatPercent } = useT();
  const shouldReduceMotion = useReducedMotion();
  const listRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const canvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const ctxRefs = React.useRef<Array<CanvasRenderingContext2D | null>>([]);
  const didMountRef = React.useRef(false);
  /** Strip index the list has already been scrolled to (skips redundant effect scrolls). */
  const scrolledIndexRef = React.useRef(-1);
  const scrollRafRef = React.useRef<number | null>(null);
  /** Cached `offsetLeft`/`offsetWidth` per item, measured outside input handlers. */
  const itemGeometryRef = React.useRef<Array<{ left: number; width: number }>>(
    [],
  );
  const listWidthRef = React.useRef(0);
  const pendingCommitRef = React.useRef<{
    index: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const onSelectWaferRef = React.useRef(onSelectWafer);
  onSelectWaferRef.current = onSelectWafer;

  const count = wafers.length;
  const safeActive =
    count > 0 ? Math.min(Math.max(0, activeWaferIndex), count - 1) : 0;

  const prevSafeActivePropRef = React.useRef(safeActive);
  const liveActiveRef = React.useRef(safeActive);
  if (prevSafeActivePropRef.current !== safeActive) {
    prevSafeActivePropRef.current = safeActive;
    liveActiveRef.current = safeActive;
  }

  const highContrast = usePrefersMoreContrast();

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
          highContrast,
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
  }, [count, wafers, dies, dpr, highContrast]);

  const measureGeometry = React.useCallback((): void => {
    const listEl = listRef.current;
    if (!listEl) {
      return;
    }
    listWidthRef.current = listEl.clientWidth;
    itemGeometryRef.current = itemRefs.current.map((el) =>
      el ? { left: el.offsetLeft, width: el.offsetWidth } : { left: 0, width: 0 },
    );
  }, []);

  // Measure item offsets after layout (mount, wafer list change, resize) so input handlers never force layout
  React.useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) {
      return;
    }
    measureGeometry();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => measureGeometry());
    observer.observe(listEl);
    return () => observer.disconnect();
  }, [count, measureGeometry]);

  const scrollToIndex = React.useCallback(
    (index: number, instant: boolean): void => {
      const listEl = listRef.current;
      const geom = itemGeometryRef.current[index];
      if (!listEl || !geom || typeof listEl.scrollTo !== 'function') {
        return;
      }
      scrolledIndexRef.current = index;
      const targetLeft = geom.left - listWidthRef.current / 2 + geom.width / 2;
      listEl.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: instant ? 'instant' : 'smooth',
      });
    },
    [],
  );

  // Defer strip scrolling to the next frame so the keydown task stays free of layout work
  const scheduleScrollToIndex = React.useCallback(
    (index: number, instant: boolean): void => {
      if (typeof requestAnimationFrame !== 'function') {
        scrollToIndex(index, instant);
        return;
      }
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        scrollToIndex(index, instant);
      });
    },
    [scrollToIndex],
  );

  const flushPendingCommit = React.useCallback((): void => {
    const pending = pendingCommitRef.current;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingCommitRef.current = null;
    onSelectWaferRef.current(pending.index, { instant: true, previewed: true });
  }, []);

  // Store readers (e.g. finding clicks) flush the pending commit inside their own event,
  // so both updates share one React render (§5.10 long-frame budget)
  React.useEffect(
    () => registerPendingWaferCommit(flushPendingCommit),
    [flushPendingCommit],
  );

  // Cancel deferred work when the lot changes or the strip unmounts
  React.useEffect(() => {
    return () => {
      const pending = pendingCommitRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        pendingCommitRef.current = null;
      }
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [wafers]);

  // Scroll the active wafer into view when the selection changes from outside the strip
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      scrolledIndexRef.current = safeActive;
      return;
    }
    if (scrolledIndexRef.current === safeActive) {
      return;
    }
    scheduleScrollToIndex(safeActive, Boolean(shouldReduceMotion));
  }, [safeActive, shouldReduceMotion, scheduleScrollToIndex]);

  if (count === 0) {
    return null;
  }

  const focusAndSelect = (nextIndex: number, isRepeat: boolean): void => {
    const clamped = Math.min(count - 1, Math.max(0, nextIndex));
    const prevIndex = liveActiveRef.current;
    if (clamped === prevIndex) {
      return;
    }
    const instant = isRepeat || Boolean(shouldReduceMotion);
    const nextEl = itemRefs.current[clamped];
    const prevEl = itemRefs.current[prevIndex];
    // Focus before mutating attributes so focus() finds clean style and forces no recalc
    nextEl?.focus({ preventScroll: true });
    if (prevEl) {
      prevEl.setAttribute('aria-selected', 'false');
      prevEl.tabIndex = -1;
    }
    if (nextEl) {
      nextEl.setAttribute('aria-selected', 'true');
      nextEl.tabIndex = 0;
    }
    liveActiveRef.current = clamped;

    if (!onPreviewWafer) {
      onSelectWafer(clamped, { instant });
      scheduleScrollToIndex(clamped, instant);
      return;
    }

    onPreviewWafer(clamped, { instant });
    scheduleScrollToIndex(clamped, instant);
    const pending = pendingCommitRef.current;
    if (pending) {
      clearTimeout(pending.timer);
    }
    pendingCommitRef.current = {
      index: clamped,
      timer: setTimeout(flushPendingCommit, WAFER_KEY_COMMIT_DELAY_MS),
    };
  };

  const handleItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (typeof performance !== 'undefined') {
      event.currentTarget.dataset.ack = String(performance.now());
    }
    const repeat = event.repeat === true;
    const baseIndex = liveActiveRef.current;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        focusAndSelect(Math.min(count - 1, baseIndex + 1), repeat);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        focusAndSelect(Math.max(0, baseIndex - 1), repeat);
        break;
      }
      case 'PageDown': {
        event.preventDefault();
        focusAndSelect(Math.min(count - 1, baseIndex + 5), repeat);
        break;
      }
      case 'PageUp': {
        event.preventDefault();
        focusAndSelect(Math.max(0, baseIndex - 5), repeat);
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
        'wafer-strip-mask flex h-14 w-full flex-nowrap items-center gap-3 overflow-x-auto overflow-y-hidden px-4 md:h-16 md:px-3',
        '[scroll-snap-type:x_proximity] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
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
              flushPendingCommit();
              const instant = Boolean(shouldReduceMotion);
              const prevEl = itemRefs.current[liveActiveRef.current];
              if (prevEl && liveActiveRef.current !== idx) {
                prevEl.setAttribute('aria-selected', 'false');
                prevEl.tabIndex = -1;
              }
              liveActiveRef.current = idx;
              onSelectWafer(idx, { instant });
              scheduleScrollToIndex(idx, instant);
            }}
            onKeyDown={handleItemKeyDown}
            className={cn(
              'group relative inline-flex h-14 w-12 shrink-0 [scroll-snap-align:center] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xs select-none md:h-16 md:w-14',
              'transition-transform duration-[100ms] ease-[var(--ease-out)] active:scale-[0.94]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <span
              data-testid="wafer-strip-thumb-ring"
              className={cn(
                'relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-opacity duration-[120ms] ease-[var(--ease-out)] md:h-12 md:w-12',
                // Selection styling keys off the button's `aria-selected` so keyboard steps can
                // flip it imperatively without a React render (§5.8, §5.10)
                'group-aria-selected:ring-2 group-aria-selected:ring-accent group-aria-selected:ring-offset-[3px] group-aria-selected:ring-offset-bg',
                'group-aria-[selected=false]:hover:ring-2 group-aria-[selected=false]:hover:ring-[var(--color-accent-soft)]',
                isZeroEvidenceDimmed
                  ? 'opacity-40 group-aria-[selected=false]:hover:opacity-70'
                  : 'opacity-[0.72] group-aria-selected:opacity-100 group-aria-[selected=false]:hover:opacity-100',
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
                  'type-caption leading-none tabular-nums text-text-tertiary group-aria-selected:text-text-primary',
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
