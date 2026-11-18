'use client';

import * as React from 'react';
import type { YieldMetrics } from '@/core/analytics';
import type { ColumnarDies, WaferSummaryMeta } from '@/core/model';
import { formatYieldPct } from '@/ui/format';
import { Button } from '@/ui/primitives';
import { paintWaferThumbnail, resolveCanvasPixelSize } from './wafer-geometry';

export const WAFER_THUMB_BUTTON_PX = 40 as const;
export const WAFER_THUMB_CANVAS_PX = 36 as const;

export interface WaferSelectorProps {
  readonly wafers: readonly WaferSummaryMeta[];
  readonly dies: ColumnarDies;
  readonly byWaferYield: readonly YieldMetrics[];
  readonly activeWaferIndex: number;
  readonly dpr?: number;
  readonly onSelectWafer: (waferIndex: number) => void;
}

interface ActiveThumbTooltip {
  readonly index: number;
  readonly anchorX: number;
}

/**
 * Horizontal "lot strip" wafer selector (`role="radiogroup"`) rendering 25+ micro
 * Pass/Fail wafer thumbnails (`36 px` canvas in a `40 px` slot) drawn once per lot,
 * letting ATE engineers see at a glance whether spatial failure signatures repeat
 * across wafers.
 *
 * Keeps full ARIA `radiogroup` / `radio` semantics, roving `tabIndex`, `ArrowLeft`/
 * `ArrowRight` stepping, `#D6E6FF` active ring + non-color indicator pip, and a
 * zero-shadow `.surface-overlay` hover/focus tooltip showing wafer ID + yield.
 *
 * Validates: Requirements 4.1, 14.2, 14.3, 17.1, 17.2, 17.5
 */
export const WaferSelector = React.memo(function WaferSelector({
  wafers,
  dies,
  byWaferYield,
  activeWaferIndex,
  dpr,
  onSelectWafer,
}: WaferSelectorProps): React.JSX.Element | null {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const radioRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const canvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const ctxRefs = React.useRef<Array<CanvasRenderingContext2D | null>>([]);
  const didMountRef = React.useRef(false);
  const tooltipId = React.useId();

  const [tooltip, setTooltip] = React.useState<ActiveThumbTooltip | null>(null);

  const count = wafers.length;
  const safeActive = count > 0 ? Math.min(Math.max(0, activeWaferIndex), count - 1) : 0;

  // Paint all wafer thumbnails once per loaded lot (or DPR change); never repaints on selection step.
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

    for (let i = 0; i < count; i += 1) {
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
  }, [count, wafers, dies, dpr]);

  // Keep stepped wafer visible inside horizontal strip on narrow viewports without scrolling on mount.
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const btn = radioRefs.current[safeActive];
    if (btn && typeof btn.scrollIntoView === 'function') {
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [safeActive]);

  const showTooltipForButton = React.useCallback(
    (index: number, buttonEl: HTMLButtonElement | null): void => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !buttonEl) {
        setTooltip({ index, anchorX: 72 });
        return;
      }
      const wrapRect = wrapper.getBoundingClientRect();
      const btnRect = buttonEl.getBoundingClientRect();
      const center = btnRect.left - wrapRect.left + btnRect.width / 2;
      const minX = 68;
      const maxX = Math.max(minX, wrapRect.width - 68);
      setTooltip({
        index,
        anchorX: Math.min(maxX, Math.max(minX, center)),
      });
    },
    [],
  );

  const dismissTooltipForIndex = React.useCallback((index: number): void => {
    setTooltip((prev) => (prev?.index === index ? null : prev));
  }, []);

  if (count === 0) {
    return null;
  }

  const focusAndSelect = (nextIndex: number): void => {
    const wrapped = ((nextIndex % count) + count) % count;
    onSelectWafer(wrapped);
    const targetBtn = radioRefs.current[wrapped] ?? null;
    targetBtn?.focus();
  };

  const handleRadioKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        focusAndSelect(index + 1);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        focusAndSelect(index - 1);
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusAndSelect(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        focusAndSelect(count - 1);
        break;
      }
      default:
        break;
    }
  };

  const activeWafer = wafers[safeActive];
  const activeYieldLabel = formatYieldPct(
    byWaferYield[safeActive]?.finalYield ?? null,
  );
  const tooltipWafer = tooltip !== null ? wafers[tooltip.index] : undefined;
  const tooltipYieldLabel =
    tooltip !== null
      ? formatYieldPct(byWaferYield[tooltip.index]?.finalYield ?? null)
      : null;

  return (
    <div className="flex w-full flex-col gap-1.5 pt-0.5">
      <div ref={wrapperRef} className="relative w-full">
        {/* Hover / focus wafer ID + yield tooltip (outside overflow-x-auto so never clipped) */}
        {tooltip !== null && tooltipWafer ? (
          <div
            id={tooltipId}
            role="tooltip"
            style={{ left: `${tooltip.anchorX}px` }}
            className="surface-overlay pointer-events-none absolute bottom-full z-20 mb-1.5 -translate-x-1/2 rounded-control px-2.5 py-1 font-mono text-[12px] whitespace-nowrap text-text-primary tabular-nums"
          >
            <span className="text-accent">{tooltipWafer.waferId}</span>
            {' · '}
            <span>Yield {tooltipYieldLabel}</span>
          </div>
        ) : null}

        <div
          role="radiogroup"
          aria-label="Select wafer"
          onScroll={() => setTooltip(null)}
          className="flex w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-control border border-hairline bg-raised px-2 py-1.5 [scrollbar-width:thin]"
        >
          {wafers.map((wafer, idx) => {
            const isSelected = idx === safeActive;
            const yieldLabel = formatYieldPct(
              byWaferYield[idx]?.finalYield ?? null,
            );
            const isTooltipTarget = tooltip?.index === idx;

            return (
              <button
                key={`${wafer.waferId}-${wafer.waferIndex}`}
                ref={(el) => {
                  radioRefs.current[idx] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Wafer ${wafer.waferId}, ${idx + 1} of ${count}, final yield ${yieldLabel}`}
                aria-describedby={isTooltipTarget ? tooltipId : undefined}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelectWafer(idx)}
                onKeyDown={(e) => handleRadioKeyDown(e, idx)}
                onPointerEnter={(e) => showTooltipForButton(idx, e.currentTarget)}
                onPointerLeave={() => dismissTooltipForIndex(idx)}
                onFocus={(e) => showTooltipForButton(idx, e.currentTarget)}
                onBlur={() => dismissTooltipForIndex(idx)}
                style={{
                  width: `${WAFER_THUMB_BUTTON_PX}px`,
                  height: `${WAFER_THUMB_BUTTON_PX}px`,
                }}
                className={`relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  isSelected
                    ? 'border-2 border-accent bg-accent/12'
                    : 'border border-hairline bg-bg/60 opacity-85 hover:border-white/25 hover:opacity-100'
                }`}
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[idx] = el;
                  }}
                  data-testid="wafer-lot-strip-thumb"
                  aria-hidden="true"
                  style={{
                    width: `${WAFER_THUMB_CANVAS_PX}px`,
                    height: `${WAFER_THUMB_CANVAS_PX}px`,
                  }}
                  className="pointer-events-none block rounded-full select-none"
                />
                {isSelected ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -bottom-1 h-1 w-2 rounded-full bg-accent"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-2 px-0.5">
        <span className="font-mono text-[12px] text-text-secondary tabular-nums">
          <span className="text-text-tertiary">Lot Strip · </span>
          <span className="text-text-primary">
            Wafer {activeWafer?.waferId ?? 'W01'}
          </span>{' '}
          <span className="text-text-tertiary">
            ({safeActive + 1} of {count}) · Yield {activeYieldLabel}
          </span>
        </span>

        {count > 1 ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous wafer"
              disabled={safeActive === 0}
              onClick={() => onSelectWafer(Math.max(0, safeActive - 1))}
              className="h-7 px-2 font-mono text-[12px]"
            >
              ← Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next wafer"
              disabled={safeActive >= count - 1}
              onClick={() =>
                onSelectWafer(Math.min(count - 1, safeActive + 1))
              }
              className="h-7 px-2 font-mono text-[12px]"
            >
              Next →
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
