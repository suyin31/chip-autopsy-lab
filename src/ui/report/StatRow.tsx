'use client';

import { animate, useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { RenderedStatFact, RenderedStatFactTuple } from '@/core/report';
import type { GlossaryTermId } from '@/core/i18n';
import type { StatCaptionKey } from '@/core/report';
import { GlossaryText, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import {
  readPrefersReducedMotionSync,
  STAT_INITIAL_COUNTUP_MS,
  STAT_UPDATE_COUNTUP_MS,
  sampleStatCountUp,
} from '@/ui/wafer-map/probe-sweep';

/** "dies failed, of 15,825 tested" defines "Die" (premium §2.2). */
export function resolveStatCaptionTerms(
  captionKey: StatCaptionKey,
): readonly GlossaryTermId[] {
  return captionKey === 'stats.failingDies' ? DIE_TERMS : NO_TERMS;
}

const DIE_TERMS: readonly GlossaryTermId[] = ['die'];
const NO_TERMS: readonly GlossaryTermId[] = [];
/** The second line "81.5% on the first test" defines "First test" (premium §2.2). */
const STAT_SECONDARY_CAPTION_TERMS: readonly GlossaryTermId[] = ['firstTest'];

export interface StatRowProps {
  readonly stats: RenderedStatFactTuple;
  /** When false (during initial 0..85% probe sweep), holds count-up until Verdict rise-in starts (§5.3). */
  readonly revealStarted?: boolean;
  /** Delay in ms matching the StatRow's §5.2 rise-in stagger (`180 ms` normal, `0 ms` reduced). */
  readonly revealDelayMs?: number;
  /** Active selection-store highlight ID; a stat whose evidence ID matches shows selected. */
  readonly activeClaimId?: string | null;
  /** Lights (or clears) the stat's evidence dies through the selection store (premium §7.5). */
  readonly onToggleStat?: (stat: RenderedStatFact) => void;
  readonly className?: string;
}

/**
 * Three-column big-number Stat Row (`src/ui/report/StatRow.tsx`, premium §7.5, `redesign.md` §5.3):
 * - `<dl>` grid `repeat(3, 1fr)`, gap 24 (12 below 768); each stat `<div>` holds a `<button>`
 *   (inside `<dd>`, padding 12 / margin -12, `r-lg`) that lights the stat's evidence dies.
 *   Hover `fill-1` + caption `text-primary`, pressed `fill-2` + scale 0.985, selected
 *   (`aria-pressed`) `fill-2`.
 * - Number `<dd>`: `stat`, `text-primary`, tabular; never orange (A4).
 * - Caption `<dt>` (`subhead` secondary, max 2 lines, optional `subhead` tertiary second line)
 *   precedes `<dd>` in DOM and sits visually below it (6 px gap) via `flex-direction: column-reverse`.
 * - §5.3 Count-up:
 *   - First reveal: `0 -> target` in `700 ms` `ease-out-expo` via one rAF loop writing `textContent`
 *     to refs (zero React state per frame).
 *   - Selection-linked updates: `previous -> target` in `300 ms` `ease-out-expo` (interruptible).
 *   - Accessibility: visible animating `<span>` is `aria-hidden="true"`; sibling `.sr-only` `<span>`
 *     holds the final value.
 *   - Reduced motion: shows final values immediately (`0 ms`, never `0`).
 */
export function StatRow({
  stats,
  revealStarted = true,
  revealDelayMs = 0,
  activeClaimId = null,
  onToggleStat,
  className,
}: StatRowProps): React.JSX.Element {
  const { formatInteger, formatPercent } = useT();
  const shouldReduceMotion = useReducedMotion();
  const prefersReduced = readPrefersReducedMotionSync(shouldReduceMotion);

  const valueRefs = React.useRef<Array<HTMLSpanElement | null>>([
    null,
    null,
    null,
  ]);
  const displayedValuesRef = React.useRef<[number, number, number]>([
    stats[0].numericValue,
    stats[1].numericValue,
    stats[2].numericValue,
  ]);
  const prevTargetsRef = React.useRef<[number, number, number]>([
    stats[0].numericValue,
    stats[1].numericValue,
    stats[2].numericValue,
  ]);
  const hasCompletedInitialRevealRef = React.useRef(false);
  const rafRef = React.useRef<number | null>(null);
  const itemRefs = React.useRef<Array<HTMLDivElement | null>>([null, null, null]);
  const pressedIdxRef = React.useRef<number | null>(null);
  const idPrefix = React.useId();

  // Premium §7.5 / §3.12: cards and rows press to 0.985 (80 ms in, spring-snappy out); none under reduced motion
  const handlePressStart = (
    idx: number,
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (typeof performance !== 'undefined') {
      event.currentTarget.dataset.ack = String(performance.now());
    }
    if (event.button !== 0 || prefersReduced) {
      return;
    }
    const el = itemRefs.current[idx];
    if (el) {
      pressedIdxRef.current = idx;
      animate(
        el,
        { scale: MOTION_TOKENS.pressScale.row },
        { duration: 0.08, ease: MOTION_TOKENS.easeOutTuple },
      );
    }
  };
  const handlePressEnd = (): void => {
    const idx = pressedIdxRef.current;
    if (idx === null) {
      return;
    }
    pressedIdxRef.current = null;
    const el = itemRefs.current[idx];
    if (el) {
      animate(el, { scale: 1 }, SPRING_TOKENS.snappy);
    }
  };

  const cancelRaf = React.useCallback((): void => {
    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  React.useLayoutEffect(() => {
    const nextTargets: [number, number, number] = [
      stats[0].numericValue,
      stats[1].numericValue,
      stats[2].numericValue,
    ];

    if (prefersReduced || typeof requestAnimationFrame !== 'function') {
      cancelRaf();
      hasCompletedInitialRevealRef.current = true;
      prevTargetsRef.current = nextTargets;
      displayedValuesRef.current = [...nextTargets];
      for (let i = 0; i < 3; i += 1) {
        const el = valueRefs.current[i];
        if (el) {
          el.textContent = stats[i]!.valueText;
        }
      }
      return;
    }

    if (!revealStarted) {
      cancelRaf();
      displayedValuesRef.current = [0, 0, 0];
      for (let i = 0; i < 3; i += 1) {
        const el = valueRefs.current[i];
        const stat = stats[i]!;
        if (el) {
          el.textContent =
            stat.format === 'percent' ? formatPercent(0) : formatInteger(0);
        }
      }
      return;
    }

    const isInitialReveal = !hasCompletedInitialRevealRef.current;
    const prevTargets = prevTargetsRef.current;
    const targetsChanged =
      Math.abs(nextTargets[0] - prevTargets[0]) > 1e-6 ||
      Math.abs(nextTargets[1] - prevTargets[1]) > 1e-6 ||
      Math.abs(nextTargets[2] - prevTargets[2]) > 1e-6;

    prevTargetsRef.current = nextTargets;

    if (!isInitialReveal && !targetsChanged) {
      if (rafRef.current === null) {
        for (let i = 0; i < 3; i += 1) {
          const el = valueRefs.current[i];
          if (el && el.textContent !== stats[i]!.valueText) {
            el.textContent = stats[i]!.valueText;
          }
        }
      }
      return;
    }

    hasCompletedInitialRevealRef.current = true;
    cancelRaf();

    const fromValues: [number, number, number] = isInitialReveal
      ? [0, 0, 0]
      : [
          displayedValuesRef.current[0],
          displayedValuesRef.current[1],
          displayedValuesRef.current[2],
        ];
    displayedValuesRef.current = [...fromValues];

    if (isInitialReveal) {
      for (let i = 0; i < 3; i += 1) {
        const el = valueRefs.current[i];
        const stat = stats[i]!;
        if (el) {
          el.textContent =
            stat.format === 'percent' ? formatPercent(0) : formatInteger(0);
        }
      }
    }

    const durationMs = isInitialReveal
      ? STAT_INITIAL_COUNTUP_MS
      : STAT_UPDATE_COUNTUP_MS;
    const delayMs = isInitialReveal ? Math.max(0, revealDelayMs) : 0;
    const startMs =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) +
      delayMs;

    const tick = (nowMs: number): void => {
      const elapsedMs = nowMs - startMs;
      if (elapsedMs < 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      for (let i = 0; i < 3; i += 1) {
        const stat = stats[i]!;
        const v = sampleStatCountUp({
          from: fromValues[i]!,
          to: nextTargets[i]!,
          elapsedMs,
          durationMs,
          prefersReducedMotion: false,
        });
        displayedValuesRef.current[i] = v;
        const el = valueRefs.current[i];
        if (el) {
          el.textContent =
            elapsedMs >= durationMs
              ? stat.valueText
              : stat.format === 'percent'
                ? formatPercent(v)
                : formatInteger(Math.round(v));
        }
      }

      if (elapsedMs < durationMs) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return cancelRaf;
  }, [
    stats,
    revealStarted,
    revealDelayMs,
    prefersReduced,
    formatInteger,
    formatPercent,
    cancelRaf,
  ]);

  return (
    <dl
      data-testid="verdict-stat-row"
      className={cn('grid grid-cols-3 gap-3 md:gap-6', className)}
    >
      {stats.map((stat, idx) => {
        const isSelected = activeClaimId === stat.evidence.claimId;
        const captionId = `${idPrefix}-caption-${idx}`;
        const valueId = `${idPrefix}-value-${idx}`;
        return (
          <div
            key={idx}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            data-testid="verdict-stat-item"
            data-selected={isSelected ? 'true' : undefined}
            className="group/stat relative flex min-w-0 origin-center flex-col-reverse justify-end gap-1.5"
          >
            {/* Text sits above the button fill and lets pointer input through to the button */}
            <dt
              id={captionId}
              className="pointer-events-none relative z-[1] type-subhead"
            >
              <span
                data-testid="verdict-stat-caption"
                className="line-clamp-2 block text-text-secondary transition-colors duration-120 ease-out group-hover/stat:text-text-primary max-xl:line-clamp-3"
              >
                <GlossaryText
                  text={stat.captionText}
                  terms={resolveStatCaptionTerms(stat.captionKey)}
                />
              </span>
              {stat.captionSecondaryText !== null ? (
                <span
                  data-testid="verdict-stat-caption-secondary"
                  className="line-clamp-2 block text-text-tertiary tabular-nums"
                >
                  <GlossaryText
                    text={stat.captionSecondaryText}
                    terms={STAT_SECONDARY_CAPTION_TERMS}
                  />
                </span>
              ) : null}
            </dt>
            <dd className="type-stat text-text-primary tabular-nums">
              <span
                ref={(el) => {
                  valueRefs.current[idx] = el;
                }}
                data-testid="verdict-stat-value"
                aria-hidden="true"
                className="pointer-events-none relative z-[1]"
              >
                {stat.valueText}
              </span>
              <span id={valueId} data-testid="verdict-stat-sr" className="sr-only">
                {stat.valueText}
              </span>
              {/* Premium §7.5: padding 12 / margin -12 keeps the text on the grid; r-lg */}
              <button
                type="button"
                data-testid="verdict-stat-button"
                data-claim-id={stat.evidence.claimId}
                aria-pressed={isSelected}
                aria-labelledby={`${valueId} ${captionId}`}
                disabled={onToggleStat === undefined}
                onPointerDown={(e) => handlePressStart(idx, e)}
                onPointerUp={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onPointerCancel={handlePressEnd}
                onClick={() => onToggleStat?.(stat)}
                className={cn(
                  'absolute -inset-x-1.5 -inset-y-3 z-0 cursor-pointer md:-inset-x-3 appearance-none rounded-lg border-0 bg-transparent p-0',
                  'transition-[background-color] duration-120 ease-out',
                  'enabled:hover:bg-fill-1 enabled:active:bg-fill-2 aria-pressed:bg-fill-2 enabled:aria-pressed:hover:bg-fill-2',
                  'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  'disabled:cursor-default',
                )}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
