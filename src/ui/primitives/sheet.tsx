'use client';

import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { cn } from './cn';

export interface ModalSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly titleId: string;
  readonly descriptionId?: string;
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
  readonly disablePortal?: boolean;
  readonly 'data-testid'?: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

const DISMISS_VELOCITY_PX_PER_S = 500;
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
 * Accessible modal / mobile bottom sheet primitive (`redesign.md` §2.4, §2.5, §3.7, §3.8, §5.9):
 * - Scrim `rgba(0, 0, 0, 0.5)` + `blur(32px)` at `z-[var(--z-sheets)]` (`60`)
 * - Desktop (`>= 768px`): `480px` wide centred `rounded-[24px]` material surface, `32px` padding, `spring-ui`
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
      const firstFocusable = dialogEl.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
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
      const focusables = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
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
          {/* Scrim: rgba(0,0,0,0.5) + 32px blur (§3.8) */}
          <motion.div
            aria-hidden="true"
            data-testid="sheet-scrim"
            initial={{ opacity: shouldReduceMotion ? 1 : 0 }}
            animate={{
              opacity: 1,
              transition: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.12, ease: MOTION_TOKENS.easeOutTuple },
            }}
            exit={{
              opacity: 0,
              transition: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.12, ease: MOTION_TOKENS.easeOutTuple },
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
            initial={
              shouldReduceMotion
                ? { opacity: 1 }
                : isMobile
                  ? { opacity: 1, y: '100%' }
                  : { opacity: 0, scale: 0.96 }
            }
            animate={
              shouldReduceMotion
                ? { opacity: 1, transition: { duration: 0 } }
                : isMobile
                  ? { opacity: 1, y: '0%', transition: SPRING_TOKENS.ui }
                  : { opacity: 1, scale: 1, transition: SPRING_TOKENS.ui }
            }
            exit={
              shouldReduceMotion
                ? { opacity: 0, transition: { duration: 0 } }
                : isMobile
                  ? {
                      opacity: 0,
                      y: '100%',
                      transition: {
                        duration: 0.16,
                        ease: MOTION_TOKENS.easeOutTuple,
                      },
                    }
                  : {
                      opacity: 0,
                      scale: 0.98,
                      transition: {
                        duration: 0.12,
                        ease: MOTION_TOKENS.easeOutTuple,
                      },
                    }
            }
            className={cn(
              'surface-material relative z-10 w-full rounded-t-lg px-6 pt-3 pb-8 text-text-primary outline-none',
              'md:w-[480px] md:max-w-[calc(100vw-32px)] md:rounded-lg md:p-8',
              className,
            )}
          >
            {/* Mobile bottom-sheet drag handle (36 x 5 px, §3.8) */}
            <div
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={finishMobileDrag}
              onPointerCancel={finishMobileDrag}
              className="-mx-2 flex touch-none items-center justify-center py-2 md:hidden"
              aria-hidden="true"
            >
              <span className="h-[5px] w-9 rounded-pill bg-white/24" />
            </div>

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
