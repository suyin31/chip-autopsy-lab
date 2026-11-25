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
  { minWidth: 1280, size: 440 },
  { minWidth: 1024, size: 360 },
  { minWidth: 640, size: 280 },
] as const;

export const LANDING_HERO_WAFER_SIZE_COMPACT = 240 as const;

/** Server snapshot and first paint: the designed 1440 desktop size. */
export const LANDING_HERO_WAFER_SIZE_DEFAULT = 440 as const;

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
 * Rounds SVG coordinates to 3 decimals so SSR (Node) and browser JS engines emit identical
 * attribute strings despite last-ULP `Math.sin` / `Math.cos` differences.
 */
export function roundSvgCoord(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export interface LandingReticleTickLine extends LandingReticleTick {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export function computeLandingReticleTickLines(
  cx: number,
  cy: number,
  reticleRadiusPx: number,
): readonly LandingReticleTickLine[] {
  const outer = reticleRadiusPx - 0.5;
  return buildLandingReticleTicks().map((tick) => {
    const a = (tick.angleDeg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const inner = outer - tick.lengthPx;
    return {
      ...tick,
      x1: roundSvgCoord(cx + sin * outer),
      y1: roundSvgCoord(cy - cos * outer),
      x2: roundSvgCoord(cx + sin * inner),
      y2: roundSvgCoord(cy - cos * inner),
    };
  });
}

/**
 * Example result card fact (§11.1, "93.8% of fails sit in the outer 3 rings."): the share of
 * `edge-ring-etch` failing dies in the outer 3 rings, the lead stat of that sample lot. A unit test
 * checks it against the engine's `stats.edgeShare` value.
 */
export const LANDING_EXAMPLE_EDGE_SHARE = 0.938 as const;

export interface LandingTelemetryLens {
  readonly id: 'all-fails' | 'outer-3-rings' | 'only-bin-7' | 'site-1-2';
  readonly query: string;
  readonly lotCode: string;
  readonly dies: number;
  readonly diesFormatted: string;
  readonly primaryStat: string;
  readonly secondaryStat: string;
  /** Visual emphasis mode on the 28-bin IDDQ_LEAK spectrum. */
  readonly spectrumFocus: 'all' | 'excursion' | 'nominal';
}

/**
 * Real engine-derived filter lenses for `LiveTelemetryStrip` (`src/ui/atelier/LiveTelemetryStrip.tsx`).
 * Verified against `ingestDemoPreset` in `landing-layout.test.ts`.
 */
export const LANDING_TELEMETRY_LENSES: readonly LandingTelemetryLens[] = [
  {
    id: 'all-fails',
    query: 'all fails',
    lotCode: 'CAL-ER-2401',
    dies: 2721,
    diesFormatted: '2,721',
    primaryStat: '82.8%',
    secondaryStat: 'Cpk 0.14',
    spectrumFocus: 'all',
  },
  {
    id: 'outer-3-rings',
    query: 'outer 3 rings',
    lotCode: 'CAL-ER-2401',
    dies: 2552,
    diesFormatted: '2,552',
    primaryStat: '93.8%',
    secondaryStat: '46.4% edge',
    spectrumFocus: 'excursion',
  },
  {
    id: 'only-bin-7',
    query: 'only bin 7',
    lotCode: 'CAL-ER-2401',
    dies: 2483,
    diesFormatted: '2,483',
    primaryStat: '91.3%',
    secondaryStat: 'SBIN 7',
    spectrumFocus: 'excursion',
  },
  {
    id: 'site-1-2',
    query: 'site 1:2',
    lotCode: 'CAL-S2-2403',
    dies: 1604,
    diesFormatted: '1,604',
    primaryStat: '40.6%',
    secondaryStat: '89.5% yield',
    spectrumFocus: 'nominal',
  },
] as const;

export interface LandingIddqSpectrumBin {
  readonly loUa: number;
  readonly hiUa: number;
  readonly count: number;
  readonly outOfSpec: boolean;
}

export const LANDING_IDDQ_HI_LIMIT_UA = 15.0 as const;
export const LANDING_IDDQ_MEAN_UA = 10.22 as const;
export const LANDING_IDDQ_MAX_BIN_COUNT = 7706 as const;

/**
 * Exact 28-bin `computeParametricHistogram` output for `edge-ring-etch` `IDDQ_LEAK` (`#204`).
 * Asserted bin-for-bin against the live STDF engine in `landing-layout.test.ts`.
 */
export const LANDING_IDDQ_SPECTRUM_BINS: readonly LandingIddqSpectrumBin[] = [
  { loUa: 1.2, hiUa: 3.1, count: 971, outOfSpec: false },
  { loUa: 3.1, hiUa: 4.9, count: 7706, outOfSpec: false },
  { loUa: 4.9, hiUa: 6.8, count: 1683, outOfSpec: false },
  { loUa: 6.8, hiUa: 8.6, count: 468, outOfSpec: false },
  { loUa: 8.6, hiUa: 10.4, count: 1240, outOfSpec: false },
  { loUa: 10.4, hiUa: 12.3, count: 933, outOfSpec: false },
  { loUa: 12.3, hiUa: 14.1, count: 307, outOfSpec: false },
  { loUa: 14.1, hiUa: 16.0, count: 34, outOfSpec: true },
  { loUa: 16.0, hiUa: 17.8, count: 0, outOfSpec: true },
  { loUa: 17.8, hiUa: 19.7, count: 0, outOfSpec: true },
  { loUa: 19.7, hiUa: 21.5, count: 17, outOfSpec: true },
  { loUa: 21.5, hiUa: 23.4, count: 29, outOfSpec: true },
  { loUa: 23.4, hiUa: 25.2, count: 58, outOfSpec: true },
  { loUa: 25.2, hiUa: 27.1, count: 90, outOfSpec: true },
  { loUa: 27.1, hiUa: 28.9, count: 131, outOfSpec: true },
  { loUa: 28.9, hiUa: 30.7, count: 217, outOfSpec: true },
  { loUa: 30.7, hiUa: 32.6, count: 253, outOfSpec: true },
  { loUa: 32.6, hiUa: 34.4, count: 267, outOfSpec: true },
  { loUa: 34.4, hiUa: 36.3, count: 293, outOfSpec: true },
  { loUa: 36.3, hiUa: 38.1, count: 265, outOfSpec: true },
  { loUa: 38.1, hiUa: 40.0, count: 263, outOfSpec: true },
  { loUa: 40.0, hiUa: 41.8, count: 212, outOfSpec: true },
  { loUa: 41.8, hiUa: 43.7, count: 152, outOfSpec: true },
  { loUa: 43.7, hiUa: 45.5, count: 111, outOfSpec: true },
  { loUa: 45.5, hiUa: 47.3, count: 61, outOfSpec: true },
  { loUa: 47.3, hiUa: 49.2, count: 37, outOfSpec: true },
  { loUa: 49.2, hiUa: 51.0, count: 17, outOfSpec: true },
  { loUa: 51.0, hiUa: 52.9, count: 10, outOfSpec: true },
] as const;
