'use client';

/**
 * Browser bindings for touch motion (`./touch-motion.ts`). Every hook is inert during SSR, on
 * hover-capable screens, and under reduced motion, so desktop behaviour and server markup stay
 * exactly as they were: blocks render at their final state and only the client hides what
 * starts below the fold.
 */

import {
  animate,
  type AnimationPlaybackControls,
  type MotionValue,
  useScroll,
  useTransform,
} from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from './hooks';
import { shouldWaitForReveal } from './reveal';
import {
  computeScrollDepthOffsetPx,
  computeTouchGrowTotalMs,
  computeTouchRevealDelayS,
  resolveTouchMotion,
  TOUCH_MOTION_QUERY,
  TOUCH_REVEAL_DURATION_S,
  TOUCH_REVEAL_EASE,
  TOUCH_REVEAL_OFFSET_PX,
} from './touch-motion';

function subscribeTouch(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(TOUCH_MOTION_QUERY);
  mql.addEventListener?.('change', onChange);
  return () => mql.removeEventListener?.('change', onChange);
}

function getTouchSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(TOUCH_MOTION_QUERY).matches;
}

/** `true` on a touch screen, whatever the motion preference (for tap behaviour, not motion). */
export function useCoarsePointer(): boolean {
  return React.useSyncExternalStore(subscribeTouch, getTouchSnapshot, () => false);
}

/** `true` when touch motion should run: a touch screen without reduced motion. */
export function useTouchMotion(): boolean {
  const coarseOrNoHover = useCoarsePointer();
  const reduced = useReducedMotionPreference();
  return resolveTouchMotion({ coarseOrNoHover, reduced });
}

function byDocumentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function clearRevealStyle(el: HTMLElement): void {
  el.style.opacity = '';
  el.style.translate = '';
  delete el.dataset.touchReveal;
}

export interface TouchRevealOptions {
  /** Children to reveal (`:scope > *`); the element itself when omitted. */
  readonly selector?: string;
  /** Arms only while `true` (for example, once a drawer opens). */
  readonly enabled?: boolean;
  readonly rootMargin?: string;
}

/**
 * One-time rise-in on a touch screen: each target that starts below the fold fades up
 * `14 px` when it first enters the viewport; targets that enter together stagger by 60 ms.
 * Only `opacity` and the independent `translate` property move, so the element's own
 * `transform` (press scale, motion values) is untouched. Targets already on screen never hide.
 */
export function useTouchReveal(
  ref: React.RefObject<HTMLElement | null>,
  { selector, enabled = true, rootMargin = '0px 0px -8% 0px' }: TouchRevealOptions = {},
): void {
  const touchMotion = useTouchMotion();
  const active = touchMotion && enabled;

  React.useEffect(() => {
    const root = ref.current;
    if (!active || !root || typeof IntersectionObserver !== 'function') {
      return undefined;
    }
    const targets = selector
      ? Array.from(root.querySelectorAll<HTMLElement>(selector))
      : [root];
    const viewportHeight = window.innerHeight;
    const armed = targets.filter((target) =>
      shouldWaitForReveal({
        top: target.getBoundingClientRect().top,
        viewportHeight,
        alreadyRevealed: target.dataset.touchReveal === 'shown',
        disabled: false,
        canObserve: true,
      }),
    );
    if (armed.length === 0) {
      return undefined;
    }
    for (const target of armed) {
      target.dataset.touchReveal = 'armed';
      target.style.opacity = '0';
      target.style.translate = `0px ${TOUCH_REVEAL_OFFSET_PX}px`;
    }
    const controls: AnimationPlaybackControls[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target as HTMLElement)
          .sort(byDocumentOrder);
        entering.forEach((target, index) => {
          observer.unobserve(target);
          target.dataset.touchReveal = 'shown';
          const control = animate(
            target,
            {
              opacity: [0, 1],
              translate: [`0px ${TOUCH_REVEAL_OFFSET_PX}px`, '0px 0px'],
            },
            {
              duration: TOUCH_REVEAL_DURATION_S,
              ease: TOUCH_REVEAL_EASE,
              delay: computeTouchRevealDelayS(index),
            },
          );
          controls.push(control);
          void control.then(() => {
            target.style.opacity = '';
            target.style.translate = '';
          });
        });
      },
      { rootMargin, threshold: 0.01 },
    );
    for (const target of armed) {
      observer.observe(target);
    }
    return () => {
      observer.disconnect();
      for (const control of controls) {
        control.stop();
      }
      for (const target of armed) {
        if (target.dataset.touchReveal === 'armed') {
          clearRevealStyle(target);
        } else {
          target.style.opacity = '';
          target.style.translate = '';
        }
      }
    };
  }, [active, ref, rootMargin, selector]);
}

export type TouchGrowPhase = 'settled' | 'hidden' | 'growing';

/**
 * One-time chart growth on a touch screen. Returns `hidden` while a chart that started below
 * the fold waits to be seen, `growing` while its `count` bars rise from the baseline
 * left to right, then `settled`. Always `settled` on SSR, desktop, and reduced motion.
 */
export function useTouchGrowOnEnter(
  ref: React.RefObject<Element | null>,
  count: number,
): TouchGrowPhase {
  const touchMotion = useTouchMotion();
  const [phase, setPhase] = React.useState<TouchGrowPhase>('settled');
  const totalMs = computeTouchGrowTotalMs(count);

  React.useEffect(() => {
    const el = ref.current;
    if (!touchMotion || !el || typeof IntersectionObserver !== 'function') {
      return undefined;
    }
    if (
      !shouldWaitForReveal({
        top: el.getBoundingClientRect().top,
        viewportHeight: window.innerHeight,
        alreadyRevealed: false,
        disabled: false,
        canObserve: true,
      })
    ) {
      return undefined;
    }
    let timer: number | null = null;
    setPhase('hidden');
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setPhase('growing');
        timer = window.setTimeout(() => setPhase('settled'), totalMs);
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
      setPhase('settled');
    };
  }, [ref, touchMotion, totalMs]);

  return phase;
}

/**
 * Scroll-linked depth on a touch screen: a `translate` value that drifts by
 * `factor x 14 px` while `target` scrolls from its top at the viewport top to its end.
 * Returns `undefined` when touch motion is off, so callers add no style at all.
 */
export function useTouchScrollDepth(
  target: React.RefObject<HTMLElement | null>,
  factor: number,
): MotionValue<string> | undefined {
  const touchMotion = useTouchMotion();
  const { scrollYProgress } = useScroll({
    target,
    offset: ['start start', 'end start'],
  });
  const translate = useTransform(
    scrollYProgress,
    (progress) => `0px ${computeScrollDepthOffsetPx(progress, factor)}px`,
  );
  return touchMotion ? translate : undefined;
}

/** A short lit window after a tap: `[lit, trigger]`. Never loops; re-tapping restarts it. */
export function useTapPulse(durationMs: number): readonly [boolean, () => void] {
  const [lit, setLit] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);
  const trigger = React.useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setLit(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setLit(false);
    }, durationMs);
  }, [durationMs]);
  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  return [lit, trigger] as const;
}
