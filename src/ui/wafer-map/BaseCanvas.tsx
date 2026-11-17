'use client';

import * as React from 'react';
import type { LotModel } from '@/core/model';
import type { WaferColorMode } from '@/ui/state';
import {
  computeWaferRenderLayout,
  paintWaferBaseLayer,
  resolveCanvasPixelSize,
  type ViewportTransform,
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
}

/**
 * DPR-scaled Canvas2D base layer rendering wafer substrate geometry, `1 px`
 * `#0A0A0B` streets, Pass/Fail or bin fills (`#53655D` pass, `#FF7A1A` fail),
 * and failing-die center micro-dots.
 *
 * Strictly isolated via `React.memo` from hover, brush, site, bin-filter, and
 * claim-highlight state so interactive selection never repaints the base layer
 * (Requirements 4.3, 15.4).
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
}: BaseCanvasProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

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

    paintWaferBaseLayer(ctx, {
      lot,
      waferIndex,
      layout,
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
    cssWidth,
    cssHeight,
    transform,
  ]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="wafer-base-canvas"
      aria-hidden="true"
      className="block h-full w-full select-none"
    />
  );
});
