'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import {
  readPrefersReducedMotionSync,
  STAT_INITIAL_COUNTUP_MS,
  sampleStatCountUp,
} from '@/ui/wafer-map/probe-sweep';
import { cn } from './cn';

/**
 * True once input in the verdict column asked every reveal to finish (premium §8.2 interrupt).
 * Count-ups inside the column read it and write their final text at once.
 */
export const CountUpCompleteContext = React.createContext(false);

export interface CountUpProps {
  readonly value: number;
  /** Final-format formatter (for example `formatPercent`); every frame uses it, so the format never changes. */
  readonly format: (value: number) => string;
  /** The count plays once per key (for example the lot ID); other value changes show the final text at once. */
  readonly playKey?: string | number;
  /** False shows the final text at once (a row that mounts after the reveal, for example). */
  readonly play?: boolean;
  readonly delayMs?: number;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

const NOT_PLAYED = Symbol('not-played');

/**
 * A number that counts from 0 to its value over 600 ms `ease-out-quart` (premium §11.5, §8.2).
 * Text is written to `textContent` through a ref (no React render per frame); `.count-up` keeps
 * the width of the final string, and only the digits change (the percent sign and units stay).
 * Reduced motion and an interrupt show the final value at once. A count that will play renders 0
 * on the server, so the first paint never flashes the final value before counting from 0.
 */
export function CountUp({
  value,
  format,
  playKey = 0,
  play = true,
  delayMs = 0,
  className,
  'data-testid': testId,
}: CountUpProps): React.JSX.Element {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const playedKeyRef = React.useRef<string | number | typeof NOT_PLAYED>(NOT_PLAYED);
  const rafRef = React.useRef<number | null>(null);
  const prefersReduced = readPrefersReducedMotionSync(useReducedMotion());
  const completed = React.useContext(CountUpCompleteContext);
  const finalText = format(value);

  // The running count reads the latest value and format, so a new value mid-count retargets it
  const latestRef = React.useRef({ value, format, finalText });
  latestRef.current = { value, format, finalText };

  const stop = React.useCallback((): boolean => {
    if (rafRef.current === null) {
      return false;
    }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    return true;
  }, []);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const firstRunForKey = playedKeyRef.current !== playKey;
    playedKeyRef.current = playKey;
    if (completed || prefersReduced || typeof requestAnimationFrame !== 'function') {
      stop();
      el.textContent = finalText;
      return;
    }
    if (!firstRunForKey) {
      if (rafRef.current === null) {
        el.textContent = finalText;
      }
      return;
    }
    stop();
    if (!play) {
      el.textContent = finalText;
      return;
    }

    el.textContent = format(0);
    const startMs = performance.now() + Math.max(0, delayMs);
    const tick = (nowMs: number): void => {
      const latest = latestRef.current;
      const elapsedMs = nowMs - startMs;
      if (elapsedMs >= STAT_INITIAL_COUNTUP_MS) {
        rafRef.current = null;
        el.textContent = latest.finalText;
        return;
      }
      el.textContent = latest.format(
        sampleStatCountUp({
          from: 0,
          to: latest.value,
          elapsedMs,
          durationMs: STAT_INITIAL_COUNTUP_MS,
          prefersReducedMotion: false,
          easing: 'quart',
        }),
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [finalText, format, playKey, play, delayMs, completed, prefersReduced, stop]);

  // Unmount stops the count; a strict-mode remount replays it
  React.useEffect(
    () => () => {
      if (stop()) {
        playedKeyRef.current = NOT_PLAYED;
      }
    },
    [stop],
  );

  return (
    <span
      ref={ref}
      data-testid={testId}
      data-final={finalText}
      className={cn('count-up', className)}
    >
      {play ? format(0) : finalText}
    </span>
  );
}
