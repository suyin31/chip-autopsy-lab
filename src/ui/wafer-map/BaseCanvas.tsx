'use client';

import * as React from 'react';
import type { LotModel } from '@/core/model';
import { areHiddenBinSetsEqual, type WaferColorMode } from '@/ui/state';
import {
  type CameraState,
  cameraToViewportTransform,
  DEFAULT_CAMERA_STATE,
} from './wafer-camera';
import {
  computeWaferRenderLayout,
  paintWaferBaseLayer,
  resolveSupersampledCanvasSize,
  type ViewportTransform,
  type WaferRenderLayout,
} from './wafer-geometry';

export interface BaseCanvasHandle {
  paintForCamera(rasterCamera: CameraState): void;
}

export interface BaseCanvasProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly colorMode: WaferColorMode;
  readonly activeTestNum: number | null;
  readonly hiddenBins: ReadonlySet<number>;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly transform?: ViewportTransform;
  readonly getRasterCamera?: () => CameraState;
  readonly dpr?: number;
  readonly layout?: WaferRenderLayout | null;
}

function areBaseCanvasPropsEqual(
  prev: BaseCanvasProps,
  next: BaseCanvasProps,
): boolean {
  const prevT = prev.transform;
  const nextT = next.transform;
  const sameTransform =
    prevT === nextT ||
    (prevT !== undefined &&
      nextT !== undefined &&
      prevT.scale === nextT.scale &&
      prevT.panX === nextT.panX &&
      prevT.panY === nextT.panY);

  return (
    prev.lot === next.lot &&
    prev.waferIndex === next.waferIndex &&
    prev.colorMode === next.colorMode &&
    prev.activeTestNum === next.activeTestNum &&
    prev.cssWidth === next.cssWidth &&
    prev.cssHeight === next.cssHeight &&
    prev.dpr === next.dpr &&
    prev.layout === next.layout &&
    prev.getRasterCamera === next.getRasterCamera &&
    sameTransform &&
    areHiddenBinSetsEqual(prev.hiddenBins, next.hiddenBins)
  );
}

/**
 * Supersampled (`devicePixelRatio x 2`, capped at `4096 px` per side, `redesign.md` §4.7)
 * Canvas2D base layer (`z: 1`) rendering silicon wafer substrate (`#0B0B0C` + `1 px` ring +
 * `WF_FLAT` V-notch), `72%` `1px`-radius pass squares (`#63666C`), and full-cell minus `1px`
 * street `1.5px`-radius fail dies (`#FF6B2C` or categorical fail palette).
 *
 * Exposes an imperative `paintForCamera` handle so `120 ms` settle re-raster at `scale > 2`
 * and fit-raster restoration execute in `< 3 ms` with zero React re-renders.
 */
const BaseCanvasImpl = React.forwardRef<BaseCanvasHandle, BaseCanvasProps>(
  function BaseCanvas(
    {
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      hiddenBins,
      cssWidth,
      cssHeight,
      transform,
      getRasterCamera,
      dpr,
      layout,
    },
    ref,
  ): React.JSX.Element {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

    const safeCssWidth = Math.max(1, Math.round(cssWidth));
    const safeCssHeight = Math.max(1, Math.round(cssHeight));

    const latestInputsRef = React.useRef({
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      hiddenBins,
      safeCssWidth,
      safeCssHeight,
      dpr,
    });
    latestInputsRef.current = {
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      hiddenBins,
      safeCssWidth,
      safeCssHeight,
      dpr,
    };

    const paintWithViewport = React.useCallback(
      (vp: ViewportTransform, explicitLayout?: WaferRenderLayout | null): void => {
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

        const cur = latestInputsRef.current;
        const resolvedDpr =
          cur.dpr ??
          (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
        const dims = resolveSupersampledCanvasSize(
          cur.safeCssWidth,
          cur.safeCssHeight,
          resolvedDpr,
          2,
        );
        if (canvas.width !== dims.pixelWidth) {
          canvas.width = dims.pixelWidth;
        }
        if (canvas.height !== dims.pixelHeight) {
          canvas.height = dims.pixelHeight;
        }

        const wafer = cur.lot.wafers[cur.waferIndex];
        if (!wafer) {
          ctx.setTransform(dims.dpr, 0, 0, dims.dpr, 0, 0);
          ctx.clearRect(0, 0, dims.cssWidth, dims.cssHeight);
          return;
        }

        const resolvedLayout =
          explicitLayout &&
          explicitLayout.cssWidth === dims.cssWidth &&
          explicitLayout.cssHeight === dims.cssHeight &&
          vp.scale === 1 &&
          vp.panX === 0 &&
          vp.panY === 0
            ? explicitLayout
            : computeWaferRenderLayout(
                wafer,
                dims.cssWidth,
                dims.cssHeight,
                cur.lot.dies,
                vp,
              );

        paintWaferBaseLayer(ctx, {
          lot: cur.lot,
          waferIndex: cur.waferIndex,
          layout: resolvedLayout,
          dpr: dims.dpr,
          colorMode: cur.colorMode,
          activeTestNum: cur.activeTestNum,
          hiddenBins: cur.hiddenBins,
        });
      },
      [],
    );

    React.useImperativeHandle(
      ref,
      () => ({
        paintForCamera(rasterCamera: CameraState): void {
          const cur = latestInputsRef.current;
          const vp = cameraToViewportTransform(
            rasterCamera,
            cur.safeCssWidth,
            cur.safeCssHeight,
          );
          paintWithViewport(vp, null);
        },
      }),
      [paintWithViewport],
    );

    React.useEffect(() => {
      const rasterCam = getRasterCamera
        ? getRasterCamera()
        : DEFAULT_CAMERA_STATE;
      const vp =
        transform ??
        cameraToViewportTransform(rasterCam, safeCssWidth, safeCssHeight);
      paintWithViewport(vp, layout);
    }, [
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      hiddenBins,
      safeCssWidth,
      safeCssHeight,
      transform,
      getRasterCamera,
      dpr,
      layout,
      paintWithViewport,
    ]);

    return (
      <canvas
        ref={canvasRef}
        data-testid="wafer-base-canvas"
        aria-hidden="true"
        style={{ width: `${safeCssWidth}px`, height: `${safeCssHeight}px` }}
        className="absolute top-0 left-0 z-[var(--z-canvas-base)] block select-none"
      />
    );
  },
);

export const BaseCanvas = React.memo(BaseCanvasImpl, areBaseCanvasPropsEqual);
