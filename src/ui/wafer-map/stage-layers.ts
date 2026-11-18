/**
 * DOM stage layers that ride inside the camera wrapper with the disc (`premium.md` §5.1
 * steps 2 and 5, §5.2 step 6, §3.3): light-theme `ambient-shadow` and `contact-shadow`,
 * dark-theme `halo`, and the specular sheen with its notch-cut SVG mask. Pure geometry,
 * no React or DOM reads, so it is unit-testable in Node.
 */

import { WAFER_TOKENS } from '@/ui/tokens';

import { computeWaferNotchGeometry } from './wafer-geometry';

export interface StageLayerRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface StageDiscLayerRects {
  /** Light theme: circle `1.16 D`, offset `+0.04 D` down. */
  readonly ambient: StageLayerRect;
  /** Light theme: ellipse `0.86 D x 0.10 D`, centred `0.035 D` below the disc's lowest point. */
  readonly contact: StageLayerRect;
  /** Dark theme: circle `1.5 D` on the disc centre. */
  readonly halo: StageLayerRect;
  /** Sheen layer: the disc's bounding square. */
  readonly sheen: StageLayerRect;
}

function rectAround(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): StageLayerRect {
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
  };
}

/** Layer boxes in the raster's CSS px for a disc centred at `(cx, cy)` with radius `r`. */
export function computeStageDiscLayerRects(
  centerXCss: number,
  centerYCss: number,
  waferRadiusPx: number,
): StageDiscLayerRects {
  const r = Math.max(0, waferRadiusPx);
  const d = r * 2;
  const { ambientShadowSize, contactShadowSize, haloSize } = WAFER_TOKENS;
  const ambientD = ambientShadowSize.diameterD * d;
  const haloD = haloSize.diameterD * d;
  return {
    ambient: rectAround(
      centerXCss,
      centerYCss + ambientShadowSize.offsetDownD * d,
      ambientD,
      ambientD,
    ),
    contact: rectAround(
      centerXCss,
      centerYCss + r + contactShadowSize.offsetBelowD * d,
      contactShadowSize.widthD * d,
      contactShadowSize.heightD * d,
    ),
    halo: rectAround(centerXCss, centerYCss, haloD, haloD),
    sheen: rectAround(centerXCss, centerYCss, d, d),
  };
}

/** Applies a layer box to an element's inline style (imperative raster sync). */
export function applyStageLayerRect(
  style: { left: string; top: string; width: string; height: string },
  rect: StageLayerRect,
): void {
  style.left = `${rect.left}px`;
  style.top = `${rect.top}px`;
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
}

const MASK_VIEWBOX = 1000;

function fmt(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * SVG path of the notch-cut disc outline in a `1000 x 1000` viewBox, the same geometry as
 * `traceWaferOutlinePath` (circle `R`, V-notch at `WF_FLAT`, apex rounded `0.002 D`).
 */
export function buildWaferOutlineSvgPath(
  wfFlat: 'U' | 'D' | 'L' | 'R' | ' ',
): string {
  const half = MASK_VIEWBOX / 2;
  const n = computeWaferNotchGeometry(half, half, half, wfFlat);
  // Tangent points of the rounded apex on the two notch edges (canvas `arcTo` semantics)
  const inX = n.apexX - n.shoulderEndX;
  const inY = n.apexY - n.shoulderEndY;
  const outX = n.shoulderStartX - n.apexX;
  const outY = n.shoulderStartY - n.apexY;
  const inLen = Math.hypot(inX, inY);
  const outLen = Math.hypot(outX, outY);
  const ux = inX / inLen;
  const uy = inY / inLen;
  const vx = outX / outLen;
  const vy = outY / outLen;
  // Interior angle at the apex between the edges back to each shoulder
  const interior = Math.acos(Math.min(1, Math.max(-1, -(ux * vx + uy * vy))));
  const tangent = n.apexRoundRadiusPx / Math.tan(interior / 2);
  const p1x = n.apexX - ux * tangent;
  const p1y = n.apexY - uy * tangent;
  const p2x = n.apexX + vx * tangent;
  const p2y = n.apexY + vy * tangent;
  const sweep = ux * vy - uy * vx > 0 ? 1 : 0;
  const rr = fmt(n.apexRoundRadiusPx);
  return [
    `M${fmt(n.shoulderStartX)} ${fmt(n.shoulderStartY)}`,
    `A${half} ${half} 0 1 1 ${fmt(n.shoulderEndX)} ${fmt(n.shoulderEndY)}`,
    `L${fmt(p1x)} ${fmt(p1y)}`,
    `A${rr} ${rr} 0 0 ${sweep} ${fmt(p2x)} ${fmt(p2y)}`,
    'Z',
  ].join(' ');
}

/** CSS `mask-image` value: the notch-cut disc as an SVG data URI (premium §5.2 step 6). */
export function buildWaferDiscMaskImage(
  wfFlat: 'U' | 'D' | 'L' | 'R' | ' ',
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MASK_VIEWBOX} ${MASK_VIEWBOX}"><path fill="#fff" d="${buildWaferOutlineSvgPath(wfFlat)}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Sheen ellipse box as percentages of the disc box, plus its rest rotation. */
export function computeSheenEllipseRestStyle(): {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly height: string;
  readonly transform: string;
} {
  const s = WAFER_TOKENS.sheenSize;
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  return {
    left: pct(s.centerXD - s.widthD / 2),
    top: pct(s.centerYD - s.heightD / 2),
    width: pct(s.widthD),
    height: pct(s.heightD),
    transform: `rotate(${s.rotateDeg}deg)`,
  };
}
