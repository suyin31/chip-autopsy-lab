/**
 * Touch motion (`src/ui/motion/touch-motion.ts`): the phone counterpart of the hover motion.
 *
 * On a touch screen (`(hover: none), (pointer: coarse)`) nothing hovers, so the desktop tilt,
 * pointer sheen, and hover crosshairs never run. This module holds the pure rules for the
 * motion that replaces them, triggered by scroll, press, and tap instead:
 * - one-time rise-in for blocks that start below the fold (opacity + `translate` only);
 * - one-time bar growth for charts that start below the fold;
 * - a scroll-linked depth drift of a few pixels between stacked planes;
 * - an overhead "scroll light" that slides the silicon sheen as the disc scrolls under it;
 * - a short signal-bus pulse after a tap.
 *
 * Reduced motion turns all of it off (final state at once). No rule here loops.
 */

/** Touch screens: no hover, or a coarse primary pointer. */
export const TOUCH_MOTION_QUERY = '(hover: none), (pointer: coarse)';

/** Rise-in travel, in px. */
export const TOUCH_REVEAL_OFFSET_PX = 14;
/** Rise-in duration, in seconds. */
export const TOUCH_REVEAL_DURATION_S = 0.52;
/** Stagger between blocks that enter together, in seconds. */
export const TOUCH_REVEAL_STAGGER_S = 0.06;
/** Blocks after this many in one batch share the last delay, so nothing waits long. */
export const TOUCH_REVEAL_MAX_STAGGER_STEPS = 5;
/** Ease-out (premium §3.12). */
export const TOUCH_REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

/** Chart bars grow from the baseline over this long, in ms. */
export const TOUCH_GROW_DURATION_MS = 520;
/** Total left-to-right spread of the bar growth, in ms. */
export const TOUCH_GROW_SPREAD_MS = 360;

/** Scroll depth drift ceiling, in px (kept small so it never reads as motion sickness). */
export const TOUCH_SCROLL_DEPTH_MAX_PX = 14;

/** How long the agent signal bus stays lit after a tap, in ms. */
export const TOUCH_BUS_PULSE_MS = 1400;

/** The overhead scroll light sits at this fraction of the viewport height. */
export const TOUCH_SCROLL_LIGHT_Y = 0.3;

export interface TouchMotionInput {
  readonly coarseOrNoHover: boolean;
  readonly reduced: boolean;
}

/** Touch motion runs only on a touch screen and never under reduced motion. */
export function resolveTouchMotion({ coarseOrNoHover, reduced }: TouchMotionInput): boolean {
  return coarseOrNoHover && !reduced;
}

/** Stagger delay for the `index`-th block of one batch, in seconds. */
export function computeTouchRevealDelayS(index: number): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  const step = Math.min(Math.floor(index), TOUCH_REVEAL_MAX_STAGGER_STEPS);
  return Number((step * TOUCH_REVEAL_STAGGER_S).toFixed(3));
}

/** Left-to-right growth delay for bar `index` of `count`, in ms. */
export function computeTouchGrowDelayMs(index: number, count: number): number {
  if (!(count > 1) || !Number.isFinite(index) || index <= 0) return 0;
  const clamped = Math.min(index, count - 1);
  return Math.round((clamped / (count - 1)) * TOUCH_GROW_SPREAD_MS);
}

/** Time until every bar of `count` has finished growing, in ms. */
export function computeTouchGrowTotalMs(count: number): number {
  return computeTouchGrowDelayMs(count - 1, count) + TOUCH_GROW_DURATION_MS;
}

/** Depth drift for a scroll progress in [0, 1]; `factor` sets direction and share of the ceiling. */
export function computeScrollDepthOffsetPx(
  progress: number,
  factor: number,
  maxPx: number = TOUCH_SCROLL_DEPTH_MAX_PX,
): number {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const f = Number.isFinite(factor) ? Math.min(1, Math.max(-1, factor)) : 0;
  const v = Math.round(p * f * maxPx * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

/** The overhead light point for a viewport, in client px. */
export function computeScrollLightPoint(viewport: {
  readonly width: number;
  readonly height: number;
}): { readonly x: number; readonly y: number } {
  return {
    x: Math.max(0, viewport.width) / 2,
    y: Math.max(0, viewport.height) * TOUCH_SCROLL_LIGHT_Y,
  };
}
