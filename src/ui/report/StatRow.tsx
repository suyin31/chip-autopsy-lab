'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { RenderedStatFactTuple } from '@/core/report';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';

export interface StatRowProps {
  readonly stats: RenderedStatFactTuple;
  readonly className?: string;
}

function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

/**
 * Three-column big-number Stat Row (`src/ui/report/StatRow.tsx`, `redesign.md` §3.4, §3.6, §4.5, §5.3):
 * - `<dl>` with exactly 3 `<div>` items (`168 px` cols + `24 px` gap at 553 px desktop; `111 px` cols + `12 px` gap mobile).
 * - Caption `<dt>` (`footnote` secondary, max 2 lines) precedes `<dd>` in DOM and sits visually
 *   below `<dd>` (`stat` 40 px / 300 weight, 6 px gap) via `flex-direction: column-reverse`.
 * - Animates selection-linked stat transitions over `300 ms` `ease-out-expo` via rAF writing
 *   `textContent` directly to refs (`tabular-nums` during transition, instant under reduced motion).
 */
export function StatRow({
  stats,
  className,
}: StatRowProps): React.JSX.Element {
  const { formatInteger, formatPercent } = useT();
  const shouldReduceMotion = useReducedMotion();
  const valueRefs = React.useRef<Array<HTMLElement | null>>([null, null, null]);
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
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const nextTargets: [number, number, number] = [
      stats[0].numericValue,
      stats[1].numericValue,
      stats[2].numericValue,
    ];
    const prevTargets = prevTargetsRef.current;
    const changed =
      Math.abs(nextTargets[0] - prevTargets[0]) > 1e-6 ||
      Math.abs(nextTargets[1] - prevTargets[1]) > 1e-6 ||
      Math.abs(nextTargets[2] - prevTargets[2]) > 1e-6;

    prevTargetsRef.current = nextTargets;

    if (!changed) {
      for (let i = 0; i < 3; i += 1) {
        const el = valueRefs.current[i];
        if (el && el.textContent !== stats[i]!.valueText) {
          el.textContent = stats[i]!.valueText;
        }
      }
      return;
    }

    if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (shouldReduceMotion || typeof requestAnimationFrame !== 'function') {
      displayedValuesRef.current = [...nextTargets];
      for (let i = 0; i < 3; i += 1) {
        const el = valueRefs.current[i];
        if (el) {
          el.textContent = stats[i]!.valueText;
        }
      }
      return;
    }

    const fromValues: [number, number, number] = [
      displayedValuesRef.current[0],
      displayedValuesRef.current[1],
      displayedValuesRef.current[2],
    ];
    const startMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = 300;

    const tick = (nowMs: number): void => {
      const t = Math.min(1, Math.max(0, (nowMs - startMs) / durationMs));
      const eased = easeOutExpo(t);

      for (let i = 0; i < 3; i += 1) {
        const stat = stats[i]!;
        const v = fromValues[i]! + (nextTargets[i]! - fromValues[i]!) * eased;
        displayedValuesRef.current[i] = v;
        const el = valueRefs.current[i];
        if (el) {
          el.textContent =
            t >= 1
              ? stat.valueText
              : stat.format === 'percent'
                ? formatPercent(v)
                : formatInteger(Math.round(v));
        }
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [stats, shouldReduceMotion, formatInteger, formatPercent]);

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
          <dt className="line-clamp-2 type-footnote text-text-secondary">
            {stat.captionText}
          </dt>
          <dd
            ref={(el) => {
              valueRefs.current[idx] = el;
            }}
            data-testid="verdict-stat-value"
            data-emphasis={stat.emphasis ? 'true' : 'false'}
            aria-label={stat.valueText}
            className={cn(
              'type-stat tabular-nums',
              stat.emphasis ? 'text-failure' : 'text-text-primary',
            )}
          >
            {stat.valueText}
          </dd>
        </div>
      ))}
    </dl>
  );
}
