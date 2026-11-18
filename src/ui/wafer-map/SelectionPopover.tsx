'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useT } from '@/ui/i18n';
import type { LiveBoxSelectStats } from './linked-interactions';

export const SELECTION_POPOVER_WIDTH_PX = 220 as const;

export interface SelectionPopoverHandle {
  updateLiveFrame(payload: {
    readonly x: number;
    readonly y: number;
    readonly transformOrigin: string;
    readonly stats: LiveBoxSelectStats;
    readonly visible: boolean;
  }): void;
  getMeasuredHeight(): number;
}

export interface SelectionPopoverProps {
  readonly committedStats: LiveBoxSelectStats | null;
  readonly isCommitted: boolean;
  readonly onClear: () => void;
  readonly onZoomToSelection: () => void;
}

/**
 * Box-Selection Live Stats Popover (`src/ui/wafer-map/SelectionPopover.tsx`,
 * `redesign.md` §3.6, §4.14, §5.7, §5.10):
 * - Material container (`z: 30`, radius `16`, padding `12 14`, width `220`)
 * - During `Shift+drag` / `Select` drag, updates position (`transform`) and live
 *   `N dies / Failing / Yield / Top bin` values every frame via DOM refs with
 *   strictly ZERO React re-renders (`pointermove` never touches React state)
 * - Enters once drag passes `8 px` via WAAPI (`opacity 0 -> 1`, `scale 0.96 -> 1`)
 * - On release (`isCommitted === true`), displays `"Clear"` and `"Zoom to selection"`
 *   text actions
 */
export const SelectionPopover = React.forwardRef<
  SelectionPopoverHandle,
  SelectionPopoverProps
>(function SelectionPopover(
  { committedStats, isCommitted, onClear, onZoomToSelection },
  ref,
): React.JSX.Element {
  const { t, tPlural, formatInteger, formatPercent } = useT();
  const shouldReduceMotion = useReducedMotion();
  const outerRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLDivElement>(null);
  const failingValRef = React.useRef<HTMLSpanElement>(null);
  const yieldValRef = React.useRef<HTMLSpanElement>(null);
  const topBinValRef = React.useRef<HTMLSpanElement>(null);
  const wasVisibleRef = React.useRef(false);
  const lastPlacedRef = React.useRef<{
    x: number;
    y: number;
    origin: string;
  }>({ x: 0, y: 0, origin: 'top left' });

  const formatStatsStrings = React.useCallback(
    (stats: LiveBoxSelectStats) => {
      const titleText = tPlural('selection.dies', stats.dieCount);
      const failingText = formatInteger(stats.failingCount);
      const yieldText =
        stats.dieCount > 0 ? formatPercent(stats.yieldRatio) : '0.0%';
      const topBinText = stats.topBin
        ? `${stats.topBin.mode} ${stats.topBin.code} (${formatInteger(stats.topBin.count)})`
        : t('selection.none');
      return { titleText, failingText, yieldText, topBinText };
    },
    [t, tPlural, formatInteger, formatPercent],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      updateLiveFrame({ x, y, transformOrigin, stats, visible }): void {
        lastPlacedRef.current = { x, y, origin: transformOrigin };
        const el = outerRef.current;
        const cardEl = cardRef.current;
        if (el) {
          el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          el.style.transformOrigin = transformOrigin;
          el.style.visibility = visible ? 'visible' : 'hidden';
          el.dataset.visible = visible ? 'true' : 'false';
          el.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        if (cardEl) {
          cardEl.style.transformOrigin = transformOrigin;
          if (visible && !wasVisibleRef.current) {
            cardEl.style.opacity = '1';
            cardEl.style.transform = 'scale(1)';
            if (!shouldReduceMotion && typeof cardEl.animate === 'function') {
              cardEl.animate(
                [
                  { opacity: 0, transform: 'scale(0.96)' },
                  { opacity: 1, transform: 'scale(1)' },
                ],
                {
                  duration: 200,
                  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                },
              );
            }
          } else if (!visible && wasVisibleRef.current) {
            cardEl.style.opacity = '0';
          }
        }
        wasVisibleRef.current = visible;

        if (visible) {
          const formatted = formatStatsStrings(stats);
          if (titleRef.current && titleRef.current.textContent !== formatted.titleText) {
            titleRef.current.textContent = formatted.titleText;
          }
          if (
            failingValRef.current &&
            failingValRef.current.textContent !== formatted.failingText
          ) {
            failingValRef.current.textContent = formatted.failingText;
          }
          if (
            yieldValRef.current &&
            yieldValRef.current.textContent !== formatted.yieldText
          ) {
            yieldValRef.current.textContent = formatted.yieldText;
          }
          if (
            topBinValRef.current &&
            topBinValRef.current.textContent !== formatted.topBinText
          ) {
            topBinValRef.current.textContent = formatted.topBinText;
          }
        }
      },
      getMeasuredHeight(): number {
        const el = outerRef.current;
        if (!el) {
          return isCommitted ? 156 : 124;
        }
        const h = el.offsetHeight;
        return h > 0 ? h : isCommitted ? 156 : 124;
      },
    }),
    [formatStatsStrings, isCommitted, shouldReduceMotion],
  );

  const committedShown = isCommitted && committedStats !== null;
  React.useEffect(() => {
    wasVisibleRef.current = committedShown;
  }, [committedShown]);

  const initialFormatted = committedStats
    ? formatStatsStrings(committedStats)
    : {
        titleText: tPlural('selection.dies', 0),
        failingText: '0',
        yieldText: '0.0%',
        topBinText: t('selection.none'),
      };

  return (
    <div
      ref={outerRef}
      data-stage-hud="true"
      data-testid="wafer-selection-popover"
      data-visible={committedShown ? 'true' : 'false'}
      aria-hidden={!committedShown}
      style={{
        transform: `translate3d(${lastPlacedRef.current.x}px, ${lastPlacedRef.current.y}px, 0)`,
        transformOrigin: lastPlacedRef.current.origin,
        visibility: committedShown ? 'visible' : 'hidden',
      }}
      className={
        committedShown
          ? 'pointer-events-auto absolute top-0 left-0 z-[var(--z-selection-popover)] w-[220px] select-none'
          : 'pointer-events-none absolute top-0 left-0 z-[var(--z-selection-popover)] w-[220px] select-none'
      }
    >
      <div
        ref={cardRef}
        style={{
          opacity: committedShown ? 1 : 0,
          transformOrigin: 'inherit',
        }}
        className="surface-material flex flex-col gap-2 rounded-lg px-3.5 py-3"
      >
        <div
          ref={titleRef}
          data-testid="selection-popover-title"
          className="type-headline text-text-primary tabular-nums"
        >
          {initialFormatted.titleText}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="type-callout text-text-secondary">
              {t('selection.failing')}
            </span>
            <span
              ref={failingValRef}
              data-testid="selection-popover-failing"
              className="type-mono-data text-text-primary"
            >
              {initialFormatted.failingText}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="type-callout text-text-secondary">
              {t('selection.yield')}
            </span>
            <span
              ref={yieldValRef}
              data-testid="selection-popover-yield"
              className="type-mono-data text-text-primary"
            >
              {initialFormatted.yieldText}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 type-callout text-text-secondary">
              {t('selection.topBin')}
            </span>
            <span
              ref={topBinValRef}
              data-testid="selection-popover-top-bin"
              translate="no"
              className="truncate text-right type-mono-data text-text-primary"
            >
              {initialFormatted.topBinText}
            </span>
          </div>
        </div>

        {isCommitted ? (
          <div
            data-testid="selection-popover-actions"
            className="mt-1 flex items-center justify-between gap-3 border-t border-separator pt-2"
          >
            <button
              type="button"
              data-testid="selection-popover-clear"
              onPointerDown={(e) => {
                if (typeof performance !== 'undefined') {
                  e.currentTarget.dataset.ack = String(performance.now());
                }
              }}
              onClick={onClear}
              className="relative cursor-pointer rounded-xs py-0.5 type-control text-text-secondary transition-colors duration-[120ms] ease-[var(--ease-out)] after:absolute after:-inset-2 after:content-[''] hover:text-text-primary active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t('selection.clear')}
            </button>
            <button
              type="button"
              data-testid="selection-popover-zoom"
              onPointerDown={(e) => {
                if (typeof performance !== 'undefined') {
                  e.currentTarget.dataset.ack = String(performance.now());
                }
              }}
              onClick={onZoomToSelection}
              className="relative cursor-pointer rounded-xs py-0.5 type-control text-text-primary transition-opacity duration-[120ms] ease-[var(--ease-out)] after:absolute after:-inset-2 after:content-[''] hover:opacity-90 active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t('selection.zoom')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
