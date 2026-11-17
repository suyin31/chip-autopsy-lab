import { formatHexColor, parseHexColor, type RgbTuple } from './contrast';

/**
 * Locked Chip Autopsy Lab colour tokens (Requirements 4.4, 5.2, 14.1, 17.1).
 *
 * Pass-die fill `#53655D` (`LCH(41.2, 8.3, 165.4)`) achieves 3.19:1 contrast
 * against `#0A0A0B` (`bg`), 3.04:1 against `#111113` (`panel`), and 4.53:1
 * against `#7CF2C1` (`accent` outlines).
 */
export const COLOR_TOKENS = {
  bg: '#0A0A0B',
  panel: '#111113',
  hairline: 'rgba(255, 255, 255, 0.08)',
  raised: 'rgba(255, 255, 255, 0.04)',
  overlay: 'rgba(255, 255, 255, 0.08)',
  textPrimary: 'rgba(255, 255, 255, 0.92)',
  textSecondary: 'rgba(255, 255, 255, 0.64)',
  textTertiary: 'rgba(255, 255, 255, 0.48)',
  accent: '#7CF2C1',
  accentForeground: '#0A0A0B',
  failure: '#FF7A1A',
  passDie: '#53655D',
  waferStreet: '#0A0A0B',
} as const;

/**
 * Equal-lightness CIE LCH (`L* ~= 66.0`, ~7.6:1 contrast on `#0A0A0B`)
 * secondary categorical fail-bin colours for ranks 2+.
 * Excludes `[125 deg, 200 deg]` (`#7CF2C1`) and `[40 deg, 72 deg]` (`#FF7A1A`).
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
 * yield-loss rank (`0` = top yield-loss failing bin -> `#FF7A1A`).
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
