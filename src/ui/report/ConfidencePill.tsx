'use client';

import { Info } from 'lucide-react';
import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { resolveGlossaryEntry, splitGlossaryTerms } from '@/core/i18n';
import type { RenderedConfidenceInfo } from '@/core/report';
import { useT } from '@/ui/i18n/use-t';
import {
  type AnchoredMenuPosition,
  computeAnchoredMenuPosition,
} from '@/ui/primitives/menu';
import { cn } from '@/ui/primitives/cn';
import { POPOVER_SURFACE_CLASS } from '@/ui/primitives/surfaces';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { renderWithUntranslatedTokens } from './render-untranslated';

export interface ConfidencePillProps {
  readonly confidence: RenderedConfidenceInfo;
  /** Optional initial open state for deterministic SSR/unit verification. */
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

const POPOVER_WIDTH_PX = 320 as const;

/**
 * Confidence chip (`src/ui/report/ConfidencePill.tsx`, premium §7.4, §7.12):
 * - Ghost pill, 28 px high, padding 0 10 0 12, no fill; `control` secondary "High confidence, 0.95"
 *   + 6 px + a 14 px `info` icon in `text-tertiary`. Hover `fill-1` with primary text and a secondary
 *   icon, pressed `fill-2` at scale 0.97, open `fill-2` with primary text. Never orange.
 * - Click opens a 320 px popover (below-start, 8 px offset): "How this verdict was made", the
 *   `glossary.confidence` definition, a "Match with {pattern}" row with a 4 px `ink` bar at the
 *   confidence width (omitted when no WM-811K class backs the score), and the method note.
 */
export function ConfidencePill({
  confidence,
  defaultOpen = false,
  className,
}: ConfidencePillProps): React.JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen);
  const { locale } = useT();
  const confidenceTerm = resolveGlossaryEntry(locale, 'confidence').term;
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

  // The popover mounts only once its anchored position is known: Motion applies `style` changes
  // on its next frame, so a popover mounted at the default position would show there for a frame.
  const [positionReady, setPositionReady] = React.useState(false);

  React.useLayoutEffect(() => {
    if (!open || !mounted) {
      setPositionReady(false);
      return;
    }
    updatePosition();
    setPositionReady(true);
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
          : { opacity: 0, scale: 0.97 }
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
              // Premium §8.13: popovers close with `opacity -> 0` over `dur-2`
              opacity: 0,
              transition: {
                duration: MOTION_TOKENS.dur2Ms / 1000,
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
        'z-(--z-menus)',
        POPOVER_SURFACE_CLASS,
        !mounted && 'mt-2',
      )}
    >
      <p className="type-headline text-text-primary">
        {confidence.methodTitle}
      </p>
      <p
        data-testid="confidence-definition"
        className="mt-2 type-callout text-text-secondary"
      >
        {confidence.definition}
      </p>
      {confidence.matchLabel !== null ? (
        <div data-testid="confidence-match" className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="type-subhead text-text-secondary">
              {confidence.matchPattern !== null
                ? renderWithUntranslatedTokens(confidence.matchLabel, {
                    pattern: confidence.matchPattern,
                  })
                : confidence.matchLabel}
            </span>
            <span className="type-subhead tabular-nums text-text-primary">
              {confidence.valueText}
            </span>
          </div>
          <div
            aria-hidden="true"
            className="mt-2 h-1 w-full overflow-hidden rounded-pill bg-fill-2"
          >
            <div
              data-testid="confidence-match-bar"
              className="h-full rounded-pill bg-ink"
              style={{
                width: `${Math.round(Math.min(1, Math.max(0, confidence.confidenceValue)) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}
      <p className="mt-3 type-callout text-text-secondary">
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
        data-level={confidence.level}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
        onPointerDown={handlePointerDown}
        onPointerUp={releaseSpringScale}
        onPointerLeave={releaseSpringScale}
        onPointerCancel={releaseSpringScale}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "group relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill bg-transparent pl-3 pr-2.5 type-control whitespace-nowrap text-text-secondary shadow-none select-none after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
          'transition-[background-color,color] duration-[120ms] ease-[var(--ease-out)]',
          'hover:bg-fill-1 hover:text-text-primary active:bg-fill-2',
          'focus-visible:shadow-focus-ring focus-visible:outline-none',
          open && 'bg-fill-2 text-text-primary hover:bg-fill-2',
        )}
      >
        <span className="tabular-nums">
          {/* Premium §2.2, A21: "Confidence" carries the Term underline; the popover holds its definition */}
          {splitGlossaryTerms(
            confidence.label,
            [{ id: 'confidence', term: confidenceTerm }],
            1,
          ).map((seg, idx) =>
            seg.kind === 'term' ? (
              <span
                key={idx}
                data-testid="confidence-term"
                data-term-id={seg.id}
                data-state={open ? 'open' : 'closed'}
                className="term cursor-pointer"
              >
                {seg.value}
              </span>
            ) : (
              <React.Fragment key={idx}>{seg.value}</React.Fragment>
            ),
          )}
        </span>
        <Info
          className="size-3.5 shrink-0 text-text-tertiary transition-[color] duration-[120ms] ease-[var(--ease-out)] group-hover:text-text-secondary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>

      {mounted && typeof document !== 'undefined' ? (
        createPortal(
          <AnimatePresence>{open && positionReady ? popoverBody : null}</AnimatePresence>,
          document.body,
        )
      ) : open ? (
        popoverBody
      ) : null}
    </div>
  );
}
