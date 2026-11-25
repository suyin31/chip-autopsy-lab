'use client';

import { animate, useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { RenderedStatFact, RenderedStatFactTuple } from '@/core/report';
import type { GlossaryTermId } from '@/core/i18n';
import type { StatCaptionKey } from '@/core/report';
import { useProximityRim } from '@/ui/atelier/ProximityPlate';
import { GlossaryText, useT } from '@/ui/i18n';
import { useTactileTilt } from '@/ui/motion';
import { CountUpCompleteContext } from '@/ui/primitives/count-up';
import { cn } from '@/ui/primitives/cn';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import {
  readPrefersReducedMotionSync,
  STAT_INITIAL_COUNTUP_MS,
  STAT_UPDATE_COUNTUP_MS,
  sampleStatCountUp,
} from '@/ui/wafer-map/probe-sweep';

export function resolveStatCaptionTerms(
  captionKey: StatCaptionKey,
): readonly GlossaryTermId[] {
  return captionKey === 'stats.failingDies' ? DIE_TERMS : NO_TERMS;
}

const DIE_TERMS: readonly GlossaryTermId[] = ['die'];
const NO_TERMS: readonly GlossaryTermId[] = [];
const STAT_SECONDARY_CAPTION_TERMS: readonly GlossaryTermId[] = ['firstTest'];

export interface StatRowProps {
  readonly stats: RenderedStatFactTuple;
  readonly revealStarted?: boolean;
  readonly revealDelayMs?: number;
  readonly activeClaimId?: string | null;
  readonly onToggleStat?: (stat: RenderedStatFact) => void;
  readonly className?: string;
}

/**
 * 3D KPI Bento Plate: restrained 5° spring tilt + proximity rim + surface spotlight.
 */
const StatPlate = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(function StatPlate({ className, children, ...rest }, forwardedRef) {
  const plateRef = React.useRef<HTMLDivElement | null>(null);
  useTactileTilt(plateRef, { maxDeg: 5, liftPx: 4 });
  useProximityRim(plateRef, { reachPx: 190 });
  React.useImperativeHandle(forwardedRef, () => plateRef.current as HTMLDivElement);
  return (
    <div ref={plateRef} className={className} {...rest}>
      {children}
    </div>
  );
});

/**
 * Mini micro-instrument rendered beside each KPI readout (zero ember class names for R5 audit):
 * - idx 0 (primary share/rate): 12-segment illuminated bar strip
 * - idx 1 (final yield): 36px SVG circular yield arc
 * - idx 2 (failed dies): compact segmented ratio track
 */
function StatMicroMeter({
  idx,
  stat,
}: {
  readonly idx: number;
  readonly stat: RenderedStatFact;
}): React.JSX.Element {
  if (idx === 0) {
    const ratio =
      stat.format === 'percent'
        ? Math.max(0.08, Math.min(1, stat.numericValue))
        : 0.75;
    const activeCells = Math.max(1, Math.round(ratio * 12));
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none relative z-[1] flex items-center gap-1"
      >
        {Array.from({ length: 12 }, (_, cellIdx) => (
          <span
            key={cellIdx}
            className={cn(
              'h-5 w-1.5 rounded-pill',
              cellIdx < activeCells ? 'at-bar-iris' : 'bg-fill-2',
            )}
          />
        ))}
      </span>
    );
  }

  if (idx === 1) {
    const ratio = Math.max(0, Math.min(1, stat.numericValue));
    const r = 13.5;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - ratio);
    return (
      <svg
        aria-hidden="true"
        width="34"
        height="34"
        viewBox="0 0 34 34"
        className="pointer-events-none relative z-[1] size-[34px] shrink-0 -rotate-90"
      >
        <circle cx="17" cy="17" r={r} fill="none" stroke="var(--fill-2)" strokeWidth="3" />
        <circle
          cx="17"
          cy="17"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="at-stroke-iris"
        />
      </svg>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none relative z-[1] flex w-12 flex-col gap-1"
    >
      <span className="h-1.5 w-full overflow-hidden rounded-pill bg-fill-2">
        <span className="at-bar-iris block h-full w-[38%] rounded-pill" />
      </span>
      <span className="h-1 w-8 rounded-pill bg-fill-2" />
    </span>
  );
}

/**
 * 1 + 2 Asymmetric KPI Bento (`src/ui/report/StatRow.tsx`):
 * - Item 0 spans 2 columns (`col-span-2`) at 48–52px as the primary forensic ratio with a
 *   12-segment micro-meter; Items 1 & 2 sit side-by-side (`34px`) with circular yield arc and
 *   fail-share micro-bars.
 * - Preserves all `verdict-stat-*` testids, `.count-up` width locking, `.sr-only` sibling,
 *   and zero-ember R5 invariants.
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
  const initialRevealRunningRef = React.useRef(false);
  const revealCompleted = React.useContext(CountUpCompleteContext);
  const rafRef = React.useRef<number | null>(null);
  const rowRef = React.useRef<HTMLDListElement>(null);
  const itemRefs = React.useRef<Array<HTMLDivElement | null>>([null, null, null]);
  const pressedIdxRef = React.useRef<number | null>(null);
  const idPrefix = React.useId();

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

    const finishRevealNow =
      revealCompleted &&
      (!hasCompletedInitialRevealRef.current || initialRevealRunningRef.current);

    if (
      prefersReduced ||
      finishRevealNow ||
      typeof requestAnimationFrame !== 'function'
    ) {
      cancelRaf();
      hasCompletedInitialRevealRef.current = true;
      initialRevealRunningRef.current = false;
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
    initialRevealRunningRef.current = isInitialReveal;

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
          easing: isInitialReveal ? 'quart' : 'expo',
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
        initialRevealRunningRef.current = false;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return cancelRaf;
  }, [
    stats,
    revealStarted,
    revealDelayMs,
    revealCompleted,
    prefersReduced,
    formatInteger,
    formatPercent,
    cancelRaf,
  ]);

  return (
    <dl
      ref={rowRef}
      data-testid="verdict-stat-row"
      className={cn('relative grid grid-cols-2 gap-3', className)}
    >
      {stats.map((stat, idx) => {
        const isLead = idx === 0;
        const isSelected = activeClaimId === stat.evidence.claimId;
        const captionId = `${idPrefix}-caption-${idx}`;
        const valueId = `${idPrefix}-value-${idx}`;
        return (
          <StatPlate
            key={idx}
            ref={(el: HTMLDivElement | null) => {
              itemRefs.current[idx] = el;
            }}
            data-testid="verdict-stat-item"
            data-selected={isSelected ? 'true' : undefined}
            className={cn(
              'group/stat at-optic cal-tactile relative flex min-w-0 origin-center flex-col-reverse justify-between gap-2.5 overflow-hidden rounded-[22px] p-4 sm:p-5',
              isLead && 'col-span-2',
            )}
            data-spotlight="true"
          >
            <dt
              id={captionId}
              className="pointer-events-none relative z-[1] type-subhead"
            >
              <span
                data-testid="verdict-stat-caption"
                className="line-clamp-2 block text-[13px] leading-[1.38] text-text-secondary transition-[color] duration-120 ease-out group-hover/stat:text-text-primary"
              >
                <GlossaryText
                  text={stat.captionText}
                  terms={resolveStatCaptionTerms(stat.captionKey)}
                />
              </span>
              {stat.captionSecondaryText !== null ? (
                <span
                  data-testid="verdict-stat-caption-secondary"
                  className={cn(
                    'mt-0.5 line-clamp-2 block tabular-nums',
                    isSelected ? 'text-text-secondary' : 'text-text-tertiary',
                  )}
                >
                  <GlossaryText
                    text={stat.captionSecondaryText}
                    terms={STAT_SECONDARY_CAPTION_TERMS}
                  />
                </span>
              ) : null}
            </dt>
            <dd
              className={cn(
                'at-kpi-number flex items-center justify-between gap-3 text-text-primary tabular-nums',
                isLead ? 'text-[46px] sm:text-[52px]' : 'text-[32px] sm:text-[36px]',
              )}
            >
              <span
                ref={(el) => {
                  valueRefs.current[idx] = el;
                }}
                data-testid="verdict-stat-value"
                data-final={stat.valueText}
                aria-hidden="true"
                className="count-up pointer-events-none relative z-[1]"
              >
                {stat.valueText}
              </span>
              <span id={valueId} data-testid="verdict-stat-sr" className="sr-only">
                {stat.valueText}
              </span>
              <StatMicroMeter idx={idx} stat={stat} />
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
                  'absolute inset-0 z-0 cursor-pointer appearance-none rounded-[22px] border-0 bg-transparent p-0',
                  'transition-[background-color] duration-120 ease-out',
                  'enabled:hover:bg-fill-1 enabled:active:bg-fill-2 aria-pressed:bg-fill-2 enabled:aria-pressed:hover:bg-fill-2',
                  'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  'disabled:cursor-default',
                )}
              />
            </dd>
          </StatPlate>
        );
      })}
    </dl>
  );
}
