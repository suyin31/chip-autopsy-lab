/**
 * Pure deterministic timing, easing, session-trigger, verdict stagger, and stat
 * count-up calculations for R8 reveal motion (`src/ui/wafer-map/probe-sweep.ts`,
 * `redesign.md` §5.1–§5.3).
 */

import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';

/** SessionStorage key guarding the once-per-session probe sweep (`redesign.md` §5.1). */
export const PROBE_SWEEP_SESSION_KEY = 'cal.sweep.seen' as const;

/** Hard ceiling for the full probe-sweep reveal including fail-canvas completion fade (§5.1). */
export const PROBE_SWEEP_TOTAL_MAX_MS =
  MOTION_TOKENS.revealCeilingsMs.probeSweep; // 1200 ms

/** Fail-canvas orange fade-in duration at sweep completion (`redesign.md` §5.1: 280 ms). */
export const PROBE_SWEEP_FAIL_FADE_MS = 280 as const;

/** Incremental die-reveal window (`900 ms` + `280 ms` fail fade = `1,180 ms <= 1,200 ms`). */
export const PROBE_SWEEP_REVEAL_MS = 900 as const;

/** Sweep reveal fraction at which the Verdict Column starts its rise-in (`redesign.md` §5.2: 85%). */
export const VERDICT_RISE_SWEEP_THRESHOLD = 0.85 as const;

/** Subsequent lot load base-canvas fade duration (`redesign.md` §5.1: 240 ms). */
export const SUBSEQUENT_LOAD_FADE_MS = 240 as const;

/** Reduced-motion opacity-only fade duration (`redesign.md` §5.1, §5.2: 120 ms). */
export const REDUCED_MOTION_FADE_MS = 120 as const;

/** Verdict rise-in per-element stagger (`redesign.md` §5.2: 60 ms). */
export const VERDICT_RISE_STAGGER_MS =
  MOTION_TOKENS.revealCeilingsMs.verdictStagger; // 60 ms

/** Initial stat count-up duration (`redesign.md` §5.3: 700 ms). */
export const STAT_INITIAL_COUNTUP_MS =
  MOTION_TOKENS.revealCeilingsMs.statCountUp; // 700 ms

/** Selection-linked stat update duration (`redesign.md` §5.3: 300 ms). */
export const STAT_UPDATE_COUNTUP_MS =
  MOTION_TOKENS.revealCeilingsMs.statUpdate; // 300 ms

export type InitialRevealMode = 'sweep' | 'subsequent-fade' | 'reduced';

export interface InitialRevealPlan {
  readonly mode: InitialRevealMode;
  readonly fadeDurationMs: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

/** Standard sinusoidal ease-in-out on `[0, 1]` (`redesign.md` §5.1). */
export function easeInOutSine(u: number): number {
  const t = clamp01(u);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return (1 - Math.cos(Math.PI * t)) / 2;
}

/** Exponential ease-out for stat count-up (`redesign.md` §2.6, §5.3). */
export function easeOutExpo(u: number): number {
  const t = clamp01(u);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

/**
 * Computes `f(t) = min(parseProgress, easeInOutSine(t / durationMs))` (`redesign.md` §5.1)
 * so a slow parse holds the sweep instead of finishing early.
 */
export function computeProbeSweepFraction(
  elapsedMs: number,
  durationMs: number = PROBE_SWEEP_REVEAL_MS,
  parseProgress = 1,
): number {
  const safeDur = durationMs > 0 ? durationMs : PROBE_SWEEP_REVEAL_MS;
  const timeFrac = easeInOutSine(elapsedMs / safeDur);
  return Math.min(clamp01(parseProgress), timeFrac);
}

/**
 * Determines whether a lot reveal runs the once-per-session probe sweep, a `240 ms`
 * subsequent-load fade, or the `120 ms` reduced-motion opacity path (`redesign.md` §5.1).
 */
export function resolveInitialRevealMode(params: {
  readonly seenInSession: boolean;
  readonly prefersReducedMotion: boolean;
}): InitialRevealPlan {
  if (params.prefersReducedMotion) {
    return { mode: 'reduced', fadeDurationMs: REDUCED_MOTION_FADE_MS };
  }
  if (params.seenInSession) {
    return { mode: 'subsequent-fade', fadeDurationMs: SUBSEQUENT_LOAD_FADE_MS };
  }
  return { mode: 'sweep', fadeDurationMs: 0 };
}

export type VerdictRiseBlockId =
  | 'headline'
  | 'subline'
  | 'confidence'
  | 'stats'
  | 'findings';

export const VERDICT_RISE_BLOCK_ORDER: readonly VerdictRiseBlockId[] = [
  'headline',
  'subline',
  'confidence',
  'stats',
  'findings',
] as const;

export interface VerdictRiseStepSpec {
  readonly id: VerdictRiseBlockId;
  readonly delayMs: number;
  readonly initialY: number;
  readonly initialBlurPx: number;
  readonly durationMs?: number;
  readonly spring?: typeof SPRING_TOKENS.ui;
}

/**
 * Builds the 5-element Verdict rise-in schedule (`redesign.md` §5.2):
 * - Normal motion: `60 ms` stagger (`0, 60, 120, 180, 240 ms`), `y: 12 -> 0`,
 *   `blur(4px) -> blur(0px)`, `spring-ui`.
 * - Reduced motion: `0 ms` stagger, `y: 0`, `blur: 0`, `120 ms` opacity-only fade.
 */
export function computeVerdictRiseSchedule(
  prefersReducedMotion: boolean,
): readonly VerdictRiseStepSpec[] {
  return VERDICT_RISE_BLOCK_ORDER.map((id, idx) => {
    if (prefersReducedMotion) {
      return {
        id,
        delayMs: 0,
        initialY: 0,
        initialBlurPx: 0,
        durationMs: REDUCED_MOTION_FADE_MS,
      };
    }
    return {
      id,
      delayMs: idx * VERDICT_RISE_STAGGER_MS,
      initialY: 12,
      initialBlurPx: 4,
      spring: SPRING_TOKENS.ui,
    };
  });
}

/**
 * Samples an interruptible `ease-out-expo` stat count-up value (`redesign.md` §5.3).
 */
export function sampleStatCountUp(params: {
  readonly from: number;
  readonly to: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly prefersReducedMotion: boolean;
}): number {
  const { from, to, elapsedMs, durationMs, prefersReducedMotion } = params;
  if (prefersReducedMotion || durationMs <= 0 || elapsedMs >= durationMs) {
    return to;
  }
  if (elapsedMs <= 0) {
    return from;
  }
  const k = easeOutExpo(elapsedMs / durationMs);
  return from + (to - from) * k;
}

/**
 * Synchronously checks both `useReducedMotion()` and `window.matchMedia` so initial
 * client `useLayoutEffect` passes never flash unreduced states before Motion's effect fires.
 */
export function readPrefersReducedMotionSync(
  hookValue: boolean | null | undefined,
): boolean {
  if (hookValue === true) {
    return true;
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}
