import { formatHexColor, parseHexColor, type RgbTuple } from './contrast';

/**
 * Legacy R-series dark colour tokens (redesign.md §2.1). Still read by components and canvas
 * code that later premium tasks migrate to `THEME_TOKENS` / `WAFER_TOKENS`.
 *
 * Contrast invariants (WCAG 2.2 relative luminance):
 * - `passDie` `#63666C` achieves 3.65:1 on `bg` `#000000` and 3.20:1 on vignette peak `#141416`.
 * - `failure` `#FF6B2C` achieves 7.4:1 on `#000000`; `failureText` `#FF8A57` achieves 9.0:1.
 * - `accent` (ice) `#D6E6FF` achieves 16.6:1 on `#000000`.
 * - `textPrimary` (0.92), `textSecondary` (0.56), and `textTertiary` (0.48) all achieve
 *   >= 4.5:1 composited over `#000000` (`bg`) and `#1A1A1C` (`surface2`).
 */
export const COLOR_TOKENS = {
  bg: '#000000',
  surface1: '#0F0F10',
  surface2: '#1A1A1C',
  surface3: '#242426',
  material: 'rgba(22, 22, 24, 0.72)',
  ring: 'inset 0 0 0 1px rgba(255, 255, 255, 0.10)',
  ringStrong: 'inset 0 0 0 1px rgba(255, 255, 255, 0.16)',
  separator: 'rgba(255, 255, 255, 0.08)',
  textPrimary: 'rgba(255, 255, 255, 0.92)',
  textSecondary: 'rgba(255, 255, 255, 0.56)',
  textTertiary: 'rgba(255, 255, 255, 0.48)',
  textDisabled: 'rgba(255, 255, 255, 0.28)',
  accent: '#D6E6FF',
  accentSoft: 'rgba(214, 230, 255, 0.12)',
  failure: '#FF6B2C',
  failureText: '#FF8A57',
  passDie: '#63666C',
  dieStreet: '#000000',
  dimScrim: 'rgba(0, 0, 0, 0.62)',
  buttonPrimary: '#F5F5F7',
  buttonPrimaryText: '#000000',
  vignette:
    'radial-gradient(closest-side, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 55%, rgba(255,255,255,0) 100%)',
  vignettePeak: '#141416',
  topLight:
    'linear-gradient(180deg, rgba(214,230,255,0.06) 0%, rgba(214,230,255,0) 40%)',
  waferDisc: '#0B0B0C',

  // Compatibility aliases while downstream R3–R7 components migrate
  panel: '#0F0F10',
  hairline: 'rgba(255, 255, 255, 0.08)',
  raised: '#1A1A1C',
  overlay: 'rgba(22, 22, 24, 0.72)',
  accentForeground: '#000000',
  waferStreet: '#000000',
} as const;

export type ThemeName = 'light' | 'dark';

/** A translucent material: fill colour plus its `backdrop-filter` value (`premium.md` §3.8). */
export interface MaterialToken {
  readonly color: string;
  readonly backdropFilter: string;
}

/** One theme's UI tokens (`premium.md` §3.2, §3.5, §3.7, §7.9). */
export interface ThemeTokens {
  readonly bg: string;
  readonly surface: string;
  readonly surfaceSunken: string;
  readonly fill1: string;
  readonly fill2: string;
  readonly fill3: string;
  readonly material: MaterialToken;
  readonly materialThick: MaterialToken;
  readonly scrim: MaterialToken;
  readonly hairline: string;
  readonly hairlineStrong: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly textDisabled: string;
  readonly ink: string;
  readonly onInk: string;
  readonly ember: string;
  readonly emberMark: string;
  readonly emberInk: string;
  readonly focusRing: string;
  readonly selection: string;
  readonly barNeutral: string;
  /** `theme-color` meta value (`premium.md` §3.1). */
  readonly themeColor: string;
  /** Bin swatch colours on the page, ranks 0..7 (`bin-n-ink`, `premium.md` §3.5). */
  readonly binInk: readonly string[];
  readonly shadowCard: string;
  readonly shadowCardHover: string;
  readonly shadowPopover: string;
  readonly shadowThumb: string;
  readonly shadowChevron: string;
}

/** Bin colours drawn on the dark disc in both themes, ranks 0..7 (`bin-n`, `premium.md` §3.5). */
export const BIN_DISC_PALETTE = [
  '#FF6B2C',
  '#00ACEA',
  '#AE90F3',
  '#FD7584',
  '#B99F35',
  '#00B0C8',
  '#E87AC7',
  '#61A1FF',
] as const;

/** Bin colours listed on the light page, ranks 0..7 (`bin-n-ink`, light; rank 0 = `ember-mark`). */
export const BIN_INK_PALETTE_LIGHT = [
  '#E8591E',
  '#0A6FB0',
  '#7353C9',
  '#C23A55',
  '#7A6510',
  '#007A8C',
  '#A63E8C',
  '#2D63CC',
] as const;

/**
 * Premium UI colour, elevation, and material tokens per theme (`premium.md` §3.2, §3.7, §3.8).
 * Canvas code reads these objects and never reads CSS variables per frame (§3.1).
 */
export const THEME_TOKENS: Readonly<Record<ThemeName, ThemeTokens>> = {
  light: {
    bg: '#F6F3EE',
    surface: '#FFFFFF',
    surfaceSunken: '#EBEBEF',
    fill1: '#EFEBE4',
    fill2: '#E6E1D8',
    fill3: 'rgba(0, 0, 0, 0.08)',
    material: {
      color: 'rgba(250, 250, 252, 0.80)',
      backdropFilter: 'blur(20px) saturate(180%)',
    },
    materialThick: {
      color: 'rgba(255, 255, 255, 0.92)',
      backdropFilter: 'blur(24px) saturate(180%)',
    },
    scrim: {
      color: 'rgba(245, 245, 247, 0.60)',
      backdropFilter: 'blur(24px)',
    },
    hairline: 'rgba(32, 30, 31, 0.10)',
    hairlineStrong: 'rgba(32, 30, 31, 0.18)',
    textPrimary: '#201E1F',
    textSecondary: '#534F49',
    textTertiary: '#6D6963',
    textDisabled: 'rgba(29, 29, 31, 0.32)',
    ink: '#201E1F',
    onInk: '#FFFFFF',
    ember: '#FF6B2C',
    emberMark: '#E8591E',
    emberInk: '#D94E14',
    focusRing: '0 0 0 2px var(--bg), 0 0 0 4px #201E1F',
    selection: 'rgba(29, 29, 31, 0.14)',
    barNeutral: 'rgba(0, 0, 0, 0.16)',
    themeColor: '#F6F3EE',
    binInk: BIN_INK_PALETTE_LIGHT,
    shadowCard:
      '0 0 0 1px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.05)',
    shadowCardHover:
      '0 0 0 1px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.05), 0 16px 40px rgba(0, 0, 0, 0.08)',
    shadowPopover:
      '0 0 0 1px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.08), 0 24px 48px rgba(0, 0, 0, 0.12)',
    shadowThumb:
      '0 0 0 0.5px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.10), 0 3px 8px rgba(0, 0, 0, 0.05)',
    shadowChevron:
      '0 0 0 1px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.10)',
  },
  dark: {
    bg: '#000000',
    surface: '#111113',
    surfaceSunken: '#1C1C1F',
    fill1: 'rgba(255, 255, 255, 0.05)',
    fill2: 'rgba(255, 255, 255, 0.08)',
    fill3: 'rgba(255, 255, 255, 0.12)',
    material: {
      color: 'rgba(22, 22, 24, 0.72)',
      backdropFilter: 'blur(24px) saturate(180%)',
    },
    materialThick: {
      color: 'rgba(28, 28, 30, 0.88)',
      backdropFilter: 'blur(24px) saturate(180%)',
    },
    scrim: {
      color: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(32px)',
    },
    hairline: 'rgba(255, 255, 255, 0.08)',
    hairlineStrong: 'rgba(255, 255, 255, 0.16)',
    textPrimary: 'rgba(255, 255, 255, 0.92)',
    textSecondary: 'rgba(255, 255, 255, 0.64)',
    textTertiary: 'rgba(255, 255, 255, 0.56)',
    textDisabled: 'rgba(255, 255, 255, 0.28)',
    ink: '#F5F5F7',
    onInk: '#000000',
    ember: '#FF6B2C',
    emberMark: '#FF6B2C',
    emberInk: '#FF8A57',
    focusRing: '0 0 0 2px #000000, 0 0 0 4px rgba(255, 255, 255, 0.92)',
    selection: 'rgba(255, 255, 255, 0.22)',
    barNeutral: 'rgba(255, 255, 255, 0.22)',
    themeColor: '#000000',
    binInk: BIN_DISC_PALETTE,
    shadowCard: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
    shadowCardHover: 'inset 0 0 0 1px rgba(255, 255, 255, 0.13)',
    shadowPopover:
      'inset 0 0 0 1px rgba(255, 255, 255, 0.10), 0 24px 48px rgba(0, 0, 0, 0.60)',
    shadowThumb: 'none',
    shadowChevron: 'inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
  },
};

/**
 * Theme-independent wafer tokens (`premium.md` §3.3): the disc is the same object in both
 * themes. DOM stage shadows (`contactShadow`, `ambientShadow`, `halo`) and the `sheen` are CSS gradients;
 * their sizes are fractions of the disc diameter D.
 */
export const WAFER_TOKENS = {
  discHi: '#2B2D33',
  discMid: '#1C1D21',
  discLo: '#121316',
  discStops: [0, 0.55, 1] as const,
  film: [
    'rgba(120, 150, 255, 0.06)',
    'rgba(180, 120, 255, 0.05)',
    'rgba(90, 220, 200, 0.04)',
    'rgba(255, 190, 120, 0.04)',
  ] as const,
  bevelTop: 'rgba(255, 255, 255, 0.38)',
  bevelBottom: 'rgba(255, 255, 255, 0.06)',
  bevelInner: 'rgba(0, 0, 0, 0.45)',
  exclusionLine: 'rgba(255, 255, 255, 0.05)',
  passTile: 'rgba(255, 255, 255, 0.06)',
  passTileHc: 'rgba(255, 255, 255, 0.34)',
  failDie: '#FF6B2C',
  failFacet: 'rgba(255, 255, 255, 0.18)',
  failFacetMinPitchPx: 10,
  dimVeil: 'rgba(18, 19, 22, 0.78)',
  evidenceRim: 'rgba(255, 255, 255, 0.90)',
  evidenceRimWidthPx: 1,
  /** 1 px rim inside an evidence pass tile (premium §5.4). */
  evidencePassRim: 'rgba(255, 255, 255, 0.55)',
  evidenceBloom: {
    color: '#FF6B2C',
    alpha: 0.35,
    blurPx: 8,
    composite: 'lighter',
    compositeAlpha: 0.6,
  },
  hoverStroke: {
    inner: 'rgba(255, 255, 255, 0.95)',
    innerWidthPx: 1.5,
    outer: 'rgba(0, 0, 0, 0.6)',
    outerWidthPx: 1,
  },
  pinnedStroke: {
    inner: '#FFFFFF',
    innerWidthPx: 2,
    outer: '#000000',
    outerWidthPx: 1,
  },
  selectionRect: {
    stroke: 'rgba(255, 255, 255, 0.90)',
    strokeWidthPx: 1,
    fill: 'rgba(255, 255, 255, 0.06)',
    radiusPx: 4,
  },
  probeLight: {
    color: 'rgba(255, 255, 255, 0.28)',
    radiusPitches: 3,
  },
  contactShadow:
    'radial-gradient(closest-side, rgba(0, 0, 0, 0.26), rgba(0, 0, 0, 0.10) 55%, rgba(0, 0, 0, 0) 100%)',
  contactShadowSize: { widthD: 0.86, heightD: 0.1, offsetBelowD: 0.035 },
  ambientShadow:
    'radial-gradient(closest-side, rgba(0, 0, 0, 0.10), rgba(0, 0, 0, 0) 100%)',
  ambientShadowSize: { diameterD: 1.16, offsetDownD: 0.04 },
  halo:
    'radial-gradient(closest-side, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018) 55%, rgba(255, 255, 255, 0) 100%)',
  haloSize: { diameterD: 1.5 },
  /** Specular sheen ellipse (premium §5.2 step 6), composited `screen` inside the disc mask. */
  sheen:
    'radial-gradient(closest-side, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.03) 60%, rgba(255, 255, 255, 0) 100%)',
  sheenSize: {
    widthD: 0.92,
    heightD: 0.58,
    centerXD: 0.34,
    centerYD: 0.26,
    rotateDeg: -24,
  },
} as const;

/** Where a bin colour is drawn: on the disc (both themes) or listed on the page. */
export type BinColorSurface = 'disc' | ThemeName;

/**
 * Bin colour by yield-loss rank (`premium.md` §3.5). Rank 0 is always ember;
 * ranks 1+ cycle through the 7 hues.
 */
export function getBinColor(
  rankZeroBased: number,
  surface: BinColorSurface,
): string {
  const palette =
    surface === 'disc' ? BIN_DISC_PALETTE : THEME_TOKENS[surface].binInk;
  const safeRank = Math.max(0, Math.trunc(rankZeroBased));
  if (safeRank === 0) {
    return palette[0];
  }
  return palette[1 + ((safeRank - 1) % (palette.length - 1))];
}

/**
 * Equal-lightness CIE LCH (`L* ~= 66.0`, ~8.0:1 contrast on `#000000`)
 * secondary categorical fail-bin colours for ranks 1+ (redesign.md §2.1).
 */
export const SECONDARY_FAIL_BIN_PALETTE = [
  '#00ACEA',
  '#AE90F3',
  '#FD7584',
  '#B99F35',
  '#00B0C8',
  '#E87AC7',
  '#61A1FF',
] as const;

/**
 * Returns the deterministic categorical colour for a failing bin ordered by
 * yield-loss rank (`0` = dominant yield-loss failing bin -> `#FF6B2C`).
 */
export function getFailBinColor(rankZeroBased: number): string {
  const safeRank = Math.max(0, Math.trunc(rankZeroBased));
  if (safeRank === 0) {
    return COLOR_TOKENS.failure;
  }
  const index = (safeRank - 1) % SECONDARY_FAIL_BIN_PALETTE.length;
  return SECONDARY_FAIL_BIN_PALETTE[index];
}

/**
 * Canonical 17-stop perceptually uniform `magma` control points (darkest to brightest)
 * interpolated into a 256-entry lookup table for O(1) Canvas2D heatmap rendering.
 */
const MAGMA_STOPS_HEX: readonly string[] = [
  '#000004',
  '#07061C',
  '#160E3B',
  '#2C115F',
  '#451077',
  '#5E177F',
  '#762181',
  '#8F2A81',
  '#A8327D',
  '#C13A75',
  '#D8456C',
  '#EC5860',
  '#F8745C',
  '#FD9567',
  '#FEB77E',
  '#FED99B',
  '#FCFDBF',
];

function buildMagmaLut256(): {
  readonly hex: readonly string[];
  readonly rgb: Uint8Array;
} {
  const parsedStops = MAGMA_STOPS_HEX.map(parseHexColor);
  const segmentCount = parsedStops.length - 1;
  const hexTable: string[] = new Array<string>(256);
  const rgbBytes = new Uint8Array(256 * 3);

  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const scaled = t * segmentCount;
    const segIndex = Math.min(segmentCount - 1, Math.floor(scaled));
    const localT = scaled - segIndex;
    const left = parsedStops[segIndex];
    const right = parsedStops[segIndex + 1];

    const r = Math.round(left.r + (right.r - left.r) * localT);
    const g = Math.round(left.g + (right.g - left.g) * localT);
    const b = Math.round(left.b + (right.b - left.b) * localT);

    rgbBytes[i * 3] = r;
    rgbBytes[i * 3 + 1] = g;
    rgbBytes[i * 3 + 2] = b;
    hexTable[i] = formatHexColor({ r, g, b });
  }

  return { hex: Object.freeze(hexTable), rgb: rgbBytes };
}

const MAGMA_BUILT = buildMagmaLut256();

/** 256-entry `#RRGGBB` lookup table for the `magma` heatmap scale (`0..255`). */
export const MAGMA_LUT_256: readonly string[] = MAGMA_BUILT.hex;

/** Packed `[r0, g0, b0, ...]` `Uint8Array(768)` for fast `ImageData` fills. */
export const MAGMA_RGB_256: Uint8Array = MAGMA_BUILT.rgb;

function normalizeUnitInterval(t: number): number {
  if (!Number.isFinite(t) || t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return t;
}

export function sampleMagmaHex(t: number): string {
  const idx = Math.round(normalizeUnitInterval(t) * 255);
  return MAGMA_LUT_256[idx];
}

export function sampleMagmaRgb(t: number): RgbTuple {
  const idx = Math.round(normalizeUnitInterval(t) * 255) * 3;
  return {
    r: MAGMA_RGB_256[idx],
    g: MAGMA_RGB_256[idx + 1],
    b: MAGMA_RGB_256[idx + 2],
  };
}
