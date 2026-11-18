"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import type { YieldMetrics } from "@/core/analytics";
import type { ColumnarDies, WaferSummaryMeta } from "@/core/model";
import { Untranslated, useT } from "@/ui/i18n";
import { cn } from "@/ui/primitives/cn";
import { registerPendingWaferCommit } from "@/ui/state";
import { usePrefersMoreContrast } from "./use-prefers-more-contrast";
import { paintWaferThumbnail, resolveCanvasPixelSize } from "./wafer-geometry";

export const WAFER_THUMB_BUTTON_PX = 48 as const;
export const WAFER_THUMB_CANVAS_PX = 40 as const;

/** Fraction of the visible strip width one chevron click scrolls (premium §5.8). */
export const WAFER_STRIP_CHEVRON_SCROLL_FRACTION = 0.8 as const;

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
   * Optional per-wafer boolean mask when a finding is active (premium §5.8, §8.3):
   * `false` drops the thumbnail to `0.32` opacity; `true` keeps it at `1.0`.
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
 * Boxless horizontal wafer strip (premium §5.8; keyboard and commit flow per `redesign.md` §5.8):
 * - `role="listbox"` `aria-orientation="horizontal"` scroller, `padding: 6px 8px` (`6px 16px`
 *   mobile), `scroll-padding-inline: 32px`, `scroll-snap-type: x proximity`, hidden scrollbar
 * - `48 x 64` items (`44 x 52` mobile) with a `40 px` thumbnail at `y 4` (`36 px` mobile) and a
 *   `caption` label (mobile: active item only)
 * - Hover `scale(1.06)`, pressed `scale(0.94)`, active ring `2 px bg + 3.5 px ink`, focus-visible
 *   ring `2 px bg + 4 px ink`; zero-evidence wafers drop to `0.32` opacity during a finding
 * - Edge fade and desktop chevrons appear only on a side that can scroll, toggled imperatively
 *   from the scroll position (no React render)
 * - Roving `tabIndex`: `ArrowLeft`/`ArrowRight` ±1, `PageUp`/`PageDown` ±5, `Home`/`End`;
 *   every key step (single press or held repeat) passes `{ instant: true }` for a `0 ms` stage
 *   swap and an `instant` strip scroll; only a thumbnail click cross-fades (premium §8.7)
 * - Keyboard steps never render React or read layout in the keydown handler: selection
 *   attributes flip imperatively, the stage repaints via `onPreviewWafer`, the strip scrolls in
 *   the next frame from cached item offsets, and the store commit is deferred until stepping pauses
 */
export const WaferSelector = React.memo(function WaferSelector({
  lotId = "LOT",
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
  const earlierChevronRef = React.useRef<HTMLButtonElement>(null);
  const laterChevronRef = React.useRef<HTMLButtonElement>(null);
  /** Last written edge state, so scroll events only touch the DOM when a side flips. */
  const edgeStateRef = React.useRef<{ start: boolean; end: boolean } | null>(
    null,
  );
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
      dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
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
          ctx = canvas.getContext("2d");
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
      typeof window !== "undefined" &&
      typeof (
        window as Window & {
          requestIdleCallback?: (cb: () => void) => number;
        }
      ).requestIdleCallback === "function"
        ? (window as Window & {
            requestIdleCallback: (cb: () => void) => number;
            cancelIdleCallback: (id: number) => void;
          })
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
      } else if (typeof requestAnimationFrame === "function") {
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
        } else if (typeof cancelAnimationFrame === "function") {
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
      el
        ? { left: el.offsetLeft, width: el.offsetWidth }
        : { left: 0, width: 0 },
    );
  }, []);

  // Side-aware edge fade and chevrons (premium §5.8): flip data attributes only when a side changes
  const syncEdges = React.useCallback((): void => {
    const listEl = listRef.current;
    if (!listEl) {
      return;
    }
    const maxScroll = listEl.scrollWidth - listEl.clientWidth;
    const start = listEl.scrollLeft > 1;
    const end = listEl.scrollLeft < maxScroll - 1;
    const prev = edgeStateRef.current;
    if (prev && prev.start === start && prev.end === end) {
      return;
    }
    edgeStateRef.current = { start, end };
    listEl.dataset.fadeStart = String(start);
    listEl.dataset.fadeEnd = String(end);
    if (earlierChevronRef.current) {
      earlierChevronRef.current.dataset.visible = String(start);
    }
    if (laterChevronRef.current) {
      laterChevronRef.current.dataset.visible = String(end);
    }
  }, []);

  // Measure item offsets after layout (mount, wafer list change, resize) so input handlers never force layout
  React.useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) {
      return;
    }
    measureGeometry();
    edgeStateRef.current = null;
    syncEdges();
    listEl.addEventListener("scroll", syncEdges, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => listEl.removeEventListener("scroll", syncEdges);
    }
    const observer = new ResizeObserver(() => {
      measureGeometry();
      syncEdges();
    });
    observer.observe(listEl);
    return () => {
      observer.disconnect();
      listEl.removeEventListener("scroll", syncEdges);
    };
  }, [count, measureGeometry, syncEdges]);

  const scrollByChevron = (direction: -1 | 1): void => {
    const listEl = listRef.current;
    if (!listEl || typeof listEl.scrollBy !== "function") {
      return;
    }
    listEl.scrollBy({
      left:
        direction * listEl.clientWidth * WAFER_STRIP_CHEVRON_SCROLL_FRACTION,
      behavior: shouldReduceMotion ? "instant" : "smooth",
    });
  };

  const stampAck = (event: React.PointerEvent<HTMLElement>): void => {
    if (typeof performance !== "undefined") {
      event.currentTarget.dataset.ack = String(performance.now());
    }
  };

  const scrollToIndex = React.useCallback(
    (index: number, instant: boolean): void => {
      const listEl = listRef.current;
      const geom = itemGeometryRef.current[index];
      if (!listEl || !geom || typeof listEl.scrollTo !== "function") {
        return;
      }
      scrolledIndexRef.current = index;
      const targetLeft = geom.left - listWidthRef.current / 2 + geom.width / 2;
      listEl.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: instant ? "instant" : "smooth",
      });
    },
    [],
  );

  // Defer strip scrolling to the next frame so the keydown task stays free of layout work
  const scheduleScrollToIndex = React.useCallback(
    (index: number, instant: boolean): void => {
      if (typeof requestAnimationFrame !== "function") {
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

  const focusAndSelect = (nextIndex: number): void => {
    const clamped = Math.min(count - 1, Math.max(0, nextIndex));
    const prevIndex = liveActiveRef.current;
    if (clamped === prevIndex) {
      return;
    }
    // Premium §8.7: arrow keys, Home/End, PageUp/PageDown, and key repeat swap at 0 ms
    const instant = true;
    const nextEl = itemRefs.current[clamped];
    const prevEl = itemRefs.current[prevIndex];
    // Focus before mutating attributes so focus() finds clean style and forces no recalc
    nextEl?.focus({ preventScroll: true });
    if (prevEl) {
      prevEl.setAttribute("aria-selected", "false");
      prevEl.tabIndex = -1;
    }
    if (nextEl) {
      nextEl.setAttribute("aria-selected", "true");
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
    if (typeof performance !== "undefined") {
      event.currentTarget.dataset.ack = String(performance.now());
    }
    const baseIndex = liveActiveRef.current;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown": {
        event.preventDefault();
        focusAndSelect(Math.min(count - 1, baseIndex + 1));
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        event.preventDefault();
        focusAndSelect(Math.max(0, baseIndex - 1));
        break;
      }
      case "PageDown": {
        event.preventDefault();
        focusAndSelect(Math.min(count - 1, baseIndex + 5));
        break;
      }
      case "PageUp": {
        event.preventDefault();
        focusAndSelect(Math.max(0, baseIndex - 5));
        break;
      }
      case "Home": {
        event.preventDefault();
        focusAndSelect(0);
        break;
      }
      case "End": {
        event.preventDefault();
        focusAndSelect(count - 1);
        break;
      }
      default:
        break;
    }
  };

  const chevronClass = cn(
    "absolute top-4 z-[1] hidden size-7 cursor-pointer items-center justify-center rounded-full bg-surface text-text-secondary shadow-chevron select-none outline-none sm:data-[visible=true]:inline-flex",
    // 28 px pill extended to a 40 px hit target (premium §3.10)
    "after:absolute after:-inset-1.5",
    "motion-safe:transition-transform motion-safe:duration-[var(--dur-2)] motion-safe:ease-[var(--ease-out)] motion-safe:active:scale-[0.94]",
    "focus-visible:shadow-focus-ring",
  );

  return (
    <div className={cn("relative w-full", className)}>
      <div
        ref={listRef}
        role="listbox"
        aria-orientation="horizontal"
        aria-label={t("strip.aria", { lotId })}
        data-testid="wafer-strip"
        className={cn(
          "wafer-strip-mask flex h-16 w-full flex-nowrap items-start overflow-x-auto overflow-y-hidden px-4 py-1.5 sm:h-[76px] sm:px-2",
          "[scroll-padding-inline:32px] [scroll-snap-type:x_proximity] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {wafers.map((wafer, idx) => {
          const isSelected = idx === safeActive;
          const yieldRatio = byWaferYield[idx]?.finalYield ?? 0;
          const yieldLabel = formatPercent(yieldRatio);
          const hasFindingActive = evidencePresence !== null;
          const waferHasEvidence =
            hasFindingActive && Boolean(evidencePresence[idx]);
          const isZeroEvidenceDimmed = hasFindingActive && !waferHasEvidence;

          return (
            <button
              key={`${wafer.waferId}-${wafer.waferIndex}`}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-label={t("strip.itemAria", {
                wafer: wafer.waferId,
                yield: yieldLabel,
              })}
              data-wafer-index={idx}
              data-has-evidence={
                hasFindingActive
                  ? waferHasEvidence
                    ? "true"
                    : "false"
                  : undefined
              }
              tabIndex={isSelected ? 0 : -1}
              onPointerDown={stampAck}
              onClick={() => {
                flushPendingCommit();
                const instant = Boolean(shouldReduceMotion);
                const prevEl = itemRefs.current[liveActiveRef.current];
                if (prevEl && liveActiveRef.current !== idx) {
                  prevEl.setAttribute("aria-selected", "false");
                  prevEl.tabIndex = -1;
                }
                liveActiveRef.current = idx;
                onSelectWafer(idx, { instant });
                scheduleScrollToIndex(idx, instant);
              }}
              onKeyDown={handleItemKeyDown}
              className={cn(
                "group relative flex h-[52px] w-11 shrink-0 [scroll-snap-align:center] cursor-pointer flex-col items-center gap-0.5 pt-0.5 outline-none select-none sm:h-16 sm:w-12 sm:gap-1.5 sm:pt-1",
              )}
            >
              <span
                data-testid="wafer-strip-thumb-ring"
                className={cn(
                  "relative block size-9 shrink-0 rounded-full sm:size-10",
                  // Selection styling keys off the button's `aria-selected` so keyboard steps can
                  // flip it imperatively without a React render (redesign §5.10)
                  "group-aria-selected:shadow-[0_0_0_2px_var(--bg),0_0_0_3.5px_var(--ink)]",
                  "group-focus-visible:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--ink)] group-aria-selected:group-focus-visible:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--ink)]",
                  "[transition-property:transform,opacity] duration-[var(--dur-2)] ease-[var(--ease-out)] motion-reduce:transition-none",
                  "motion-safe:group-hover:scale-[1.06] motion-safe:group-active:scale-[0.94]",
                  isZeroEvidenceDimmed ? "opacity-[0.32]" : "opacity-100",
                )}
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[idx] = el;
                  }}
                  data-testid="wafer-lot-strip-thumb"
                  aria-hidden="true"
                  className="pointer-events-none block size-9 rounded-full select-none sm:size-10"
                />
              </span>
              <span
                className={cn(
                  "type-caption leading-none tabular-nums text-text-tertiary transition-[color] duration-[var(--dur-2)] ease-[var(--ease-out)]",
                  "group-aria-[selected=false]:group-hover:text-text-secondary group-aria-selected:font-[590] group-aria-selected:text-text-primary",
                  "max-sm:group-aria-[selected=false]:hidden",
                )}
              >
                <Untranslated className="font-mono-id">{wafer.waferId}</Untranslated>
              </span>
            </button>
          );
        })}
      </div>
      <button
        ref={earlierChevronRef}
        type="button"
        data-testid="wafer-strip-chevron-earlier"
        data-visible="false"
        aria-label={t("strip.earlier")}
        onPointerDown={stampAck}
        onClick={() => scrollByChevron(-1)}
        className={cn(chevronClass, "left-1")}
      >
        <ChevronLeft
          aria-hidden="true"
          className="size-3.5"
          strokeWidth={1.75}
        />
      </button>
      <button
        ref={laterChevronRef}
        type="button"
        data-testid="wafer-strip-chevron-later"
        data-visible="false"
        aria-label={t("strip.later")}
        onPointerDown={stampAck}
        onClick={() => scrollByChevron(1)}
        className={cn(chevronClass, "right-1")}
      >
        <ChevronRight
          aria-hidden="true"
          className="size-3.5"
          strokeWidth={1.75}
        />
      </button>
    </div>
  );
});
