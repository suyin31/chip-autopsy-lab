'use client';

/**
 * Client hooks for Task 18 motion (`src/ui/motion/hooks.ts`):
 * - `useReducedMotionPreference`: combines Motion's `useReducedMotion()` with synchronous `matchMedia`
 * - `useSessionOnceGuard`: reactive `sessionStorage` once-per-session reveal guard
 * - `useTypeOn`: SSR-safe rAF type-on hook with instant reduced-motion & interrupt/skip completion
 */

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import {
  hasSeenSessionReveal,
  markSessionRevealSeen,
  PROBE_SWEEP_SESSION_KEY,
  readPrefersReducedMotionSync,
  sampleTypeOnFrame,
  type TypeOnFrameState,
} from './reveal';
import { TYPE_ON_DEFAULT_MS, TYPE_ON_MAX_MS } from './tokens';

export interface UseTypeOnOptions {
  readonly text: string;
  readonly durationMs?: number;
  readonly enabled?: boolean;
  readonly completed?: boolean;
  readonly reducedMotion?: boolean;
  readonly playKey?: string;
}

export interface UseTypeOnResult extends TypeOnFrameState {
  readonly skip: () => void;
}

/**
 * Combines Motion's `useReducedMotion()` with synchronous `matchMedia('(prefers-reduced-motion: reduce)')`
 * so initial client layout effects never flash unreduced states before Motion's effect fires.
 */
export function useReducedMotionPreference(): boolean {
  const motionReduced = useReducedMotion();
  const [mediaReduced, setMediaReduced] = React.useState<boolean>(() =>
    readPrefersReducedMotionSync(motionReduced),
  );

  React.useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMediaReduced(mql.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      setMediaReduced(event.matches);
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  return readPrefersReducedMotionSync(motionReduced) || mediaReduced;
}

/**
 * Reads and marks a once-per-session reveal key in `sessionStorage` (default `"cal.sweep.v1"`).
 */
export function useSessionOnceGuard(
  key: string = PROBE_SWEEP_SESSION_KEY,
): { readonly seen: boolean; readonly markSeen: () => void } {
  const [seen, setSeen] = React.useState<boolean>(() =>
    hasSeenSessionReveal(key),
  );

  React.useEffect(() => {
    setSeen(hasSeenSessionReveal(key));
  }, [key]);

  const markSeen = React.useCallback((): void => {
    markSessionRevealSeen(key);
    setSeen(true);
  }, [key]);

  return { seen, markSeen };
}

/**
 * SSR-safe rAF type-on hook: returns full settled text on server/SSR and under `reducedMotion`/`completed`.
 * On client under normal motion, animates codepoint progression over `durationMs` (clamped to `[1, 1500]`)
 * and finishes immediately on `skip()` or `completed`.
 */
export function useTypeOn(options: UseTypeOnOptions): UseTypeOnResult {
  const {
    text,
    durationMs = TYPE_ON_DEFAULT_MS,
    enabled = true,
    completed = false,
    reducedMotion,
    playKey = '',
  } = options;

  const hookReduced = useReducedMotionPreference();
  const effectiveReduced = reducedMotion ?? hookReduced;
  const safeDuration = Number.isFinite(durationMs)
    ? Math.min(TYPE_ON_MAX_MS, Math.max(1, durationMs))
    : TYPE_ON_DEFAULT_MS;

  const runToken = `${playKey}::${text}`;
  const [skippedToken, setSkippedToken] = React.useState<string | null>(null);
  const isSkipped = skippedToken === runToken;

  const isServer = typeof window === 'undefined';
  const shouldSettleImmediately =
    isServer || effectiveReduced || completed || isSkipped || text.length === 0;

  const [elapsedState, setElapsedState] = React.useState<{
    readonly token: string;
    readonly elapsedMs: number;
  }>(() => ({
    token: runToken,
    elapsedMs: shouldSettleImmediately ? safeDuration : 0,
  }));

  React.useEffect(() => {
    if (shouldSettleImmediately) {
      setElapsedState({ token: runToken, elapsedMs: safeDuration });
      return;
    }

    if (!enabled) {
      setElapsedState({ token: runToken, elapsedMs: 0 });
      return;
    }

    let rafId: number | null = null;
    let cancelled = false;
    const nowFn =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now()
        : () => Date.now();
    const startTime = nowFn();

    setElapsedState({ token: runToken, elapsedMs: 0 });

    const finish = (): void => {
      if (cancelled) return;
      cancelled = true;
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      setElapsedState({ token: runToken, elapsedMs: safeDuration });
    };

    const safetyTimer = window.setTimeout(finish, safeDuration + 32);

    const step = (timestamp: number): void => {
      if (cancelled) return;
      const current = Number.isFinite(timestamp) ? timestamp : nowFn();
      const elapsed = Math.max(0, current - startTime);
      if (elapsed >= safeDuration) {
        window.clearTimeout(safetyTimer);
        finish();
        return;
      }
      setElapsedState({ token: runToken, elapsedMs: elapsed });
      if (typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(step);
      }
    };

    if (typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(step);
    } else {
      window.clearTimeout(safetyTimer);
      finish();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [enabled, runToken, safeDuration, shouldSettleImmediately]);

  const skip = React.useCallback((): void => {
    setSkippedToken(runToken);
    setElapsedState({ token: runToken, elapsedMs: safeDuration });
  }, [runToken, safeDuration]);

  const effectiveElapsed = shouldSettleImmediately
    ? safeDuration
    : elapsedState.token === runToken
      ? elapsedState.elapsedMs
      : 0;

  const frame = sampleTypeOnFrame({
    text,
    elapsedMs: effectiveElapsed,
    durationMs: safeDuration,
    reducedMotion: shouldSettleImmediately,
    skipped: isSkipped || completed,
  });

  return {
    ...frame,
    skip,
  };
}
