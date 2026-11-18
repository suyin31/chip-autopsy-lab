'use client';

import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { LotModel } from '@/core/model';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import {
  computeWaferRenderLayout,
  paintWaferOverlayLayer,
  resolveCanvasPixelSize,
  type ViewportTransform,
  type WaferRenderLayout,
} from './wafer-geometry';

export interface OverlayCanvasProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly transform: ViewportTransform;
  readonly dpr?: number;
  readonly layout?: WaferRenderLayout | null;
  readonly store?: StoreApi<SelectionStoreState>;
}

const EMPTY_MASK = new Uint8Array(0);

/**
 * DPR-scaled Canvas2D overlay layer stacked above `BaseCanvas` (`pointer-events: none`).
 *
 * Subscribes via a single `useShallow` selector to `SelectionStore` highlight,
 * brush, and hover slices so `#7CF2C1` outlines/glows and hover reticles repaint
 * in `< 1 ms` without ever re-rendering or repainting `BaseCanvas`
 * (Requirements 4.3, 10.4, 15.4).
 */
export const OverlayCanvas = React.memo(function OverlayCanvas({
  lot,
  waferIndex,
  cssWidth,
  cssHeight,
  transform,
  dpr,
  layout,
  store = useSelectionStore,
}: OverlayCanvasProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

  const {
    storeLot,
    rawOverlayMask,
    rawOverlayCount,
    rawHoveredDieIndex,
    rawBrush,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawOverlayMask: s.overlayHighlightMask,
      rawOverlayCount: s.overlayHighlightCount,
      rawHoveredDieIndex: s.hoveredDieIndex,
      rawBrush: s.brush,
    })),
  );

  const isSynced = storeLot === lot;
  const overlayHighlightMask = isSynced ? rawOverlayMask : EMPTY_MASK;
  const overlayHighlightCount = isSynced ? rawOverlayCount : 0;
  const hoveredDieIndex = isSynced ? rawHoveredDieIndex : null;
  const brush = isSynced ? rawBrush : null;

  const safeCssWidth = Math.max(1, Math.round(cssWidth));
  const safeCssHeight = Math.max(1, Math.round(cssHeight));

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (!ctxRef.current || ctxRef.current.canvas !== canvas) {
      ctxRef.current = canvas.getContext('2d');
    }
    const ctx = ctxRef.current;
    if (!ctx) {
      return;
    }

    const resolvedDpr =
      dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const dims = resolveCanvasPixelSize(
      safeCssWidth,
      safeCssHeight,
      resolvedDpr,
    );
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

    const resolvedLayout =
      layout &&
      layout.cssWidth === dims.cssWidth &&
      layout.cssHeight === dims.cssHeight
        ? layout
        : computeWaferRenderLayout(
            wafer,
            dims.cssWidth,
            dims.cssHeight,
            lot.dies,
            transform,
          );

    paintWaferOverlayLayer(ctx, {
      lot,
      waferIndex,
      layout: resolvedLayout,
      dpr: dims.dpr,
      overlayHighlightMask,
      overlayHighlightCount,
      hoveredDieIndex,
      brush,
    });
  }, [
    lot,
    waferIndex,
    safeCssWidth,
    safeCssHeight,
    transform,
    dpr,
    layout,
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
      style={{ width: `${safeCssWidth}px`, height: `${safeCssHeight}px` }}
      className="pointer-events-none absolute top-0 left-0 block select-none"
    />
  );
});
