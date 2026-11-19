/**
 * Pure deterministic reveal motion calculations for Task 18 (`src/ui/motion/reveal.ts`):
 * - Session-once probe-sweep guard (`sessionStorage["cal.sweep.v1"]`, Req 1.11)
 * - Codepoint-safe cause-of-death headline type-on sampler (`<= 1.5 s`, Req 10.1, 17.5)
 * - Claim evidence light-up stagger timing (`<= 600 ms`, Req 10.4, 17.5)
 */

import {
  computeOrderedGlowSchedule,
  evaluateGlowSequenceFrame,
  GLOW_DIE_FADE_DURATION_MS,
  GLOW_EXIT_DURATION_MS,
  GLOW_STAGGER_WINDOW_MS,
  GLOW_TOTAL_DURATION_MS,
  type GlowOrderMode,
  type GlowSequenceFrameState,
  type OrderedGlowSchedule,
  sampleCubicEaseOut,
  SCRIM_ENTER_DURATION_MS,
} from '@/ui/wafer-map/linked-interactions';
import {
  computeProbeLightOpacity,
  computeProbeSweepFraction,
  computeVerdictRiseSchedule,
  type InitialRevealMode,
  type InitialRevealPlan,
  PROBE_SWEEP_FAIL_FADE_MS,
  PROBE_SWEEP_REVEAL_MS,
  PROBE_SWEEP_SESSION_KEY,
  PROBE_SWEEP_TOTAL_MAX_MS,
  readPrefersReducedMotionSync,
  REDUCED_MOTION_FADE_MS,
  resolveInitialRevealMode,
  sampleStatCountUp,
  VERDICT_REVEAL_SETTLE_MS,
  VERDICT_RISE_BLOCK_ORDER,
  VERDICT_RISE_OFFSET_PX,
  VERDICT_RISE_STAGGER_MS,
  type VerdictRiseBlockId,
  type VerdictRiseStepSpec,
} from '@/ui/wafer-map/probe-sweep';
import {
  EVIDENCE_STAGGER_WINDOW_MS,
  TYPE_ON_DEFAULT_MS,
  TYPE_ON_MAX_MS,
} from './tokens';

export {
  PROBE_SWEEP_SESSION_KEY,
  PROBE_SWEEP_REVEAL_MS,
  PROBE_SWEEP_FAIL_FADE_MS,
  PROBE_SWEEP_TOTAL_MAX_MS,
  REDUCED_MOTION_FADE_MS,
  VERDICT_RISE_STAGGER_MS,
  VERDICT_RISE_OFFSET_PX,
  VERDICT_REVEAL_SETTLE_MS,
  VERDICT_RISE_BLOCK_ORDER,
  computeProbeSweepFraction,
  computeProbeLightOpacity,
  resolveInitialRevealMode,
  computeVerdictRiseSchedule,
  sampleStatCountUp,
  readPrefersReducedMotionSync,
  type InitialRevealMode,
  type InitialRevealPlan,
  type VerdictRiseBlockId,
  type VerdictRiseStepSpec,
};

export {
  GLOW_STAGGER_WINDOW_MS,
  GLOW_DIE_FADE_DURATION_MS,
  GLOW_TOTAL_DURATION_MS,
  GLOW_EXIT_DURATION_MS,
  SCRIM_ENTER_DURATION_MS,
  computeOrderedGlowSchedule,
  evaluateGlowSequenceFrame,
  type GlowOrderMode,
  type OrderedGlowSchedule,
  type GlowSequenceFrameState,
};

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveSessionStorage(
  storage?: SessionStorageLike | null,
): SessionStorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Checks whether the once-per-session reveal key (`"cal.sweep.v1"`) has already been recorded.
 */
export function hasSeenSessionReveal(
  key: string = PROBE_SWEEP_SESSION_KEY,
  storage?: SessionStorageLike | null,
): boolean {
  const target = resolveSessionStorage(storage);
  if (!target) {
    return false;
  }
  try {
    return target.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * Records the once-per-session reveal key (`"cal.sweep.v1" = "1"`) in `sessionStorage`.
 */
export function markSessionRevealSeen(
  key: string = PROBE_SWEEP_SESSION_KEY,
  storage?: SessionStorageLike | null,
): void {
  const target = resolveSessionStorage(storage);
  if (!target) {
    return;
  }
  try {
    target.setItem(key, '1');
  } catch {
    // Ignore storage quota or sandbox errors
  }
}

export interface TypeOnSampleInput {
  readonly text: string;
  readonly elapsedMs: number;
  readonly durationMs?: number;
  readonly reducedMotion?: boolean;
  readonly skipped?: boolean;
}

export interface TypeOnFrameState {
  readonly visibleText: string;
  readonly visibleCount: number;
  readonly totalCount: number;
  readonly progress: number;
  readonly settled: boolean;
}

/**
 * Codepoint-safe (`Array.from(text)`) ease-out type-on sampler clamped to `[1, TYPE_ON_MAX_MS]`.
 * Never splits UTF-16 surrogate pairs or CJK clusters, and settles immediately when
 * `reducedMotion` or `skipped` is true.
 */
export function sampleTypeOnFrame(input: TypeOnSampleInput): TypeOnFrameState {
  const codepoints = Array.from(input.text);
  const totalCount = codepoints.length;

  if (totalCount === 0 || input.reducedMotion || input.skipped) {
    return {
      visibleText: input.text,
      visibleCount: totalCount,
      totalCount,
      progress: 1,
      settled: true,
    };
  }

  const rawDuration = input.durationMs ?? TYPE_ON_DEFAULT_MS;
  const safeDuration = Number.isFinite(rawDuration)
    ? Math.min(TYPE_ON_MAX_MS, Math.max(1, rawDuration))
    : TYPE_ON_DEFAULT_MS;
  const elapsed = Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0;

  if (elapsed >= safeDuration) {
    return {
      visibleText: input.text,
      visibleCount: totalCount,
      totalCount,
      progress: 1,
      settled: true,
    };
  }

  if (elapsed <= 0) {
    return {
      visibleText: '',
      visibleCount: 0,
      totalCount,
      progress: 0,
      settled: false,
    };
  }

  const progress = sampleCubicEaseOut(elapsed / safeDuration);
  const visibleCount = Math.min(
    totalCount,
    Math.max(0, Math.floor(progress * totalCount)),
  );

  return {
    visibleText: codepoints.slice(0, visibleCount).join(''),
    visibleCount,
    totalCount,
    progress,
    settled: false,
  };
}

/**
 * Returns `0` when `reducedMotion || total <= 1`, else `(clampedIndex / (total - 1)) * maxWindowMs`.
 */
export function computeStaggerDelayMs(
  index: number,
  total: number,
  maxWindowMs: number = EVIDENCE_STAGGER_WINDOW_MS,
  reducedMotion = false,
): number {
  if (
    reducedMotion ||
    !Number.isFinite(total) ||
    total <= 1 ||
    !Number.isFinite(maxWindowMs) ||
    maxWindowMs <= 0
  ) {
    return 0;
  }
  const safeIndex = Number.isFinite(index) ? index : 0;
  const clampedIndex = Math.min(total - 1, Math.max(0, safeIndex));
  return (clampedIndex / (total - 1)) * maxWindowMs;
}
