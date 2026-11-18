/**
 * Landing sample-card wafer sizes per breakpoint (`premium.md` §6.1, §3.10): 152 px at
 * `xl` (>= 1440), 140 px at `lg` (1280–1439), 120 px at `md` (1024–1279), and 112 px in the
 * stacked `sm` cards (640–1023) and the mobile carousel (< 640).
 */

export const LANDING_WAFER_SIZE_STEPS = [
  { minWidth: 1440, size: 152 },
  { minWidth: 1280, size: 140 },
  { minWidth: 1024, size: 120 },
] as const;

export const LANDING_WAFER_SIZE_COMPACT = 112 as const;

/** Server snapshot and first paint: the designed 1440 desktop size. */
export const LANDING_WAFER_SIZE_DEFAULT = 152 as const;

export function resolveLandingWaferSize(viewportWidth: number): number {
  for (const step of LANDING_WAFER_SIZE_STEPS) {
    if (viewportWidth >= step.minWidth) {
      return step.size;
    }
  }
  return LANDING_WAFER_SIZE_COMPACT;
}

/**
 * Landing hero wafer diameter (`premium.md` §11.1): 320 px at 1440 / 1280, 280 px at 1024,
 * 240 px at `sm` (640–1023), and 220 px at `xs` (< 640).
 */
export const LANDING_HERO_WAFER_SIZE_STEPS = [
  { minWidth: 1280, size: 320 },
  { minWidth: 1024, size: 280 },
  { minWidth: 640, size: 240 },
] as const;

export const LANDING_HERO_WAFER_SIZE_COMPACT = 220 as const;

/** Server snapshot and first paint: the designed 1440 desktop size. */
export const LANDING_HERO_WAFER_SIZE_DEFAULT = 320 as const;

export function resolveLandingHeroWaferSize(viewportWidth: number): number {
  for (const step of LANDING_HERO_WAFER_SIZE_STEPS) {
    if (viewportWidth >= step.minWidth) {
      return step.size;
    }
  }
  return LANDING_HERO_WAFER_SIZE_COMPACT;
}

/** Probe-station reticle (§11.1): a hairline circle at D + 32, i.e. 16 px outside the disc edge. */
export const LANDING_RETICLE_GAP_PX = 16 as const;

/** One tick per 5° (A41: 72 ticks); 8 px at the four 90° marks, 4 px elsewhere. */
export const LANDING_RETICLE_TICK_COUNT = 72 as const;

export interface LandingReticleTick {
  readonly angleDeg: number;
  readonly lengthPx: number;
}

export function buildLandingReticleTicks(): readonly LandingReticleTick[] {
  const step = 360 / LANDING_RETICLE_TICK_COUNT;
  return Array.from({ length: LANDING_RETICLE_TICK_COUNT }, (_, i) => {
    const angleDeg = i * step;
    return { angleDeg, lengthPx: angleDeg % 90 === 0 ? 8 : 4 };
  });
}

/**
 * Example result card fact (§11.1, "93.8% of fails sit in the outer 3 rings."): the share of
 * `edge-ring-etch` failing dies in the outer 3 rings, the lead stat of that sample lot. A unit test
 * checks it against the engine's `stats.edgeShare` value.
 */
export const LANDING_EXAMPLE_EDGE_SHARE = 0.938 as const;
