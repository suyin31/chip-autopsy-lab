import { formatHexColor, parseHexColor, type RgbTuple } from './contrast';

/**
 * Locked Chip Autopsy Lab redesign colour tokens (redesign.md §2.1, design-language.md).
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
