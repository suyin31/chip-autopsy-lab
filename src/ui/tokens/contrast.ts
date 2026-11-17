/**
 * WCAG 2.2 relative luminance, alpha compositing, and CIE LCH helpers
 * used to verify contrast invariants across Chip Autopsy Lab tokens.
 */

export interface RgbTuple {
  readonly r: number; // 0..255
  readonly g: number; // 0..255
  readonly b: number; // 0..255
}

export interface RgbaTuple extends RgbTuple {
  readonly a: number; // 0..1
}

export function parseHexColor(hex: string): RgbTuple {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid 6-digit hex color: "${hex}"`);
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function formatHexColor({ r, g, b }: RgbTuple): string {
  const clampByte = (v: number): number =>
    Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number): string =>
    clampByte(v).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function parseRgbaString(rgba: string): RgbaTuple {
  const match =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+|1\.0+)\s*\)$/.exec(
      rgba.trim(),
    );
  if (!match) {
    throw new Error(`Invalid rgba() color token: "${rgba}"`);
  }
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = Number(match[4]);
  if (r > 255 || g > 255 || b > 255 || a < 0 || a > 1) {
    throw new Error(`Out-of-range rgba() channel in "${rgba}"`);
  }
  return { r, g, b, a };
}

export function compositeRgbaOverRgb(
  fg: RgbaTuple,
  bg: RgbTuple,
): RgbTuple {
  const inv = 1 - fg.a;
  return {
    r: fg.r * fg.a + bg.r * inv,
    g: fg.g * fg.a + bg.g * inv,
    b: fg.b * fg.a + bg.b * inv,
  };
}

export function srgbChannelToLinear(byteValue: number): number {
  const s = Math.max(0, Math.min(255, byteValue)) / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: RgbTuple): number {
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function wcagContrastRatio(a: RgbTuple, b: RgbTuple): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function wcagHexContrastRatio(hexA: string, hexB: string): number {
  return wcagContrastRatio(parseHexColor(hexA), parseHexColor(hexB));
}

/**
 * Converts sRGB (D65) to CIE LCH(ab) for verifying hue exclusion zones
 * and equal-lightness categorical bin palettes.
 */
export function rgbToCieLch(rgb: RgbTuple): {
  readonly l: number;
  readonly c: number;
  readonly h: number;
} {
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);

  // sRGB D65 -> XYZ
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;

  const f = (t: number): number =>
    t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const l = 116 * fy - 16;
  const labA = 500 * (fx - fy);
  const labB = 200 * (fy - fz);
  const c = Math.hypot(labA, labB);
  const rawHue = (Math.atan2(labB, labA) * 180) / Math.PI;
  const h = ((rawHue % 360) + 360) % 360;

  return { l, c, h };
}
