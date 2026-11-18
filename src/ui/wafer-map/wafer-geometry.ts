/**
 * Pure Wafer Map Geometry, WCR Orientation, Color Mapping, and Two-Layer
 * Canvas2D Painters (`src/ui/wafer-map/wafer-geometry.ts`).
 *
 * Kept free of React and browser global reads so every coordinate transform,
 * DPR backing-store calculation, 1 px street inset, fail micro-dot threshold,
 * wafer rim + V-notch path, O(1) pointer hit-test, and two-layer draw pass is
 * directly unit-testable in Node.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 14.2, 15.4, 17.1
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

/** `redesign.md` §2.1: `#000000` street border width around every die. */
export const WAFER_STREET_WIDTH_PX = 1 as const;

/** `design.md` Resolved Decision: failing dies draw a center micro-dot when `diePitchPx >= 7`. */
export const FAIL_MICRO_DOT_MIN_PITCH_PX = 7 as const;

/** Extra radial margin (in die pitches) between outermost die corner and wafer bevel rim. */
const WAFER_RIM_CLEARANCE_UNITS = 0.55;

/** Subtle ice outer halo stroke paired with crisp `#D6E6FF` inner outline. */
export const OVERLAY_HALO_STROKE = 'rgba(214, 230, 255, 0.28)' as const;
export const OVERLAY_HOVER_STROKE = 'rgba(255, 255, 255, 0.92)' as const;
export const WAFER_OUTLINE_STROKE = 'rgba(255, 255, 255, 0.14)' as const;
export const WAFER_EXCLUSION_RING_STROKE = 'rgba(255, 255, 255, 0.04)' as const;

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

export interface WaferRenderLayout {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly centerXCss: number;
  readonly centerYCss: number;
  readonly waferRadiusPx: number;
  readonly waferRadiusUnits: number;
  readonly diePitchPx: number;
  readonly streetPx: number;
  readonly dieSizePx: number;
  readonly drawFailMicroDot: boolean;
  readonly microDotSizePx: number;
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
 * Returns whether failing dies should render their inner `#0A0A0B` center micro-dot
 * for WCAG 2.2 SC 1.4.1 / 1.4.11 non-color differentiation (`diePitchPx >= 7`).
 */
export function shouldDrawFailMicroDot(diePitchPx: number): boolean {
  return Number.isFinite(diePitchPx) && diePitchPx >= FAIL_MICRO_DOT_MIN_PITCH_PX;
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
      const dx = Math.abs(dies.x[i] - gridCenterX) + 0.5;
      const dy = Math.abs(dies.y[i] - gridCenterY) + 0.5;
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
 * Computes deterministic coordinate-to-canvas geometry respecting `WCR` orientation
 * (`POS_X`, `POS_Y`), `1 px` street insets, micro-dot rules, and `ViewportTransform`.
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
  const paddingCss = Math.max(6, Math.round(minDim * 0.02));
  const baseRadiusPx = Math.max(12, minDim / 2 - paddingCss);

  const clampedScale =
    Number.isFinite(transform.scale) && transform.scale > 0
      ? Math.min(24, Math.max(0.25, transform.scale))
      : 1;
  const panX = Number.isFinite(transform.panX) ? transform.panX : 0;
  const panY = Number.isFinite(transform.panY) ? transform.panY : 0;

  const waferRadiusUnits = computeWaferRadiusUnits(wafer, dies);
  const waferRadiusPx = baseRadiusPx * clampedScale;
  const diePitchPx = waferRadiusPx / waferRadiusUnits;

  const streetPx =
    diePitchPx >= 3
      ? WAFER_STREET_WIDTH_PX
      : Math.max(0, Math.min(WAFER_STREET_WIDTH_PX, diePitchPx * 0.2));
  const dieSizePx = Math.max(0.75, diePitchPx - streetPx);

  const drawFailMicroDot = shouldDrawFailMicroDot(diePitchPx);
  const microDotSizePx = drawFailMicroDot
    ? Math.max(1.5, Math.min(4, Math.round(diePitchPx * 0.18 * 2) / 2))
    : 0;

  const gridCenterX = (wafer.minX + wafer.maxX) / 2;
  const gridCenterY = (wafer.minY + wafer.maxY) / 2;

  const dirX: 1 | -1 = wafer.geometry.posX === 'L' ? -1 : 1;
  const dirY: 1 | -1 = wafer.geometry.posY === 'D' ? 1 : -1;

  return {
    cssWidth: safeW,
    cssHeight: safeH,
    centerXCss: safeW / 2 + panX,
    centerYCss: safeH / 2 + panY,
    waferRadiusPx,
    waferRadiusUnits,
    diePitchPx,
    streetPx,
    dieSizePx,
    drawFailMicroDot,
    microDotSizePx,
    gridCenterX,
    gridCenterY,
    dirX,
    dirY,
  };
}

/**
 * Projects integer die coordinates `(x, y)` to a logical CSS-pixel die rectangle
 * surrounded by a `streetPx` (`1 px`) `#0A0A0B` street border.
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
  const counts = new Map<number, number>();
  const binArr = mode === 'SBIN' ? dies.sbin : dies.hbin;
  for (let i = 0; i < dies.count; i += 1) {
    if (dies.finalPass[i] !== 0) {
      continue;
    }
    const code = binArr[i];
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] - b[0];
  });
  const rankByCode = new Map<number, number>();
  for (let r = 0; r < sorted.length; r += 1) {
    rankByCode.set(sorted[r][0], r);
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
    const v = vals[i];
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
    return resolvePassFailDieColor(dies.finalPass[dieIndex]);
  }

  if (colorMode === 'hbin' || colorMode === 'sbin') {
    if (dies.finalPass[dieIndex] !== 0) {
      return COLOR_TOKENS.passDie;
    }
    const code =
      colorMode === 'sbin' ? dies.sbin[dieIndex] : dies.hbin[dieIndex];
    const rank = failBinRankMap?.get(code) ?? 0;
    return getFailBinColor(rank);
  }

  // Parametric magma heatmap mode
  if (!parametricCol || !parametricRange) {
    return COLOR_TOKENS.raised;
  }
  const val = parametricCol.values[dieIndex];
  if (!Number.isFinite(val)) {
    return COLOR_TOKENS.raised;
  }
  const span = parametricRange.max - parametricRange.min;
  const t = span > 0 ? (val - parametricRange.min) / span : 0.5;
  return sampleMagmaHex(t);
}

/**
 * Minimal structural subset of `CanvasRenderingContext2D` used by the base and
 * overlay painters so unit tests can verify exact draw calls without DOM globals.
 */
export interface Canvas2DContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
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
 * Draws the DPR-scaled base wafer map layer:
 * 1. Subtle wafer substrate circle + `WF_FLAT` V-notch + inner bevel guide
 * 2. Coordinate-bearing dies (`!== -32768`) with `1 px` `#000000` streets
 * 3. `#000000` center micro-dot on failing dies when `diePitchPx >= 7`
 *
 * Batches `Pass/Fail` mode into at most three `fillStyle` passes (`#63666C`,
 * `#FF6B2C`, `#000000` micro-dots) so `10,000` dies draw in `< 2 ms`.
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

  // 1. Wafer boundary disc + subtle orientation V-notch
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

  ctx.fillStyle = COLOR_TOKENS.waferStreet;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = WAFER_OUTLINE_STROKE;
  ctx.stroke();

  if (layout.waferRadiusPx > 24) {
    ctx.beginPath();
    ctx.arc(
      layout.centerXCss,
      layout.centerYCss,
      layout.waferRadiusPx - 3.5,
      0,
      Math.PI * 2,
      false,
    );
    ctx.strokeStyle = WAFER_EXCLUSION_RING_STROKE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const { dies } = lot;
  const start = wafer.dieStartIndex;
  const end = wafer.dieEndIndex;
  const hasHidden = hiddenBins.size > 0;

  // Fast batched Pass/Fail path (zero per-die string allocations)
  if (colorMode === 'pass-fail') {
    const xArr = dies.x;
    const yArr = dies.y;
    const validArr = dies.hasValidCoords;
    const passArr = dies.finalPass;
    const sbinArr = dies.sbin;
    const half = layout.dieSizePx / 2;
    const dieSize = layout.dieSizePx;

    // Pass 1: Passing dies (#63666C)
    ctx.fillStyle = COLOR_TOKENS.passDie;
    for (let i = start; i < end; i += 1) {
      if (validArr[i] === 0 || passArr[i] === 0) {
        continue;
      }
      if (hasHidden && hiddenBins.has(sbinArr[i])) {
        continue;
      }
      const cx =
        layout.centerXCss +
        (xArr[i] - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i] - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      ctx.fillRect(cx - half, cy - half, dieSize, dieSize);
    }

    // Pass 2: Failing dies (#FF6B2C)
    ctx.fillStyle = COLOR_TOKENS.failure;
    for (let i = start; i < end; i += 1) {
      if (validArr[i] === 0 || passArr[i] !== 0) {
        continue;
      }
      if (hasHidden && hiddenBins.has(sbinArr[i])) {
        continue;
      }
      const cx =
        layout.centerXCss +
        (xArr[i] - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i] - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      ctx.fillRect(cx - half, cy - half, dieSize, dieSize);
    }

    // Pass 3: Failing-die center micro-dots (#000000) when diePitchPx >= 7
    if (layout.drawFailMicroDot && layout.microDotSizePx > 0) {
      const dotSize = layout.microDotSizePx;
      const dotHalf = dotSize / 2;
      ctx.fillStyle = COLOR_TOKENS.waferStreet;
      for (let i = start; i < end; i += 1) {
        if (validArr[i] === 0 || passArr[i] !== 0) {
          continue;
        }
        if (hasHidden && hiddenBins.has(sbinArr[i])) {
          continue;
        }
        const cx =
          layout.centerXCss +
          (xArr[i] - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
        const cy =
          layout.centerYCss +
          (yArr[i] - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
        ctx.fillRect(cx - dotHalf, cy - dotHalf, dotSize, dotSize);
      }
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
    if (dies.hasValidCoords[i] === 0) {
      continue;
    }
    if (hasHidden) {
      const binCode = colorMode === 'hbin' ? dies.hbin[i] : dies.sbin[i];
      if (hiddenBins.has(binCode)) {
        continue;
      }
    }
    const rect = dieCoordToCanvasRect(dies.x[i], dies.y[i], layout);
    ctx.fillStyle = resolveDieFillColor(
      i,
      dies,
      colorMode,
      failRankMap,
      paramCol,
      paramRange,
    );
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    if (
      colorMode !== 'parametric' &&
      dies.finalPass[i] === 0 &&
      layout.drawFailMicroDot &&
      layout.microDotSizePx > 0
    ) {
      const dotHalf = layout.microDotSizePx / 2;
      ctx.fillStyle = COLOR_TOKENS.waferStreet;
      ctx.fillRect(
        rect.centerX - dotHalf,
        rect.centerY - dotHalf,
        layout.microDotSizePx,
        layout.microDotSizePx,
      );
    }
  }
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
}

/**
 * Draws the DPR-scaled overlay canvas (`#D6E6FF` selection / site / claim
 * outlines + outer glow, spatial brush bounds, and hovered die reticle)
 * WITHOUT touching or repainting `BaseCanvas`.
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

  // 1. Batched #D6E6FF evidence/selection outer glow + crisp inner outline (never a fill)
  if (overlayHighlightCount > 0 && overlayHighlightMask.length >= end) {
    const xArr = dies.x;
    const yArr = dies.y;
    const validArr = dies.hasValidCoords;
    const half = layout.dieSizePx / 2;
    const dieSize = layout.dieSizePx;

    let anyOnWafer = false;
    ctx.beginPath();
    for (let i = start; i < end; i += 1) {
      if (overlayHighlightMask[i] === 0 || validArr[i] === 0) {
        continue;
      }
      anyOnWafer = true;
      const cx =
        layout.centerXCss +
        (xArr[i] - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
      const cy =
        layout.centerYCss +
        (yArr[i] - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
      ctx.rect(cx - half, cy - half, dieSize, dieSize);
    }

    if (anyOnWafer) {
      ctx.setLineDash([]);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = OVERLAY_HALO_STROKE;
      ctx.lineWidth = Math.min(4, Math.max(2.5, layout.diePitchPx * 0.24));
      ctx.stroke();

      ctx.strokeStyle = COLOR_TOKENS.accent;
      ctx.lineWidth = layout.diePitchPx >= 6 ? 1.5 : 1;
      ctx.stroke();
    }
  }

  // 2. Active spatial brush rectangle (when brushed on this wafer or stacked)
  if (
    brush !== null &&
    (brush.scope === 'stacked' ||
      brush.waferIndex === undefined ||
      brush.waferIndex === waferIndex)
  ) {
    const bRect = projectBrushToCanvasRect(brush, layout);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = COLOR_TOKENS.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bRect.x, bRect.y, bRect.width, bRect.height);
    ctx.setLineDash([]);
  }

  // 3. Hovered die crisp reticle on active wafer
  if (
    hoveredDieIndex !== null &&
    hoveredDieIndex >= start &&
    hoveredDieIndex < end &&
    dies.hasValidCoords[hoveredDieIndex] !== 0
  ) {
    const hRect = dieCoordToCanvasRect(
      dies.x[hoveredDieIndex],
      dies.y[hoveredDieIndex],
      layout,
    );
    ctx.setLineDash([]);
    ctx.strokeStyle = OVERLAY_HOVER_STROKE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      hRect.x - 0.5,
      hRect.y - 0.5,
      hRect.width + 1,
      hRect.height + 1,
    );
  }
}

export interface PaintWaferThumbnailParams {
  readonly wafer: WaferSummaryMeta;
  readonly dies: ColumnarDies;
  readonly cssSize: number;
  readonly dpr: number;
}

/**
 * Draws a compact Pass/Fail wafer thumbnail (`~36-44 px` CSS) for the horizontal
 * lot strip using locked colour tokens (`#63666C` pass, `#FF6B2C` fail, `#000000`
 * substrate) and `WCR` orientation. Failing dies paint in a dedicated second pass
 * so repeating spatial signatures (edge rings, scratches, site checkerboards) remain
 * immediately scannable across 25+ wafers.
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

  ctx.fillStyle = COLOR_TOKENS.waferStreet;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = WAFER_OUTLINE_STROKE;
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
  const passSize = Math.max(0.95, diePitchPx * 0.94);
  const passHalf = passSize / 2;
  ctx.fillStyle = COLOR_TOKENS.passDie;
  for (let i = start; i < end; i += 1) {
    if (validArr[i] === 0 || passArr[i] === 0) {
      continue;
    }
    const cx = center + (xArr[i] - gridCenterX) * dirX * diePitchPx;
    const cy = center + (yArr[i] - gridCenterY) * dirY * diePitchPx;
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
    const cx = center + (xArr[i] - gridCenterX) * dirX * diePitchPx;
    const cy = center + (yArr[i] - gridCenterY) * dirY * diePitchPx;
    ctx.fillRect(cx - failHalf, cy - failHalf, failSize, failSize);
  }
}
