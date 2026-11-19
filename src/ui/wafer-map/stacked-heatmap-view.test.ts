import { describe, expect, it, vi } from 'vitest';
import { computeStackedHeatmap, computeStackedHeatmapSummary } from '@/core/analytics';
import { generateDemoStdfBytes } from '@/core/demo';
import { buildLotModel } from '@/core/model';
import { parseStdfBytes } from '@/core/stdf';
import { sampleMagmaHex, WAFER_TOKENS } from '@/ui/tokens';
import {
  computeGalleryCollapseOffset,
  computeStackedRenderLayout,
  hitTestStackedCell,
  paintMagmaLegendCanvas,
  paintStackedHeatmapBase,
  paintStackedHeatmapOverlay,
  resolveStackedCellColor,
  screenRectToStackedBrush,
  STACKED_MAGMA_MAX_T,
  STACKED_MAGMA_MIN_T,
} from './stacked-heatmap-view';
import { dieCoordToCanvasRect } from './wafer-geometry';

function loadEdgeRingDemo() {
  const bytes = generateDemoStdfBytes('edge-ring-etch');
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return buildLotModel(parsed.value);
}

function createMockContext() {
  return {
    fillStyle: '' as string | CanvasGradient,
    strokeStyle: '' as string | CanvasGradient,
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createConicGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}

describe('stacked-heatmap-view helpers', () => {
  it('maps zero-fail cells to pass-tile substrate and failing cells onto magma t in [0.18, 1.0]', () => {
    expect(resolveStackedCellColor(0, 1, false)).toBe(WAFER_TOKENS.passTile);
    expect(resolveStackedCellColor(0, 1, true)).toBe(WAFER_TOKENS.passTileHc);

    const lowFail = resolveStackedCellColor(0.01, 1, false);
    expect(lowFail).toBe(sampleMagmaHex(STACKED_MAGMA_MIN_T + 0.01 * (STACKED_MAGMA_MAX_T - STACKED_MAGMA_MIN_T)));

    const maxFail = resolveStackedCellColor(0.8, 0.8, false);
    expect(maxFail).toBe(sampleMagmaHex(STACKED_MAGMA_MAX_T));
  });

  it('computes stacked layout, hit-tests exact cell coordinates, and maps brushed rects to stacked SpatialBrushRect', () => {
    const lot = loadEdgeRingDemo();
    const cells = computeStackedHeatmap(lot);
    const summary = computeStackedHeatmapSummary(cells, lot.wafers.length);
    const layout = computeStackedRenderLayout(cells, summary, lot.wafers[0]!.geometry, 320, 320, 2);

    const peak = summary.peakCell!;
    const rect = dieCoordToCanvasRect(peak.x, peak.y, layout);
    const hit = hitTestStackedCell(rect.centerX, rect.centerY, layout, summary.cellByCoord);
    expect(hit).toBe(peak);

    // Outside the disc returns null
    expect(hitTestStackedCell(1, 1, layout, summary.cellByCoord)).toBeNull();

    // Drag covering peak cell and neighbours snaps to stacked brush bounds
    const brush = screenRectToStackedBrush(
      {
        left: rect.x - layout.diePitchPx,
        top: rect.y - layout.diePitchPx,
        right: rect.x + rect.width + layout.diePitchPx,
        bottom: rect.y + rect.height + layout.diePitchPx,
      },
      layout,
      summary,
    );
    expect(brush).not.toBeNull();
    expect(brush!.scope).toBe('stacked');
    expect(brush!.minX).toBeLessThanOrEqual(peak.x);
    expect(brush!.maxX).toBeGreaterThanOrEqual(peak.x);
    expect(brush!.minY).toBeLessThanOrEqual(peak.y);
    expect(brush!.maxY).toBeGreaterThanOrEqual(peak.y);
  });

  it('paints base, overlay, and magma legend canvases without errors', () => {
    const lot = loadEdgeRingDemo();
    const cells = computeStackedHeatmap(lot);
    const summary = computeStackedHeatmapSummary(cells, lot.wafers.length);
    const layout = computeStackedRenderLayout(cells, summary, lot.wafers[0]!.geometry, 320, 320, 2);

    const baseCtx = createMockContext();
    paintStackedHeatmapBase(baseCtx, {
      cells,
      summary,
      geometry: lot.wafers[0]!.geometry,
      layout,
      dpr: 2,
      deviceDpr: 2,
      highContrast: false,
    });
    expect(baseCtx.fill).toHaveBeenCalled();

    const overlayCtx = createMockContext();
    paintStackedHeatmapOverlay(overlayCtx, {
      layout,
      dpr: 2,
      hoveredCell: summary.peakCell,
      brush: { scope: 'stacked', minX: -2, maxX: 2, minY: -2, maxY: 2 },
      liveDragRect: null,
    });
    expect(overlayCtx.stroke).toHaveBeenCalled();

    const legendCtx = createMockContext();
    paintMagmaLegendCanvas(legendCtx, 160, 6, 2);
    expect(legendCtx.fillRect).toHaveBeenCalled();
  });

  it('converges outer gallery tiles toward the grid center and zeroes offset under reduced motion', () => {
    const topLeft = computeGalleryCollapseOffset(0, 25, 5, 80, false);
    const center = computeGalleryCollapseOffset(12, 25, 5, 80, false);
    const bottomRight = computeGalleryCollapseOffset(24, 25, 5, 80, false);

    expect(topLeft.x).toBeGreaterThan(0);
    expect(topLeft.y).toBeGreaterThan(0);
    expect(center.x).toBe(0);
    expect(center.y).toBe(0);
    expect(bottomRight.x).toBeLessThan(0);
    expect(bottomRight.y).toBeLessThan(0);

    expect(computeGalleryCollapseOffset(0, 25, 5, 80, true)).toEqual({ x: 0, y: 0 });
  });
});
