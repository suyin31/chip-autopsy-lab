'use client';

import * as React from 'react';
import type { LotModel } from '@/core/model';
import { useSelectionStore } from '@/ui/state';
import {
  computeWaferRenderLayout,
  paintWaferOverlayLayer,
  resolveCanvasPixelSize,
  type ViewportTransform,
} from './wafer-geometry';

export interface OverlayCanvasProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly transform: ViewportTransform;
}

const EMPTY_MASK = new Uint8Array(0);

/**
 * DPR-scaled Canvas2D overlay layer stacked above `BaseCanvas` (`pointer-events: none`).
 *
 * Subscribes directly to `useSelectionStore` highlight, brush, and hover slices so
 * `#7CF2C1` outlines/glows and hover reticles repaint in `< 1 ms` without ever
 * re-rendering or repainting `BaseCanvas` (Requirements 4.3, 10.4, 15.4).
 */
export const OverlayCanvas = React.memo(function OverlayCanvas({
  lot,
  waferIndex,
  cssWidth,
  cssHeight,
  transform,
}: OverlayCanvasProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const storeLot = useSelectionStore((s) => s.lot);
  const rawOverlayMask = useSelectionStore((s) => s.overlayHighlightMask);
  const rawOverlayCount = useSelectionStore((s) => s.overlayHighlightCount);
  const rawHoveredDieIndex = useSelectionStore((s) => s.hoveredDieIndex);
  const rawBrush = useSelectionStore((s) => s.brush);

  const isSynced = storeLot === lot;
  const overlayHighlightMask = isSynced ? rawOverlayMask : EMPTY_MASK;
  const overlayHighlightCount = isSynced ? rawOverlayCount : 0;
  const hoveredDieIndex = isSynced ? rawHoveredDieIndex : null;
  const brush = isSynced ? rawBrush : null;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dims = resolveCanvasPixelSize(cssWidth, cssHeight, dpr);
    if (canvas.width !== dims.pixelWidth) {
      canvas.width = dims.pixelWidth;
    }
    if (canvas.height !== dims.pixelHeight) {
      canvas.height = dims.pixelHeight;
    }

    const wafer = lot.wafers[waferIndex];
    if (!wafer) {
      ctx.setTransform(dims.dpr, 0, 0, dims.dpr, 0, 0);
      ctx.clearRect(0, 0, dims.cssWidth, dims.cssHeight);
      return;
    }

    const layout = computeWaferRenderLayout(
      wafer,
      dims.cssWidth,
      dims.cssHeight,
      lot.dies,
      transform,
    );

    paintWaferOverlayLayer(ctx, {
      lot,
      waferIndex,
      layout,
      dpr: dims.dpr,
      overlayHighlightMask,
      overlayHighlightCount,
      hoveredDieIndex,
      brush,
    });
  }, [
    lot,
    waferIndex,
    cssWidth,
    cssHeight,
    transform,
    overlayHighlightMask,
    overlayHighlightCount,
    hoveredDieIndex,
    brush,
  ]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="wafer-overlay-canvas"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 block h-full w-full select-none"
    />
  );
});
