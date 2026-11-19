/**
 * Pure geometry, Canvas2D rendering, hit-testing, brush snapping, and collapse-offset helpers
 * for the Stacked Multi-Wafer Failure Heatmap and Wafer Gallery (`src/ui/wafer-map/stacked-heatmap-view.ts`).
 *
 * Follows `premium.md` §3.6 (`magma` sampled on `t ∈ [0.18, 1.0]` on the silicon disc,
 * `160 x 6 px` numeric legend), §5.2–§5.4 (disc material, pass tiles, hover & selection strokes),
 * and Requirements 5.1–5.5 & 14.5.
 */

import type { StackedCellStat, StackedHeatmapSummary } from '@/core/analytics';
import { type LotModel, packWaferCoord, type WaferGeometry } from '@/core/model';
import type { SpatialBrushRect } from '@/ui/state';
import { sampleMagmaHex, WAFER_TOKENS } from '@/ui/tokens';
import {
  type Canvas2DContextLike,
  computeDieStreetPx,
  computeFailDieRadiusPx,
  computePassDieRadiusPx,
  dieCoordToCanvasRect,
  paintWaferDiscMaterial,
  PASS_DIE_CELL_FRACTION,
  projectBrushToCanvasRect,
  resolvePassTileColor,
  WAFER_EXCLUSION_INSET_D,
  type WaferRenderLayout,
} from './wafer-geometry';

/** Premium §3.6: magma sampled on `t ∈ [0.18, 1.0]` so zero-fail cells sink into the disc. */
export const STACKED_MAGMA_MIN_T = 0.18 as const;
export const STACKED_MAGMA_MAX_T = 1.0 as const;

/** Premium §3.6: numeric legend bar size (`160 x 6 px`, radius 3). */
export const STACKED_LEGEND_WIDTH_PX = 160 as const;
export const STACKED_LEGEND_HEIGHT_PX = 6 as const;

/** Gallery -> stacked collapse animation duration (seconds; strictly <= 800 ms, Req 5.3). */
export const GALLERY_COLLAPSE_DURATION_S = 0.45 as const;

/** Instant opacity cross-fade duration under `prefers-reduced-motion: reduce` (Req 14.5). */
export const GALLERY_REDUCED_FADE_DURATION_S = 0.1 as const;

const STACKED_RIM_CLEARANCE_UNITS = 0.55;

export interface ScreenSelectionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PaintStackedBaseParams {
  readonly cells: readonly StackedCellStat[];
  readonly summary: StackedHeatmapSummary;
  readonly geometry: WaferGeometry;
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly deviceDpr: number;
  readonly highContrast?: boolean;
}

export interface PaintStackedOverlayParams {
  readonly layout: WaferRenderLayout;
  readonly dpr: number;
  readonly hoveredCell: StackedCellStat | null;
  readonly brush: SpatialBrushRect | null;
  readonly liveDragRect: ScreenSelectionRect | null;
}

/**
 * Resolves a stacked cell's fill colour (`premium.md` §3.6):
 * - Zero-fail cells (`failRate <= 0`) draw as substrate pass tiles so they sink into the disc.
 * - Failing cells (`failRate > 0`) map `failRate / scaleMax` onto `magma` `t ∈ [0.18, 1.0]`.
 */
export function resolveStackedCellColor(
  failRate: number,
  maxFailRate: number,
  highContrast = false,
): string {
  if (!Number.isFinite(failRate) || failRate <= 0) {
    return resolvePassTileColor(highContrast);
  }
  const scaleMax =
    Number.isFinite(maxFailRate) && maxFailRate > 0 ? maxFailRate : 1;
  const normalized = Math.min(1, Math.max(0, failRate / scaleMax));
  const t =
    STACKED_MAGMA_MIN_T +
    normalized * (STACKED_MAGMA_MAX_T - STACKED_MAGMA_MIN_T);
  return sampleMagmaHex(t);
}

/**
 * Computes a fit `WaferRenderLayout` for the union of all stacked `(x, y)` cells inside a
 * square canvas of `cssWidth x cssHeight`, keeping every cell corner inside the exclusion line.
 */
export function computeStackedRenderLayout(
  cells: readonly StackedCellStat[],
  summary: StackedHeatmapSummary,
  geometry: WaferGeometry,
  cssWidth: number,
  cssHeight: number,
  deviceDpr = 1,
): WaferRenderLayout {
  const safeW = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1;
  const safeH = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1;
  const minDim = Math.min(safeW, safeH);
  const fitWaferRadiusPx = Math.max(12, minDim * 0.46);

  const gridCenterX = (summary.minX + summary.maxX) / 2;
  const gridCenterY = (summary.minY + summary.maxY) / 2;

  let maxCornerDist = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    const dx = Math.abs(cell.x - gridCenterX) + 0.5;
    const dy = Math.abs(cell.y - gridCenterY) + 0.5;
    const dist = Math.hypot(dx, dy);
    if (dist > maxCornerDist) {
      maxCornerDist = dist;
    }
  }
  if (maxCornerDist === 0) {
    const halfSpanX = Math.max(1, summary.maxX - summary.minX + 1) / 2;
    const halfSpanY = Math.max(1, summary.maxY - summary.minY + 1) / 2;
    maxCornerDist = Math.hypot(halfSpanX, halfSpanY);
  }

  const waferRadiusUnits = Math.max(
    1.5,
    maxCornerDist + STACKED_RIM_CLEARANCE_UNITS,
    maxCornerDist / (1 - 2 * WAFER_EXCLUSION_INSET_D),
  );

  const diePitchPx = fitWaferRadiusPx / waferRadiusUnits;
  const streetPx = computeDieStreetPx(diePitchPx, deviceDpr);
  const dieSizePx = Math.max(0.75, diePitchPx - streetPx);
  const passDieSizePx = Math.max(0.6, dieSizePx * PASS_DIE_CELL_FRACTION);

  const dirX: 1 | -1 = geometry.posX === 'L' ? -1 : 1;
  const dirY: 1 | -1 = geometry.posY === 'D' ? 1 : -1;

  return {
    cssWidth: safeW,
    cssHeight: safeH,
    centerXCss: safeW / 2,
    centerYCss: safeH / 2,
    fitWaferRadiusPx,
    waferRadiusPx: fitWaferRadiusPx,
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

function appendRoundedRectPath(
  ctx: Canvas2DContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0.1) {
    ctx.rect(x, y, width, height);
    return;
  }
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  if (typeof ctx.arcTo !== 'function') {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Paints the base layer of the stacked multi-wafer heatmap: silicon disc material (§5.2)
 * followed by quiet substrate pass tiles for zero-fail coordinates and magma tiles for
 * failing coordinates (`t ∈ [0.18, 1.0]`, §3.6).
 */
export function paintStackedHeatmapBase(
  ctx: Canvas2DContextLike,
  params: PaintStackedBaseParams,
): void {
  const { cells, summary, geometry, layout, dpr, deviceDpr, highContrast = false } =
    params;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);

  paintWaferDiscMaterial(ctx, {
    centerXCss: layout.centerXCss,
    centerYCss: layout.centerYCss,
    waferRadiusPx: layout.waferRadiusPx,
    wfFlat: geometry.wfFlat,
    devicePixelCss: 1 / Math.max(1, deviceDpr),
  });

  if (cells.length === 0) {
    return;
  }

  const passHalf = layout.passDieSizePx / 2;
  const passColor = resolvePassTileColor(highContrast);
  const scaleMax = summary.maxFailRate > 0 ? summary.maxFailRate : 1;

  // Batch all zero-fail cells into one pass-tile fill path
  ctx.beginPath();
  let hasPass = false;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    if (cell.failCount > 0) {
      continue;
    }
    const r = dieCoordToCanvasRect(cell.x, cell.y, layout);
    appendRoundedRectPath(
      ctx,
      r.centerX - passHalf,
      r.centerY - passHalf,
      layout.passDieSizePx,
      layout.passDieSizePx,
      layout.passDieRadiusPx,
    );
    hasPass = true;
  }
  if (hasPass) {
    ctx.fillStyle = passColor;
    ctx.fill();
  }

  // Group failing cells by exact hex colour so fills batch tightly
  const buckets = new Map<string, StackedCellStat[]>();
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    if (cell.failCount <= 0) {
      continue;
    }
    const hex = resolveStackedCellColor(cell.failRate, scaleMax, highContrast);
    let list = buckets.get(hex);
    if (!list) {
      list = [];
      buckets.set(hex, list);
    }
    list.push(cell);
  }

  for (const [hex, group] of buckets.entries()) {
    ctx.beginPath();
    for (let i = 0; i < group.length; i += 1) {
      const cell = group[i]!;
      const r = dieCoordToCanvasRect(cell.x, cell.y, layout);
      appendRoundedRectPath(
        ctx,
        r.x,
        r.y,
        r.width,
        r.height,
        layout.failDieRadiusPx,
      );
    }
    ctx.fillStyle = hex;
    ctx.fill();
  }
}

/**
 * Paints the screen-space overlay layer of the stacked heatmap: active brush / live drag
 * selection rectangle (`WAFER_TOKENS.selectionRect`) and hovered cell reticle (`hoverStroke`).
 */
export function paintStackedHeatmapOverlay(
  ctx: Canvas2DContextLike,
  params: PaintStackedOverlayParams,
): void {
  const { layout, dpr, hoveredCell, brush, liveDragRect } = params;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssWidth, layout.cssHeight);

  // Selection rectangle (live drag takes precedence over committed brush)
  let selRect: { x: number; y: number; width: number; height: number } | null =
    null;
  if (liveDragRect !== null) {
    const x = Math.min(liveDragRect.left, liveDragRect.right);
    const y = Math.min(liveDragRect.top, liveDragRect.bottom);
    const width = Math.abs(liveDragRect.right - liveDragRect.left);
    const height = Math.abs(liveDragRect.bottom - liveDragRect.top);
    if (width >= 2 || height >= 2) {
      selRect = { x, y, width, height };
    }
  } else if (brush !== null) {
    selRect = projectBrushToCanvasRect(brush, layout);
  }

  if (selRect !== null) {
    ctx.save?.();
    ctx.beginPath();
    appendRoundedRectPath(
      ctx,
      selRect.x,
      selRect.y,
      selRect.width,
      selRect.height,
      WAFER_TOKENS.selectionRect.radiusPx,
    );
    ctx.fillStyle = WAFER_TOKENS.selectionRect.fill;
    ctx.fill();
    ctx.lineWidth = WAFER_TOKENS.selectionRect.strokeWidthPx;
    ctx.strokeStyle = WAFER_TOKENS.selectionRect.stroke;
    ctx.stroke();
    ctx.restore?.();
  }

  if (hoveredCell !== null) {
    const rect = dieCoordToCanvasRect(hoveredCell.x, hoveredCell.y, layout);
    const { hoverStroke } = WAFER_TOKENS;
    ctx.save?.();

    // Outer dark keyline
    ctx.beginPath();
    appendRoundedRectPath(
      ctx,
      rect.x - hoverStroke.outerWidthPx / 2,
      rect.y - hoverStroke.outerWidthPx / 2,
      rect.width + hoverStroke.outerWidthPx,
      rect.height + hoverStroke.outerWidthPx,
      layout.failDieRadiusPx + 0.5,
    );
    ctx.lineWidth = hoverStroke.outerWidthPx;
    ctx.strokeStyle = hoverStroke.outer;
    ctx.stroke();

    // Inner bright reticle
    ctx.beginPath();
    appendRoundedRectPath(
      ctx,
      rect.x + hoverStroke.innerWidthPx / 2,
      rect.y + hoverStroke.innerWidthPx / 2,
      Math.max(1, rect.width - hoverStroke.innerWidthPx),
      Math.max(1, rect.height - hoverStroke.innerWidthPx),
      layout.failDieRadiusPx,
    );
    ctx.lineWidth = hoverStroke.innerWidthPx;
    ctx.strokeStyle = hoverStroke.inner;
    ctx.stroke();

    ctx.restore?.();
  }
}

/**
 * Paints the `160 x 6 px` magma ramp bar (`t ∈ [0.18, 1.0]`, premium §3.6) onto a tiny
 * DPR-scaled canvas so the legend matches the disc fills 1:1 with zero CSS gradients.
 */
export function paintMagmaLegendCanvas(
  ctx: Canvas2DContextLike,
  widthCss: number,
  heightCss: number,
  dpr: number,
): void {
  const safeW = Math.max(1, Math.round(widthCss));
  const safeH = Math.max(1, Math.round(heightCss));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, safeW, safeH);

  const steps = safeW;
  for (let x = 0; x < steps; x += 1) {
    const norm = steps > 1 ? x / (steps - 1) : 1;
    const t =
      STACKED_MAGMA_MIN_T +
      norm * (STACKED_MAGMA_MAX_T - STACKED_MAGMA_MIN_T);
    ctx.fillStyle = sampleMagmaHex(t);
    ctx.fillRect(x, 0, 1.5, safeH);
  }
}

/**
 * O(1) pointer-to-stacked-cell hit test returning the `StackedCellStat` under
 * `(pointerXCss, pointerYCss)` or `null`.
 */
export function hitTestStackedCell(
  pointerXCss: number,
  pointerYCss: number,
  layout: WaferRenderLayout,
  cellByCoord: ReadonlyMap<number, StackedCellStat>,
): StackedCellStat | null {
  if (cellByCoord.size === 0 || layout.diePitchPx <= 0) {
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
  return cellByCoord.get(packWaferCoord(ix, iy)) ?? null;
}

/**
 * Maps a screen-space drag rectangle on the stacked heatmap to a `SpatialBrushRect`
 * with `scope: 'stacked'`, clipped to cells that actually exist in `summary`.
 */
export function screenRectToStackedBrush(
  rect: ScreenSelectionRect,
  layout: WaferRenderLayout,
  summary: StackedHeatmapSummary,
): SpatialBrushRect | null {
  if (summary.cellCount === 0 || layout.diePitchPx <= 0) {
    return null;
  }
  const loScreenX = Math.min(rect.left, rect.right);
  const hiScreenX = Math.max(rect.left, rect.right);
  const loScreenY = Math.min(rect.top, rect.bottom);
  const hiScreenY = Math.max(rect.top, rect.bottom);

  const gx1 =
    layout.gridCenterX +
    ((loScreenX - layout.centerXCss) / layout.diePitchPx) * layout.dirX;
  const gx2 =
    layout.gridCenterX +
    ((hiScreenX - layout.centerXCss) / layout.diePitchPx) * layout.dirX;
  const gy1 =
    layout.gridCenterY +
    ((loScreenY - layout.centerYCss) / layout.diePitchPx) * layout.dirY;
  const gy2 =
    layout.gridCenterY +
    ((hiScreenY - layout.centerYCss) / layout.diePitchPx) * layout.dirY;

  const rawMinX = Math.ceil(Math.min(gx1, gx2) - 0.5);
  const rawMaxX = Math.floor(Math.max(gx1, gx2) + 0.5);
  const rawMinY = Math.ceil(Math.min(gy1, gy2) - 0.5);
  const rawMaxY = Math.floor(Math.max(gy1, gy2) + 0.5);

  const clampedMinX = Math.max(summary.minX, rawMinX);
  const clampedMaxX = Math.min(summary.maxX, rawMaxX);
  const clampedMinY = Math.max(summary.minY, rawMinY);
  const clampedMaxY = Math.min(summary.maxY, rawMaxY);

  if (clampedMinX > clampedMaxX || clampedMinY > clampedMaxY) {
    return null;
  }

  // Verify at least one tested stacked cell falls inside the brushed box
  let matchedMinX = Number.POSITIVE_INFINITY;
  let matchedMaxX = Number.NEGATIVE_INFINITY;
  let matchedMinY = Number.POSITIVE_INFINITY;
  let matchedMaxY = Number.NEGATIVE_INFINITY;
  let found = false;

  for (let x = clampedMinX; x <= clampedMaxX; x += 1) {
    for (let y = clampedMinY; y <= clampedMaxY; y += 1) {
      if (summary.cellByCoord.has(packWaferCoord(x, y))) {
        found = true;
        if (x < matchedMinX) matchedMinX = x;
        if (x > matchedMaxX) matchedMaxX = x;
        if (y < matchedMinY) matchedMinY = y;
        if (y > matchedMaxY) matchedMaxY = y;
      }
    }
  }

  if (!found) {
    return null;
  }

  return {
    scope: 'stacked',
    minX: matchedMinX,
    maxX: matchedMaxX,
    minY: matchedMinY,
    maxY: matchedMaxY,
  };
}

/**
 * Counts how many coordinate-bearing dies across all wafers in `lot` fall inside `brush`.
 */
export function countDiesInStackedBrush(
  lot: LotModel,
  brush: SpatialBrushRect,
): number {
  const { dies } = lot;
  const loX = Math.min(brush.minX, brush.maxX);
  const hiX = Math.max(brush.minX, brush.maxX);
  const loY = Math.min(brush.minY, brush.maxY);
  const hiY = Math.max(brush.minY, brush.maxY);
  let count = 0;
  for (let i = 0; i < dies.count; i += 1) {
    if (dies.hasValidCoords[i] === 0) continue;
    const x = dies.x[i]!;
    const y = dies.y[i]!;
    if (x >= loX && x <= hiX && y >= loY && y <= hiY) {
      count += 1;
    }
  }
  return count;
}

/**
 * Computes the inward collapse translation vector `(x, y)` in px for gallery tile `index`
 * converging toward the center of the wafer gallery grid. Returns `{ x: 0, y: 0 }` when
 * `reducedMotion` is active so gallery collapse becomes an instant opacity cross-fade.
 */
export function computeGalleryCollapseOffset(
  index: number,
  total: number,
  columns: number,
  cellStepPx: number,
  reducedMotion: boolean,
): { readonly x: number; readonly y: number } {
  if (reducedMotion || total <= 1 || columns <= 0) {
    return { x: 0, y: 0 };
  }
  const rows = Math.ceil(total / columns);
  const col = index % columns;
  const row = Math.floor(index / columns);
  const midCol = (Math.min(total, columns) - 1) / 2;
  const midRow = (rows - 1) / 2;
  const dx = (midCol - col) * cellStepPx * 0.55;
  const dy = (midRow - row) * cellStepPx * 0.55;
  return {
    x: Object.is(dx, -0) ? 0 : Math.round(dx),
    y: Object.is(dy, -0) ? 0 : Math.round(dy),
  };
}
