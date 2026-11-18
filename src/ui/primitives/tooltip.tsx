'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { TOOLTIP_SURFACE_CLASS } from './surfaces';

/** Tooltip delay on controls (premium §7.12). */
export const TOOLTIP_DELAY_MS = 600 as const;
/** Moving to another tooltip trigger within this window after a close shows it at once (premium §7.12). */
export const TOOLTIP_SKIP_DELAY_WINDOW_MS = 400 as const;
const TOOLTIP_OFFSET_PX = 8;
const TOOLTIP_VIEWPORT_MARGIN_PX = 8;

let lastTooltipClosedAt = Number.NEGATIVE_INFINITY;

/** Delay before showing a tooltip, given the time since the last tooltip closed. */
export function resolveTooltipDelayMs(
  now: number,
  lastClosedAt: number,
): number {
  return now - lastClosedAt <= TOOLTIP_SKIP_DELAY_WINDOW_MS
    ? 0
    : TOOLTIP_DELAY_MS;
}

export interface TooltipProps {
  readonly content: React.ReactNode;
  /** Suppresses the tooltip, for example while the trigger's menu is open. */
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/**
 * Hover tooltip (premium §7.12): `material-thick` + `shadow-popover`, `r-sm`, padding 6 10,
 * `caption` primary, max 240 wide, 8 px below the trigger and kept 8 px inside the viewport,
 * z 55. Mouse only: never on touch. Pressing the trigger hides it until the pointer re-enters.
 */
export function Tooltip({
  content,
  disabled = false,
  className,
  children,
}: TooltipProps): React.JSX.Element {
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ top: 0, left: 0 });

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const hide = React.useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen((wasOpen) => {
      if (wasOpen) {
        lastTooltipClosedAt = performance.now();
      }
      return false;
    });
  }, []);

  React.useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  React.useEffect(() => () => clearTimer(), []);

  React.useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tooltipRef.current;
    if (!anchor || !tip) return;
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const centred = rect.left + rect.width / 2 - width / 2;
    const maxLeft = window.innerWidth - TOOLTIP_VIEWPORT_MARGIN_PX - width;
    setPosition({
      top: rect.bottom + TOOLTIP_OFFSET_PX,
      left: Math.max(TOOLTIP_VIEWPORT_MARGIN_PX, Math.min(centred, maxLeft)),
    });
  }, [open]);

  const handlePointerEnter = (event: React.PointerEvent): void => {
    if (disabled || event.pointerType !== 'mouse') return;
    clearTimer();
    const delay = resolveTooltipDelayMs(performance.now(), lastTooltipClosedAt);
    if (delay === 0) {
      setOpen(true);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, delay);
  };

  return (
    <span
      ref={anchorRef}
      className={cn('inline-flex', className)}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={hide}
      onPointerDown={hide}
    >
      {children}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tooltipRef}
              role="tooltip"
              data-testid="tooltip"
              style={{ top: `${position.top}px`, left: `${position.left}px` }}
              className={cn(
                TOOLTIP_SURFACE_CLASS,
                'pointer-events-none fixed z-[var(--z-tooltips)] w-max text-pretty',
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
