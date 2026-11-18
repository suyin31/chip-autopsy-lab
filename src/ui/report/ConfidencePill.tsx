'use client';

import { Info } from 'lucide-react';
import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { RenderedConfidenceInfo } from '@/core/report';
import {
  type AnchoredMenuPosition,
  computeAnchoredMenuPosition,
} from '@/ui/primitives/menu';
import { cn } from '@/ui/primitives/cn';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';

export interface ConfidencePillProps {
  readonly confidence: RenderedConfidenceInfo;
  /** Optional initial open state for deterministic SSR/unit verification. */
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

const POPOVER_WIDTH_PX = 300 as const;

/**
 * Confidence Pill (`src/ui/report/ConfidencePill.tsx`, `redesign.md` §0, §3.4, §4.4, §5.9):
 * - Visual height `28 px`, padding `0 12`, radius `999`, `surface-2`, `footnote` secondary
 *   (`"Confidence 0.95"`) with a trailing `12 px` info icon; hit target expanded to `44 px` height.
 * - Clicking opens a `300 px` `material` popover explaining provenance (`"How this verdict was made"` +
 *   template vs verified-LLM method copy), absorbing the legacy `NarrationBadge`.
 */
export function ConfidencePill({
  confidence,
  defaultOpen = false,
  className,
}: ConfidencePillProps): React.JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen);
  const [mounted, setMounted] = React.useState(false);
  const [position, setPosition] = React.useState<AnchoredMenuPosition>({
    top: 0,
    left: 0,
    transformOrigin: 'top left',
  });

  const shouldReduceMotion = useReducedMotion();
  const popoverId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const pressedRef = React.useRef(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = React.useCallback((): void => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === 'undefined') {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPosition(
      computeAnchoredMenuPosition({
        triggerRect: rect,
        menuWidth: POPOVER_WIDTH_PX,
        viewportWidth: window.innerWidth,
        align: 'start',
        sideOffset: 8,
        viewportMargin: 8,
      }),
    );
  }, []);

  React.useLayoutEffect(() => {
    if (!open || !mounted) {
      return;
    }
    updatePosition();
    const handleRelayout = (): void => updatePosition();
    window.addEventListener('resize', handleRelayout);
    window.addEventListener('scroll', handleRelayout, true);
    return () => {
      window.removeEventListener('resize', handleRelayout);
      window.removeEventListener('scroll', handleRelayout, true);
    };
  }, [open, mounted, updatePosition]);

  React.useEffect(() => {
    if (!open || !mounted) {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener('pointerdown', handleOutsidePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, mounted]);

  const releaseSpringScale = React.useCallback((): void => {
    if (!pressedRef.current) {
      return;
    }
    pressedRef.current = false;
    const el = triggerRef.current;
    if (!el || shouldReduceMotion) {
      return;
    }
    animate(el, { scale: 1 }, SPRING_TOKENS.snappy);
  }, [shouldReduceMotion]);

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (typeof performance !== 'undefined') {
      event.currentTarget.dataset.ack = String(performance.now());
    }
    if (event.button !== 0 || shouldReduceMotion) {
      return;
    }
    pressedRef.current = true;
    animate(
      event.currentTarget,
      { scale: 0.97 },
      { duration: 0.1, ease: MOTION_TOKENS.easeOutTuple },
    );
  };

  const popoverBody = (
    <motion.div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-label={confidence.methodTitle}
      data-testid="confidence-popover"
      initial={
        shouldReduceMotion
          ? { opacity: 0 }
          : { opacity: 0, scale: 0.96 }
      }
      animate={
        shouldReduceMotion
          ? { opacity: 1 }
          : { opacity: 1, scale: 1 }
      }
      exit={
        shouldReduceMotion
          ? { opacity: 0, transition: { duration: 0.12 } }
          : {
              opacity: 0,
              scale: 0.98,
              transition: {
                duration: MOTION_TOKENS.durFastMs / 1000,
                ease: MOTION_TOKENS.easeOutTuple,
              },
            }
      }
      transition={shouldReduceMotion ? { duration: 0.12 } : SPRING_TOKENS.ui}
      style={
        mounted
          ? {
              position: 'fixed',
              top: `${position.top}px`,
              left: `${position.left}px`,
              transformOrigin: position.transformOrigin,
            }
          : undefined
      }
      className={cn(
        'z-(--z-menus) w-[300px] max-w-[calc(100vw-32px)] rounded-lg p-4 surface-material',
        !mounted && 'mt-2',
      )}
    >
      <p className="type-headline text-text-primary">
        {confidence.methodTitle}
      </p>
      <p className="mt-1.5 type-callout text-text-secondary">
        {confidence.methodBody}
      </p>
    </motion.div>
  );

  return (
    <div className={cn('inline-flex flex-col items-start', className)}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="confidence-pill"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        onPointerDown={handlePointerDown}
        onPointerUp={releaseSpringScale}
        onPointerLeave={releaseSpringScale}
        onPointerCancel={releaseSpringScale}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill bg-surface-2 px-3 type-footnote text-text-secondary select-none after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
          'transition-[background-color,color] duration-120 ease-out',
          'hover:bg-surface-3 hover:text-text-primary',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          open && 'bg-surface-3 text-text-primary',
        )}
      >
        <span>{confidence.label}</span>
        <Info
          className="size-3 shrink-0 text-text-tertiary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>

      {mounted && typeof document !== 'undefined' ? (
        createPortal(
          <AnimatePresence>{open ? popoverBody : null}</AnimatePresence>,
          document.body,
        )
      ) : open ? (
        popoverBody
      ) : null}
    </div>
  );
}
