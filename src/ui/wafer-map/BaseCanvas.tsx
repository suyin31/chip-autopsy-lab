'use client';

import * as React from 'react';
import type { StoreApi } from 'zustand';
import type { LotModel } from '@/core/model';
import {
  areHiddenBinSetsEqual,
  type SelectionStoreState,
  useAccent,
  type WaferColorMode,
} from '@/ui/state';
import type { AccentName } from '@/ui/tokens';
import {
  type CameraState,
  cameraToViewportTransform,
  DEFAULT_CAMERA_STATE,
} from './wafer-camera';
import {
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  paintWaferBaseLayer,
  paintWaferSubstrateOnly,
  paintWaferSweepBatch,
  resolveSupersampledCanvasSize,
  type ViewportTransform,
  type WaferRenderLayout,
} from './wafer-geometry';
import { useHiddenBinsRef } from './use-hidden-bins';

export interface BaseCanvasHandle {
  paintForCamera(rasterCamera: CameraState): void;
  paintSubstrateOnly(): void;
  paintSweepBatch(
    probeOrder: Uint32Array,
    startOrderIndex: number,
    endOrderIndex: number,
  ): void;
  setSweepSuppressAutoPaint(suppressed: boolean): void;
  /**
   * Imperatively repaints `waferIndex` at `rasterCamera` without a React render (§5.8
   * keyboard wafer stepping). The next React commit for the same inputs skips its repaint.
   */
  paintWafer(waferIndex: number, rasterCamera: CameraState): void;
  getCanvasElement(): HTMLCanvasElement | null;
}

export interface BaseCanvasProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly colorMode: WaferColorMode;
  readonly activeTestNum: number | null;
  /**
   * Selection Store read for hidden legend bins. The layer subscribes itself and repaints
   * imperatively, so toggling a bin never re-renders the stage.
   */
  readonly store: StoreApi<SelectionStoreState>;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly transform?: ViewportTransform;
  readonly getRasterCamera?: () => CameraState;
  readonly dpr?: number;
  readonly layout?: WaferRenderLayout | null;
  /** `prefers-contrast: more`: pass tiles use `pass-tile-hc` (premium §5.3). */
  readonly highContrast?: boolean;
}

interface LastBasePaint {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly colorMode: WaferColorMode;
  readonly activeTestNum: number | null;
  readonly hiddenBins: ReadonlySet<number>;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number | undefined;
  readonly highContrast: boolean;
  readonly accent: AccentName;
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

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
    prev.store === next.store &&
    prev.cssWidth === next.cssWidth &&
    prev.cssHeight === next.cssHeight &&
    prev.dpr === next.dpr &&
    prev.highContrast === next.highContrast &&
    prev.layout === next.layout &&
    prev.getRasterCamera === next.getRasterCamera &&
    sameTransform
  );
}

/**
 * Supersampled (`devicePixelRatio x 2`, capped at `4096 px` per side, `redesign.md` §4.7)
 * Canvas2D base layer (`z: 1`) rendering the silicon disc material (premium §5.2: body
 * gradient, thin film, exclusion line, bevel, `WF_FLAT` V-notch) and the premium §5.3 die tiles:
 * 80 % pass tiles and full-cell-minus-street fail dies with a top facet (`#FF6B2C` or bin palette).
 *
 * Also exposes `paintSubstrateOnly` + `paintSweepBatch` for the O(n) incremental
 * §5.1 probe-sweep reveal.
 */
const BaseCanvasImpl = React.forwardRef<BaseCanvasHandle, BaseCanvasProps>(
  function BaseCanvas(
    {
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      store,
      cssWidth,
      cssHeight,
      transform,
      getRasterCamera,
      dpr,
      layout,
      highContrast = false,
    },
    ref,
  ): React.JSX.Element {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
    const suppressAutoPaintRef = React.useRef(false);
    /** Inputs of the last full base-layer paint; lets the effect skip repainting identical content. */
    const lastPaintRef = React.useRef<LastBasePaint | null>(null);

    const accent = useAccent();
    const safeCssWidth = Math.max(1, Math.round(cssWidth));
    const safeCssHeight = Math.max(1, Math.round(cssHeight));

    const latestInputsRef = React.useRef({
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      safeCssWidth,
      safeCssHeight,
      dpr,
      layout,
      highContrast,
      accent,
    });
    latestInputsRef.current = {
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      safeCssWidth,
      safeCssHeight,
      dpr,
      layout,
      highContrast,
      accent,
    };

    /** Re-raster for a hidden-bin change; reassigned every render so it sees current props. */
    const repaintRef = React.useRef<() => void>(() => undefined);
    const hiddenBinsRef = useHiddenBinsRef(store, lot, () => repaintRef.current());

    const ensureCanvasAndContext = React.useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return null;
      }
      if (!ctxRef.current || ctxRef.current.canvas !== canvas) {
        ctxRef.current = canvas.getContext('2d');
      }
      const ctx = ctxRef.current;
      if (!ctx) {
        return null;
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
      return { ctx, dims, cur, deviceDpr: resolvedDpr };
    }, []);

    const paintWithViewport = React.useCallback(
      (vp: ViewportTransform, explicitLayout?: WaferRenderLayout | null): void => {
        const ready = ensureCanvasAndContext();
        if (!ready) {
          return;
        }
        const { ctx, dims, cur, deviceDpr } = ready;
        const wafer = cur.lot.wafers[cur.waferIndex];
        if (!wafer) {
          lastPaintRef.current = null;
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
                deviceDpr,
              );

        paintWaferBaseLayer(ctx, {
          lot: cur.lot,
          waferIndex: cur.waferIndex,
          layout: resolvedLayout,
          dpr: dims.dpr,
          deviceDpr,
          colorMode: cur.colorMode,
          activeTestNum: cur.activeTestNum,
          hiddenBins: hiddenBinsRef.current,
          highContrast: cur.highContrast,
          accent: cur.accent,
        });
        lastPaintRef.current = {
          lot: cur.lot,
          waferIndex: cur.waferIndex,
          colorMode: cur.colorMode,
          activeTestNum: cur.activeTestNum,
          hiddenBins: hiddenBinsRef.current,
          cssWidth: cur.safeCssWidth,
          cssHeight: cur.safeCssHeight,
          dpr: cur.dpr,
          highContrast: cur.highContrast,
          accent: cur.accent,
          scale: vp.scale,
          panX: vp.panX,
          panY: vp.panY,
        };
      },
      [ensureCanvasAndContext, hiddenBinsRef],
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
        paintSubstrateOnly(): void {
          const ready = ensureCanvasAndContext();
          if (!ready) {
            return;
          }
          const { ctx, dims, cur, deviceDpr } = ready;
          lastPaintRef.current = null;
          const wafer = cur.lot.wafers[cur.waferIndex];
          const resolvedLayout =
            cur.layout &&
            cur.layout.cssWidth === dims.cssWidth &&
            cur.layout.cssHeight === dims.cssHeight
              ? cur.layout
              : wafer
                ? computeWaferRenderLayout(
                    wafer,
                    dims.cssWidth,
                    dims.cssHeight,
                    cur.lot.dies,
                    DEFAULT_VIEWPORT_TRANSFORM,
                    deviceDpr,
                  )
                : null;
          if (!resolvedLayout) {
            ctx.setTransform(dims.dpr, 0, 0, dims.dpr, 0, 0);
            ctx.clearRect(0, 0, dims.cssWidth, dims.cssHeight);
            return;
          }
          paintWaferSubstrateOnly(
            ctx,
            wafer,
            resolvedLayout,
            dims.dpr,
            deviceDpr,
          );
        },
        paintSweepBatch(
          probeOrder: Uint32Array,
          startOrderIndex: number,
          endOrderIndex: number,
        ): void {
          const ready = ensureCanvasAndContext();
          if (!ready) {
            return;
          }
          const { ctx, dims, cur, deviceDpr } = ready;
          lastPaintRef.current = null;
          const wafer = cur.lot.wafers[cur.waferIndex];
          if (!wafer) {
            return;
          }
          const resolvedLayout =
            cur.layout &&
            cur.layout.cssWidth === dims.cssWidth &&
            cur.layout.cssHeight === dims.cssHeight
              ? cur.layout
              : computeWaferRenderLayout(
                  wafer,
                  dims.cssWidth,
                  dims.cssHeight,
                  cur.lot.dies,
                  DEFAULT_VIEWPORT_TRANSFORM,
                  deviceDpr,
                );
          paintWaferSweepBatch(ctx, {
            lot: cur.lot,
            layout: resolvedLayout,
            dpr: dims.dpr,
            probeOrder,
            startOrderIndex,
            endOrderIndex,
            highContrast: cur.highContrast,
          });
        },
        setSweepSuppressAutoPaint(suppressed: boolean): void {
          suppressAutoPaintRef.current = suppressed;
        },
        paintWafer(waferIndex: number, rasterCamera: CameraState): void {
          const cur = latestInputsRef.current;
          if (waferIndex < 0 || waferIndex >= cur.lot.wafers.length) {
            return;
          }
          // Until React commits the same index, every imperative paint path uses the previewed wafer
          latestInputsRef.current = { ...cur, waferIndex, layout: null };
          const vp = cameraToViewportTransform(
            rasterCamera,
            cur.safeCssWidth,
            cur.safeCssHeight,
          );
          paintWithViewport(vp, null);
        },
        getCanvasElement(): HTMLCanvasElement | null {
          return canvasRef.current;
        },
      }),
      [ensureCanvasAndContext, paintWithViewport],
    );

    repaintRef.current = () => {
      if (suppressAutoPaintRef.current) {
        return;
      }
      const rasterCam = getRasterCamera
        ? getRasterCamera()
        : DEFAULT_CAMERA_STATE;
      const vp =
        transform ??
        cameraToViewportTransform(rasterCam, safeCssWidth, safeCssHeight);
      paintWithViewport(vp, layout);
    };

    useIsomorphicLayoutEffect(() => {
      if (suppressAutoPaintRef.current) {
        return;
      }
      const rasterCam = getRasterCamera
        ? getRasterCamera()
        : DEFAULT_CAMERA_STATE;
      const vp =
        transform ??
        cameraToViewportTransform(rasterCam, safeCssWidth, safeCssHeight);
      const last = lastPaintRef.current;
      if (
        last &&
        last.lot === lot &&
        last.waferIndex === waferIndex &&
        last.colorMode === colorMode &&
        last.activeTestNum === activeTestNum &&
        last.cssWidth === safeCssWidth &&
        last.cssHeight === safeCssHeight &&
        last.dpr === dpr &&
        last.highContrast === highContrast &&
        last.accent === accent &&
        last.scale === vp.scale &&
        last.panX === vp.panX &&
        last.panY === vp.panY &&
        areHiddenBinSetsEqual(last.hiddenBins, hiddenBinsRef.current)
      ) {
        // Already painted imperatively (e.g. keyboard wafer preview); skip the duplicate raster
        return;
      }
      paintWithViewport(vp, layout);
    }, [
      lot,
      waferIndex,
      colorMode,
      activeTestNum,
      safeCssWidth,
      safeCssHeight,
      transform,
      getRasterCamera,
      dpr,
      layout,
      highContrast,
      accent,
      paintWithViewport,
      hiddenBinsRef,
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
