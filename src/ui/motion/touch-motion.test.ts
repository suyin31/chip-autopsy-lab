import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  computeScrollDepthOffsetPx,
  computeScrollLightPoint,
  computeTouchGrowDelayMs,
  computeTouchGrowTotalMs,
  computeTouchRevealDelayS,
  resolveTouchMotion,
  TOUCH_GROW_DURATION_MS,
  TOUCH_GROW_SPREAD_MS,
  TOUCH_MOTION_QUERY,
  TOUCH_REVEAL_MAX_STAGGER_STEPS,
  TOUCH_REVEAL_STAGGER_S,
  TOUCH_SCROLL_DEPTH_MAX_PX,
} from './touch-motion';
import { useCoarsePointer, useTouchGrowOnEnter, useTouchMotion } from './use-touch-motion';
import {
  canSheenFollowScroll,
  computeScrollLightSheenTarget,
  SHEEN_REST,
} from '@/ui/wafer-map/sheen-motion';

describe('touch motion rules', () => {
  it('targets touch screens and never runs under reduced motion', () => {
    expect(TOUCH_MOTION_QUERY).toBe('(hover: none), (pointer: coarse)');
    expect(resolveTouchMotion({ coarseOrNoHover: true, reduced: false })).toBe(true);
    expect(resolveTouchMotion({ coarseOrNoHover: true, reduced: true })).toBe(false);
    expect(resolveTouchMotion({ coarseOrNoHover: false, reduced: false })).toBe(false);
  });

  it('staggers rise-ins 60 ms apart and caps the wait', () => {
    expect(computeTouchRevealDelayS(0)).toBe(0);
    expect(computeTouchRevealDelayS(1)).toBe(TOUCH_REVEAL_STAGGER_S);
    expect(computeTouchRevealDelayS(99)).toBe(
      Number((TOUCH_REVEAL_MAX_STAGGER_STEPS * TOUCH_REVEAL_STAGGER_S).toFixed(3)),
    );
    expect(computeTouchRevealDelayS(Number.NaN)).toBe(0);
  });

  it('grows bars left to right inside a bounded window', () => {
    expect(computeTouchGrowDelayMs(0, 28)).toBe(0);
    expect(computeTouchGrowDelayMs(27, 28)).toBe(TOUCH_GROW_SPREAD_MS);
    expect(computeTouchGrowDelayMs(40, 28)).toBe(TOUCH_GROW_SPREAD_MS);
    expect(computeTouchGrowDelayMs(3, 1)).toBe(0);
    for (let i = 1; i < 28; i += 1) {
      expect(computeTouchGrowDelayMs(i, 28)).toBeGreaterThanOrEqual(computeTouchGrowDelayMs(i - 1, 28));
    }
    expect(computeTouchGrowTotalMs(28)).toBe(TOUCH_GROW_SPREAD_MS + TOUCH_GROW_DURATION_MS);
  });

  it('keeps scroll depth within the 14 px ceiling', () => {
    expect(computeScrollDepthOffsetPx(0, -1)).toBe(0);
    expect(computeScrollDepthOffsetPx(1, -1)).toBe(-TOUCH_SCROLL_DEPTH_MAX_PX);
    expect(computeScrollDepthOffsetPx(0.5, 0.4)).toBeCloseTo(2.8, 5);
    expect(computeScrollDepthOffsetPx(4, 3)).toBe(TOUCH_SCROLL_DEPTH_MAX_PX);
    expect(computeScrollDepthOffsetPx(Number.NaN, 1)).toBe(0);
  });

  it('places the scroll light overhead, centred', () => {
    expect(computeScrollLightPoint({ width: 390, height: 844 })).toEqual({ x: 195, y: 253.2 });
  });
});

describe('scroll light sheen', () => {
  const env = { hoverCapable: false, reducedMotion: false, reducedTransparency: false };

  it('runs only without hover, reduced motion, or reduced transparency', () => {
    expect(canSheenFollowScroll(env)).toBe(true);
    expect(canSheenFollowScroll({ ...env, hoverCapable: true })).toBe(false);
    expect(canSheenFollowScroll({ ...env, reducedMotion: true })).toBe(false);
    expect(canSheenFollowScroll({ ...env, reducedTransparency: true })).toBe(false);
  });

  it('slides the sheen toward the light as the disc scrolls past it', () => {
    const viewport = { width: 390, height: 844 };
    const below = computeScrollLightSheenTarget({ left: 45, top: 500, width: 300, height: 300 }, viewport, 0.05);
    const above = computeScrollLightSheenTarget({ left: 45, top: -100, width: 300, height: 300 }, viewport, 0.05);
    const under = computeScrollLightSheenTarget({ left: 45, top: 103.2, width: 300, height: 300 }, viewport, 0.05);
    expect(below.y).toBeLessThan(0);
    expect(above.y).toBeGreaterThan(0);
    expect(Math.abs(under.y)).toBeLessThan(1e-9);
    expect(Math.abs(below.y)).toBeLessThanOrEqual(0.05);
    expect(below.x).toBe(0);
    expect(computeScrollLightSheenTarget({ left: 0, top: 0, width: 0, height: 0 }, viewport, 0.05)).toBe(SHEEN_REST);
  });
});

describe('touch motion hooks on the server', () => {
  it('stay inert during SSR so markup keeps its final state', () => {
    const seen: unknown[] = [];
    function Probe(): React.JSX.Element {
      const ref = React.useRef<HTMLDivElement | null>(null);
      seen.push(useCoarsePointer(), useTouchMotion(), useTouchGrowOnEnter(ref, 28));
      return React.createElement('div', { ref });
    }
    renderToStaticMarkup(React.createElement(Probe));
    expect(seen).toEqual([false, false, 'settled']);
  });
});
