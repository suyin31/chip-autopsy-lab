'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { RenderedStatFactTuple } from '@/core/report';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import {
  readPrefersReducedMotionSync,
  STAT_INITIAL_COUNTUP_MS,
  STAT_UPDATE_COUNTUP_MS,
  sampleStatCountUp,
} from '@/ui/wafer-map/probe-sweep';

export interface StatRowProps {
  readonly stats: RenderedStatFactTuple;
  /** When false (during initial 0..85% probe sweep), holds count-up until Verdict rise-in starts (§5.3). */
  readonly revealStarted?: boolean;
  /** Delay in ms matching the StatRow's §5.2 rise-in stagger (`180 ms` normal, `0 ms` reduced). */
  readonly revealDelayMs?: number;
  readonly className?: string;
}

/**
 * Three-column big-number Stat Row (`src/ui/report/StatRow.tsx`, `redesign.md` §3.4, §3.6, §4.5, §5.3):
 * - `<dl>` with exactly 3 `<div>` items (`168 px` cols + `24 px` gap at 553 px desktop; `111 px` cols + `12 px` gap mobile).
 * - Caption `<dt>` (`footnote` secondary, max 2 lines) precedes `<dd>` in DOM and sits visually
 *   below `<dd>` (`stat` 40 px / 300 weight, 6 px gap) via `flex-direction: column-reverse`.
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
      {stats.map((stat, idx) => (
        <div
          key={idx}
          data-testid="verdict-stat-item"
          className="flex min-w-0 flex-col-reverse justify-end gap-1.5"
        >
          <dt className="line-clamp-2 type-subhead text-text-secondary">
            {stat.captionText}
          </dt>
          <dd
            data-emphasis={stat.emphasis ? 'true' : 'false'}
            className={cn(
              'type-stat tabular-nums',
              stat.emphasis ? 'text-failure' : 'text-text-primary',
            )}
          >
            <span
              ref={(el) => {
                valueRefs.current[idx] = el;
              }}
              data-testid="verdict-stat-value"
              aria-hidden="true"
            >
              {stat.valueText}
            </span>
            <span data-testid="verdict-stat-sr" className="sr-only">
              {stat.valueText}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
