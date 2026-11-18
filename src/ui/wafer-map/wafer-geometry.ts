/**
 * Pure Wafer Map Geometry, WCR Orientation, Color Mapping, and Three-Layer
 * Canvas2D Painters (`src/ui/wafer-map/wafer-geometry.ts`).
 *
 * Kept free of React and browser global reads so every coordinate transform,
 * DPR/supersampled backing-store calculation, §2.1 pass/fail geometry cue
 * (premium §5.3: 80 % pass tile vs full cell minus street fail die with facet),
 * premium §5.2 silicon disc material + V-notch path, O(1) pointer hit-test, and
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
  WAFER_TOKENS,
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

/** `premium.md` §5.3: pass dies are centred squares at 80 % of the fail-die side. */
export const PASS_DIE_CELL_FRACTION = 0.8 as const;

/** `premium.md` §5.3: thumbnails below this pitch omit pass tiles and draw fail dies at full cell. */
export const THUMBNAIL_DENSE_PITCH_PX = 3 as const;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `premium.md` §5.3: street `max(1 device px, round(0.10 p))` in CSS px. */
export function computeDieStreetPx(diePitchPx: number, deviceDpr = 1): number {
  const devicePx = 1 / (Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1);
  const pitch = Number.isFinite(diePitchPx) && diePitchPx > 0 ? diePitchPx : 0;
  return Math.max(devicePx, Math.round(0.1 * pitch));
}

/** `premium.md` §5.3: fail die corner radius `clamp(0.5, 0.12 p, 2)` px. */
export function computeFailDieRadiusPx(diePitchPx: number): number {
  return clampNumber(0.12 * diePitchPx, 0.5, 2);
}

/** `premium.md` §5.3: pass die corner radius `clamp(0.5, 0.10 p, 1.5)` px. */
export function computePassDieRadiusPx(diePitchPx: number): number {
  return clampNumber(0.1 * diePitchPx, 0.5, 1.5);
}

/** `premium.md` §5.3: fail facet is drawn only when the pitch is at least 10 css px. */
export function shouldDrawFailFacet(diePitchPx: number): boolean {
  return (
    Number.isFinite(diePitchPx) &&
    diePitchPx >= WAFER_TOKENS.failFacetMinPitchPx
  );
}

/** `premium.md` §5.3: `pass-tile`, or `pass-tile-hc` under `prefers-contrast: more`. */
export function resolvePassTileColor(highContrast = false): string {
  return highContrast ? WAFER_TOKENS.passTileHc : WAFER_TOKENS.passTile;
}

/** `redesign.md` §4.7: Supersampled base canvas cap per side (`devicePixelRatio x 2`, max `4096 px`). */
export const MAX_SUPERSAMPLED_CANVAS_PX = 4096 as const;

/** Extra radial margin (in die pitches) between outermost die corner and wafer bevel rim. */
const WAFER_RIM_CLEARANCE_UNITS = 0.55;

/** `premium.md` §5.2 step 1: notch opening width, depth, and apex rounding as fractions of `D`. */
export const WAFER_NOTCH_OPENING_D = 0.03 as const;
export const WAFER_NOTCH_DEPTH_D = 0.016 as const;
export const WAFER_NOTCH_APEX_RADIUS_D = 0.002 as const;

/** `premium.md` §5.2 step 4: edge-exclusion ring sits at `R - 0.026 D`. */
export const WAFER_EXCLUSION_INSET_D = 0.026 as const;

/** Edge-exclusion radius in px for a disc of radius `waferRadiusPx` (`R - 0.026 D`). */
export function computeWaferExclusionRadiusPx(waferRadiusPx: number): number {
  return waferRadiusPx * (1 - 2 * WAFER_EXCLUSION_INSET_D);
}

/** `redesign.md` §2.1: Silicon disc `1 px` ring (`rgba(255, 255, 255, 0.10)`). */
export const WAFER_DISC_RING_STROKE = 'rgba(255, 255, 255, 0.10)' as const;

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
  /** Fail die corner radius (`clamp(0.5, 0.12 p, 2)`, premium §5.3). */
  readonly failDieRadiusPx: number;
  /** Pass die corner radius (`clamp(0.5, 0.10 p, 1.5)`, premium §5.3). */
  readonly passDieRadiusPx: number;
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
  /** Apex rounding radius (`0.002 D`, premium §5.2 step 1). */
  readonly apexRoundRadiusPx: number;
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

  // Every cell corner stays inside the `R - 0.026 D` edge-exclusion ring (premium §5.2 step 4)
  return Math.max(
    1.5,
    maxCornerDist + WAFER_RIM_CLEARANCE_UNITS,
    maxCornerDist / (1 - 2 * WAFER_EXCLUSION_INSET_D),
  );
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
 * Fit wafer diameter for a stage of `cssWidth x cssHeight` CSS px:
 * - Desktop wafer area (non-square, premium §6.2): `D = clamp(320, min(areaW - 96, areaH - 48), 680)`
 *   (`783 x 644` -> 596 at 1440 x 900, `690 x 544` -> 496 at 1280 x 800).
 * - Square sm stages (`576–655`, the 640 px column at 640–1023): `D = min(560, vw − 64)` = 560.
 * - Other square stages (xs) and areas too small for the 320 px floor keep the
 *   `resolveStageMarginPx` ramp (`390 x 390` -> 350).
 */
export function resolveFitWaferDiameterPx(
  cssWidth: number,
  cssHeight: number,
): number {
  const minDim = Math.min(cssWidth, cssHeight);
  const areaFit = Math.min(cssWidth - 96, cssHeight - 48);
  if (Math.abs(cssWidth - cssHeight) > 1 && areaFit >= 320) {
    return Math.min(680, areaFit);
  }
  if (minDim >= 576 && minDim < 656) {
    return 560;
  }
  return minDim - 2 * resolveStageMarginPx(minDim);
}

/**
 * Computes deterministic coordinate-to-canvas geometry respecting `WCR` orientation
 * (`POS_X`, `POS_Y`), premium §5.3 street and radii, the 80 % pass-die cue, and `ViewportTransform`.
 * `deviceDpr` sets the 1 device px street floor (defaults to 1).
 */
export function computeWaferRenderLayout(
  wafer: WaferSummaryMeta,
  cssWidth: number,
  cssHeight: number,
  dies?: ColumnarDies,
  transform: ViewportTransform = DEFAULT_VIEWPORT_TRANSFORM,
  deviceDpr = 1,
): WaferRenderLayout {
  const safeW = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const safeH = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const fitWaferRadiusPx = Math.max(
    12,
    resolveFitWaferDiameterPx(safeW, safeH) / 2,
  );

  const clampedScale =
    Number.isFinite(transform.scale) && transform.scale > 0
      ? Math.min(24, Math.max(0.25, transform.scale))
      : 1;
  const panX = Number.isFinite(transform.panX) ? transform.panX : 0;
  const panY = Number.isFinite(transform.panY) ? transform.panY : 0;

  const waferRadiusUnits = computeWaferRadiusUnits(wafer, dies);
  const waferRadiusPx = fitWaferRadiusPx * clampedScale;
  const diePitchPx = waferRadiusPx / waferRadiusUnits;

  const streetPx = computeDieStreetPx(diePitchPx, deviceDpr);
  const dieSizePx = Math.max(0.75, diePitchPx - streetPx);
  const passDieSizePx = Math.max(0.6, dieSizePx * PASS_DIE_CELL_FRACTION);

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
    failDieRadiusPx: computeFailDieRadiusPx(diePitchPx),
    passDieRadiusPx: computePassDieRadiusPx(diePitchPx),
    gridCenterX,
    gridCenterY,
    dirX,
    dirY,
  };
}

/**
 * Projects integer die coordinates `(x, y)` to a logical CSS-pixel full die rectangle
 * (cell minus `streetPx`, premium §5.3).
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
 * `WCR.WF_FLAT` (`'D'` bottom default, `'U'` top, `'L'` left, `'R'` right): opening width
 * `0.030 D`, depth `0.016 D`, apex rounded with radius `0.002 D` (`premium.md` §5.2 step 1).
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

  const safeRadiusPx = Math.max(0, waferRadiusPx);
  const diameterPx = safeRadiusPx * 2;
  const depthPx = diameterPx * WAFER_NOTCH_DEPTH_D;
  const halfAngleRad = Math.asin(WAFER_NOTCH_OPENING_D); // half opening 0.015 D on radius 0.5 D

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
    apexRoundRadiusPx: diameterPx * WAFER_NOTCH_APEX_RADIUS_D,
  };
}

/**
 * Traces the notch-cut disc outline (circle of radius `R` with the `WF_FLAT` V-notch and a
 * rounded apex) as the current path. Every disc fill, veil, and stroke uses this path.
 */
export function traceWaferOutlinePath(
  ctx: Canvas2DContextLike,
  centerXCss: number,
  centerYCss: number,
  waferRadiusPx: number,
  notch: WaferNotchGeometry,
): void {
  ctx.beginPath();
  ctx.arc(
    centerXCss,
    centerYCss,
    waferRadiusPx,
    notch.arcStartRad,
    notch.arcEndRad,
    false,
  );
  if (typeof ctx.arcTo === 'function' && notch.apexRoundRadiusPx > 0) {
    ctx.arcTo(
      notch.apexX,
      notch.apexY,
      notch.shoulderStartX,
      notch.shoulderStartY,
      notch.apexRoundRadiusPx,
    );
    ctx.lineTo(notch.shoulderStartX, notch.shoulderStartY);
  } else {
    ctx.lineTo(notch.apexX, notch.apexY);
  }
  ctx.closePath();
}

export interface PaintWaferDiscMaterialParams {
  readonly centerXCss: number;
  readonly centerYCss: number;
  readonly waferRadiusPx: number;
  readonly wfFlat: 'U' | 'D' | 'L' | 'R' | ' ';
  /** CSS px width of one device pixel (`1 / devicePixelRatio`) for the hairline strokes. */
  readonly devicePixelCss: number;
  /** Thumbnails skip the thin film (premium §5.3 thumbnail row). */
  readonly skipThinFilm?: boolean;
}

/**
 * Paints the silicon disc material (`premium.md` §5.2 steps 1-5): notch-cut outline, radial
 * body gradient, feature-detected conic thin film (`screen`), edge-exclusion line, and the
 * outer gradient plus inner bevel strokes. Steps after the body clip to the outline path.
 */
export function paintWaferDiscMaterial(
  ctx: Canvas2DContextLike,
  params: PaintWaferDiscMaterialParams,
): void {
  const { centerXCss: cx, centerYCss: cy, waferRadiusPx: r, wfFlat } = params;
  if (!(r > 0)) {
    return;
  }
  const d = r * 2;
  const hairline =
    Number.isFinite(params.devicePixelCss) && params.devicePixelCss > 0
      ? params.devicePixelCss
      : 1;
  const notch = computeWaferNotchGeometry(cx, cy, r, wfFlat);

  ctx.save?.();

  // 1-2. Outline path and radial body gradient (light catch upper-left)
  traceWaferOutlinePath(ctx, cx, cy, r, notch);
  if (typeof ctx.createRadialGradient === 'function') {
    const gx = cx - 0.12 * d;
    const gy = cy - 0.2 * d;
    const body = ctx.createRadialGradient(gx, gy, 0, gx, gy, 0.78 * d);
    body.addColorStop(WAFER_TOKENS.discStops[0], WAFER_TOKENS.discHi);
    body.addColorStop(WAFER_TOKENS.discStops[1], WAFER_TOKENS.discMid);
    body.addColorStop(WAFER_TOKENS.discStops[2], WAFER_TOKENS.discLo);
    ctx.fillStyle = body;
  } else {
    ctx.fillStyle = WAFER_TOKENS.discMid;
  }
  ctx.fill();
  ctx.clip?.();

  // 3. Thin-film iridescence (skipped without createConicGradient)
  if (!params.skipThinFilm && typeof ctx.createConicGradient === 'function') {
    const film = ctx.createConicGradient((200 * Math.PI) / 180, cx, cy);
    film.addColorStop(0, WAFER_TOKENS.film[0]);
    film.addColorStop(0.25, WAFER_TOKENS.film[1]);
    film.addColorStop(0.5, WAFER_TOKENS.film[2]);
    film.addColorStop(0.75, WAFER_TOKENS.film[3]);
    film.addColorStop(1, WAFER_TOKENS.film[0]);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = film;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // 4. Edge-exclusion line, 1 device px at R - 0.026 D
  ctx.beginPath();
  ctx.arc(cx, cy, computeWaferExclusionRadiusPx(r), 0, Math.PI * 2, false);
  ctx.lineWidth = hairline;
  ctx.strokeStyle = WAFER_TOKENS.exclusionLine;
  ctx.stroke();

  // 5. Bevel: 1.5 css px outer stroke (vertical gradient), then 1 device px inner stroke at R - 1.5
  traceWaferOutlinePath(ctx, cx, cy, r, notch);
  if (typeof ctx.createLinearGradient === 'function') {
    const bevel = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    bevel.addColorStop(0, WAFER_TOKENS.bevelTop);
    bevel.addColorStop(1, WAFER_TOKENS.bevelBottom);
    ctx.strokeStyle = bevel;
  } else {
    ctx.strokeStyle = WAFER_TOKENS.bevelBottom;
  }
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, r - 1.5), 0, Math.PI * 2, false);
  ctx.lineWidth = hairline;
  ctx.strokeStyle = WAFER_TOKENS.bevelInner;
  ctx.stroke();

  ctx.restore?.();
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
 * Maps Pass/Fail state to the disc die palette (premium §5.3: `pass-tile` texture, `fail-die` `#FF6B2C`).
 */
export function resolvePassFailDieColor(
  finalPass: number,
  highContrast = false,
): string {
  return finalPass !== 0
    ? resolvePassTileColor(highContrast)
    : COLOR_TOKENS.failure;
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
  highContrast = false,
): string {
  if (colorMode === 'pass-fail') {
    return resolvePassFailDieColor(dies.finalPass[dieIndex]!, highContrast);
  }

  if (colorMode === 'hbin' || colorMode === 'sbin') {
    if (dies.finalPass[dieIndex] !== 0) {
      return resolvePassTileColor(highContrast);
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
  save?(): void;
  restore?(): void;
  clip?(): void;
  arcTo?(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  createRadialGradient?(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
  createLinearGradient?(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): CanvasGradient;
  createConicGradient?(startAngle: number, x: number, y: number): CanvasGradient;
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
 * Fills the batched fail facets (premium §5.3): a 1 px line along each fail die's top edge,
 * inset by the corner radius, in `fail-facet`. `facets` holds `[x, y, size]` triples.
 */
function paintFailFacets(
  ctx: Canvas2DContextLike,
  facets: readonly number[],
  radius: number,
): void {
  if (facets.length === 0) {
    return;
  }
  ctx.fillStyle = WAFER_TOKENS.failFacet;
  ctx.beginPath();
  for (let k = 0; k + 2 < facets.length; k += 3) {
    const size = facets[k + 2]!;
    const inset = Math.min(radius, size * 0.45);
    ctx.rect(facets[k]! + inset, facets[k + 1]!, size - 2 * inset, 1);
  }
  ctx.fill();
}

/**
 * Clears the canvas and paints ONLY the silicon disc material (premium §5.2 steps 1-5),
 * used as frame 0 of the
 * incremental probe-sweep reveal (`redesign.md` §3.3, §5.1).
 */
export function paintWaferSubstrateOnly(
  ctx: Canvas2DContextLike,
  wafer: WaferSummaryMeta | undefined,
  layout: WaferRenderLayout,
  dpr: number,
  deviceDpr?: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);
  if (!wafer) {
    return;
  }

  paintWaferDiscMaterial(ctx, {
    centerXCss: layout.centerXCss,
    centerYCss: layout.centerYCss,
    waferRadiusPx: layout.waferRadiusPx,
    wfFlat: wafer.geometry.wfFlat,
    devicePixelCss: 1 / (deviceDpr ?? dpr),
  });
}

export interface PaintWaferSweepBatchParams {
  readonly lot: LotModel;
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly probeOrder: Uint32Array;
  readonly startOrderIndex: number;
  readonly endOrderIndex: number;
  /** `prefers-contrast: more`: pass tiles use `pass-tile-hc` (premium §5.3). */
  readonly highContrast?: boolean;
}

/**
 * Incrementally draws newly revealed dies `probeOrder[startOrderIndex .. endOrderIndex)`
 * onto `BaseCanvas` as pass tiles (premium §5.3: 80 % square, `pass-tile`) without clearing
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
  ctx.fillStyle = resolvePassTileColor(params.highContrast);

  const { x: xArr, y: yArr, hasValidCoords: validArr } = lot.dies;
  const passSize = layout.passDieSizePx;
  const passHalf = passSize / 2;
  const useBatchedRoundRect =
    typeof ctx.roundRect === 'function' && passSize >= 3.5;
  const clampedR = Math.min(layout.passDieRadiusPx, passSize * 0.45);

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

/**
 * Reserved `hiddenBins` keys for the Pass/fail legend entries (premium §5.7). Bin codes are
 * `U*2` (0..65535), so these never collide with a real HBIN or SBIN code.
 */
export const LEGEND_FAILED_KEY = 0x10000;
export const LEGEND_PASSED_KEY = 0x10001;

export interface PaintWaferBaseParams {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly colorMode: WaferColorMode;
  readonly activeTestNum: number | null;
  readonly hiddenBins: ReadonlySet<number>;
  /** Display `devicePixelRatio` (without supersampling) for 1-device-px hairlines; defaults to `dpr`. */
  readonly deviceDpr?: number;
  /** `prefers-contrast: more`: pass tiles use `pass-tile-hc` (premium §5.3). */
  readonly highContrast?: boolean;
}

/**
 * Draws the DPR/supersampled base wafer map layer (`redesign.md` §2.1, §4.7):
 * 1. Silicon disc material (premium §5.2 steps 1-5) with the `WF_FLAT` V-notch
 * 2. Pass tiles as centred 80 % squares (`pass-tile`, `pass-tile-hc` under `prefers-contrast: more`)
 * 3. Fail dies filling the cell minus the street with rounded corners and a top facet (premium §5.3)
 * 4. Viewport culling so re-rastering at `scale > 2` draws `10,000` dies in `< 3 ms`.
 */
export function paintWaferBaseLayer(
  ctx: Canvas2DContextLike,
  params: PaintWaferBaseParams,
): void {
  const {
    lot,
    waferIndex,
    layout,
    dpr,
    deviceDpr,
    colorMode,
    activeTestNum,
    hiddenBins,
    highContrast = false,
  } = params;
  const wafer = lot.wafers[waferIndex];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);

  if (!wafer) {
    return;
  }

  // 1. Silicon disc material with the WF_FLAT notch (premium §5.2 steps 1-5)
  paintWaferDiscMaterial(ctx, {
    centerXCss: layout.centerXCss,
    centerYCss: layout.centerYCss,
    waferRadiusPx: layout.waferRadiusPx,
    wfFlat: wafer.geometry.wfFlat,
    devicePixelCss: 1 / (deviceDpr ?? dpr),
  });

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
  const facets: number[] | null = shouldDrawFailFacet(layout.diePitchPx)
    ? []
    : null;

  if (colorMode === 'pass-fail') {
    // Legend toggles (premium §5.7): hidden groups are not drawn
    const hidePassed = hiddenBins.has(LEGEND_PASSED_KEY);
    const hideFailed = hiddenBins.has(LEGEND_FAILED_KEY);
    // Pass 1: Pass tiles, centred 80 % square (batched single fill, premium §5.3)
    ctx.fillStyle = resolvePassTileColor(highContrast);
    ctx.beginPath();
    let anyPassPath = false;
    for (let i = start; i < end; i += 1) {
      if (hidePassed || validArr[i] === 0 || passArr[i] === 0) {
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
          layout.passDieRadiusPx,
        )
      ) {
        anyPassPath = true;
      }
    }
    if (anyPassPath) {
      ctx.fill();
    }

    // Pass 2: Failing dies (#FF6B2C), full cell minus street (batched single fill, premium §5.3)
    ctx.fillStyle = COLOR_TOKENS.failure;
    ctx.beginPath();
    let anyFailPath = false;
    for (let i = start; i < end; i += 1) {
      if (hideFailed || validArr[i] === 0 || passArr[i] !== 0) {
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
          layout.failDieRadiusPx,
        )
      ) {
        anyFailPath = true;
      }
      facets?.push(cx - failHalf, cy - failHalf, failSize);
    }
    if (anyFailPath) {
      ctx.fill();
    }
    if (facets) {
      paintFailFacets(ctx, facets, layout.failDieRadiusPx);
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
    const radius = isPassBinMode
      ? layout.passDieRadiusPx
      : layout.failDieRadiusPx;

    ctx.fillStyle = resolveDieFillColor(
      i,
      dies,
      colorMode,
      failRankMap,
      paramCol,
      paramRange,
      highContrast,
    );
    drawDieRoundedRect(ctx, cx - half, cy - half, size, radius);
    if (facets && colorMode !== 'parametric' && !isPassBinMode) {
      facets.push(cx - half, cy - half, size);
    }
  }
  if (facets) {
    paintFailFacets(ctx, facets, layout.failDieRadiusPx);
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
  const failRadius = layout.failDieRadiusPx;
  const facets: number[] | null = shouldDrawFailFacet(layout.diePitchPx)
    ? []
    : null;
  const minCullX = -layout.diePitchPx;
  const maxCullX = layout.cssWidth + layout.diePitchPx;
  const minCullY = -layout.diePitchPx;
  const maxCullY = layout.cssHeight + layout.diePitchPx;

  if (colorMode === 'pass-fail') {
    const hideFailed = hiddenBins.has(LEGEND_FAILED_KEY);
    ctx.fillStyle = COLOR_TOKENS.failure;
    ctx.beginPath();
    let anyFailPath = false;
    for (let i = start; i < end; i += 1) {
      if (
        hideFailed ||
        dies.hasValidCoords[i] === 0 ||
        dies.finalPass[i] !== 0
      ) {
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
          failRadius,
        )
      ) {
        anyFailPath = true;
      }
      facets?.push(cx - failHalf, cy - failHalf, failSize);
    }
    if (anyFailPath) {
      ctx.fill();
    }
    if (facets) {
      paintFailFacets(ctx, facets, failRadius);
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
      failRadius,
    );
    facets?.push(cx - failHalf, cy - failHalf, failSize);
  }
  if (facets) {
    paintFailFacets(ctx, facets, failRadius);
  }
}

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

/** `premium.md` §3.3 `evidence-bloom`: the sprite extends 3 sigma beyond the die on each side. */
export const EVIDENCE_BLOOM_PAD_PX = 3 * WAFER_TOKENS.evidenceBloom.blurPx;

interface EvidenceBloomSprite {
  readonly image: CanvasImageSource;
  /** Sprite side in fit-view css px (die side + 2 x pad). */
  readonly cssSpan: number;
}

const bloomSpriteCache = new Map<string, EvidenceBloomSprite | null>();

/**
 * Pre-renders the `evidence-bloom` sprite (premium §3.3): a fit-view fail die in `#FF6B2C` at
 * 0.35 alpha, blurred by an 8 css px gaussian. Built with a canvas shadow (`shadowBlur = 2 sigma`)
 * so it works in every browser; cached per fit die size and device pixel ratio.
 */
function getEvidenceBloomSprite(
  fitDieSizePx: number,
  dpr: number,
): EvidenceBloomSprite | null {
  const size = Math.max(1, Math.round(fitDieSizePx * 2) / 2);
  const scale = Math.min(4, Math.max(1, dpr));
  const key = `${size}@${scale}`;
  const cached = bloomSpriteCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const { color, alpha, blurPx } = WAFER_TOKENS.evidenceBloom;
  const cssSpan = size + 2 * EVIDENCE_BLOOM_PAD_PX;
  const pixelSpan = Math.ceil(cssSpan * scale);
  let sprite: EvidenceBloomSprite | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(pixelSpan, pixelSpan);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const r = Number.parseInt(color.slice(1, 3), 16);
      const g = Number.parseInt(color.slice(3, 5), 16);
      const b = Number.parseInt(color.slice(5, 7), 16);
      // Draw the die off-canvas and keep only its shadow, so the sprite is the blur alone
      const offset = pixelSpan * 2;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.shadowBlur = 2 * blurPx * scale;
      ctx.shadowOffsetX = offset;
      ctx.fillStyle = '#000000';
      const side = size * scale;
      ctx.fillRect(
        (pixelSpan - side) / 2 - offset,
        (pixelSpan - side) / 2,
        side,
        side,
      );
      sprite = { image: canvas, cssSpan };
    }
  }
  if (bloomSpriteCache.size >= 8) {
    bloomSpriteCache.clear();
  }
  bloomSpriteCache.set(key, sprite);
  return sprite;
}

/** Appends a die-shaped (rounded when possible) rect to the current path. */
function appendDieOutline(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  size: number,
  radius: number,
): void {
  if (typeof ctx.roundRect === 'function' && size >= 3.5 && radius > 0) {
    ctx.roundRect(x, y, size, size, Math.min(radius, size * 0.45));
    return;
  }
  ctx.rect(x, y, size, size);
}

interface DieRingStroke {
  readonly inner: string;
  readonly innerWidthPx: number;
  readonly outer: string;
  readonly outerWidthPx: number;
}

/**
 * Strokes a two-tone die ring (premium §3.3 `hover-stroke` / `pinned-stroke`): the light stroke
 * sits inside the die's edge and the dark keyline sits outside it, both following the die radius.
 */
function strokeDieRing(
  ctx: Canvas2DContextLike,
  cx: number,
  cy: number,
  size: number,
  radius: number,
  ring: DieRingStroke,
): void {
  const half = size / 2;
  const outerOffset = ring.outerWidthPx / 2;
  ctx.beginPath();
  appendDieOutline(
    ctx,
    cx - half - outerOffset,
    cy - half - outerOffset,
    size + 2 * outerOffset,
    radius + outerOffset,
  );
  ctx.strokeStyle = ring.outer;
  ctx.lineWidth = ring.outerWidthPx;
  ctx.stroke();

  const innerOffset = Math.min(ring.innerWidthPx / 2, half / 2);
  ctx.beginPath();
  appendDieOutline(
    ctx,
    cx - half + innerOffset,
    cy - half + innerOffset,
    size - 2 * innerOffset,
    Math.max(0, radius - innerOffset),
  );
  ctx.strokeStyle = ring.inner;
  ctx.lineWidth = ring.innerWidthPx;
  ctx.stroke();
}

export interface OverlayGlowSequenceOverride {
  /** Veil progress `0..1`; the `dim-veil` token itself carries its 0.78 alpha. */
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
  /** Pinned die (`Enter` on a keyboard-focused die, or tap): `pinned-stroke` (premium §5.4). */
  readonly pinnedDieIndex?: number | null;
  readonly brush: SpatialBrushRect | null;
  /**
   * `true` when the highlight mask comes from a box selection alone. A selected region gets the
   * selection rect only: no die strokes and no veil (premium §5.4).
   */
  readonly highlightIsSelectionOnly?: boolean;
  /** Optional animated veil + per-die ordered ignite state (premium §5.4, §8.3). */
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
 * Draws the DPR-scaled screen-space overlay canvas (premium §5.4) WITHOUT touching `BaseCanvas`:
 * `dim-veil` over the disc with evidence dies punched out (`destination-out`), `evidence-bloom`
 * (`lighter`) and `evidence-rim` on evidence fail dies, a 0.55 rim on evidence pass tiles,
 * `selection-rect`, `hover-stroke`, `pinned-stroke`, and the probe-head light.
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
    pinnedDieIndex = null,
    brush,
    highlightIsSelectionOnly = false,
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
  const dieCenterX = (i: number): number =>
    layout.centerXCss +
    (xArr[i]! - layout.gridCenterX) * layout.dirX * layout.diePitchPx;
  const dieCenterY = (i: number): number =>
    layout.centerYCss +
    (yArr[i]! - layout.gridCenterY) * layout.dirY * layout.diePitchPx;
  const isDrawable = (i: number): boolean => {
    if (i < start || i >= end || validArr[i] === 0) {
      return false;
    }
    const cx = dieCenterX(i);
    const cy = dieCenterY(i);
    return cx >= minCullX && cx <= maxCullX && cy >= minCullY && cy <= maxCullY;
  };

  // Resolve the evidence set: the animated finding sequence, or a static filter highlight
  let veilAlpha = 0;
  let evidenceIndices: Uint32Array | null = null;
  let evidenceAlphas: Float32Array | null = null;
  let outgoingIndices: Uint32Array | null = null;
  let outgoingAlphas: Float32Array | null = null;
  if (glowOverride !== null) {
    veilAlpha = Math.min(1, Math.max(0, glowOverride.scrimAlpha));
    evidenceIndices = glowOverride.dieIndices;
    evidenceAlphas = glowOverride.dieAlphas;
    if (glowOverride.outgoingIndices && glowOverride.outgoingAlphas) {
      outgoingIndices = glowOverride.outgoingIndices;
      outgoingAlphas = glowOverride.outgoingAlphas;
    }
  } else if (
    !highlightIsSelectionOnly &&
    overlayHighlightCount > 0 &&
    overlayHighlightMask.length >= end
  ) {
    let n = 0;
    for (let i = start; i < end; i += 1) {
      if (overlayHighlightMask[i] !== 0) n += 1;
    }
    if (n > 0) {
      evidenceIndices = new Uint32Array(n);
      let w = 0;
      for (let i = start; i < end; i += 1) {
        if (overlayHighlightMask[i] !== 0) evidenceIndices[w++] = i;
      }
      evidenceAlphas = new Float32Array(n).fill(1);
      veilAlpha = 1;
    }
  }

  const hasEvidence =
    veilAlpha > 0.002 ||
    (evidenceIndices !== null && evidenceIndices.length > 0) ||
    (outgoingIndices !== null && outgoingIndices.length > 0);

  if (hasEvidence) {
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';
    const failSize = layout.dieSizePx;
    const failHalf = failSize / 2;
    const passSize = layout.passDieSizePx;

    // 1. `dim-veil` over the disc (disc-coloured, so dimmed ember stays ember-hued)
    if (veilAlpha > 0.002) {
      const notch = computeWaferNotchGeometry(
        layout.centerXCss,
        layout.centerYCss,
        layout.waferRadiusPx,
        wafer.geometry.wfFlat,
      );
      traceWaferOutlinePath(
        ctx,
        layout.centerXCss,
        layout.centerYCss,
        layout.waferRadiusPx,
        notch,
      );
      ctx.globalAlpha = veilAlpha;
      ctx.fillStyle = WAFER_TOKENS.dimVeil;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 2. `evidence-bloom` under evidence fail dies, composited `lighter` at 0.6
    const fitScale =
      layout.fitWaferRadiusPx > 0
        ? layout.waferRadiusPx / layout.fitWaferRadiusPx
        : 1;
    const sprite =
      typeof ctx.drawImage === 'function'
        ? getEvidenceBloomSprite(failSize / fitScale, dpr)
        : null;
    if (sprite !== null) {
      const span = sprite.cssSpan * fitScale;
      const { compositeAlpha } = WAFER_TOKENS.evidenceBloom;
      ctx.globalCompositeOperation = 'lighter';
      const drawBlooms = (indices: Uint32Array, alphas: Float32Array): void => {
        for (let r = 0; r < indices.length; r += 1) {
          const a = alphas[r] ?? 0;
          const i = indices[r]!;
          if (a <= 0.005 || passArr[i] !== 0 || !isDrawable(i)) continue;
          ctx.globalAlpha = compositeAlpha * a;
          ctx.drawImage!(
            sprite.image,
            dieCenterX(i) - span / 2,
            dieCenterY(i) - span / 2,
            span,
            span,
          );
        }
      };
      if (outgoingIndices && outgoingAlphas) drawBlooms(outgoingIndices, outgoingAlphas);
      if (evidenceIndices && evidenceAlphas) drawBlooms(evidenceIndices, evidenceAlphas);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // 3. Punch the evidence dies out of the veil and bloom (`destination-out`, one batched path)
    if (evidenceIndices !== null && evidenceIndices.length > 0) {
      ctx.beginPath();
      let any = false;
      for (let r = 0; r < evidenceIndices.length; r += 1) {
        const i = evidenceIndices[r]!;
        if (!isDrawable(i)) continue;
        any = true;
        appendDieOutline(
          ctx,
          dieCenterX(i) - failHalf,
          dieCenterY(i) - failHalf,
          failSize,
          layout.failDieRadiusPx,
        );
      }
      if (any) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000000';
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // 4. Rims: `evidence-rim` 1 px inside fail dies, 0.55 white 1 px inside pass tiles.
    // Fully lit dies share one path per rim colour; partially lit dies stroke individually.
    const rimWidth = WAFER_TOKENS.evidenceRimWidthPx;
    const inset = rimWidth / 2;
    const appendRim = (i: number): void => {
      const isPass = passArr[i] !== 0;
      const size = isPass ? passSize : failSize;
      const radius = isPass ? layout.passDieRadiusPx : layout.failDieRadiusPx;
      appendDieOutline(
        ctx,
        dieCenterX(i) - size / 2 + inset,
        dieCenterY(i) - size / 2 + inset,
        size - 2 * inset,
        Math.max(0, radius - inset),
      );
    };
    const strokeRims = (indices: Uint32Array, alphas: Float32Array): void => {
      ctx.lineWidth = rimWidth;
      for (const wantPass of [false, true]) {
        ctx.beginPath();
        let any = false;
        for (let r = 0; r < indices.length; r += 1) {
          const i = indices[r]!;
          if ((alphas[r] ?? 0) < 0.999 || (passArr[i] !== 0) !== wantPass || !isDrawable(i)) {
            continue;
          }
          any = true;
          appendRim(i);
        }
        if (any) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = wantPass
            ? WAFER_TOKENS.evidencePassRim
            : WAFER_TOKENS.evidenceRim;
          ctx.stroke();
        }
      }
      for (let r = 0; r < indices.length; r += 1) {
        const a = alphas[r] ?? 0;
        const i = indices[r]!;
        if (a <= 0.005 || a >= 0.999 || !isDrawable(i)) continue;
        ctx.beginPath();
        appendRim(i);
        ctx.globalAlpha = a;
        ctx.strokeStyle =
          passArr[i] !== 0 ? WAFER_TOKENS.evidencePassRim : WAFER_TOKENS.evidenceRim;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    if (outgoingIndices && outgoingAlphas) strokeRims(outgoingIndices, outgoingAlphas);
    if (evidenceIndices && evidenceAlphas) strokeRims(evidenceIndices, evidenceAlphas);
  }

  // 5. `selection-rect`: 1 px white 0.90 stroke, white 0.06 fill, radius 4 (premium §3.3)
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
    const sel = WAFER_TOKENS.selectionRect;
    const { x, y, width, height } = resolvedBrushRect;
    const radius = Math.min(sel.radiusPx, width / 2, height / 2);
    ctx.setLineDash([]);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, radius);
    } else {
      ctx.rect(x, y, width, height);
    }
    ctx.fillStyle = sel.fill;
    ctx.fill();
    ctx.beginPath();
    const half = sel.strokeWidthPx / 2;
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(
        x + half,
        y + half,
        width - 2 * half,
        height - 2 * half,
        Math.max(0, radius - half),
      );
    } else {
      ctx.rect(x + half, y + half, width - 2 * half, height - 2 * half);
    }
    ctx.strokeStyle = sel.stroke;
    ctx.lineWidth = sel.strokeWidthPx;
    ctx.stroke();
  }

  // 6. `hover-stroke` on the hovered (or keyboard-cursor) die, `pinned-stroke` on the pinned die
  const strokeDieState = (dieIndex: number | null, ring: DieRingStroke): void => {
    if (
      dieIndex === null ||
      dieIndex < start ||
      dieIndex >= end ||
      validArr[dieIndex] === 0
    ) {
      return;
    }
    const isPass = passArr[dieIndex] !== 0;
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';
    strokeDieRing(
      ctx,
      dieCenterX(dieIndex),
      dieCenterY(dieIndex),
      isPass ? layout.passDieSizePx : layout.dieSizePx,
      isPass ? layout.passDieRadiusPx : layout.failDieRadiusPx,
      ring,
    );
  };
  if (hoveredDieIndex !== pinnedDieIndex) {
    strokeDieState(hoveredDieIndex, WAFER_TOKENS.hoverStroke);
  }
  strokeDieState(pinnedDieIndex, WAFER_TOKENS.pinnedStroke);

  // 7. Probe-sweep examination lamp at the last revealed die (3 die widths, 35% ice alpha, §5.1)
  if (
    probeHeadDieIndex !== null &&
    probeHeadDieIndex >= start &&
    probeHeadDieIndex < end &&
    dies.hasValidCoords[probeHeadDieIndex] !== 0
  ) {
    const cx = dieCenterX(probeHeadDieIndex);
    const cy = dieCenterY(probeHeadDieIndex);
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
  /** `prefers-contrast: more`: pass tiles use `pass-tile-hc` (premium §5.3). */
  readonly highContrast?: boolean;
}

/**
 * Shared thumbnail disc (premium §5.3 thumbnail row): disc material at thumbnail size with the
 * thin film (step 3) and sheen (step 6) skipped, then die tiles. When `p < 3` pass tiles are
 * omitted (the disc body alone reads as silicon) and fail dies fill the full cell with no street;
 * otherwise the main-wafer tile rules apply.
 */
function paintThumbnailDisc(
  ctx: Canvas2DContextLike,
  params: PaintWaferThumbnailParams,
  radiusPx: number,
): void {
  const { wafer, dies, cssSize, dpr, highContrast = false } = params;
  const center = cssSize / 2;

  paintWaferDiscMaterial(ctx, {
    centerXCss: center,
    centerYCss: center,
    waferRadiusPx: radiusPx,
    wfFlat: wafer.geometry.wfFlat,
    devicePixelCss: 1 / dpr,
    skipThinFilm: true,
  });

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

  const dense = diePitchPx < THUMBNAIL_DENSE_PITCH_PX;
  const failSize = dense
    ? diePitchPx
    : Math.max(0.75, diePitchPx - computeDieStreetPx(diePitchPx, dpr));
  const failHalf = failSize / 2;
  const failRadius = computeFailDieRadiusPx(diePitchPx);

  // Pass tiles: omitted when p < 3; otherwise centred 80 % squares
  if (!dense) {
    const passSize = failSize * PASS_DIE_CELL_FRACTION;
    const passHalf = passSize / 2;
    const passRadius = computePassDieRadiusPx(diePitchPx);
    ctx.fillStyle = resolvePassTileColor(highContrast);
    ctx.beginPath();
    let anyPassPath = false;
    for (let i = start; i < end; i += 1) {
      if (validArr[i] === 0 || passArr[i] === 0) {
        continue;
      }
      const cx = center + (xArr[i]! - gridCenterX) * dirX * diePitchPx;
      const cy = center + (yArr[i]! - gridCenterY) * dirY * diePitchPx;
      if (
        appendDieToPath(ctx, cx - passHalf, cy - passHalf, passSize, passRadius)
      ) {
        anyPassPath = true;
      }
    }
    if (anyPassPath) {
      ctx.fill();
    }
  }

  // Fail dies: full cell with no street when p < 3; otherwise cell minus street
  const facets: number[] | null =
    !dense && shouldDrawFailFacet(diePitchPx) ? [] : null;
  ctx.fillStyle = COLOR_TOKENS.failure;
  ctx.beginPath();
  let anyFailPath = false;
  for (let i = start; i < end; i += 1) {
    if (validArr[i] === 0 || passArr[i] !== 0) {
      continue;
    }
    const cx = center + (xArr[i]! - gridCenterX) * dirX * diePitchPx;
    const cy = center + (yArr[i]! - gridCenterY) * dirY * diePitchPx;
    if (dense) {
      ctx.fillRect(cx - failHalf, cy - failHalf, failSize, failSize);
      continue;
    }
    if (
      appendDieToPath(ctx, cx - failHalf, cy - failHalf, failSize, failRadius)
    ) {
      anyFailPath = true;
    }
    facets?.push(cx - failHalf, cy - failHalf, failSize);
  }
  if (anyFailPath) {
    ctx.fill();
  }
  if (facets) {
    paintFailFacets(ctx, facets, failRadius);
  }
}

/**
 * Draws a compact Pass/Fail wafer thumbnail (`~36-48 px` CSS) for the wafer strip and lot
 * picker with the premium §5.3 thumbnail rules and `WCR` orientation.
 */
export function paintWaferThumbnail(
  ctx: Canvas2DContextLike,
  params: PaintWaferThumbnailParams,
): void {
  const safeSize =
    Number.isFinite(params.cssSize) && params.cssSize > 0 ? params.cssSize : 1;
  const dpr = Number.isFinite(params.dpr) && params.dpr > 0 ? params.dpr : 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, safeSize, safeSize);

  const radiusPx = Math.max(4, safeSize / 2 - 1.25);
  paintThumbnailDisc(ctx, { ...params, cssSize: safeSize, dpr }, radiusPx);
}

/** Disc radius of the landing card wafer inside its `cssSize` square canvas (CSS px). */
export function computeLandingCardWaferRadiusPx(cssSize: number): number {
  return Math.max(8, cssSize / 2 - 1.5);
}

/**
 * Draws the landing demo card wafer with the premium §5.3 thumbnail rules (disc material
 * without thin film, notch from `WF_FLAT`, die tiles). The sheen is a DOM layer (§6.1).
 */
export function paintLandingCardWafer(
  ctx: Canvas2DContextLike,
  params: PaintWaferThumbnailParams,
): void {
  const safeSize =
    Number.isFinite(params.cssSize) && params.cssSize > 0 ? params.cssSize : 1;
  const dpr = Number.isFinite(params.dpr) && params.dpr > 0 ? params.dpr : 1;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, safeSize, safeSize);

  const radiusPx = computeLandingCardWaferRadiusPx(safeSize);
  paintThumbnailDisc(ctx, { ...params, cssSize: safeSize, dpr }, radiusPx);
}
