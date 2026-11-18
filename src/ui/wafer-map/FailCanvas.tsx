'use client';

import * as React from 'react';
import type { StoreApi } from 'zustand';
import type { LotModel } from '@/core/model';
import type { SelectionStoreState, WaferColorMode } from '@/ui/state';
import {
  type CameraState,
  cameraToViewportTransform,
  DEFAULT_CAMERA_STATE,
} from './wafer-camera';
import {
  computeWaferRenderLayout,
  paintWaferFailLayer,
  resolveSupersampledCanvasSize,
} from './wafer-geometry';
import { useHiddenBinsRef } from './use-hidden-bins';

export interface FailCanvasHandle {
  paintForCamera(rasterCamera: CameraState): void;
  clear(): void;
  setOpacity(opacity: number): void;
}

export interface FailCanvasProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly colorMode: WaferColorMode;
  /** Selection Store read for hidden legend bins (repaints imperatively, no stage re-render). */
  readonly store: StoreApi<SelectionStoreState>;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr?: number;
  /** True only while probe-sweep completion fade is active; at rest FailCanvas is hidden (`opacity: 0`). */
  readonly active?: boolean;
}

function areFailCanvasPropsEqual(
  prev: FailCanvasProps,
  next: FailCanvasProps,
): boolean {
  return (
    prev.lot === next.lot &&
    prev.waferIndex === next.waferIndex &&
    prev.colorMode === next.colorMode &&
    prev.cssWidth === next.cssWidth &&
    prev.cssHeight === next.cssHeight &&
    prev.dpr === next.dpr &&
    prev.store === next.store &&
    prev.active === next.active
  );
}

/**
 * Second stage canvas (`z: 2`, `redesign.md` §2.5, §4.7, §5.1) dedicated to failing dies
 * during the probe-sweep completion fade (`opacity 0 -> 1` in `280 ms`), merged into
 * `BaseCanvas` and hidden (`opacity: 0`) at rest so idle memory/compositing stays minimal.
 */
const FailCanvasImpl = React.forwardRef<FailCanvasHandle, FailCanvasProps>(
  function FailCanvas(
    {
      lot,
      waferIndex,
      colorMode,
      store,
      cssWidth,
      cssHeight,
      dpr,
      active = false,
    },
    ref,
  ): React.JSX.Element {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

    const safeCssWidth = Math.max(1, Math.round(cssWidth));
    const safeCssHeight = Math.max(1, Math.round(cssHeight));

    const latestRef = React.useRef({
      lot,
      waferIndex,
      colorMode,
      safeCssWidth,
      safeCssHeight,
      dpr,
    });
    latestRef.current = {
      lot,
      waferIndex,
      colorMode,
      safeCssWidth,
      safeCssHeight,
      dpr,
    };

    const repaintHiddenRef = React.useRef<() => void>(() => undefined);
    const hiddenBinsRef = useHiddenBinsRef(store, lot, () =>
      repaintHiddenRef.current(),
    );

    const paintCamera = React.useCallback((rasterCamera: CameraState): void => {
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

      const cur = latestRef.current;
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

      const vp = cameraToViewportTransform(
        rasterCamera,
        dims.cssWidth,
        dims.cssHeight,
      );
      const layout = computeWaferRenderLayout(
        wafer,
        dims.cssWidth,
        dims.cssHeight,
        cur.lot.dies,
        vp,
      );

      paintWaferFailLayer(ctx, {
        lot: cur.lot,
        waferIndex: cur.waferIndex,
        layout,
        dpr: dims.dpr,
        colorMode: cur.colorMode,
        hiddenBins: hiddenBinsRef.current,
      });
    }, [hiddenBinsRef]);

    repaintHiddenRef.current = () => {
      if (active) {
        paintCamera(DEFAULT_CAMERA_STATE);
      }
    };

    React.useImperativeHandle(
      ref,
      () => ({
        paintForCamera: paintCamera,
        clear(): void {
          const canvas = canvasRef.current;
          const ctx = ctxRef.current;
          if (canvas && ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        },
        setOpacity(opacity: number): void {
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.style.opacity = String(opacity);
          }
        },
      }),
      [paintCamera],
    );

    React.useEffect(() => {
      if (!active) {
        return;
      }
      paintCamera(DEFAULT_CAMERA_STATE);
    }, [
      active,
      lot,
      waferIndex,
      colorMode,
      safeCssWidth,
      safeCssHeight,
      dpr,
      paintCamera,
    ]);

    return (
      <canvas
        ref={canvasRef}
        data-testid="wafer-fail-canvas"
        aria-hidden="true"
        style={{
          width: `${safeCssWidth}px`,
          height: `${safeCssHeight}px`,
          opacity: active ? 1 : 0,
        }}
        className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-fail)] block select-none"
      />
    );
  },
);

export const FailCanvas = React.memo(FailCanvasImpl, areFailCanvasPropsEqual);
