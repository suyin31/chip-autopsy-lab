/**
 * Pure Wafer Map Geometry, WCR Orientation, Color Mapping, and Three-Layer
 * Canvas2D Painters (`src/ui/wafer-map/wafer-geometry.ts`).
 *
 * Kept free of React and browser global reads so every coordinate transform,
 * DPR/supersampled backing-store calculation, §2.1 pass/fail geometry cue
 * (72% 1px-radius pass square vs full-cell minus 1px street 1.5px-radius fail die),
 * `#0B0B0C` silicon wafer disc + V-notch path, O(1) pointer hit-test, and
 * base/fail/overlay draw passes are directly unit-testable in Node.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 14.2, 15.4, 17.1 & redesign §2.1, §3.4, §4.7
 */

import {
  type ColumnarDies,
  type LotModel,
  packWaferCoord,
  type ParametricTestColumn,
  type WaferSummaryMeta,
} from '@/core/model';
import type { SpatialBrushRect, WaferColorMode } from '@/ui/state';
import {
  COLOR_TOKENS,
  getFailBinColor,
  sampleMagmaHex,
} from '@/ui/tokens';

export interface ViewportTransform {
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;
}

export const DEFAULT_VIEWPORT_TRANSFORM: ViewportTransform = {
  scale: 1,
  panX: 0,
  panY: 0,
};

/** `redesign.md` §2.1: `#000000` street border width around every failing die. */
export const WAFER_STREET_WIDTH_PX = 1 as const;

/** `redesign.md` §2.1: Pass dies render as a centred square at 72% of the cell with 1 px radius. */
export const PASS_DIE_CELL_FRACTION = 0.72 as const;
export const PASS_DIE_RADIUS_PX = 1 as const;

/** `redesign.md` §2.1: Fail dies fill the cell minus the 1 px street with 1.5 px radius. */
export const FAIL_DIE_RADIUS_PX = 1.5 as const;

/** `redesign.md` §4.7: Supersampled base canvas cap per side (`devicePixelRatio x 2`, max `4096 px`). */
export const MAX_SUPERSAMPLED_CANVAS_PX = 4096 as const;

/** Extra radial margin (in die pitches) between outermost die corner and wafer bevel rim. */
const WAFER_RIM_CLEARANCE_UNITS = 0.55;

/** `redesign.md` §2.1: Silicon disc `1 px` ring (`rgba(255, 255, 255, 0.10)`). */
export const WAFER_DISC_RING_STROKE = 'rgba(255, 255, 255, 0.10)' as const;

/** Canvas evidence keyline (`#000000` 1px), ice halo, and hover reticle strokes (`redesign.md` §2.1). */
export const OVERLAY_KEYLINE_STROKE = '#000000' as const;
export const OVERLAY_HALO_STROKE = 'rgba(214, 230, 255, 0.28)' as const;
export const OVERLAY_HOVER_STROKE = 'rgba(255, 255, 255, 0.92)' as const;

/** Compatibility export kept for tests importing `FAIL_MICRO_DOT_MIN_PITCH_PX` / `shouldDrawFailMicroDot`. */
export const FAIL_MICRO_DOT_MIN_PITCH_PX = 7 as const;
export function shouldDrawFailMicroDot(diePitchPx: number): boolean {
  return Number.isFinite(diePitchPx) && diePitchPx >= FAIL_MICRO_DOT_MIN_PITCH_PX;
}

export interface CanvasPixelDimensions {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * Resolves device-pixel-ratio-scaled backing store dimensions from logical CSS pixels.
 */
export function resolveCanvasPixelSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): CanvasPixelDimensions {
  const safeCssW = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const safeCssH = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? Math.min(4, devicePixelRatio)
      : 1;

  return {
    cssWidth: safeCssW,
    cssHeight: safeCssH,
    dpr,
    pixelWidth: Math.max(1, Math.round(safeCssW * dpr)),
    pixelHeight: Math.max(1, Math.round(safeCssH * dpr)),
  };
}

/**
 * Resolves supersampled (`devicePixelRatio x 2`) backing store dimensions for `BaseCanvas`,
 * uniformly capped so neither side exceeds `4096 px` (`redesign.md` §4.7).
 */
export function resolveSupersampledCanvasSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  supersampleFactor = 2,
): CanvasPixelDimensions {
  const safeCssW = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const safeCssH = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const baseDpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? Math.min(4, devicePixelRatio)
      : 1;
  const desiredScale = baseDpr * Math.max(1, supersampleFactor);
  const maxCssSide = Math.max(safeCssW, safeCssH);
  const maxAllowedScale = MAX_SUPERSAMPLED_CANVAS_PX / maxCssSide;
  const effectiveDpr = Math.max(0.5, Math.min(desiredScale, maxAllowedScale));

  return {
    cssWidth: safeCssW,
    cssHeight: safeCssH,
    dpr: effectiveDpr,
    pixelWidth: Math.min(
      MAX_SUPERSAMPLED_CANVAS_PX,
      Math.max(1, Math.round(safeCssW * effectiveDpr)),
    ),
    pixelHeight: Math.min(
      MAX_SUPERSAMPLED_CANVAS_PX,
      Math.max(1, Math.round(safeCssH * effectiveDpr)),
    ),
  };
}

export interface WaferRenderLayout {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly centerXCss: number;
  readonly centerYCss: number;
  readonly fitWaferRadiusPx: number;
  readonly waferRadiusPx: number;
  readonly waferRadiusUnits: number;
  readonly diePitchPx: number;
  readonly streetPx: number;
  readonly dieSizePx: number;
  readonly passDieSizePx: number;
  readonly gridCenterX: number;
  readonly gridCenterY: number;
  /** `+1` when positive X points right (`POS_X = 'R'`), `-1` when left (`POS_X = 'L'`). */
  readonly dirX: 1 | -1;
  /** `-1` in screen Y when positive Y points up (`POS_Y = 'U'`), `+1` when down (`POS_Y = 'D'`). */
  readonly dirY: 1 | -1;
}

export interface DieCanvasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface WaferNotchGeometry {
  readonly notchAngleRad: number;
  readonly arcStartRad: number;
  readonly arcEndRad: number;
  readonly shoulderStartX: number;
  readonly shoulderStartY: number;
  readonly apexX: number;
  readonly apexY: number;
  readonly shoulderEndX: number;
  readonly shoulderEndY: number;
}

/**
 * Computes the wafer's outer radius in die-pitch units so every valid die cell's
 * 4 corners sit cleanly inside the circular wafer boundary with realistic edge clearance.
 */
export function computeWaferRadiusUnits(
  wafer: WaferSummaryMeta,
  dies?: ColumnarDies,
): number {
  const gridCenterX = (wafer.minX + wafer.maxX) / 2;
  const gridCenterY = (wafer.minY + wafer.maxY) / 2;

  let maxCornerDist = 0;
  if (dies !== undefined) {
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (dies.hasValidCoords[i] === 0) {
        continue;
      }
      const dx = Math.abs(dies.x[i]! - gridCenterX) + 0.5;
      const dy = Math.abs(dies.y[i]! - gridCenterY) + 0.5;
      const cornerDist = Math.hypot(dx, dy);
      if (cornerDist > maxCornerDist) {
        maxCornerDist = cornerDist;
      }
    }
  }

  if (maxCornerDist === 0) {
    const halfSpanX = Math.max(1, wafer.maxX - wafer.minX + 1) / 2;
    const halfSpanY = Math.max(1, wafer.maxY - wafer.minY + 1) / 2;
    maxCornerDist = Math.hypot(halfSpanX, halfSpanY);
  }

  return Math.max(1.5, maxCornerDist + WAFER_RIM_CLEARANCE_UNITS);
}

/**
 * Resolves stage-side margin so fit wafer diameter matches `redesign.md` §3.4:
 * - Desktop (`minDim >= 656`, e.g. `783 x 720`): `minDim - 96` (`48 px` per side -> `624 Ø` at `720 px`)
 * - Mobile (`minDim === 390`): `390 - 40 = 350 Ø` (`20 px` per side)
 * - Smooth linear ramp between `390` and `656`
 */
export function resolveStageMarginPx(minDim: number): number {
  if (minDim >= 656) {
    return 48;
  }
  if (minDim <= 390) {
    return Math.max(6, Math.round((minDim * 20) / 390));
  }
  const t = (minDim - 390) / (656 - 390);
  return Math.round(20 + t * 28);
}

/**
 * Computes deterministic coordinate-to-canvas geometry respecting `WCR` orientation
 * (`POS_X`, `POS_Y`), `1 px` street insets, `72%` pass-die geometry cue, and `ViewportTransform`.
 */
export function computeWaferRenderLayout(
  wafer: WaferSummaryMeta,
  cssWidth: number,
  cssHeight: number,
  dies?: ColumnarDies,
  transform: ViewportTransform = DEFAULT_VIEWPORT_TRANSFORM,
): WaferRenderLayout {
  const safeW = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const safeH = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const minDim = Math.min(safeW, safeH);
  const paddingCss = resolveStageMarginPx(minDim);
  const fitWaferRadiusPx = Math.max(12, minDim / 2 - paddingCss);

  const clampedScale =
    Number.isFinite(transform.scale) && transform.scale > 0
      ? Math.min(24, Math.max(0.25, transform.scale))
      : 1;
  const panX = Number.isFinite(transform.panX) ? transform.panX : 0;
  const panY = Number.isFinite(transform.panY) ? transform.panY : 0;

  const waferRadiusUnits = computeWaferRadiusUnits(wafer, dies);
  const waferRadiusPx = fitWaferRadiusPx * clampedScale;
  const diePitchPx = waferRadiusPx / waferRadiusUnits;

  const streetPx =
    diePitchPx >= 3
      ? WAFER_STREET_WIDTH_PX
      : Math.max(0, Math.min(WAFER_STREET_WIDTH_PX, diePitchPx * 0.2));
  const dieSizePx = Math.max(0.75, diePitchPx - streetPx);
  const passDieSizePx = Math.max(0.6, diePitchPx * PASS_DIE_CELL_FRACTION);

  const gridCenterX = (wafer.minX + wafer.maxX) / 2;
  const gridCenterY = (wafer.minY + wafer.maxY) / 2;

  const dirX: 1 | -1 = wafer.geometry.posX === 'L' ? -1 : 1;
  const dirY: 1 | -1 = wafer.geometry.posY === 'D' ? 1 : -1;

  return {
    cssWidth: safeW,
    cssHeight: safeH,
    centerXCss: safeW / 2 + panX,
    centerYCss: safeH / 2 + panY,
    fitWaferRadiusPx,
    waferRadiusPx,
    waferRadiusUnits,
    diePitchPx,
    streetPx,
    dieSizePx,
    passDieSizePx,
    gridCenterX,
    gridCenterY,
    dirX,
    dirY,
  };
}

/**
 * Projects integer die coordinates `(x, y)` to a logical CSS-pixel full die rectangle
 * (cell minus `streetPx` = `1 px` street border).
 */
export function dieCoordToCanvasRect(
  x: number,
  y: number,
  layout: WaferRenderLayout,
): DieCanvasRect {
  const centerX =
    layout.centerXCss +
    (x - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
  const centerY =
    layout.centerYCss +
    (y - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
  const half = layout.dieSizePx / 2;
  return {
    x: centerX - half,
    y: centerY - half,
    width: layout.dieSizePx,
    height: layout.dieSizePx,
    centerX,
    centerY,
  };
}

/**
 * O(1) inverse pointer-to-die hit-test using `LotModel.waferCoordIndex[waferIndex]`.
 * Returns the resolved global die index (`0 .. lot.dies.count - 1`) or `null`.
 */
export function hitTestWaferDie(
  pointerXCss: number,
  pointerYCss: number,
  layout: WaferRenderLayout,
  waferCoordMap: ReadonlyMap<number, number> | undefined,
): number | null {
  if (!waferCoordMap || layout.diePitchPx <= 0) {
    return null;
  }

  const gx =
    layout.gridCenterX +
    ((pointerXCss - layout.centerXCss) / layout.diePitchPx) * layout.dirX;
  const gy =
    layout.gridCenterY +
    ((pointerYCss - layout.centerYCss) / layout.diePitchPx) * layout.dirY;

  const ix = Math.round(gx);
  const iy = Math.round(gy);

  if (Math.abs(gx - ix) > 0.5 || Math.abs(gy - iy) > 0.5) {
    return null;
  }

  const dieIndex = waferCoordMap.get(packWaferCoord(ix, iy));
  return dieIndex !== undefined ? dieIndex : null;
}

/**
 * Computes SEMI orientation V-notch geometry on the wafer perimeter according to
 * `WCR.WF_FLAT` (`'D'` bottom default, `'U'` top, `'L'` left, `'R'` right).
 */
export function computeWaferNotchGeometry(
  centerXCss: number,
  centerYCss: number,
  waferRadiusPx: number,
  wfFlat: 'U' | 'D' | 'L' | 'R' | ' ',
): WaferNotchGeometry {
  let notchAngleRad = Math.PI / 2; // 'D' or ' ' -> bottom 6 o'clock
  if (wfFlat === 'U') {
    notchAngleRad = -Math.PI / 2;
  } else if (wfFlat === 'L') {
    notchAngleRad = Math.PI;
  } else if (wfFlat === 'R') {
    notchAngleRad = 0;
  }

  const depthPx = Math.max(4, Math.min(9, waferRadiusPx * 0.032));
  const halfOpeningPx = depthPx * 0.88;
  const halfAngleRad = Math.min(
    0.2,
    Math.max(0.025, halfOpeningPx / Math.max(1, waferRadiusPx)),
  );

  const arcStartRad = notchAngleRad + halfAngleRad;
  const arcEndRad = notchAngleRad - halfAngleRad + Math.PI * 2;

  const shoulderStartX = centerXCss + Math.cos(arcStartRad) * waferRadiusPx;
  const shoulderStartY = centerYCss + Math.sin(arcStartRad) * waferRadiusPx;
  const apexRadius = Math.max(0, waferRadiusPx - depthPx);
  const apexX = centerXCss + Math.cos(notchAngleRad) * apexRadius;
  const apexY = centerYCss + Math.sin(notchAngleRad) * apexRadius;
  const shoulderEndX =
    centerXCss + Math.cos(notchAngleRad - halfAngleRad) * waferRadiusPx;
  const shoulderEndY =
    centerYCss + Math.sin(notchAngleRad - halfAngleRad) * waferRadiusPx;

  return {
    notchAngleRad,
    arcStartRad,
    arcEndRad,
    shoulderStartX,
    shoulderStartY,
    apexX,
    apexY,
    shoulderEndX,
    shoulderEndY,
  };
}

/**
 * Projects a `SpatialBrushRect` into logical CSS-pixel coordinates on `OverlayCanvas`.
 */
export function projectBrushToCanvasRect(
  brush: SpatialBrushRect,
  layout: WaferRenderLayout,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const r1 = dieCoordToCanvasRect(brush.minX, brush.minY, layout);
  const r2 = dieCoordToCanvasRect(brush.maxX, brush.maxY, layout);
  const left = Math.min(r1.x, r2.x);
  const top = Math.min(r1.y, r2.y);
  const right = Math.max(r1.x + r1.width, r2.x + r2.width);
  const bottom = Math.max(r1.y + r1.height, r2.y + r2.height);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Maps Pass/Fail state to the locked WCAG-verified wafer palette (`#63666C` pass, `#FF6B2C` fail).
 */
export function resolvePassFailDieColor(finalPass: number): string {
  return finalPass !== 0 ? COLOR_TOKENS.passDie : COLOR_TOKENS.failure;
}

/**
 * Ranks failing bin codes across a Lot in non-increasing order of final-state fail count
 * (`rank 0` -> `#FF6B2C`, `ranks 1+` -> equal-lightness LCH categorical palette).
 */
export function buildFailBinRankMap(
  dies: ColumnarDies,
  mode: 'HBIN' | 'SBIN',
): ReadonlyMap<number, number> {
  const cached = failBinRankCache.get(dies)?.[mode];
  if (cached !== undefined) {
    return cached;
  }
  const rankByCode = computeFailBinRankMap(dies, mode);
  const entry = failBinRankCache.get(dies) ?? {};
  entry[mode] = rankByCode;
  failBinRankCache.set(dies, entry);
  return rankByCode;
}

/** `ColumnarDies` are immutable after the lot is built, so ranks are cached per die table. */
const failBinRankCache = new WeakMap<
  ColumnarDies,
  { HBIN?: ReadonlyMap<number, number>; SBIN?: ReadonlyMap<number, number> }
>();

function computeFailBinRankMap(
  dies: ColumnarDies,
  mode: 'HBIN' | 'SBIN',
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  const binArr = mode === 'SBIN' ? dies.sbin : dies.hbin;
  for (let i = 0; i < dies.count; i += 1) {
    if (dies.finalPass[i] !== 0) {
      continue;
    }
    const code = binArr[i]!;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] - b[0];
  });
  const rankByCode = new Map<number, number>();
  for (let r = 0; r < sorted.length; r += 1) {
    rankByCode.set(sorted[r]![0], r);
  }
  return rankByCode;
}

export interface ParametricRange {
  readonly min: number;
  readonly max: number;
}

export function computeParametricRange(
  col: ParametricTestColumn | undefined,
): ParametricRange | null {
  if (!col) {
    return null;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const vals = col.values;
  for (let i = 0; i < vals.length; i += 1) {
    const v = vals[i]!;
    if (!Number.isFinite(v)) {
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
}

export function resolveDieFillColor(
  dieIndex: number,
  dies: ColumnarDies,
  colorMode: WaferColorMode,
  failBinRankMap?: ReadonlyMap<number, number>,
  parametricCol?: ParametricTestColumn,
  parametricRange?: ParametricRange | null,
): string {
  if (colorMode === 'pass-fail') {
    return resolvePassFailDieColor(dies.finalPass[dieIndex]!);
  }

  if (colorMode === 'hbin' || colorMode === 'sbin') {
    if (dies.finalPass[dieIndex] !== 0) {
      return COLOR_TOKENS.passDie;
    }
    const code =
      colorMode === 'sbin' ? dies.sbin[dieIndex]! : dies.hbin[dieIndex]!;
    const rank = failBinRankMap?.get(code) ?? 0;
    return getFailBinColor(rank);
  }

  // Parametric magma heatmap mode
  if (!parametricCol || !parametricRange) {
    return COLOR_TOKENS.surface2;
  }
  const val = parametricCol.values[dieIndex]!;
  if (!Number.isFinite(val)) {
    return COLOR_TOKENS.surface2;
  }
  const span = parametricRange.max - parametricRange.min;
  const t = span > 0 ? (val - parametricRange.min) / span : 0.5;
  return sampleMagmaHex(t);
}

/**
 * Minimal structural subset of `CanvasRenderingContext2D` used by the base, fail,
 * and overlay painters so unit tests can verify exact draw calls without DOM globals.
 */
export interface Canvas2DContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  globalAlpha?: number;
  globalCompositeOperation?: GlobalCompositeOperation;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  roundRect?(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | readonly number[],
  ): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  rect(x: number, y: number, w: number, h: number): void;
  setLineDash(segments: number[]): void;
  drawImage?(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

function appendDieToPath(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  size: number,
  radius: number,
): boolean {
  if (typeof ctx.roundRect === 'function' && size >= 3.5 && radius > 0) {
    const clampedR = Math.min(radius, size * 0.45);
    ctx.roundRect(x, y, size, size, clampedR);
    return true;
  }
  ctx.fillRect(x, y, size, size);
  return false;
}

function drawDieRoundedRect(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  size: number,
  radius: number,
): void {
  if (typeof ctx.roundRect === 'function' && size >= 3.5 && radius > 0) {
    const clampedR = Math.min(radius, size * 0.45);
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, clampedR);
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, size, size);
}

/**
 * Clears the canvas and paints ONLY the silicon wafer disc (`#0B0B0C` fill +
 * `1 px` `rgba(255,255,255,0.10)` ring + SEMI V-notch), used as frame 0 of the
 * incremental probe-sweep reveal (`redesign.md` §3.3, §5.1).
 */
export function paintWaferSubstrateOnly(
  ctx: Canvas2DContextLike,
  wafer: WaferSummaryMeta | undefined,
  layout: WaferRenderLayout,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
  if (!wafer) {
    return;
  }

  const notch = computeWaferNotchGeometry(
    layout.centerXCss,
    layout.centerYCss,
    layout.waferRadiusPx,
    wafer.geometry.wfFlat,
  );

  ctx.beginPath();
  ctx.arc(
    layout.centerXCss,
    layout.centerYCss,
    layout.waferRadiusPx,
    notch.arcStartRad,
    notch.arcEndRad,
    false,
  );
  ctx.lineTo(notch.apexX, notch.apexY);
  ctx.closePath();

  ctx.fillStyle = COLOR_TOKENS.waferDisc;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = WAFER_DISC_RING_STROKE;
  ctx.stroke();
}

export interface PaintWaferSweepBatchParams {
  readonly lot: LotModel;
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly probeOrder: Uint32Array;
  readonly startOrderIndex: number;
  readonly endOrderIndex: number;
}

/**
 * Incrementally draws newly revealed dies `probeOrder[startOrderIndex .. endOrderIndex)`
 * onto `BaseCanvas` in pass colour (`#63666C`, `72%` square, `1 px` radius) without clearing
 * previously revealed dies (`redesign.md` §5.1: total O(n) across the sweep).
 */
export function paintWaferSweepBatch(
  ctx: Canvas2DContextLike,
  params: PaintWaferSweepBatchParams,
): void {
  const { lot, layout, dpr, probeOrder, startOrderIndex, endOrderIndex } =
    params;
  const from = Math.max(0, startOrderIndex);
  const to = Math.min(probeOrder.length, endOrderIndex);
  if (to <= from) {
    return;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLOR_TOKENS.passDie;

  const { x: xArr, y: yArr, hasValidCoords: validArr } = lot.dies;
  const passSize = layout.passDieSizePx;
  const passHalf = passSize / 2;
  const useBatchedRoundRect =
    typeof ctx.roundRect === 'function' && passSize >= 3.5;
  const clampedR = Math.min(PASS_DIE_RADIUS_PX, passSize * 0.45);

  if (useBatchedRoundRect) {
    ctx.beginPath();
  }
  let hasAnyPath = false;
  for (let k = from; k < to; k += 1) {
    const i = probeOrder[k]!;
    if (i >= lot.dies.count || validArr[i] === 0) {
      continue;
    }
    const cx =
      layout.centerXCss +
      (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
    const cy =
      layout.centerYCss +
      (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
    if (useBatchedRoundRect) {
      ctx.roundRect!(cx - passHalf, cy - passHalf, passSize, passSize, clampedR);
      hasAnyPath = true;
    } else {
      ctx.fillRect(cx - passHalf, cy - passHalf, passSize, passSize);
    }
  }
  if (useBatchedRoundRect && hasAnyPath) {
    ctx.fill();
  }
}

export interface PaintWaferBaseParams {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly colorMode: WaferColorMode;
  readonly activeTestNum: number | null;
  readonly hiddenBins: ReadonlySet<number>;
}

/**
 * Draws the DPR/supersampled base wafer map layer (`redesign.md` §2.1, §4.7):
 * 1. Silicon wafer disc (`#0B0B0C` fill + `1 px` `rgba(255,255,255,0.10)` ring) + `WF_FLAT` V-notch
 * 2. Pass dies as centred `72%` squares with `1 px` radius (`#63666C`)
 * 3. Fail dies filling the cell minus `1 px` street with `1.5 px` radius (`#FF6B2C` or bin palette)
 * 4. Viewport culling so re-rastering at `scale > 2` draws `10,000` dies in `< 3 ms`.
 */
export function paintWaferBaseLayer(
  ctx: Canvas2DContextLike,
  params: PaintWaferBaseParams,
): void {
  const { lot, waferIndex, layout, dpr, colorMode, activeTestNum, hiddenBins } =
    params;
  const wafer = lot.wafers[waferIndex];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);

  if (!wafer) {
    return;
  }

  // 1. Silicon wafer disc (#0B0B0C) + 1 px ring (rgba(255,255,255,0.10)) + SEMI V-notch
  const notch = computeWaferNotchGeometry(
    layout.centerXCss,
    layout.centerYCss,
    layout.waferRadiusPx,
    wafer.geometry.wfFlat,
  );

  ctx.beginPath();
  ctx.arc(
    layout.centerXCss,
    layout.centerYCss,
    layout.waferRadiusPx,
    notch.arcStartRad,
    notch.arcEndRad,
    false,
  );
  ctx.lineTo(notch.apexX, notch.apexY);
  ctx.closePath();

  ctx.fillStyle = COLOR_TOKENS.waferDisc;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = WAFER_DISC_RING_STROKE;
  ctx.stroke();

  const { dies } = lot;
  const start = wafer.dieStartIndex;
  const end = wafer.dieEndIndex;
  const hasHidden =
    hiddenBins.size > 0 && (colorMode === 'hbin' || colorMode === 'sbin');

  const minCullX = -layout.diePitchPx;
  const maxCullX = layout.cssWidth + layout.diePitchPx;
  const minCullY = -layout.diePitchPx;
  const maxCullY = layout.cssHeight + layout.diePitchPx;

  const xArr = dies.x;
  const yArr = dies.y;
  const validArr = dies.hasValidCoords;
  const passArr = dies.finalPass;
  const passSize = layout.passDieSizePx;
  const passHalf = passSize / 2;
  const failSize = layout.dieSizePx;
  const failHalf = failSize / 2;

  if (colorMode === 'pass-fail') {
    // Pass 1: Passing dies (#63666C), centred 72% square with 1 px radius (batched single fill)
    ctx.fillStyle = COLOR_TOKENS.passDie;
    ctx.beginPath();
    let anyPassPath = false;
    for (let i = start; i < end; i += 1) {
      if (validArr[i] === 0 || passArr[i] === 0) {
        continue;
      }
      const cx =
        layout.centerXCss +
        (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
        continue;
      }
      if (
        appendDieToPath(
          ctx,
          cx - passHalf,
          cy - passHalf,
          passSize,
          PASS_DIE_RADIUS_PX,
        )
      ) {
        anyPassPath = true;
      }
    }
    if (anyPassPath) {
      ctx.fill();
    }

    // Pass 2: Failing dies (#FF6B2C), full cell minus 1 px street with 1.5 px radius (batched single fill)
    ctx.fillStyle = COLOR_TOKENS.failure;
    ctx.beginPath();
    let anyFailPath = false;
    for (let i = start; i < end; i += 1) {
      if (validArr[i] === 0 || passArr[i] !== 0) {
        continue;
      }
      const cx =
        layout.centerXCss +
        (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
        continue;
      }
      if (
        appendDieToPath(
          ctx,
          cx - failHalf,
          cy - failHalf,
          failSize,
          FAIL_DIE_RADIUS_PX,
        )
      ) {
        anyFailPath = true;
      }
    }
    if (anyFailPath) {
      ctx.fill();
    }
    return;
  }

  // Categorical HBIN / SBIN or Parametric modes
  const failRankMap =
    colorMode === 'hbin'
      ? buildFailBinRankMap(dies, 'HBIN')
      : colorMode === 'sbin'
        ? buildFailBinRankMap(dies, 'SBIN')
        : undefined;
  const paramCol =
    colorMode === 'parametric' && activeTestNum !== null
      ? lot.tests.get(activeTestNum)
      : undefined;
  const paramRange =
    colorMode === 'parametric' ? computeParametricRange(paramCol) : null;

  for (let i = start; i < end; i += 1) {
    if (validArr[i] === 0) {
      continue;
    }
    if (hasHidden) {
      const binCode = colorMode === 'hbin' ? dies.hbin[i]! : dies.sbin[i]!;
      if (hiddenBins.has(binCode)) {
        continue;
      }
    }
    const cx =
      layout.centerXCss +
      (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
    const cy =
      layout.centerYCss +
      (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
    if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
      continue;
    }

    const isPassBinMode =
      (colorMode === 'hbin' || colorMode === 'sbin') && passArr[i] !== 0;
    const size = isPassBinMode ? passSize : failSize;
    const half = size / 2;
    const radius = isPassBinMode ? PASS_DIE_RADIUS_PX : FAIL_DIE_RADIUS_PX;

    ctx.fillStyle = resolveDieFillColor(
      i,
      dies,
      colorMode,
      failRankMap,
      paramCol,
      paramRange,
    );
    drawDieRoundedRect(ctx, cx - half, cy - half, size, radius);
  }
}

export interface PaintWaferFailParams {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly colorMode: WaferColorMode;
  readonly hiddenBins: ReadonlySet<number>;
}

/**
 * Draws failing dies only onto `FailCanvas` (`z: 2`), used by the probe-sweep
 * completion fade (`redesign.md` §4.7, §5.1); at rest it is merged into `BaseCanvas` and hidden.
 */
export function paintWaferFailLayer(
  ctx: Canvas2DContextLike,
  params: PaintWaferFailParams,
): void {
  const { lot, waferIndex, layout, dpr, colorMode, hiddenBins } = params;
  const wafer = lot.wafers[waferIndex];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);

  if (!wafer || colorMode === 'parametric') {
    return;
  }

  const { dies } = lot;
  const start = wafer.dieStartIndex;
  const end = wafer.dieEndIndex;
  const hasHidden =
    hiddenBins.size > 0 && (colorMode === 'hbin' || colorMode === 'sbin');
  const failRankMap =
    colorMode === 'hbin'
      ? buildFailBinRankMap(dies, 'HBIN')
      : colorMode === 'sbin'
        ? buildFailBinRankMap(dies, 'SBIN')
        : undefined;

  const failSize = layout.dieSizePx;
  const failHalf = failSize / 2;
  const minCullX = -layout.diePitchPx;
  const maxCullX = layout.cssWidth + layout.diePitchPx;
  const minCullY = -layout.diePitchPx;
  const maxCullY = layout.cssHeight + layout.diePitchPx;

  if (colorMode === 'pass-fail') {
    ctx.fillStyle = COLOR_TOKENS.failure;
    ctx.beginPath();
    let anyFailPath = false;
    for (let i = start; i < end; i += 1) {
      if (dies.hasValidCoords[i] === 0 || dies.finalPass[i] !== 0) {
        continue;
      }
      const cx =
        layout.centerXCss +
        (dies.x[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (dies.y[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
        continue;
      }
      if (
        appendDieToPath(
          ctx,
          cx - failHalf,
          cy - failHalf,
          failSize,
          FAIL_DIE_RADIUS_PX,
        )
      ) {
        anyFailPath = true;
      }
    }
    if (anyFailPath) {
      ctx.fill();
    }
    return;
  }

  for (let i = start; i < end; i += 1) {
    if (dies.hasValidCoords[i] === 0 || dies.finalPass[i] !== 0) {
      continue;
    }
    if (hasHidden) {
      const code = colorMode === 'hbin' ? dies.hbin[i]! : dies.sbin[i]!;
      if (hiddenBins.has(code)) {
        continue;
      }
    }
    const cx =
      layout.centerXCss +
      (dies.x[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
    const cy =
      layout.centerYCss +
      (dies.y[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
    if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
      continue;
    }
    ctx.fillStyle = resolveDieFillColor(i, dies, colorMode, failRankMap);
    drawDieRoundedRect(
      ctx,
      cx - failHalf,
      cy - failHalf,
      failSize,
      FAIL_DIE_RADIUS_PX,
    );
  }
}

let cachedGlowSprite: CanvasImageSource | null | undefined;
let cachedProbeHeadSprite: CanvasImageSource | null | undefined;

function getProbeHeadSprite(): CanvasImageSource | null {
  if (cachedProbeHeadSprite !== undefined) {
    return cachedProbeHeadSprite;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const size = 64;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(214, 230, 255, 0.35)');
      g.addColorStop(0.45, 'rgba(214, 230, 255, 0.14)');
      g.addColorStop(1, 'rgba(214, 230, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      cachedProbeHeadSprite = canvas;
      return cachedProbeHeadSprite;
    }
  }
  cachedProbeHeadSprite = null;
  return null;
}

function getEvidenceGlowSprite(): CanvasImageSource | null {
  if (cachedGlowSprite !== undefined) {
    return cachedGlowSprite;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const size = 64;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
      g.addColorStop(0, 'rgba(214, 230, 255, 0.45)');
      g.addColorStop(0.45, 'rgba(214, 230, 255, 0.18)');
      g.addColorStop(1, 'rgba(214, 230, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      cachedGlowSprite = canvas;
      return cachedGlowSprite;
    }
  }
  cachedGlowSprite = null;
  return null;
}

export interface OverlayGlowSequenceOverride {
  readonly scrimAlpha: number;
  readonly dieIndices: Uint32Array;
  readonly dieAlphas: Float32Array;
  /** Optional outgoing finding fade-out dies (`redesign.md` §5.4 step 7). */
  readonly outgoingIndices?: Uint32Array;
  readonly outgoingAlphas?: Float32Array;
}

export interface PaintWaferOverlayParams {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly overlayHighlightMask: Uint8Array;
  readonly overlayHighlightCount: number;
  readonly hoveredDieIndex: number | null;
  readonly brush: SpatialBrushRect | null;
  /** Optional animated scrim + per-die ordered glow state (`redesign.md` §2.1, §5.4). */
  readonly glowOverride?: OverlayGlowSequenceOverride | null;
  /** Optional screen-space override rect during live Shift+drag or spring-snappy snap (`redesign.md` §3.6, §5.7). */
  readonly liveBrushScreenRect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  /** Optional last-revealed die index for the §5.1 probe-head examination light (3 die widths, 35% alpha). */
  readonly probeHeadDieIndex?: number | null;
}

/**
 * Draws the DPR-scaled screen-space overlay canvas (`dim-scrim` punched out at evidence dies,
 * `#000000` 1px outer keyline + `#D6E6FF` 1.5px evidence stroke + pre-rendered ice glow sprite,
 * `accent-soft` + `1px #D6E6FF` selection rectangle, and hovered die reticle) WITHOUT touching
 * or repainting `BaseCanvas`.
 */
export function paintWaferOverlayLayer(
  ctx: Canvas2DContextLike,
  params: PaintWaferOverlayParams,
): void {
  const {
    lot,
    waferIndex,
    layout,
    dpr,
    overlayHighlightMask,
    overlayHighlightCount,
    hoveredDieIndex,
    brush,
    glowOverride = null,
    liveBrushScreenRect = null,
    probeHeadDieIndex = null,
  } = params;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);

  const wafer = lot.wafers[waferIndex];
  if (!wafer) {
    return;
  }

  const { dies } = lot;
  const start = wafer.dieStartIndex;
  const end = wafer.dieEndIndex;
  const xArr = dies.x;
  const yArr = dies.y;
  const validArr = dies.hasValidCoords;
  const passArr = dies.finalPass;
  const minCullX = -layout.diePitchPx;
  const maxCullX = layout.cssWidth + layout.diePitchPx;
  const minCullY = -layout.diePitchPx;
  const maxCullY = layout.cssHeight + layout.diePitchPx;

  // 0. Finding dim-scrim (`rgba(0, 0, 0, scrimAlpha)`, up to 0.62) punched out at evidence dies (§2.1, §5.4)
  if (glowOverride !== null && glowOverride.scrimAlpha > 0.002) {
    const notch = computeWaferNotchGeometry(
      layout.centerXCss,
      layout.centerYCss,
      layout.waferRadiusPx,
      wafer.geometry.wfFlat,
    );
    ctx.beginPath();
    ctx.arc(
      layout.centerXCss,
      layout.centerYCss,
      layout.waferRadiusPx,
      notch.arcStartRad,
      notch.arcEndRad,
      false,
    );
    ctx.lineTo(notch.apexX, notch.apexY);
    ctx.closePath();
    ctx.fillStyle = `rgba(0, 0, 0, ${glowOverride.scrimAlpha.toFixed(4)})`;
    ctx.fill();

    const evIndices = glowOverride.dieIndices;
    for (let k = 0; k < evIndices.length; k += 1) {
      const i = evIndices[k]!;
      if (i < start || i >= end || validArr[i] === 0) {
        continue;
      }
      const cx =
        layout.centerXCss +
        (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
        continue;
      }
      const size = passArr[i] !== 0 ? layout.passDieSizePx : layout.dieSizePx;
      const half = size / 2;
      ctx.clearRect(cx - half - 0.5, cy - half - 0.5, size + 1, size + 1);
    }
  }

  // 1. Evidence glow + 1 px #000000 keyline + 1.5 px #D6E6FF stroke (§2.1, §5.4)
  const glowSprite = getEvidenceGlowSprite();

  const paintGlowSubset = (
    indices: Uint32Array,
    alphas: Float32Array,
  ): void => {
    const keylineW = layout.diePitchPx >= 6 ? 3 : 2.25;
    const strokeW = layout.diePitchPx >= 6 ? 1.5 : 1;
    const haloW = Math.min(4.5, Math.max(2.75, layout.diePitchPx * 0.26));
    const canSprite = glowSprite !== null && typeof ctx.drawImage === 'function';

    ctx.setLineDash([]);
    ctx.lineJoin = 'round';

    if (canSprite && glowSprite) {
      ctx.globalCompositeOperation = 'lighter';
      for (let r = 0; r < indices.length; r += 1) {
        const a = alphas[r]!;
        if (a <= 0.005) continue;
        const i = indices[r]!;
        if (i < start || i >= end || validArr[i] === 0) continue;
        const cx =
          layout.centerXCss +
          (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
        const cy =
          layout.centerYCss +
          (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
        if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
          continue;
        }
        const size = passArr[i] !== 0 ? layout.passDieSizePx : layout.dieSizePx;
        const spriteSpan = size + 12;
        ctx.globalAlpha = a;
        ctx.drawImage!(
          glowSprite,
          cx - spriteSpan / 2,
          cy - spriteSpan / 2,
          spriteSpan,
          spriteSpan,
        );
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // Batch all fully-settled dies (alpha >= 0.999) into one path, and draw partial-alpha dies individually
    ctx.beginPath();
    let anyFullVisible = false;
    for (let r = 0; r < indices.length; r += 1) {
      if (alphas[r]! < 0.999) continue;
      const i = indices[r]!;
      if (i < start || i >= end || validArr[i] === 0) continue;
      const cx =
        layout.centerXCss +
        (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
        continue;
      }
      anyFullVisible = true;
      const size = passArr[i] !== 0 ? layout.passDieSizePx : layout.dieSizePx;
      const half = size / 2;
      ctx.rect(cx - half, cy - half, size, size);
    }
    if (anyFullVisible) {
      ctx.globalAlpha = 1;
      if (!canSprite) {
        ctx.strokeStyle = OVERLAY_HALO_STROKE;
        ctx.lineWidth = haloW;
        ctx.stroke();
      }
      ctx.strokeStyle = OVERLAY_KEYLINE_STROKE;
      ctx.lineWidth = keylineW;
      ctx.stroke();
      ctx.strokeStyle = COLOR_TOKENS.accent;
      ctx.lineWidth = strokeW;
      ctx.stroke();
    }

    for (let r = 0; r < indices.length; r += 1) {
      const a = alphas[r]!;
      if (a <= 0.005 || a >= 0.999) continue;
      const i = indices[r]!;
      if (i < start || i >= end || validArr[i] === 0) continue;
      const cx =
        layout.centerXCss +
        (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
        continue;
      }
      const size = passArr[i] !== 0 ? layout.passDieSizePx : layout.dieSizePx;
      const half = size / 2;
      ctx.globalAlpha = a;
      if (!canSprite) {
        ctx.strokeStyle = OVERLAY_HALO_STROKE;
        ctx.lineWidth = haloW;
        ctx.strokeRect(cx - half, cy - half, size, size);
      }
      ctx.strokeStyle = OVERLAY_KEYLINE_STROKE;
      ctx.lineWidth = keylineW;
      ctx.strokeRect(cx - half, cy - half, size, size);
      ctx.strokeStyle = COLOR_TOKENS.accent;
      ctx.lineWidth = strokeW;
      ctx.strokeRect(cx - half, cy - half, size, size);
    }
    ctx.globalAlpha = 1;
  };

  if (glowOverride !== null) {
    if (
      glowOverride.outgoingIndices &&
      glowOverride.outgoingAlphas &&
      glowOverride.outgoingIndices.length > 0
    ) {
      paintGlowSubset(glowOverride.outgoingIndices, glowOverride.outgoingAlphas);
    }
    if (glowOverride.dieIndices.length > 0) {
      paintGlowSubset(glowOverride.dieIndices, glowOverride.dieAlphas);
    }
  } else if (overlayHighlightCount > 0 && overlayHighlightMask.length >= end) {
    let anyOnWafer = false;
    ctx.beginPath();
    for (let i = start; i < end; i += 1) {
      if (overlayHighlightMask[i] === 0 || validArr[i] === 0) {
        continue;
      }
      const cx =
        layout.centerXCss +
        (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      if (cx < minCullX || cx > maxCullX || cy < minCullY || cy > maxCullY) {
        continue;
      }
      anyOnWafer = true;
      const size = passArr[i] !== 0 ? layout.passDieSizePx : layout.dieSizePx;
      const half = size / 2;
      ctx.rect(cx - half, cy - half, size, size);
    }

    if (anyOnWafer) {
      ctx.setLineDash([]);
      ctx.lineJoin = 'round';

      ctx.strokeStyle = OVERLAY_HALO_STROKE;
      ctx.lineWidth = Math.min(4.5, Math.max(2.75, layout.diePitchPx * 0.26));
      ctx.stroke();

      ctx.strokeStyle = OVERLAY_KEYLINE_STROKE;
      ctx.lineWidth = layout.diePitchPx >= 6 ? 3 : 2.25;
      ctx.stroke();

      ctx.strokeStyle = COLOR_TOKENS.accent;
      ctx.lineWidth = layout.diePitchPx >= 6 ? 1.5 : 1;
      ctx.stroke();
    }
  }

  // 2. Active or live spatial brush rectangle: 1 px ice accent stroke + accent-soft fill (§3.6)
  const resolvedBrushRect =
    liveBrushScreenRect ??
    (brush !== null &&
    (brush.scope === 'stacked' ||
      brush.waferIndex === undefined ||
      brush.waferIndex === waferIndex)
      ? projectBrushToCanvasRect(brush, layout)
      : null);

  if (
    resolvedBrushRect !== null &&
    resolvedBrushRect.width > 0.5 &&
    resolvedBrushRect.height > 0.5
  ) {
    ctx.setLineDash([]);
    ctx.fillStyle = COLOR_TOKENS.accentSoft;
    ctx.fillRect(
      resolvedBrushRect.x,
      resolvedBrushRect.y,
      resolvedBrushRect.width,
      resolvedBrushRect.height,
    );
    ctx.strokeStyle = COLOR_TOKENS.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      resolvedBrushRect.x,
      resolvedBrushRect.y,
      resolvedBrushRect.width,
      resolvedBrushRect.height,
    );
  }

  // 3. Hovered die crisp reticle on active wafer
  if (
    hoveredDieIndex !== null &&
    hoveredDieIndex >= start &&
    hoveredDieIndex < end &&
    dies.hasValidCoords[hoveredDieIndex] !== 0
  ) {
    const isPass = dies.finalPass[hoveredDieIndex] !== 0;
    const size = isPass ? layout.passDieSizePx : layout.dieSizePx;
    const cx =
      layout.centerXCss +
      (dies.x[hoveredDieIndex]! - layout.gridCenterX) *
        layout.dirX *
        layout.diePitchPx;
    const cy =
      layout.centerYCss +
      (dies.y[hoveredDieIndex]! - layout.gridCenterY) *
        layout.dirY *
        layout.diePitchPx;
    const half = size / 2;
    ctx.setLineDash([]);
    ctx.strokeStyle = OVERLAY_HOVER_STROKE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - half - 0.5, cy - half - 0.5, size + 1, size + 1);
  }

  // 4. Probe-sweep examination lamp at the last revealed die (3 die widths, 35% ice alpha, §5.1)
  if (
    probeHeadDieIndex !== null &&
    probeHeadDieIndex >= start &&
    probeHeadDieIndex < end &&
    dies.hasValidCoords[probeHeadDieIndex] !== 0
  ) {
    const cx =
      layout.centerXCss +
      (dies.x[probeHeadDieIndex]! - layout.gridCenterX) *
        layout.dirX *
        layout.diePitchPx;
    const cy =
      layout.centerYCss +
      (dies.y[probeHeadDieIndex]! - layout.gridCenterY) *
        layout.dirY *
        layout.diePitchPx;
    const diameter = Math.max(12, layout.diePitchPx * 3);
    const probeSprite = getProbeHeadSprite();
    if (probeSprite !== null && typeof ctx.drawImage === 'function') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      ctx.drawImage(
        probeSprite,
        cx - diameter / 2,
        cy - diameter / 2,
        diameter,
        diameter,
      );
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2, false);
      ctx.fillStyle = 'rgba(214, 230, 255, 0.35)';
      ctx.fill();
    }
  }
}

export interface PaintWaferThumbnailParams {
  readonly wafer: WaferSummaryMeta;
  readonly dies: ColumnarDies;
  readonly cssSize: number;
  readonly dpr: number;
}

/**
 * Draws a compact Pass/Fail wafer thumbnail (`~36-48 px` CSS) for the horizontal
 * lot strip using locked colour tokens (`#63666C` pass, `#FF6B2C` fail, `#0B0B0C`
 * silicon substrate) and `WCR` orientation.
 */
export function paintWaferThumbnail(
  ctx: Canvas2DContextLike,
  params: PaintWaferThumbnailParams,
): void {
  const { wafer, dies, cssSize, dpr } = params;
  const safeSize = Number.isFinite(cssSize) && cssSize > 0 ? cssSize : 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, safeSize, safeSize);

  const center = safeSize / 2;
  const radiusPx = Math.max(4, center - 1.25);

  let notchAngleRad = Math.PI / 2;
  if (wafer.geometry.wfFlat === 'U') {
    notchAngleRad = -Math.PI / 2;
  } else if (wafer.geometry.wfFlat === 'L') {
    notchAngleRad = Math.PI;
  } else if (wafer.geometry.wfFlat === 'R') {
    notchAngleRad = 0;
  }
  const depthPx = Math.max(1.8, Math.min(3.2, radiusPx * 0.11));
  const halfAngleRad = 0.12;
  const apexRadius = Math.max(0, radiusPx - depthPx);

  ctx.beginPath();
  ctx.arc(
    center,
    center,
    radiusPx,
    notchAngleRad + halfAngleRad,
    notchAngleRad - halfAngleRad + Math.PI * 2,
    false,
  );
  ctx.lineTo(
    center + Math.cos(notchAngleRad) * apexRadius,
    center + Math.sin(notchAngleRad) * apexRadius,
  );
  ctx.closePath();

  ctx.fillStyle = COLOR_TOKENS.waferDisc;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = WAFER_DISC_RING_STROKE;
  ctx.stroke();

  const waferRadiusUnits = computeWaferRadiusUnits(wafer, dies);
  const diePitchPx = radiusPx / waferRadiusUnits;
  const gridCenterX = (wafer.minX + wafer.maxX) / 2;
  const gridCenterY = (wafer.minY + wafer.maxY) / 2;
  const dirX: 1 | -1 = wafer.geometry.posX === 'L' ? -1 : 1;
  const dirY: 1 | -1 = wafer.geometry.posY === 'D' ? 1 : -1;

  const xArr = dies.x;
  const yArr = dies.y;
  const validArr = dies.hasValidCoords;
  const passArr = dies.finalPass;
  const start = wafer.dieStartIndex;
  const end = wafer.dieEndIndex;

  // Pass 1: Passing dies (#63666C)
  const passSize = Math.max(0.95, diePitchPx * 0.82);
  const passHalf = passSize / 2;
  ctx.fillStyle = COLOR_TOKENS.passDie;
  for (let i = start; i < end; i += 1) {
    if (validArr[i] === 0 || passArr[i] === 0) {
      continue;
    }
    const cx = center + (xArr[i]! - gridCenterX) * dirX * diePitchPx;
    const cy = center + (yArr[i]! - gridCenterY) * dirY * diePitchPx;
    ctx.fillRect(cx - passHalf, cy - passHalf, passSize, passSize);
  }

  // Pass 2: Failing dies (#FF6B2C) painted over pass cells for sub-2 px pattern legibility
  const failSize = Math.max(1.15, diePitchPx * 1.04);
  const failHalf = failSize / 2;
  ctx.fillStyle = COLOR_TOKENS.failure;
  for (let i = start; i < end; i += 1) {
    if (validArr[i] === 0 || passArr[i] !== 0) {
      continue;
    }
    const cx = center + (xArr[i]! - gridCenterX) * dirX * diePitchPx;
    const cy = center + (yArr[i]! - gridCenterY) * dirY * diePitchPx;
    ctx.fillRect(cx - failHalf, cy - failHalf, failSize, failSize);
  }
}

/**
 * Draws the `168 px` landing demo card wafer (`redesign.md` §3.1, §2.1):
 * - Silicon disc `#0B0B0C` fill + `1 px` `rgba(255, 255, 255, 0.10)` ring + SEMI V-notch
 * - Pass dies as centred `72%` `#63666C` squares; fail dies as full-cell minus `1 px` street in `#FF6B2C`
 */
export function paintLandingCardWafer(
  ctx: Canvas2DContextLike,
  params: PaintWaferThumbnailParams,
): void {
  const { wafer, dies, cssSize, dpr } = params;
  const safeSize = Number.isFinite(cssSize) && cssSize > 0 ? cssSize : 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, safeSize, safeSize);

  const center = safeSize / 2;
  const radiusPx = Math.max(8, center - 1.5);
  const notch = computeWaferNotchGeometry(
    center,
    center,
    radiusPx,
    wafer.geometry.wfFlat,
  );

  ctx.beginPath();
  ctx.arc(
    center,
    center,
    radiusPx,
    notch.arcStartRad,
    notch.arcEndRad,
    false,
  );
  ctx.lineTo(notch.apexX, notch.apexY);
  ctx.closePath();

  ctx.fillStyle = COLOR_TOKENS.waferDisc;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = WAFER_DISC_RING_STROKE;
  ctx.stroke();

  const waferRadiusUnits = computeWaferRadiusUnits(wafer, dies);
  const diePitchPx = radiusPx / waferRadiusUnits;
  const gridCenterX = (wafer.minX + wafer.maxX) / 2;
  const gridCenterY = (wafer.minY + wafer.maxY) / 2;
  const dirX: 1 | -1 = wafer.geometry.posX === 'L' ? -1 : 1;
  const dirY: 1 | -1 = wafer.geometry.posY === 'D' ? 1 : -1;

  const xArr = dies.x;
  const yArr = dies.y;
  const validArr = dies.hasValidCoords;
  const passArr = dies.finalPass;
  const start = wafer.dieStartIndex;
  const end = wafer.dieEndIndex;

  // Pass 1: Passing dies (#63666C) centred square at 72% of cell (§2.1)
  const passSize = Math.max(1.2, diePitchPx * PASS_DIE_CELL_FRACTION);
  const passHalf = passSize / 2;
  ctx.fillStyle = COLOR_TOKENS.passDie;
  for (let i = start; i < end; i += 1) {
    if (validArr[i] === 0 || passArr[i] === 0) {
      continue;
    }
    const cx = center + (xArr[i]! - gridCenterX) * dirX * diePitchPx;
    const cy = center + (yArr[i]! - gridCenterY) * dirY * diePitchPx;
    ctx.fillRect(cx - passHalf, cy - passHalf, passSize, passSize);
  }

  // Pass 2: Failing dies (#FF6B2C) filling cell minus 1 px street (§2.1)
  const streetPx = Math.min(1, diePitchPx * 0.18);
  const failSize = Math.max(1.6, diePitchPx - streetPx);
  const failHalf = failSize / 2;
  ctx.fillStyle = COLOR_TOKENS.failure;
  for (let i = start; i < end; i += 1) {
    if (validArr[i] === 0 || passArr[i] !== 0) {
      continue;
    }
    const cx = center + (xArr[i]! - gridCenterX) * dirX * diePitchPx;
    const cy = center + (yArr[i]! - gridCenterY) * dirY * diePitchPx;
    ctx.fillRect(cx - failHalf, cy - failHalf, failSize, failSize);
  }
}
