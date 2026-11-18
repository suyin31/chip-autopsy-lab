'use client';

import * as React from 'react';
import type { LotModel } from '@/core/model';
import { areHiddenBinSetsEqual, type WaferColorMode } from '@/ui/state';
import {
  computeWaferRenderLayout,
  paintWaferBaseLayer,
  resolveCanvasPixelSize,
  type ViewportTransform,
  type WaferRenderLayout,
} from './wafer-geometry';

export interface BaseCanvasProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly colorMode: WaferColorMode;
  readonly activeTestNum: number | null;
  readonly hiddenBins: ReadonlySet<number>;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly transform: ViewportTransform;
  readonly dpr?: number;
  readonly layout?: WaferRenderLayout | null;
}

function areBaseCanvasPropsEqual(
  prev: BaseCanvasProps,
  next: BaseCanvasProps,
): boolean {
  return (
    prev.lot === next.lot &&
    prev.waferIndex === next.waferIndex &&
    prev.colorMode === next.colorMode &&
    prev.activeTestNum === next.activeTestNum &&
    prev.cssWidth === next.cssWidth &&
    prev.cssHeight === next.cssHeight &&
    prev.dpr === next.dpr &&
    prev.layout === next.layout &&
    prev.transform.scale === next.transform.scale &&
    prev.transform.panX === next.transform.panX &&
    prev.transform.panY === next.transform.panY &&
    areHiddenBinSetsEqual(prev.hiddenBins, next.hiddenBins)
  );
}

/**
 * DPR-scaled Canvas2D base layer rendering wafer substrate geometry, `1 px`
 * `#000000` streets, Pass/Fail or bin fills (`#63666C` pass, `#FF6B2C` fail),
 * and failing-die center micro-dots.
 *
 * Strictly isolated via `React.memo` with structural `hiddenBins` equality from
 * hover, brush, site, bin-filter, and claim-highlight state so interactive
 * selection never repaints the base layer (Requirements 4.3, 15.4).
 */
export const BaseCanvas = React.memo(function BaseCanvas({
  lot,
  waferIndex,
  colorMode,
  activeTestNum,
  hiddenBins,
  cssWidth,
  cssHeight,
  transform,
  dpr,
  layout,
}: BaseCanvasProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

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

    paintWaferBaseLayer(ctx, {
      lot,
      waferIndex,
      layout: resolvedLayout,
      dpr: dims.dpr,
      colorMode,
      activeTestNum,
      hiddenBins,
    });
  }, [
    lot,
    waferIndex,
    colorMode,
    activeTestNum,
    hiddenBins,
    safeCssWidth,
    safeCssHeight,
    transform,
    dpr,
    layout,
  ]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="wafer-base-canvas"
      aria-hidden="true"
      style={{ width: `${safeCssWidth}px`, height: `${safeCssHeight}px` }}
      className="block select-none"
    />
  );
}, areBaseCanvasPropsEqual);
