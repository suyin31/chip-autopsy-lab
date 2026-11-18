'use client';

import { X } from 'lucide-react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { Button } from './button';
import { cn } from './cn';

export interface ModalSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly titleId: string;
  readonly descriptionId?: string;
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Accessible name of the desktop close icon button ("Close", premium §7.16). */
  readonly closeLabel: string;
  /** Desktop dialog width: 480 (default) or 560 (error details). */
  readonly size?: 'default' | 'wide';
  readonly disablePortal?: boolean;
  readonly 'data-testid'?: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

const DISMISS_VELOCITY_PX_PER_S = 500;
const REDUCED_FADE = { duration: 0.12, ease: 'linear' } as const;
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable descendants that are rendered (the desktop-only close button is hidden on mobile). */
function listFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0,
  );
}
const DISMISS_HEIGHT_FRACTION = 0.3;
const RUBBERBAND_CONSTANT = 0.55;

function rubberband(overshoot: number, dimension: number): number {
  const safeDim = Math.max(1, dimension);
  return (
    (overshoot * safeDim * RUBBERBAND_CONSTANT) /
    (safeDim + RUBBERBAND_CONSTANT * Math.abs(overshoot))
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Accessible modal / mobile bottom sheet primitive (premium §7.16; `redesign.md` §2.4, §2.5, §5.9):
 * - `scrim` backdrop at `z-[var(--z-sheets)]` (`60`)
 * - Desktop (`>= 768px`): centred dialog, 480 wide (`size="wide"`: 560), `surface`, `r-2xl`,
 *   `shadow-popover`, padding 32, `spring-ui`; icon button "Close" (`x`) 16 / 16 from the top-right
 * - Mobile (`< 768px`): full-width bottom sheet (`rounded-t-[24px]`), `36 x 5 px` drag handle,
 *   `y: 100% -> 0` `spring-ui` + 1:1 ref-driven drag-to-dismiss (`velocity > 500 px/s` or `> 30%` height)
 * - Deterministic initial focus (`initialFocusRef`), Tab focus trap, Escape & scrim dismissal
 */
export function ModalSheet({
  open,
  onClose,
  titleId,
  descriptionId,
  initialFocusRef,
  closeLabel,
  size = 'default',
  disablePortal = false,
  'data-testid': dataTestId,
  className,
  children,
}: ModalSheetProps): React.JSX.Element | null {
  const shouldReduceMotion = useReducedMotion();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const [isMobile, setIsMobile] = React.useState(false);
  const [isClientMounted, setIsClientMounted] = React.useState(false);

  const dragSamplesRef = React.useRef<Array<{ y: number; t: number }>>([]);
  const dragStartYRef = React.useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    setIsClientMounted(true);
    if (typeof window === 'undefined') {
      return;
    }
    const mql = window.matchMedia('(max-width: 767px)');
    const sync = (): void => setIsMobile(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const focusTarget = (): void => {
      const preferred = initialFocusRef?.current;
      if (preferred && !preferred.hasAttribute('disabled')) {
        preferred.focus();
        return;
      }
      const dialogEl = dialogRef.current;
      if (!dialogEl) {
        return;
      }
      const firstFocusable = listFocusables(dialogEl)[0];
      (firstFocusable ?? dialogEl).focus();
    };

    focusTarget();
    const rafId = requestAnimationFrame(() => {
      const dialogEl = dialogRef.current;
      if (
        dialogEl &&
        (!document.activeElement || !dialogEl.contains(document.activeElement))
      ) {
        focusTarget();
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        queueMicrotask(() => {
          prev.focus();
        });
      }
    };
  }, [initialFocusRef, open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === 'Tab') {
      const dialogEl = dialogRef.current;
      if (!dialogEl || typeof document === 'undefined') {
        return;
      }
      const focusables = listFocusables(dialogEl);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !dialogEl.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !dialogEl.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleDragPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (!isMobile || event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartYRef.current = event.clientY;
    dragSamplesRef.current = [{ y: event.clientY, t: event.timeStamp }];
  };

  const handleDragPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const startY = dragStartYRef.current;
    const dialogEl = dialogRef.current;
    if (startY === null || !dialogEl) {
      return;
    }
    const rawDelta = event.clientY - startY;
    const sheetHeight = Math.max(1, dialogEl.offsetHeight);
    const deltaY =
      rawDelta >= 0 ? rawDelta : rubberband(rawDelta, sheetHeight) * 0.25;
    dialogEl.style.transform = `translate3d(0, ${deltaY}px, 0)`;

    const samples = dragSamplesRef.current;
    samples.push({ y: event.clientY, t: event.timeStamp });
    while (samples.length > 5) {
      samples.shift();
    }
  };

  const finishMobileDrag = (): void => {
    const startY = dragStartYRef.current;
    const dialogEl = dialogRef.current;
    dragStartYRef.current = null;
    if (startY === null || !dialogEl) {
      return;
    }

    const samples = dragSamplesRef.current;
    const last = samples[samples.length - 1];
    const first = samples[0];
    const sheetHeight = Math.max(1, dialogEl.offsetHeight);
    const rawDelta = last ? last.y - startY : 0;
    const currentDeltaY =
      rawDelta >= 0 ? rawDelta : rubberband(rawDelta, sheetHeight) * 0.25;
    const dtMs = first && last ? Math.max(1, last.t - first.t) : 16;
    const velocityPxPerS =
      first && last ? ((last.y - first.y) / dtMs) * 1000 : 0;

    if (
      velocityPxPerS > DISMISS_VELOCITY_PX_PER_S ||
      currentDeltaY > sheetHeight * DISMISS_HEIGHT_FRACTION
    ) {
      onClose();
      return;
    }

    if (shouldReduceMotion) {
      dialogEl.style.transform = 'translate3d(0, 0px, 0)';
    } else {
      animate(
        dialogEl,
        { y: [currentDeltaY, 0] },
        { ...SPRING_TOKENS.ui, velocity: velocityPxPerS },
      );
    }
  };

  const sheetTree = (
    <AnimatePresence initial={false}>
      {open ? (
        <div
          className="fixed inset-0 z-[var(--z-sheets)] flex items-end justify-center overscroll-contain md:items-center md:p-4"
          onKeyDown={handleKeyDown}
        >
          {/* Scrim: premium §3.2 `scrim` token (light 0.60 + 24 px blur, dark 0.55 + 32 px blur) */}
          <motion.div
            aria-hidden="true"
            data-testid="sheet-scrim"
            // Premium §8.13: scrim opacity `dur-3` in, `dur-2` out; reduced motion 120 ms
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: shouldReduceMotion
                ? REDUCED_FADE
                : {
                    duration: MOTION_TOKENS.dur3Ms / 1000,
                    ease: MOTION_TOKENS.easeOutTuple,
                  },
            }}
            exit={{
              opacity: 0,
              transition: shouldReduceMotion
                ? REDUCED_FADE
                : {
                    duration: MOTION_TOKENS.dur2Ms / 1000,
                    ease: MOTION_TOKENS.easeOutTuple,
                  },
            }}
            onClick={onClose}
            className="sheet-scrim-surface absolute inset-0"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            data-testid={dataTestId}
            tabIndex={-1}
            // Premium §8.13: dialog `opacity 0 -> 1` + `scale(0.98 -> 1)` on `spring-ui`, closes with
            // `opacity -> 0` over `dur-2`; the bottom sheet slides `translateY(100% <-> 0)` on
            // `spring-ui` both ways; reduced motion fades opacity only over 120 ms
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : isMobile
                  ? { opacity: 1, y: '100%' }
                  : { opacity: 0, scale: 0.98 }
            }
            animate={
              shouldReduceMotion
                ? { opacity: 1, transition: REDUCED_FADE }
                : isMobile
                  ? { opacity: 1, y: '0%', transition: SPRING_TOKENS.ui }
                  : { opacity: 1, scale: 1, transition: SPRING_TOKENS.ui }
            }
            exit={
              shouldReduceMotion
                ? { opacity: 0, transition: REDUCED_FADE }
                : isMobile
                  ? { y: '100%', transition: SPRING_TOKENS.ui }
                  : {
                      opacity: 0,
                      transition: {
                        duration: MOTION_TOKENS.dur2Ms / 1000,
                        ease: MOTION_TOKENS.easeOutTuple,
                      },
                    }
            }
            className={cn(
              // premium §7.16: `surface`, `r-2xl`, `shadow-popover`; mobile padding 24 16 + safe area
              'relative z-10 w-full rounded-t-2xl bg-surface px-4 pt-0 pb-[calc(24px+env(safe-area-inset-bottom))] text-text-primary shadow-popover outline-none',
              size === 'wide' ? 'md:w-[560px]' : 'md:w-[480px]',
              'md:max-w-[calc(100vw-32px)] md:rounded-2xl md:p-8',
              className,
            )}
          >
            {/* Mobile grabber: 36 x 5 `fill-3`, 8 px from the top, content starts at 24 (premium §7.16) */}
            <div
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={finishMobileDrag}
              onPointerCancel={finishMobileDrag}
              className="-mx-2 flex h-6 touch-none items-start justify-center pt-2 md:hidden"
              aria-hidden="true"
            >
              <span className="h-[5px] w-9 rounded-pill bg-fill-3" />
            </div>

            {/* Desktop: icon button "Close" (`x`) 16 / 16 from the top-right (premium §7.16) */}
            <span className="absolute top-4 right-4 hidden md:block">
              <Button
                variant="icon"
                aria-label={closeLabel}
                data-testid="sheet-close-button"
                onClick={onClose}
              >
                <X aria-hidden="true" strokeWidth={2} />
              </Button>
            </span>

            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  if (disablePortal || !isClientMounted || typeof document === 'undefined') {
    return sheetTree;
  }

  return createPortal(sheetTree, document.body);
}
