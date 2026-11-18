'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { LotModel } from '@/core/model';
import { CLASSIFIER_THRESHOLDS } from '@/core/patterns';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import {
  computeOrderedGlowSchedule,
  DIM_SCRIM_MAX_ALPHA,
  GLOW_DIE_FADE_DURATION_MS,
  GLOW_EXIT_DURATION_MS,
  GLOW_TOTAL_DURATION_MS,
  type OrderedGlowSchedule,
  SCRIM_ENTER_DURATION_MS,
  type ScreenBox,
  sampleCubicEaseOut,
} from './linked-interactions';
import {
  type CameraState,
  cameraToViewportTransform,
  DEFAULT_CAMERA_STATE,
} from './wafer-camera';
import { readPrefersReducedMotionSync } from './probe-sweep';
import {
  computeWaferRenderLayout,
  type OverlayGlowSequenceOverride,
  paintWaferOverlayLayer,
  resolveCanvasPixelSize,
  type ViewportTransform,
  type WaferRenderLayout,
} from './wafer-geometry';

export interface OverlayCanvasHandle {
  paintForCamera(camera: CameraState): void;
  setLiveBrushScreenRect(rect: ScreenBox | null): void;
  setProbeHeadDieIndex(dieIndex: number | null): void;
  /**
   * Repaints the overlay for `waferIndex` before React commits it (§5.8 keyboard wafer
   * stepping): clears hover and settles any active finding glow on the new wafer at once.
   */
  previewWafer(waferIndex: number): void;
}

export interface OverlayCanvasProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly transform?: ViewportTransform;
  readonly getCamera?: () => CameraState;
  readonly dpr?: number;
  readonly layout?: WaferRenderLayout | null;
  readonly store?: StoreApi<SelectionStoreState>;
}

const EMPTY_MASK = new Uint8Array(0);

interface GlowAnimatorState {
  phase: 'idle' | 'entering' | 'settled' | 'exiting';
  claimId: string | null;
  waferIndex: number;
  schedule: OrderedGlowSchedule | null;
  startTimeMs: number;
  scrimStartAlpha: number;
  liveScrimAlpha: number;
  liveDieIndices: Uint32Array;
  liveDieAlphas: Float32Array;
  outgoingIndices: Uint32Array | null;
  outgoingStartAlphas: Float32Array | null;
  outgoingLiveAlphas: Float32Array | null;
  outgoingStartTimeMs: number;
}

function createIdleAnimatorState(waferIndex: number): GlowAnimatorState {
  return {
    phase: 'idle',
    claimId: null,
    waferIndex,
    schedule: null,
    startTimeMs: 0,
    scrimStartAlpha: 0,
    liveScrimAlpha: 0,
    liveDieIndices: new Uint32Array(0),
    liveDieAlphas: new Float32Array(0),
    outgoingIndices: null,
    outgoingStartAlphas: null,
    outgoingLiveAlphas: null,
    outgoingStartTimeMs: 0,
  };
}

/**
 * DPR-scaled screen-space Canvas2D overlay layer (`z: 3`, `pointer-events: none`, `redesign.md` §4.7, §5.4, §5.7).
 *
 * - Drives the §5.4 finding `dim-scrim` (`0 -> 0.62` in `200 ms`, punched out at evidence dies),
 *   ordered glow sequence (`polar-cw` / `principal-axis` / `centroid-distance`, `<= 600 ms` total),
 *   `160 ms` clear fade, and mid-animation finding retargeting in a self-terminating rAF loop.
 * - Exposes `setLiveBrushScreenRect` and `paintForCamera` so `Shift+drag` box selection and
 *   camera springs repaint at 60/120 fps with zero React re-renders and zero `BaseCanvas` repaints.
 */
const OverlayCanvasImpl = React.forwardRef<
  OverlayCanvasHandle,
  OverlayCanvasProps
>(function OverlayCanvas(
  {
    lot,
    waferIndex,
    cssWidth,
    cssHeight,
    transform,
    getCamera,
    dpr,
    layout,
    store = useSelectionStore,
  },
  ref,
): React.JSX.Element {
  const shouldReduceMotion = useReducedMotion();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const liveBrushRectRef = React.useRef<ScreenBox | null>(null);
  const probeHeadDieIndexRef = React.useRef<number | null>(null);
  const animStateRef = React.useRef<GlowAnimatorState>(
    createIdleAnimatorState(waferIndex),
  );
  const rafIdRef = React.useRef<number | null>(null);

  const {
    storeLot,
    rawClaimHighlight,
    rawClaimMask,
    rawOverlayMask,
    rawOverlayCount,
    rawHoveredDieIndex,
    rawBrush,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawClaimHighlight: s.claimHighlight,
      rawClaimMask: s.claimHighlightMask,
      rawOverlayMask: s.overlayHighlightMask,
      rawOverlayCount: s.overlayHighlightCount,
      rawHoveredDieIndex: s.hoveredDieIndex,
      rawBrush: s.brush,
    })),
  );

  const isSynced = storeLot === lot;
  const claimHighlight = isSynced ? rawClaimHighlight : null;
  const claimHighlightMask = isSynced ? rawClaimMask : EMPTY_MASK;
  const overlayHighlightMask = isSynced ? rawOverlayMask : EMPTY_MASK;
  const overlayHighlightCount = isSynced ? rawOverlayCount : 0;
  const hoveredDieIndex = isSynced ? rawHoveredDieIndex : null;
  const brush = isSynced ? rawBrush : null;

  const safeCssWidth = Math.max(1, Math.round(cssWidth));
  const safeCssHeight = Math.max(1, Math.round(cssHeight));

  const reducedMotionRef = React.useRef(
    readPrefersReducedMotionSync(shouldReduceMotion),
  );
  reducedMotionRef.current = readPrefersReducedMotionSync(shouldReduceMotion);

  const latestRef = React.useRef({
    lot,
    waferIndex,
    safeCssWidth,
    safeCssHeight,
    dpr,
    transform,
    getCamera,
    layout,
    claimHighlight,
    claimHighlightMask,
    overlayHighlightMask,
    overlayHighlightCount,
    hoveredDieIndex,
    brush,
  });
  latestRef.current = {
    lot,
    waferIndex,
    safeCssWidth,
    safeCssHeight,
    dpr,
    transform,
    getCamera,
    layout,
    claimHighlight,
    claimHighlightMask,
    overlayHighlightMask,
    overlayHighlightCount,
    hoveredDieIndex,
    brush,
  };

  const lotHighlightStats = React.useMemo(() => {
    if (
      overlayHighlightCount === 0 ||
      overlayHighlightMask.length < lot.dies.count
    ) {
      return { outerBandCount: 0, interiorCount: 0 };
    }
    const { hasValidCoords, ringIndex, count } = lot.dies;
    const maxEdgeRing = CLASSIFIER_THRESHOLDS.EDGE_RING_BAND;
    let outerBandCount = 0;
    let interiorCount = 0;
    for (let i = 0; i < count; i += 1) {
      if (overlayHighlightMask[i] === 0 || hasValidCoords[i] === 0) {
        continue;
      }
      const ring = ringIndex[i]!;
      if (ring >= 1 && ring <= maxEdgeRing) {
        outerBandCount += 1;
      } else if (ring > maxEdgeRing) {
        interiorCount += 1;
      }
    }
    return { outerBandCount, interiorCount };
  }, [lot, overlayHighlightMask, overlayHighlightCount]);

  const waferHighlightStats = React.useMemo(() => {
    const wafer = lot.wafers[waferIndex];
    if (
      overlayHighlightCount === 0 ||
      !wafer ||
      overlayHighlightMask.length < wafer.dieEndIndex
    ) {
      return { waferCount: 0, waferOuterBandCount: 0 };
    }
    const { hasValidCoords, ringIndex } = lot.dies;
    const maxEdgeRing = CLASSIFIER_THRESHOLDS.EDGE_RING_BAND;
    let waferCount = 0;
    let waferOuterBandCount = 0;
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (overlayHighlightMask[i] === 0 || hasValidCoords[i] === 0) {
        continue;
      }
      waferCount += 1;
      const ring = ringIndex[i]!;
      if (ring >= 1 && ring <= maxEdgeRing) {
        waferOuterBandCount += 1;
      }
    }
    return { waferCount, waferOuterBandCount };
  }, [lot, waferIndex, overlayHighlightMask, overlayHighlightCount]);

  const syncWrapperDebugAttrs = React.useCallback((): void => {
    const wrapperEl = wrapperRef.current;
    if (!wrapperEl) {
      return;
    }
    const anim = animStateRef.current;
    wrapperEl.dataset.glowPhase = anim.phase;
    wrapperEl.dataset.glowMode = anim.schedule?.mode ?? '';
    wrapperEl.dataset.scrimAlpha = anim.liveScrimAlpha.toFixed(3);
    let litCount = 0;
    for (let i = 0; i < anim.liveDieAlphas.length; i += 1) {
      if (anim.liveDieAlphas[i]! > 0.05) {
        litCount += 1;
      }
    }
    wrapperEl.dataset.litDieCount = String(litCount);
    wrapperEl.dataset.firstOrderedDie =
      anim.liveDieIndices.length > 0 ? String(anim.liveDieIndices[0]) : '';
  }, []);

  const buildCurrentGlowOverride =
    React.useCallback((): OverlayGlowSequenceOverride | null => {
      const anim = animStateRef.current;
      if (anim.phase === 'idle') {
        return null;
      }
      return {
        scrimAlpha: anim.liveScrimAlpha,
        dieIndices: anim.liveDieIndices,
        dieAlphas: anim.liveDieAlphas,
        ...(anim.outgoingIndices && anim.outgoingLiveAlphas
          ? {
              outgoingIndices: anim.outgoingIndices,
              outgoingAlphas: anim.outgoingLiveAlphas,
            }
          : {}),
      };
    }, []);

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

      const cur = latestRef.current;
      const resolvedDpr =
        cur.dpr ??
        (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const dims = resolveCanvasPixelSize(
        cur.safeCssWidth,
        cur.safeCssHeight,
        resolvedDpr,
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

      paintWaferOverlayLayer(ctx, {
        lot: cur.lot,
        waferIndex: cur.waferIndex,
        layout: resolvedLayout,
        dpr: dims.dpr,
        overlayHighlightMask: cur.overlayHighlightMask,
        overlayHighlightCount: cur.overlayHighlightCount,
        hoveredDieIndex: cur.hoveredDieIndex,
        brush: cur.brush,
        glowOverride: buildCurrentGlowOverride(),
        liveBrushScreenRect: liveBrushRectRef.current,
        probeHeadDieIndex: probeHeadDieIndexRef.current,
      });
      syncWrapperDebugAttrs();
    },
    [buildCurrentGlowOverride, syncWrapperDebugAttrs],
  );

  const paintCurrentNow = React.useCallback((): void => {
    const cur = latestRef.current;
    const cam = cur.getCamera ? cur.getCamera() : DEFAULT_CAMERA_STATE;
    const vp =
      cur.transform ??
      cameraToViewportTransform(cam, cur.safeCssWidth, cur.safeCssHeight);
    paintWithViewport(vp, cur.layout);
  }, [paintWithViewport]);

  const stopGlowRaf = React.useCallback((): void => {
    if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const stepGlowFrame = React.useCallback(
    (nowMs: number): void => {
      rafIdRef.current = null;
      const anim = animStateRef.current;
      let needsMoreFrames = false;

      // Update outgoing mid-switch fade if present (§5.4 step 7)
      if (
        anim.outgoingIndices &&
        anim.outgoingStartAlphas &&
        anim.outgoingLiveAlphas
      ) {
        const outElapsed = Math.max(0, nowMs - anim.outgoingStartTimeMs);
        if (outElapsed >= GLOW_EXIT_DURATION_MS) {
          anim.outgoingIndices = null;
          anim.outgoingStartAlphas = null;
          anim.outgoingLiveAlphas = null;
        } else {
          const k = 1 - sampleCubicEaseOut(outElapsed / GLOW_EXIT_DURATION_MS);
          for (let i = 0; i < anim.outgoingLiveAlphas.length; i += 1) {
            anim.outgoingLiveAlphas[i] = anim.outgoingStartAlphas[i]! * k;
          }
          needsMoreFrames = true;
        }
      }

      if (anim.phase === 'entering' && anim.schedule) {
        const elapsed = Math.max(0, nowMs - anim.startTimeMs);
        const scrimT = Math.min(1, elapsed / SCRIM_ENTER_DURATION_MS);
        anim.liveScrimAlpha =
          anim.scrimStartAlpha +
          (DIM_SCRIM_MAX_ALPHA - anim.scrimStartAlpha) *
            sampleCubicEaseOut(scrimT);

        let allSettled = scrimT >= 1 && elapsed >= GLOW_TOTAL_DURATION_MS;
        const n = anim.schedule.dieIndices.length;
        if (n > 0 && elapsed < GLOW_TOTAL_DURATION_MS) {
          let everyDieFull = scrimT >= 1;
          for (let r = 0; r < n; r += 1) {
            const localMs = elapsed - anim.schedule.delaysMs[r]!;
            if (localMs <= 0) {
              anim.liveDieAlphas[r] = 0;
              everyDieFull = false;
            } else if (localMs >= GLOW_DIE_FADE_DURATION_MS) {
              anim.liveDieAlphas[r] = 1;
            } else {
              anim.liveDieAlphas[r] = sampleCubicEaseOut(
                localMs / GLOW_DIE_FADE_DURATION_MS,
              );
              everyDieFull = false;
            }
          }
          allSettled = everyDieFull;
        } else {
          anim.liveDieAlphas.fill(1);
        }

        if (allSettled) {
          anim.liveScrimAlpha = DIM_SCRIM_MAX_ALPHA;
          anim.liveDieAlphas.fill(1);
          anim.phase = 'settled';
        } else {
          needsMoreFrames = true;
        }
      } else if (anim.phase === 'exiting') {
        const elapsed = Math.max(0, nowMs - anim.startTimeMs);
        if (elapsed >= GLOW_EXIT_DURATION_MS) {
          animStateRef.current = createIdleAnimatorState(
            latestRef.current.waferIndex,
          );
        } else {
          const k = 1 - sampleCubicEaseOut(elapsed / GLOW_EXIT_DURATION_MS);
          anim.liveScrimAlpha = anim.scrimStartAlpha * k;
          if (anim.outgoingStartAlphas) {
            for (let i = 0; i < anim.liveDieAlphas.length; i += 1) {
              anim.liveDieAlphas[i] = anim.outgoingStartAlphas[i]! * k;
            }
          }
          needsMoreFrames = true;
        }
      }

      paintCurrentNow();

      if (needsMoreFrames && typeof requestAnimationFrame === 'function') {
        rafIdRef.current = requestAnimationFrame(stepGlowFrame);
      }
    },
    [paintCurrentNow],
  );

  // Transition glow/scrim state when claimHighlight or waferIndex changes (§5.4)
  React.useEffect(() => {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const anim = animStateRef.current;
    const nextClaimId = claimHighlight?.claimId ?? null;
    const reduced =
      reducedMotionRef.current || typeof requestAnimationFrame !== 'function';

    if (nextClaimId === null) {
      if (anim.phase === 'idle') {
        return;
      }
      stopGlowRaf();
      if (reduced || anim.liveScrimAlpha <= 0.005) {
        animStateRef.current = createIdleAnimatorState(waferIndex);
        paintCurrentNow();
        return;
      }
      const snapshotAlphas = new Float32Array(anim.liveDieAlphas);
      anim.phase = 'exiting';
      anim.claimId = null;
      anim.startTimeMs = now;
      anim.scrimStartAlpha = anim.liveScrimAlpha;
      anim.outgoingStartAlphas = snapshotAlphas;
      anim.outgoingIndices = null;
      anim.outgoingLiveAlphas = null;
      rafIdRef.current = requestAnimationFrame(stepGlowFrame);
      return;
    }

    const mode = claimHighlight?.glowOrderMode ?? 'centroid-distance';
    const schedule = computeOrderedGlowSchedule({
      lot,
      waferIndex,
      evidenceMask: claimHighlightMask,
      mode,
    });

    const isSameClaimNewWafer =
      anim.claimId === nextClaimId && anim.waferIndex !== waferIndex;

    if (reduced || (isSameClaimNewWafer && anim.phase === 'settled')) {
      stopGlowRaf();
      const alphas = new Float32Array(schedule.dieIndices.length);
      alphas.fill(1);
      animStateRef.current = {
        phase: 'settled',
        claimId: nextClaimId,
        waferIndex,
        schedule,
        startTimeMs: now,
        scrimStartAlpha: DIM_SCRIM_MAX_ALPHA,
        liveScrimAlpha: DIM_SCRIM_MAX_ALPHA,
        liveDieIndices: schedule.dieIndices,
        liveDieAlphas: alphas,
        outgoingIndices: null,
        outgoingStartAlphas: null,
        outgoingLiveAlphas: null,
        outgoingStartTimeMs: 0,
      };
      paintCurrentNow();
      return;
    }

    if (anim.claimId === nextClaimId && anim.waferIndex === waferIndex) {
      return;
    }

    stopGlowRaf();

    // §5.4 step 7: preserve outgoing glow fade when switching findings on the same wafer
    let outgoingIndices: Uint32Array | null = null;
    let outgoingStartAlphas: Float32Array | null = null;
    let outgoingLiveAlphas: Float32Array | null = null;
    if (
      anim.claimId !== null &&
      anim.claimId !== nextClaimId &&
      anim.waferIndex === waferIndex &&
      anim.liveDieIndices.length > 0
    ) {
      outgoingIndices = anim.liveDieIndices;
      outgoingStartAlphas = new Float32Array(anim.liveDieAlphas);
      outgoingLiveAlphas = new Float32Array(anim.liveDieAlphas);
    }

    const startScrim =
      anim.waferIndex === waferIndex ? anim.liveScrimAlpha : 0;
    const nextAlphas = new Float32Array(schedule.dieIndices.length);

    animStateRef.current = {
      phase: 'entering',
      claimId: nextClaimId,
      waferIndex,
      schedule,
      startTimeMs: now,
      scrimStartAlpha: startScrim,
      liveScrimAlpha: startScrim,
      liveDieIndices: schedule.dieIndices,
      liveDieAlphas: nextAlphas,
      outgoingIndices,
      outgoingStartAlphas,
      outgoingLiveAlphas,
      outgoingStartTimeMs: now,
    };

    paintCurrentNow();
    rafIdRef.current = requestAnimationFrame(stepGlowFrame);
  }, [
    claimHighlight,
    claimHighlightMask,
    lot,
    waferIndex,
    paintCurrentNow,
    stepGlowFrame,
    stopGlowRaf,
  ]);

  React.useEffect(() => {
    return () => stopGlowRaf();
  }, [stopGlowRaf]);

  React.useImperativeHandle(
    ref,
    () => ({
      paintForCamera(camera: CameraState): void {
        const cur = latestRef.current;
        if (
          cur.overlayHighlightCount === 0 &&
          cur.hoveredDieIndex === null &&
          cur.brush === null &&
          animStateRef.current.phase === 'idle' &&
          liveBrushRectRef.current === null &&
          probeHeadDieIndexRef.current === null
        ) {
          return;
        }
        const vp = cameraToViewportTransform(
          camera,
          cur.safeCssWidth,
          cur.safeCssHeight,
        );
        paintWithViewport(vp, null);
      },
      setLiveBrushScreenRect(rect: ScreenBox | null): void {
        if (liveBrushRectRef.current === null && rect === null) {
          return;
        }
        liveBrushRectRef.current = rect;
        paintCurrentNow();
      },
      setProbeHeadDieIndex(dieIndex: number | null): void {
        if (probeHeadDieIndexRef.current === dieIndex) {
          return;
        }
        probeHeadDieIndexRef.current = dieIndex;
        paintCurrentNow();
      },
      previewWafer(waferIndex: number): void {
        const cur = latestRef.current;
        if (
          waferIndex === cur.waferIndex ||
          waferIndex < 0 ||
          waferIndex >= cur.lot.wafers.length
        ) {
          return;
        }
        latestRef.current = {
          ...cur,
          waferIndex,
          layout: null,
          hoveredDieIndex: null,
        };
        const anim = animStateRef.current;
        const claimId = cur.claimHighlight?.claimId ?? null;
        if (anim.phase !== 'idle' || claimId !== null) {
          stopGlowRaf();
          if (claimId === null) {
            animStateRef.current = createIdleAnimatorState(waferIndex);
          } else {
            // Same finding, new wafer: show its evidence settled immediately (0 ms keyboard swap)
            const schedule = computeOrderedGlowSchedule({
              lot: cur.lot,
              waferIndex,
              evidenceMask: cur.claimHighlightMask,
              mode: cur.claimHighlight?.glowOrderMode ?? 'centroid-distance',
            });
            const alphas = new Float32Array(schedule.dieIndices.length);
            alphas.fill(1);
            animStateRef.current = {
              phase: 'settled',
              claimId,
              waferIndex,
              schedule,
              startTimeMs:
                typeof performance !== 'undefined'
                  ? performance.now()
                  : Date.now(),
              scrimStartAlpha: DIM_SCRIM_MAX_ALPHA,
              liveScrimAlpha: DIM_SCRIM_MAX_ALPHA,
              liveDieIndices: schedule.dieIndices,
              liveDieAlphas: alphas,
              outgoingIndices: null,
              outgoingStartAlphas: null,
              outgoingLiveAlphas: null,
              outgoingStartTimeMs: 0,
            };
          }
        }
        paintCurrentNow();
      },
    }),
    [paintCurrentNow, paintWithViewport, stopGlowRaf],
  );

  React.useEffect(() => {
    paintCurrentNow();
  }, [
    lot,
    waferIndex,
    safeCssWidth,
    safeCssHeight,
    transform,
    getCamera,
    dpr,
    layout,
    overlayHighlightMask,
    overlayHighlightCount,
    hoveredDieIndex,
    brush,
    paintCurrentNow,
  ]);

  return (
    <div
      ref={wrapperRef}
      data-testid="wafer-overlay-wrapper"
      data-highlight-count={overlayHighlightCount}
      data-hovered-die={hoveredDieIndex !== null ? hoveredDieIndex : ''}
      data-outer-band-highlight-count={lotHighlightStats.outerBandCount}
      data-interior-highlight-count={lotHighlightStats.interiorCount}
      data-wafer-highlight-count={waferHighlightStats.waferCount}
      data-wafer-outer-band-highlight-count={
        waferHighlightStats.waferOuterBandCount
      }
      data-glow-phase="idle"
      data-scrim-alpha="0.000"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-overlay)]"
    >
      <canvas
        ref={canvasRef}
        data-testid="wafer-overlay-canvas"
        aria-hidden="true"
        style={{ width: `${safeCssWidth}px`, height: `${safeCssHeight}px` }}
        className="pointer-events-none absolute top-0 left-0 block select-none"
      />
    </div>
  );
});

export const OverlayCanvas = React.memo(OverlayCanvasImpl);
