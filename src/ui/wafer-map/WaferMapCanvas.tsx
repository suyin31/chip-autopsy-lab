'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { YieldMetrics } from '@/core/analytics';
import {
  buildWaferProbeOrder,
  type LotModel,
  packWaferCoord,
} from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { SegmentedControl, type SegmentedControlOption } from '@/ui/primitives';
import { cn } from '@/ui/primitives/cn';
import {
  type SelectionStoreState,
  type SpatialBrushRect,
  useSelectionStore,
  type WaferColorMode,
} from '@/ui/state';
import { SPRING_PHYSICS_EQUIVALENTS } from '@/ui/tokens';
import { BaseCanvas, type BaseCanvasHandle } from './BaseCanvas';
import { BinLegend } from './BinLegend';
import { FailCanvas, type FailCanvasHandle } from './FailCanvas';
import { HoverMagnifier, type HoverMagnifierHandle } from './HoverMagnifier';
import {
  computeEvidenceFramingCamera,
  computeLiveBoxSelectStats,
  computePopoverPlacement,
  computeWaferEvidencePresence,
  sampleCubicEaseOut,
  type ScreenBox,
  screenRectToWaferGridBounds,
} from './linked-interactions';
import { OverlayCanvas, type OverlayCanvasHandle } from './OverlayCanvas';
import {
  computeProbeSweepFraction,
  type InitialRevealPlan,
  PROBE_SWEEP_FAIL_FADE_MS,
  PROBE_SWEEP_REVEAL_MS,
  PROBE_SWEEP_SESSION_KEY,
  readPrefersReducedMotionSync,
  resolveInitialRevealMode,
  VERDICT_RISE_SWEEP_THRESHOLD,
} from './probe-sweep';
import {
  SELECTION_POPOVER_WIDTH_PX,
  SelectionPopover,
  type SelectionPopoverHandle,
} from './SelectionPopover';
import { type WaferSelectOptions, WaferSelector } from './WaferSelector';
import {
  applyKeyboardZoom,
  type CameraState,
  cameraToViewportTransform,
  computeRelativeWrapperTransform,
  createWaferCameraController,
  DEFAULT_CAMERA_STATE,
  ensurePointWithinMargin,
  formatWrapperCssTransform,
  isCameraAtFit,
  stepSpring1D,
  type WaferCameraController,
} from './wafer-camera';
import {
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  dieCoordToCanvasRect,
  hitTestWaferDie,
  projectBrushToCanvasRect,
} from './wafer-geometry';

export interface WaferMapCanvasProps {
  readonly lot: LotModel;
  readonly byWaferYield: readonly YieldMetrics[];
  readonly probeOrderByWafer?: readonly Uint32Array[];
  readonly enableInitialReveal?: boolean;
  readonly onVerdictRevealTrigger?: () => void;
  readonly store?: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

const lotRevealPlanCache = new WeakMap<LotModel, InitialRevealPlan>();

export function peekLotInitialRevealPlan(
  lot: LotModel,
  prefersReducedMotion: boolean,
): InitialRevealPlan {
  if (prefersReducedMotion) {
    return { mode: 'reduced', fadeDurationMs: 120 };
  }
  const cached = lotRevealPlanCache.get(lot);
  if (cached) {
    return cached;
  }
  let seenInSession = false;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      seenInSession =
        window.sessionStorage.getItem(PROBE_SWEEP_SESSION_KEY) === '1';
    }
  } catch {
    seenInSession = false;
  }
  return resolveInitialRevealMode({
    seenInSession,
    prefersReducedMotion: false,
  });
}

type StageToolMode = 'pan' | 'select';

const INITIAL_STAGE_WIDTH_PX = 783;
const INITIAL_STAGE_HEIGHT_PX = 720;
const MIN_STAGE_DIM_PX = 200;
const MAX_A11Y_FAILING_DIES_ROWS = 200;
const TOUCH_LONG_PRESS_MS = 350;

interface StageDimensions {
  readonly width: number;
  readonly height: number;
}

interface ActiveBoxSelectDrag {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = React.useState<number>(1);

  React.useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    let cleanup: (() => void) | undefined;
    const subscribeDpr = (): void => {
      const current = window.devicePixelRatio || 1;
      setDpr(current);
      const mql = window.matchMedia(`(resolution: ${current}dppx)`);
      const handleChange = (): void => {
        cleanup?.();
        subscribeDpr();
      };
      mql.addEventListener('change', handleChange);
      cleanup = () => mql.removeEventListener('change', handleChange);
    };
    subscribeDpr();
    return () => cleanup?.();
  }, []);

  return dpr;
}

function isStageHudEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[data-stage-hud="true"]') !== null
  );
}

/**
 * Boxless Wafer Stage + Three-Layer Canvas + Physics Camera + Linked Interactions + Wafer Strip
 * (`src/ui/wafer-map/WaferMapCanvas.tsx`, `redesign.md` §3.4–§3.6, §4.7–§4.9, §4.14, §5.4–§5.8, §5.10).
 *
 * Performance guarantees:
 * - Zero React re-renders of `WaferMapCanvas` during pointer hover, wheel zoom, pinch, drag pan,
 *   inertia coasting, `Shift+drag` box selection, or `120 ms` settle re-raster.
 * - Two-stacked-base-canvas `160 ms` `ease-out` wafer crossfade on click/single-step, and `0 ms`
 *   instant swap on held `ArrowRight` (`event.repeat === true`) or `prefers-reduced-motion`.
 */
/**
 * Visually hidden table of failing dies on the active wafer (§4.7, §6.8). It follows the
 * stage through `useDeferredValue`, so a wafer change rebuilds its up-to-200 rows in an
 * interruptible background render instead of inside the input frame (§5.10).
 */
const FailingDiesTable = React.memo(function FailingDiesTable({
  lot,
  waferIndex,
}: {
  readonly lot: LotModel;
  readonly waferIndex: number;
}): React.JSX.Element {
  const { t } = useT();
  const deferredWaferIndex = React.useDeferredValue(waferIndex);
  const wafer = lot.wafers[deferredWaferIndex];
  const waferId = wafer?.waferId ?? 'W01';
  const rows = React.useMemo(() => {
    if (!wafer) {
      return [];
    }
    const nextRows: Array<{
      readonly idx: number;
      readonly x: number;
      readonly y: number;
      readonly siteLabel: string;
      readonly sbin: number;
      readonly hbin: number;
    }> = [];
    for (
      let i = wafer.dieStartIndex;
      i < wafer.dieEndIndex && nextRows.length < MAX_A11Y_FAILING_DIES_ROWS;
      i += 1
    ) {
      if (lot.dies.finalPass[i] !== 0 || lot.dies.hasValidCoords[i] === 0) {
        continue;
      }
      const site = lot.sites[lot.dies.siteIndex[i]!];
      nextRows.push({
        idx: i,
        x: lot.dies.x[i]!,
        y: lot.dies.y[i]!,
        siteLabel: site ? `Head ${site.headNum} · Site ${site.siteNum}` : '—',
        sbin: lot.dies.sbin[i]!,
        hbin: lot.dies.hbin[i]!,
      });
    }
    return nextRows;
  }, [wafer, lot.dies, lot.sites]);

  return (
    <table className="sr-only">
      <caption>
        {t('a11y.failingDiesTable', { wafer: waferId })}
      </caption>
      <thead>
        <tr>
          <th scope="col">X, Y</th>
          <th scope="col">Site</th>
          <th scope="col">SBIN</th>
          <th scope="col">HBIN</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowPos) => (
          <tr key={rowPos}>
            <td>
              ({row.x}, {row.y})
            </td>
            <td>{row.siteLabel}</td>
            <td>SBIN {row.sbin}</td>
            <td>HBIN {row.hbin}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

function WaferMapCanvasImpl({
  lot,
  byWaferYield,
  probeOrderByWafer,
  enableInitialReveal = false,
  onVerdictRevealTrigger,
  store = useSelectionStore,
  className,
}: WaferMapCanvasProps): React.JSX.Element {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const prefersReduced = readPrefersReducedMotionSync(shouldReduceMotion);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const cameraWrapperRef = React.useRef<HTMLDivElement>(null);
  const crossfadeCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const crossfadeAnimRef = React.useRef<Animation | null>(null);
  const topLightRef = React.useRef<HTMLDivElement>(null);
  const zoomPillRef = React.useRef<HTMLButtonElement>(null);
  const skipHintRef = React.useRef<HTMLParagraphElement>(null);
  const finishSweepRef = React.useRef<(() => void) | null>(null);
  const baseCanvasRef = React.useRef<BaseCanvasHandle>(null);
  const failCanvasRef = React.useRef<FailCanvasHandle>(null);
  const overlayCanvasRef = React.useRef<OverlayCanvasHandle>(null);
  const magnifierRef = React.useRef<HoverMagnifierHandle>(null);
  const selectionPopoverRef = React.useRef<SelectionPopoverHandle>(null);
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;

  const [stageDims, setStageDims] = React.useState<StageDimensions>({
    width: INITIAL_STAGE_WIDTH_PX,
    height: INITIAL_STAGE_HEIGHT_PX,
  });
  const [stageTool, setStageTool] = React.useState<StageToolMode>('pan');
  const dpr = useDevicePixelRatio();

  const stageToolRef = React.useRef<StageToolMode>('pan');
  stageToolRef.current = stageTool;

  const {
    storeLot,
    rawWaferIndex,
    rawColorMode,
    rawActiveTestNum,
    rawBrush,
    rawClaimHighlight,
    rawClaimMask,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawWaferIndex: s.activeWaferIndex,
      rawColorMode: s.colorMode,
      rawActiveTestNum: s.activeTestNum,
      rawBrush: s.brush,
      rawClaimHighlight: s.claimHighlight,
      rawClaimMask: s.claimHighlightMask,
    })),
  );

  const isSynced = storeLot === lot;
  const safeWaferIndex =
    lot.wafers.length === 0
      ? 0
      : Math.min(
          Math.max(0, isSynced ? rawWaferIndex : 0),
          lot.wafers.length - 1,
        );
  const colorMode: WaferColorMode = isSynced ? rawColorMode : 'pass-fail';
  const activeTestNum = isSynced ? rawActiveTestNum : null;
  const brush = isSynced ? rawBrush : null;
  const claimHighlight = isSynced ? rawClaimHighlight : null;
  const claimHighlightMask = isSynced ? rawClaimMask : null;

  const wafer = lot.wafers[safeWaferIndex];
  const waferYield = byWaferYield[safeWaferIndex];

  const fitLayout = React.useMemo(
    () =>
      wafer
        ? computeWaferRenderLayout(
            wafer,
            stageDims.width,
            stageDims.height,
            lot.dies,
            DEFAULT_VIEWPORT_TRANSFORM,
          )
        : null,
    [wafer, stageDims.width, stageDims.height, lot.dies],
  );

  const reducedMotionRef = React.useRef(prefersReduced);
  reducedMotionRef.current = prefersReduced;

  const probeOrderByWaferRef = React.useRef(probeOrderByWafer);
  probeOrderByWaferRef.current = probeOrderByWafer;
  const onVerdictRevealTriggerRef = React.useRef(onVerdictRevealTrigger);
  onVerdictRevealTriggerRef.current = onVerdictRevealTrigger;

  const stageMetricsRef = React.useRef({
    stageWidth: stageDims.width,
    stageHeight: stageDims.height,
    fitRadiusPx: fitLayout?.fitWaferRadiusPx ?? 312,
  });
  stageMetricsRef.current = {
    stageWidth: stageDims.width,
    stageHeight: stageDims.height,
    fitRadiusPx: fitLayout?.fitWaferRadiusPx ?? 312,
  };

  const waferGeometryRef = React.useRef({
    lot,
    wafer,
    safeWaferIndex,
    colorMode,
    brush,
  });
  waferGeometryRef.current = {
    lot,
    wafer,
    safeWaferIndex,
    colorMode,
    brush,
  };

  const userMovedCameraSinceFindingRef = React.useRef(false);
  const boxSelectDragRef = React.useRef<ActiveBoxSelectDrag | null>(null);
  const boxSelectRafRef = React.useRef<number | null>(null);
  const snapRectRafRef = React.useRef<number | null>(null);
  const touchLongPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const touchDownOriginRef = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  const activeWaferBrush = React.useMemo<SpatialBrushRect | null>(() => {
    if (!brush) {
      return null;
    }
    if (
      brush.scope === 'wafer' &&
      brush.waferIndex !== undefined &&
      brush.waferIndex !== safeWaferIndex
    ) {
      return null;
    }
    return brush;
  }, [brush, safeWaferIndex]);

  const committedBrushStats = React.useMemo(() => {
    if (!activeWaferBrush) {
      return null;
    }
    return computeLiveBoxSelectStats(
      lot,
      safeWaferIndex,
      activeWaferBrush,
      colorMode === 'hbin' ? 'HBIN' : 'SBIN',
    );
  }, [activeWaferBrush, lot, safeWaferIndex, colorMode]);

  const committedBrushStatsRef = React.useRef(committedBrushStats);
  committedBrushStatsRef.current = committedBrushStats;
  const activeWaferBrushRef = React.useRef(activeWaferBrush);
  activeWaferBrushRef.current = activeWaferBrush;

  const syncCommittedPopoverForCamera = React.useCallback(
    (camera: CameraState): void => {
      if (boxSelectDragRef.current !== null || snapRectRafRef.current !== null) {
        return;
      }
      const curBrush = activeWaferBrushRef.current;
      const curStats = committedBrushStatsRef.current;
      const curWafer = waferGeometryRef.current.wafer;
      const popHandle = selectionPopoverRef.current;
      if (!curBrush || !curStats || !curWafer || !popHandle) {
        return;
      }
      const { stageWidth, stageHeight } = stageMetricsRef.current;
      const vp = cameraToViewportTransform(camera, stageWidth, stageHeight);
      const liveLayout = computeWaferRenderLayout(
        curWafer,
        stageWidth,
        stageHeight,
        waferGeometryRef.current.lot.dies,
        vp,
      );
      const screenRect = projectBrushToCanvasRect(curBrush, liveLayout);
      const popPos = computePopoverPlacement({
        rect: screenRect,
        popoverWidth: SELECTION_POPOVER_WIDTH_PX,
        popoverHeight: popHandle.getMeasuredHeight(),
        stageWidth,
        stageHeight,
      });
      popHandle.updateLiveFrame({
        ...popPos,
        stats: curStats,
        visible: true,
      });
    },
    [],
  );

  const syncTopLightForRaster = React.useCallback(
    (rasterScale: number, rasterTx: number, rasterTy: number): void => {
      const topLightEl = topLightRef.current;
      const curWafer = waferGeometryRef.current.wafer;
      if (!topLightEl || !curWafer) {
        return;
      }
      const { stageWidth, stageHeight } = stageMetricsRef.current;
      const vp = cameraToViewportTransform(
        { scale: rasterScale, tx: rasterTx, ty: rasterTy },
        stageWidth,
        stageHeight,
      );
      const rasterLayout = computeWaferRenderLayout(
        curWafer,
        stageWidth,
        stageHeight,
        waferGeometryRef.current.lot.dies,
        vp,
      );
      const diam = rasterLayout.waferRadiusPx * 2;
      topLightEl.style.width = `${diam}px`;
      topLightEl.style.height = `${diam}px`;
      topLightEl.style.left = `${rasterLayout.centerXCss - rasterLayout.waferRadiusPx}px`;
      topLightEl.style.top = `${rasterLayout.centerYCss - rasterLayout.waferRadiusPx}px`;
    },
    [],
  );

  const controllerRef = React.useRef<WaferCameraController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createWaferCameraController({
      getStageMetrics: () => stageMetricsRef.current,
      getPrefersReducedMotion: () => reducedMotionRef.current,
      onTransformFrame: ({ camera, wrapperCssTransform, motionActive }) => {
        const wrapperEl = cameraWrapperRef.current;
        if (wrapperEl) {
          wrapperEl.style.transform = wrapperCssTransform;
          wrapperEl.style.willChange = motionActive ? 'transform' : 'auto';
        }
        const stageEl = stageRef.current;
        if (stageEl) {
          stageEl.style.touchAction =
            stageToolRef.current === 'select' || camera.scale > 1.001
              ? 'none'
              : 'pan-y';
        }
        const zoomPillEl = zoomPillRef.current;
        if (zoomPillEl) {
          const atFit = isCameraAtFit(camera);
          zoomPillEl.hidden = atFit;
          if (!atFit) {
            const label = `${Math.round(camera.scale * 100)}%`;
            if (zoomPillEl.textContent !== label) {
              zoomPillEl.textContent = label;
            }
          }
        }
        overlayCanvasRef.current?.paintForCamera(camera);
        magnifierRef.current?.syncPositionForCamera();
        syncCommittedPopoverForCamera(camera);
      },
      onSettleReRaster: (rasterCamera) => {
        baseCanvasRef.current?.paintForCamera(rasterCamera);
        syncTopLightForRaster(
          rasterCamera.scale,
          rasterCamera.tx,
          rasterCamera.ty,
        );
      },
      onRestoreFitRaster: () => {
        baseCanvasRef.current?.paintForCamera(DEFAULT_CAMERA_STATE);
        syncTopLightForRaster(1, 0, 0);
      },
    });
  }

  const getCamera = React.useCallback(
    () => controllerRef.current?.getCamera() ?? DEFAULT_CAMERA_STATE,
    [],
  );
  const getRasterCamera = React.useCallback(
    () => controllerRef.current?.getRasterCamera() ?? DEFAULT_CAMERA_STATE,
    [],
  );
  const getBaseCanvasElement = React.useCallback(
    () => baseCanvasRef.current?.getCanvasElement() ?? null,
    [],
  );

  const cancelCrossfadeImmediately = React.useCallback((): void => {
    if (crossfadeAnimRef.current) {
      crossfadeAnimRef.current.cancel();
      crossfadeAnimRef.current = null;
    }
    const cf = crossfadeCanvasRef.current;
    if (cf) {
      cf.style.opacity = '0';
      cf.style.visibility = 'hidden';
      cf.dataset.crossfading = 'false';
    }
  }, []);

  const cancelSnapAnimation = React.useCallback((): void => {
    if (
      snapRectRafRef.current !== null &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(snapRectRafRef.current);
      snapRectRafRef.current = null;
    }
  }, []);

  const clearTouchLongPress = React.useCallback((): void => {
    if (touchLongPressTimerRef.current !== null) {
      clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
  }, []);

  // §5.1 Probe-sweep load reveal (once per session, <= 1,200 ms, skippable by any key/click/tap, 240 ms subsequent fade, 120 ms reduced motion)
  React.useLayoutEffect(() => {
    if (
      !enableInitialReveal ||
      typeof window === 'undefined' ||
      typeof requestAnimationFrame !== 'function'
    ) {
      baseCanvasRef.current?.setSweepSuppressAutoPaint(false);
      if (stageRef.current) {
        stageRef.current.dataset.sweep = 'done';
      }
      if (skipHintRef.current) {
        skipHintRef.current.hidden = true;
      }
      onVerdictRevealTriggerRef.current?.();
      return;
    }

    const plan = peekLotInitialRevealPlan(lot, reducedMotionRef.current);
    lotRevealPlanCache.set(lot, plan);
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(PROBE_SWEEP_SESSION_KEY, '1');
      }
    } catch {
      // Ignore storage restrictions in private sandboxes
    }

    if (plan.mode !== 'sweep') {
      finishSweepRef.current = null;
      baseCanvasRef.current?.setSweepSuppressAutoPaint(false);
      overlayCanvasRef.current?.setProbeHeadDieIndex(null);
      failCanvasRef.current?.setOpacity(0);
      if (skipHintRef.current) {
        skipHintRef.current.hidden = true;
      }
      if (stageRef.current) {
        stageRef.current.dataset.sweep = 'done';
      }
      onVerdictRevealTriggerRef.current?.();

      const baseEl = baseCanvasRef.current?.getCanvasElement();
      if (
        baseEl &&
        typeof baseEl.animate === 'function' &&
        plan.fadeDurationMs > 0 &&
        !reducedMotionRef.current
      ) {
        const anim = baseEl.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: plan.fadeDurationMs,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        });
        return () => anim.cancel();
      }
      return;
    }

    const waferIdx = waferGeometryRef.current.safeWaferIndex;
    const probeOrder =
      probeOrderByWaferRef.current?.[waferIdx] ??
      buildWaferProbeOrder(lot, waferIdx);

    if (probeOrder.length === 0) {
      baseCanvasRef.current?.setSweepSuppressAutoPaint(false);
      if (stageRef.current) {
        stageRef.current.dataset.sweep = 'done';
      }
      onVerdictRevealTriggerRef.current?.();
      return;
    }

    if (stageRef.current) {
      stageRef.current.dataset.sweep = 'running';
    }
    if (skipHintRef.current) {
      skipHintRef.current.hidden = false;
    }

    baseCanvasRef.current?.setSweepSuppressAutoPaint(true);
    baseCanvasRef.current?.paintSubstrateOnly();
    failCanvasRef.current?.paintForCamera(DEFAULT_CAMERA_STATE);
    failCanvasRef.current?.setOpacity(0);

    let lastStageW = stageMetricsRef.current.stageWidth;
    let lastStageH = stageMetricsRef.current.stageHeight;
    let revealedCount = 0;
    let verdictTriggered = false;
    let finished = false;
    let rafId: number | null = null;
    const startMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const totalSweepMs = PROBE_SWEEP_REVEAL_MS + PROBE_SWEEP_FAIL_FADE_MS;

    const cleanupInputListeners = (): void => {
      window.removeEventListener('keydown', handleSkipInput, true);
      window.removeEventListener('pointerdown', handleSkipInput, true);
    };

    const completeSweep = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      finishSweepRef.current = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      cleanupInputListeners();
      lotRevealPlanCache.set(lot, {
        mode: 'subsequent-fade',
        fadeDurationMs: 0,
      });

      baseCanvasRef.current?.setSweepSuppressAutoPaint(false);
      overlayCanvasRef.current?.setProbeHeadDieIndex(null);
      failCanvasRef.current?.setOpacity(0);
      failCanvasRef.current?.clear();
      baseCanvasRef.current?.paintForCamera(getRasterCamera());

      if (!verdictTriggered) {
        verdictTriggered = true;
        onVerdictRevealTriggerRef.current?.();
      }
      if (skipHintRef.current) {
        skipHintRef.current.hidden = true;
      }
      if (stageRef.current) {
        stageRef.current.dataset.sweep = 'done';
      }
    };

    function handleSkipInput(): void {
      completeSweep();
    }

    finishSweepRef.current = completeSweep;
    window.addEventListener('keydown', handleSkipInput, true);
    window.addEventListener('pointerdown', handleSkipInput, true);

    const stepSweep = (nowMs: number): void => {
      if (finished) {
        return;
      }
      if (reducedMotionRef.current) {
        completeSweep();
        return;
      }

      // Re-sync substrate + revealed batch if ResizeObserver updated stage dimensions on initial layout
      const curW = stageMetricsRef.current.stageWidth;
      const curH = stageMetricsRef.current.stageHeight;
      if (curW !== lastStageW || curH !== lastStageH) {
        lastStageW = curW;
        lastStageH = curH;
        baseCanvasRef.current?.paintSubstrateOnly();
        if (revealedCount > 0) {
          baseCanvasRef.current?.paintSweepBatch(probeOrder, 0, revealedCount);
        }
        failCanvasRef.current?.paintForCamera(DEFAULT_CAMERA_STATE);
      }

      const elapsed = Math.max(0, nowMs - startMs);
      const revealFrac = computeProbeSweepFraction(
        elapsed,
        PROBE_SWEEP_REVEAL_MS,
        1,
      );
      const targetCount = Math.min(
        probeOrder.length,
        Math.floor(revealFrac * probeOrder.length),
      );

      if (targetCount > revealedCount) {
        baseCanvasRef.current?.paintSweepBatch(
          probeOrder,
          revealedCount,
          targetCount,
        );
        revealedCount = targetCount;
      }

      if (!verdictTriggered && revealFrac >= VERDICT_RISE_SWEEP_THRESHOLD) {
        verdictTriggered = true;
        onVerdictRevealTriggerRef.current?.();
      }

      if (elapsed < PROBE_SWEEP_REVEAL_MS) {
        const headDie =
          revealedCount > 0 ? probeOrder[revealedCount - 1]! : null;
        overlayCanvasRef.current?.setProbeHeadDieIndex(headDie);
        rafId = requestAnimationFrame(stepSweep);
        return;
      }

      // Reveal reached 100%: ensure all pass dies drawn, clear probe lamp, fade FailCanvas 0 -> 1 over 280 ms
      if (revealedCount < probeOrder.length) {
        baseCanvasRef.current?.paintSweepBatch(
          probeOrder,
          revealedCount,
          probeOrder.length,
        );
        revealedCount = probeOrder.length;
      }
      overlayCanvasRef.current?.setProbeHeadDieIndex(null);

      if (elapsed >= totalSweepMs) {
        completeSweep();
        return;
      }

      const failFadeT = (elapsed - PROBE_SWEEP_REVEAL_MS) / PROBE_SWEEP_FAIL_FADE_MS;
      failCanvasRef.current?.setOpacity(sampleCubicEaseOut(failFadeT));
      rafId = requestAnimationFrame(stepSweep);
    };

    rafId = requestAnimationFrame(stepSweep);

    return () => {
      finishSweepRef.current = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      cleanupInputListeners();
      baseCanvasRef.current?.setSweepSuppressAutoPaint(false);
      overlayCanvasRef.current?.setProbeHeadDieIndex(null);
      failCanvasRef.current?.setOpacity(0);
    };
  }, [lot, enableInitialReveal, getRasterCamera]);

  React.useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      cancelCrossfadeImmediately();
      cancelSnapAnimation();
      clearTouchLongPress();
      if (
        boxSelectRafRef.current !== null &&
        typeof cancelAnimationFrame === 'function'
      ) {
        cancelAnimationFrame(boxSelectRafRef.current);
      }
      controller?.dispose();
    };
  }, [cancelCrossfadeImmediately, cancelSnapAnimation, clearTouchLongPress]);

  // Reset camera cleanly when a new lot is opened; preserve camera across wafers in the same lot (§5.8)
  const prevLotRef = React.useRef<LotModel>(lot);
  React.useEffect(() => {
    if (prevLotRef.current !== lot) {
      prevLotRef.current = lot;
      userMovedCameraSinceFindingRef.current = false;
      cancelCrossfadeImmediately();
      cancelSnapAnimation();
      overlayCanvasRef.current?.setLiveBrushScreenRect(null);
      controllerRef.current?.resetToFit(false);
    }
  }, [lot, cancelCrossfadeImmediately, cancelSnapAnimation]);

  // §3.5 & §5.4: Finding camera frame on select, return-to-fit on clear, and mobile stage scroll
  const prevClaimIdRef = React.useRef<string | null>(
    claimHighlight?.claimId ?? null,
  );
  React.useEffect(() => {
    const nextClaimId = claimHighlight?.claimId ?? null;
    const prevClaimId = prevClaimIdRef.current;
    if (prevClaimId === nextClaimId) {
      return;
    }
    prevClaimIdRef.current = nextClaimId;

    const controller = controllerRef.current;
    if (!controller) {
      return;
    }

    if (nextClaimId === null) {
      if (!userMovedCameraSinceFindingRef.current) {
        controller.resetToFit(true);
      }
      return;
    }

    userMovedCameraSinceFindingRef.current = false;
    if (fitLayout && claimHighlightMask) {
      const targetCam = computeEvidenceFramingCamera({
        lot,
        waferIndex: safeWaferIndex,
        dieMask: claimHighlightMask,
        fitLayout,
        stageWidth: stageDims.width,
        stageHeight: stageDims.height,
      });
      controller.animateToCamera(targetCam);
    }

    // §3.5 Mobile: scroll page so stage top sits 8 px below sticky nav (48 px mobile / 52 px tablet)
    if (
      typeof window !== 'undefined' &&
      window.innerWidth < 1280 &&
      stageRef.current
    ) {
      const stageRect = stageRef.current.getBoundingClientRect();
      const navHeight = window.innerWidth < 768 ? 48 : 52;
      const targetScrollY = Math.max(
        0,
        window.scrollY + stageRect.top - navHeight - 8,
      );
      if (Math.abs(window.scrollY - targetScrollY) > 12) {
        window.scrollTo({
          top: targetScrollY,
          behavior: reducedMotionRef.current ? 'instant' : 'smooth',
        });
      }
    }
  }, [
    claimHighlight,
    claimHighlightMask,
    fitLayout,
    lot,
    safeWaferIndex,
    stageDims.width,
    stageDims.height,
  ]);

  // Keep committed SelectionPopover positioned when brush, wafer, or stage dimensions update
  React.useLayoutEffect(() => {
    if (activeWaferBrush && committedBrushStats) {
      syncCommittedPopoverForCamera(getCamera());
    } else if (boxSelectDragRef.current === null) {
      overlayCanvasRef.current?.setLiveBrushScreenRect(null);
    }
  }, [
    activeWaferBrush,
    committedBrushStats,
    getCamera,
    syncCommittedPopoverForCamera,
  ]);

  // Keep imperative wrapper transform, top-light raster geometry, and touch-action synced across stage resizes or discrete store re-renders
  React.useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const cam = controller.getCamera();
    const rasterCam = controller.getRasterCamera();
    const wrapperEl = cameraWrapperRef.current;
    if (wrapperEl) {
      wrapperEl.style.transform = formatWrapperCssTransform(
        computeRelativeWrapperTransform(cam, rasterCam),
      );
    }
    const stageEl = stageRef.current;
    if (stageEl) {
      stageEl.style.touchAction =
        stageTool === 'select' || cam.scale > 1.001 ? 'none' : 'pan-y';
    }
    syncTopLightForRaster(rasterCam.scale, rasterCam.tx, rasterCam.ty);
  }, [fitLayout, safeWaferIndex, stageTool, syncTopLightForRaster]);

  // Measure actual stage CSS dimensions via ResizeObserver
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const updateDims = (rawW: number, rawH: number): void => {
      const nextW = Math.max(MIN_STAGE_DIM_PX, Math.round(rawW));
      const nextH = Math.max(
        MIN_STAGE_DIM_PX,
        Math.round(rawH > 0 ? rawH : rawW),
      );
      setStageDims((prev) =>
        prev.width !== nextW || prev.height !== nextH
          ? { width: nextW, height: nextH }
          : prev,
      );
    };
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      updateDims(rect.width, rect.height);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        updateDims(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Non-passive wheel listener for cursor-anchored 1:1 zoom (§5.5)
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const handleNativeWheel = (event: WheelEvent): void => {
      if (isStageHudEventTarget(event.target)) {
        return;
      }
      event.preventDefault();
      finishSweepRef.current?.();
      userMovedCameraSinceFindingRef.current = true;
      const bounds = el.getBoundingClientRect();
      controllerRef.current?.handleWheel({
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        pointerX: event.clientX - bounds.left,
        pointerY: event.clientY - bounds.top,
      });
    };
    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, []);

  const hitTestAtStagePoint = React.useCallback(
    (pointerX: number, pointerY: number): number | null => {
      const curWafer = waferGeometryRef.current.wafer;
      if (!curWafer) {
        return null;
      }
      const { stageWidth, stageHeight } = stageMetricsRef.current;
      const cam = controllerRef.current?.getCamera() ?? DEFAULT_CAMERA_STATE;
      const vp = cameraToViewportTransform(cam, stageWidth, stageHeight);
      const liveLayout = computeWaferRenderLayout(
        curWafer,
        stageWidth,
        stageHeight,
        lot.dies,
        vp,
      );
      return hitTestWaferDie(
        pointerX,
        pointerY,
        liveLayout,
        lot.waferCoordIndex[safeWaferIndex],
      );
    },
    [lot.dies, lot.waferCoordIndex, safeWaferIndex],
  );

  const flushBoxSelectFrame = React.useCallback((): void => {
    boxSelectRafRef.current = null;
    const drag = boxSelectDragRef.current;
    const curWafer = waferGeometryRef.current.wafer;
    if (!drag || !curWafer) {
      return;
    }
    const { stageWidth, stageHeight } = stageMetricsRef.current;
    const left = Math.max(0, Math.min(drag.startX, drag.currentX));
    const right = Math.min(stageWidth, Math.max(drag.startX, drag.currentX));
    const top = Math.max(0, Math.min(drag.startY, drag.currentY));
    const bottom = Math.min(stageHeight, Math.max(drag.startY, drag.currentY));
    const screenRect: ScreenBox = {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };

    overlayCanvasRef.current?.setLiveBrushScreenRect(screenRect);

    const dragDist = Math.hypot(
      drag.currentX - drag.startX,
      drag.currentY - drag.startY,
    );
    if (dragDist < 8) {
      return;
    }

    const cam = controllerRef.current?.getCamera() ?? DEFAULT_CAMERA_STATE;
    const vp = cameraToViewportTransform(cam, stageWidth, stageHeight);
    const liveLayout = computeWaferRenderLayout(
      curWafer,
      stageWidth,
      stageHeight,
      waferGeometryRef.current.lot.dies,
      vp,
    );
    const bounds = screenRectToWaferGridBounds(
      {
        x0: left,
        y0: top,
        x1: right,
        y1: bottom,
      },
      liveLayout,
      curWafer,
    );
    const stats = computeLiveBoxSelectStats(
      waferGeometryRef.current.lot,
      waferGeometryRef.current.safeWaferIndex,
      bounds,
      waferGeometryRef.current.colorMode === 'hbin' ? 'HBIN' : 'SBIN',
    );
    const popHandle = selectionPopoverRef.current;
    if (popHandle) {
      const popPos = computePopoverPlacement({
        rect: screenRect,
        popoverWidth: SELECTION_POPOVER_WIDTH_PX,
        popoverHeight: popHandle.getMeasuredHeight(),
        stageWidth,
        stageHeight,
      });
      popHandle.updateLiveFrame({
        ...popPos,
        stats,
        visible: true,
      });
    }
  }, []);

  const animateBrushSnap = React.useCallback(
    (
      fromRect: ScreenBox,
      committedBrush: SpatialBrushRect,
      committedStats: ReturnType<typeof computeLiveBoxSelectStats>,
    ): void => {
      cancelSnapAnimation();
      const curWafer = waferGeometryRef.current.wafer;
      if (
        !curWafer ||
        reducedMotionRef.current ||
        typeof requestAnimationFrame !== 'function'
      ) {
        overlayCanvasRef.current?.setLiveBrushScreenRect(null);
        return;
      }

      const { stageWidth, stageHeight } = stageMetricsRef.current;
      const cam = controllerRef.current?.getCamera() ?? DEFAULT_CAMERA_STATE;
      const vp = cameraToViewportTransform(cam, stageWidth, stageHeight);
      const liveLayout = computeWaferRenderLayout(
        curWafer,
        stageWidth,
        stageHeight,
        waferGeometryRef.current.lot.dies,
        vp,
      );
      const targetRect = projectBrushToCanvasRect(committedBrush, liveLayout);

      let lPos = fromRect.x;
      let tPos = fromRect.y;
      let rPos = fromRect.x + fromRect.width;
      let bPos = fromRect.y + fromRect.height;
      let lVel = 0;
      let tVel = 0;
      let rVel = 0;
      let bVel = 0;
      const lTarget = targetRect.x;
      const tTarget = targetRect.y;
      const rTarget = targetRect.x + targetRect.width;
      const bTarget = targetRect.y + targetRect.height;

      const spring = {
        stiffness: SPRING_PHYSICS_EQUIVALENTS.snappy.stiffness,
        damping: SPRING_PHYSICS_EQUIVALENTS.snappy.damping,
        mass: SPRING_PHYSICS_EQUIVALENTS.snappy.mass,
      };
      let lastMs =
        typeof performance !== 'undefined' ? performance.now() : Date.now();

      const step = (nowMs: number): void => {
        const dt = Math.max(0.001, (nowMs - lastMs) / 1000);
        lastMs = nowMs;

        const sL = stepSpring1D(lPos, lVel, lTarget, spring, dt, 0.2, 2);
        const sT = stepSpring1D(tPos, tVel, tTarget, spring, dt, 0.2, 2);
        const sR = stepSpring1D(rPos, rVel, rTarget, spring, dt, 0.2, 2);
        const sB = stepSpring1D(bPos, bVel, bTarget, spring, dt, 0.2, 2);

        lPos = sL.position;
        lVel = sL.velocity;
        tPos = sT.position;
        tVel = sT.velocity;
        rPos = sR.position;
        rVel = sR.velocity;
        bPos = sB.position;
        bVel = sB.velocity;

        const settled = sL.settled && sT.settled && sR.settled && sB.settled;
        if (settled) {
          snapRectRafRef.current = null;
          overlayCanvasRef.current?.setLiveBrushScreenRect(null);
          const popHandle = selectionPopoverRef.current;
          if (popHandle) {
            const popPos = computePopoverPlacement({
              rect: targetRect,
              popoverWidth: SELECTION_POPOVER_WIDTH_PX,
              popoverHeight: popHandle.getMeasuredHeight(),
              stageWidth,
              stageHeight,
            });
            popHandle.updateLiveFrame({
              ...popPos,
              stats: committedStats,
              visible: true,
            });
          }
          return;
        }

        const liveRect: ScreenBox = {
          x: Math.min(lPos, rPos),
          y: Math.min(tPos, bPos),
          width: Math.max(1, Math.abs(rPos - lPos)),
          height: Math.max(1, Math.abs(bPos - tPos)),
        };
        overlayCanvasRef.current?.setLiveBrushScreenRect(liveRect);
        const popHandle = selectionPopoverRef.current;
        if (popHandle) {
          const popPos = computePopoverPlacement({
            rect: liveRect,
            popoverWidth: SELECTION_POPOVER_WIDTH_PX,
            popoverHeight: popHandle.getMeasuredHeight(),
            stageWidth,
            stageHeight,
          });
          popHandle.updateLiveFrame({
            ...popPos,
            stats: committedStats,
            visible: true,
          });
        }
        snapRectRafRef.current = requestAnimationFrame(step);
      };

      snapRectRafRef.current = requestAnimationFrame(step);
    },
    [cancelSnapAnimation],
  );

  const capturedPointersRef = React.useRef<Set<number>>(new Set());

  const captureStagePointer = (
    el: HTMLDivElement,
    pointerId: number,
  ): void => {
    if (
      !capturedPointersRef.current.has(pointerId) &&
      typeof el.setPointerCapture === 'function'
    ) {
      try {
        el.setPointerCapture(pointerId);
        capturedPointersRef.current.add(pointerId);
      } catch {
        // Ignore synthetic pointer events without active browser pointer id
      }
    }
  };

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (isStageHudEventTarget(event.target)) {
        return;
      }
      const el = event.currentTarget;
      if (typeof performance !== 'undefined') {
        el.dataset.ack = String(performance.now());
      }
      if (event.pointerType === 'mouse' && event.button === 0) {
        el.focus({ preventScroll: true });
      }
      const bounds = el.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;

      // Immediate box-select trigger: Shift+drag or Select tool (§3.6, §5.7)
      if (
        event.button === 0 &&
        (event.shiftKey || stageToolRef.current === 'select')
      ) {
        event.preventDefault();
        clearTouchLongPress();
        cancelSnapAnimation();
        boxSelectDragRef.current = {
          pointerId: event.pointerId,
          startX: pointerX,
          startY: pointerY,
          currentX: pointerX,
          currentY: pointerY,
        };
        magnifierRef.current?.setGestureSuppressed(true);
        captureStagePointer(el, event.pointerId);
        return;
      }

      // Mobile 350 ms long-press to start box select (§3.6)
      if (event.pointerType === 'touch' && event.button === 0) {
        clearTouchLongPress();
        touchDownOriginRef.current = {
          pointerId: event.pointerId,
          x: pointerX,
          y: pointerY,
        };
        touchLongPressTimerRef.current = setTimeout(() => {
          touchLongPressTimerRef.current = null;
          const origin = touchDownOriginRef.current;
          if (!origin || controllerRef.current?.isDragging()) {
            return;
          }
          cancelSnapAnimation();
          boxSelectDragRef.current = {
            pointerId: origin.pointerId,
            startX: origin.x,
            startY: origin.y,
            currentX: origin.x,
            currentY: origin.y,
          };
          magnifierRef.current?.setGestureSuppressed(true);
          captureStagePointer(el, origin.pointerId);
        }, TOUCH_LONG_PRESS_MS);
      }

      const startedPinch = controllerRef.current?.handlePointerDown({
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        button: event.button,
        shiftKey: event.shiftKey,
        x: pointerX,
        y: pointerY,
        timeMs: event.timeStamp || performance.now(),
      });
      if (startedPinch) {
        clearTouchLongPress();
        userMovedCameraSinceFindingRef.current = true;
        magnifierRef.current?.setGestureSuppressed(true);
        captureStagePointer(el, event.pointerId);
      }
    },
    [cancelSnapAnimation, clearTouchLongPress],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const el = event.currentTarget;
      const bounds = el.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;

      // Active box-select drag: update live rect & popover in rAF with 0 React renders (§5.7, §5.10)
      if (
        boxSelectDragRef.current !== null &&
        boxSelectDragRef.current.pointerId === event.pointerId
      ) {
        boxSelectDragRef.current.currentX = pointerX;
        boxSelectDragRef.current.currentY = pointerY;
        if (boxSelectRafRef.current === null) {
          if (typeof requestAnimationFrame === 'function') {
            boxSelectRafRef.current = requestAnimationFrame(flushBoxSelectFrame);
          } else {
            flushBoxSelectFrame();
          }
        }
        return;
      }

      if (
        touchDownOriginRef.current &&
        touchDownOriginRef.current.pointerId === event.pointerId
      ) {
        const moved = Math.hypot(
          pointerX - touchDownOriginRef.current.x,
          pointerY - touchDownOriginRef.current.y,
        );
        if (moved > 8) {
          clearTouchLongPress();
        }
      }

      if (
        isStageHudEventTarget(event.target) &&
        !controllerRef.current?.isDragging()
      ) {
        magnifierRef.current?.notifyStagePointerLeave();
        return;
      }

      const consumedByCamera = controllerRef.current?.handlePointerMove({
        pointerId: event.pointerId,
        x: pointerX,
        y: pointerY,
        timeMs: event.timeStamp || performance.now(),
      });

      if (consumedByCamera) {
        clearTouchLongPress();
        userMovedCameraSinceFindingRef.current = true;
        captureStagePointer(el, event.pointerId);
        return;
      }

      if (event.buttons === 0 && event.pointerType !== 'touch') {
        const hitIndex = hitTestAtStagePoint(pointerX, pointerY);
        store.getState().setHoveredDieIndex(hitIndex);
        magnifierRef.current?.notifyStagePointer(pointerX, pointerY, hitIndex);
      }
    },
    [clearTouchLongPress, flushBoxSelectFrame, hitTestAtStagePoint, store],
  );

  const finishPointer = React.useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      allowBackgroundClear: boolean,
    ): void => {
      clearTouchLongPress();
      touchDownOriginRef.current = null;

      const el = event.currentTarget;
      if (capturedPointersRef.current.has(event.pointerId)) {
        capturedPointersRef.current.delete(event.pointerId);
        if (typeof el.releasePointerCapture === 'function') {
          try {
            el.releasePointerCapture(event.pointerId);
          } catch {
            // Ignore if already released
          }
        }
      }
      const bounds = el.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;

      // Commit or cancel active box-select drag (§3.6, §5.7)
      if (
        boxSelectDragRef.current !== null &&
        boxSelectDragRef.current.pointerId === event.pointerId
      ) {
        const drag = boxSelectDragRef.current;
        boxSelectDragRef.current = null;
        if (
          boxSelectRafRef.current !== null &&
          typeof cancelAnimationFrame === 'function'
        ) {
          cancelAnimationFrame(boxSelectRafRef.current);
          boxSelectRafRef.current = null;
        }
        magnifierRef.current?.setGestureSuppressed(false);

        const dist = Math.hypot(pointerX - drag.startX, pointerY - drag.startY);
        const curWafer = waferGeometryRef.current.wafer;
        if (!allowBackgroundClear || dist < 4 || !curWafer) {
          overlayCanvasRef.current?.setLiveBrushScreenRect(null);
          selectionPopoverRef.current?.updateLiveFrame({
            x: 0,
            y: 0,
            transformOrigin: 'top left',
            stats: {
              dieCount: 0,
              failingCount: 0,
              yieldRatio: 0,
              topBin: null,
              snappedBounds: null,
            },
            visible: false,
          });
          if (allowBackgroundClear && dist < 4) {
            const hitIdx = hitTestAtStagePoint(pointerX, pointerY);
            if (hitIdx === null) {
              const st = store.getState();
              if (st.hasActiveFilter || st.claimHighlight !== null) {
                st.clearFilters();
              }
            }
          }
          return;
        }

        const { stageWidth, stageHeight } = stageMetricsRef.current;
        const left = Math.max(0, Math.min(drag.startX, pointerX));
        const right = Math.min(stageWidth, Math.max(drag.startX, pointerX));
        const top = Math.max(0, Math.min(drag.startY, pointerY));
        const bottom = Math.min(stageHeight, Math.max(drag.startY, pointerY));
        const releaseScreenRect: ScreenBox = {
          x: left,
          y: top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        };

        const cam = controllerRef.current?.getCamera() ?? DEFAULT_CAMERA_STATE;
        const vp = cameraToViewportTransform(cam, stageWidth, stageHeight);
        const liveLayout = computeWaferRenderLayout(
          curWafer,
          stageWidth,
          stageHeight,
          lot.dies,
          vp,
        );
        const gridBounds = screenRectToWaferGridBounds(
          { x0: left, y0: top, x1: right, y1: bottom },
          liveLayout,
          curWafer,
        );
        const stats = computeLiveBoxSelectStats(
          lot,
          safeWaferIndex,
          gridBounds,
          colorMode === 'hbin' ? 'HBIN' : 'SBIN',
        );

        if (stats.dieCount === 0 || !stats.snappedBounds) {
          overlayCanvasRef.current?.setLiveBrushScreenRect(null);
          store.getState().setBrush(null);
          selectionPopoverRef.current?.updateLiveFrame({
            x: 0,
            y: 0,
            transformOrigin: 'top left',
            stats,
            visible: false,
          });
          return;
        }

        const nextBrush: SpatialBrushRect = {
          scope: 'wafer',
          waferIndex: safeWaferIndex,
          ...stats.snappedBounds,
        };
        store.getState().setBrush(nextBrush);
        animateBrushSnap(releaseScreenRect, nextBrush, stats);
        return;
      }

      const wasGesture = controllerRef.current?.handlePointerUp({
        pointerId: event.pointerId,
        x: pointerX,
        y: pointerY,
        timeMs: event.timeStamp || performance.now(),
      });
      magnifierRef.current?.setGestureSuppressed(false);

      if (wasGesture) {
        userMovedCameraSinceFindingRef.current = true;
        return;
      }

      if (
        allowBackgroundClear &&
        event.button === 0 &&
        !event.shiftKey &&
        !isStageHudEventTarget(event.target)
      ) {
        const hitIndex = hitTestAtStagePoint(pointerX, pointerY);
        // §4.8 Touch: tap a die shows the readout pinned above the die; tap elsewhere hides
        if (event.pointerType === 'touch') {
          store.getState().setHoveredDieIndex(hitIndex);
          magnifierRef.current?.togglePinAtDie(hitIndex);
          if (hitIndex !== null) {
            return;
          }
        }
        if (hitIndex === null) {
          magnifierRef.current?.clearPin();
          const state = store.getState();
          if (state.hasActiveFilter || state.claimHighlight !== null) {
            state.clearFilters();
          }
        }
      }
    },
    [
      animateBrushSnap,
      clearTouchLongPress,
      colorMode,
      hitTestAtStagePoint,
      lot,
      safeWaferIndex,
      store,
    ],
  );

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      finishPointer(event, true);
    },
    [finishPointer],
  );

  const handlePointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      finishPointer(event, false);
    },
    [finishPointer],
  );

  const handlePointerLeave = React.useCallback((): void => {
    if (
      !controllerRef.current?.isDragging() &&
      boxSelectDragRef.current === null
    ) {
      store.getState().setHoveredDieIndex(null);
      magnifierRef.current?.notifyStagePointerLeave();
    }
  }, [store]);

  const handleDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (isStageHudEventTarget(event.target)) {
        return;
      }
      userMovedCameraSinceFindingRef.current = true;
      const bounds = event.currentTarget.getBoundingClientRect();
      controllerRef.current?.handleDoubleClick(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    },
    [],
  );

  const handleClearSelection = React.useCallback((): void => {
    cancelSnapAnimation();
    overlayCanvasRef.current?.setLiveBrushScreenRect(null);
    store.getState().setBrush(null);
  }, [cancelSnapAnimation, store]);

  const handleZoomToSelection = React.useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller || !fitLayout) {
      return;
    }
    const state = store.getState();
    if (!state.hasActiveFilter) {
      return;
    }
    userMovedCameraSinceFindingRef.current = true;
    const targetCam = computeEvidenceFramingCamera({
      lot,
      waferIndex: safeWaferIndex,
      dieMask: state.selectedDieMask,
      fitLayout,
      stageWidth: stageDims.width,
      stageHeight: stageDims.height,
      fullWaferRatioThreshold: 0.98,
    });
    controller.animateToCamera(targetCam);
  }, [fitLayout, lot, safeWaferIndex, stageDims.height, stageDims.width, store]);

  const handleStageKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (isStageHudEventTarget(event.target)) {
        return;
      }
      if (typeof performance !== 'undefined') {
        event.currentTarget.dataset.ack = String(performance.now());
      }

      // §4.7 Esc priority: selection -> finding -> pin
      if (event.key === 'Escape') {
        const state = store.getState();
        if (state.hasActiveFilter) {
          event.preventDefault();
          cancelSnapAnimation();
          overlayCanvasRef.current?.setLiveBrushScreenRect(null);
          state.setBrush(null);
          state.setBinFilter(null);
          state.setSiteFilter(null);
          state.setWaferFilter(null);
          state.setDslFilter(null);
          return;
        }
        if (state.claimHighlight !== null) {
          event.preventDefault();
          state.setClaimHighlight(null);
          return;
        }
        if (magnifierRef.current?.clearPin()) {
          event.preventDefault();
        }
        return;
      }

      // §3.6 / §4.7: S toggles Select tool
      if (
        (event.key === 's' || event.key === 'S') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setStageTool((prev) => (prev === 'select' ? 'pan' : 'select'));
        return;
      }

      // §4.7: Enter pins the magnifier at the hovered die
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
        const curHovered = store.getState().hoveredDieIndex;
        if (curHovered !== null) {
          event.preventDefault();
          magnifierRef.current?.togglePinAtDie(curHovered);
        }
        return;
      }

      // Keyboard camera controls (§4.7: +/= zoom 1.5x about cursor die, - zoom out, 0 reset, 0 ms)
      if (event.key === '0' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        userMovedCameraSinceFindingRef.current = true;
        controllerRef.current?.resetToFit(false);
        return;
      }

      if (
        (event.key === '+' ||
          event.key === '=' ||
          event.key === '-' ||
          event.key === '_') &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        const controller = controllerRef.current;
        if (!controller) {
          return;
        }
        userMovedCameraSinceFindingRef.current = true;
        const metrics = stageMetricsRef.current;
        const currentCam = controller.getCamera();
        let anchorX = metrics.stageWidth / 2;
        let anchorY = metrics.stageHeight / 2;

        const hoveredIdx = store.getState().hoveredDieIndex;
        if (
          wafer &&
          fitLayout &&
          hoveredIdx !== null &&
          hoveredIdx >= wafer.dieStartIndex &&
          hoveredIdx < wafer.dieEndIndex &&
          lot.dies.hasValidCoords[hoveredIdx] !== 0
        ) {
          const fitRect = dieCoordToCanvasRect(
            lot.dies.x[hoveredIdx]!,
            lot.dies.y[hoveredIdx]!,
            fitLayout,
          );
          anchorX = fitRect.centerX * currentCam.scale + currentCam.tx;
          anchorY = fitRect.centerY * currentCam.scale + currentCam.ty;
        }

        const factor = event.key === '+' || event.key === '=' ? 1.5 : 1 / 1.5;
        const nextCam = applyKeyboardZoom(currentCam, factor, {
          ...metrics,
          anchorX,
          anchorY,
        });
        controller.setCameraImmediate(nextCam);
        return;
      }

      if (!wafer) {
        return;
      }

      const coordMap = lot.waferCoordIndex[safeWaferIndex];
      if (!coordMap || coordMap.size === 0) {
        return;
      }

      const dirX = wafer.geometry.posX === 'L' ? -1 : 1;
      const dirY = wafer.geometry.posY === 'D' ? 1 : -1;

      let stepX = 0;
      let stepY = 0;
      if (event.key === 'ArrowRight') {
        stepX = dirX;
      } else if (event.key === 'ArrowLeft') {
        stepX = -dirX;
      } else if (event.key === 'ArrowUp') {
        stepY = -dirY;
      } else if (event.key === 'ArrowDown') {
        stepY = dirY;
      } else {
        return;
      }

      event.preventDefault();
      const state = store.getState();
      const currentIdx = state.hoveredDieIndex;

      const selectDieWithMarginPan = (targetIdx: number): void => {
        state.setHoveredDieIndex(targetIdx);
        const controller = controllerRef.current;
        if (
          controller &&
          fitLayout &&
          lot.dies.hasValidCoords[targetIdx] !== 0
        ) {
          const fitRect = dieCoordToCanvasRect(
            lot.dies.x[targetIdx]!,
            lot.dies.y[targetIdx]!,
            fitLayout,
          );
          const curCam = controller.getCamera();
          const panned = ensurePointWithinMargin(curCam, {
            ...stageMetricsRef.current,
            fitX: fitRect.centerX,
            fitY: fitRect.centerY,
            marginPx: 48,
          });
          if (panned !== curCam) {
            userMovedCameraSinceFindingRef.current = true;
            controller.setCameraImmediate(panned);
          }
        }
        magnifierRef.current?.notifyKeyboardStepDie(targetIdx);
      };

      if (
        currentIdx === null ||
        currentIdx < wafer.dieStartIndex ||
        currentIdx >= wafer.dieEndIndex ||
        lot.dies.hasValidCoords[currentIdx] === 0
      ) {
        const cx = Math.round((wafer.minX + wafer.maxX) / 2);
        const cy = Math.round((wafer.minY + wafer.maxY) / 2);
        const centerHit = coordMap.get(packWaferCoord(cx, cy));
        if (centerHit !== undefined) {
          selectDieWithMarginPan(centerHit);
          return;
        }
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (lot.dies.hasValidCoords[i] !== 0) {
            selectDieWithMarginPan(i);
            return;
          }
        }
        return;
      }

      const curX = lot.dies.x[currentIdx]!;
      const curY = lot.dies.y[currentIdx]!;
      for (let dist = 1; dist <= 6; dist += 1) {
        const nextHit = coordMap.get(
          packWaferCoord(curX + stepX * dist, curY + stepY * dist),
        );
        if (nextHit !== undefined) {
          selectDieWithMarginPan(nextHit);
          return;
        }
      }
    },
    [
      cancelSnapAnimation,
      fitLayout,
      lot.dies,
      lot.waferCoordIndex,
      safeWaferIndex,
      store,
      wafer,
    ],
  );

  // §5.8: snapshot the outgoing wafer into the crossfade layer and fade it out over 160 ms
  const startWaferCrossfade = React.useCallback((): void => {
    const baseEl = baseCanvasRef.current?.getCanvasElement();
    const cfEl = crossfadeCanvasRef.current;
    if (!baseEl || !cfEl || baseEl.width === 0 || baseEl.height === 0) {
      return;
    }
    if (cfEl.width !== baseEl.width) {
      cfEl.width = baseEl.width;
    }
    if (cfEl.height !== baseEl.height) {
      cfEl.height = baseEl.height;
    }
    const cfCtx = cfEl.getContext('2d');
    if (!cfCtx) {
      return;
    }
    cfCtx.setTransform(1, 0, 0, 1, 0, 0);
    cfCtx.clearRect(0, 0, cfEl.width, cfEl.height);
    cfCtx.drawImage(baseEl, 0, 0);
    if (crossfadeAnimRef.current) {
      crossfadeAnimRef.current.cancel();
      crossfadeAnimRef.current = null;
    }
    cfEl.style.visibility = 'visible';
    cfEl.style.opacity = '1';
    cfEl.dataset.crossfading = 'true';

    if (typeof cfEl.animate !== 'function') {
      cfEl.style.opacity = '0';
      cfEl.style.visibility = 'hidden';
      cfEl.dataset.crossfading = 'false';
      return;
    }
    const anim = cfEl.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 160,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards',
    });
    crossfadeAnimRef.current = anim;
    anim.onfinish = () => {
      if (crossfadeAnimRef.current === anim) {
        crossfadeAnimRef.current = null;
        cfEl.style.opacity = '0';
        cfEl.style.visibility = 'hidden';
        cfEl.dataset.crossfading = 'false';
      }
    };
  }, []);

  // Wafer currently painted on the stage canvases; runs ahead of the store during keyboard previews
  const displayedWaferIndexRef = React.useRef(safeWaferIndex);
  displayedWaferIndexRef.current = safeWaferIndex;

  /**
   * §5.8 keyboard wafer stepping: repaint base + overlay canvases imperatively inside the
   * keydown handler (no React render, no layout reads). `WaferSelector` commits the index to
   * the store once stepping pauses, and that single render then skips the duplicate raster.
   */
  const handlePreviewWafer = React.useCallback(
    (waferIndex: number, options?: WaferSelectOptions): void => {
      if (waferIndex === displayedWaferIndexRef.current) {
        return;
      }
      if (waferIndex < 0 || waferIndex >= lot.wafers.length) {
        return;
      }
      const instant = Boolean(options?.instant) || reducedMotionRef.current;
      if (instant) {
        cancelCrossfadeImmediately();
      } else {
        startWaferCrossfade();
      }
      displayedWaferIndexRef.current = waferIndex;
      baseCanvasRef.current?.paintWafer(waferIndex, getRasterCamera());
      overlayCanvasRef.current?.previewWafer(waferIndex);
    },
    [cancelCrossfadeImmediately, getRasterCamera, lot, startWaferCrossfade],
  );

  // §5.8: 160 ms ease-out wafer crossfade on click/single-step; 0 ms instant swap on key-repeat or reduced motion
  const handleSelectWafer = React.useCallback(
    (waferIndex: number, options?: WaferSelectOptions): void => {
      const currentIdx = store.getState().activeWaferIndex;
      if (waferIndex === currentIdx) {
        return;
      }
      if (options?.previewed) {
        // Canvases already show this wafer (handlePreviewWafer); only commit the store
        store.getState().setActiveWaferIndex(waferIndex);
        return;
      }
      const instant = Boolean(options?.instant) || reducedMotionRef.current;
      if (instant) {
        cancelCrossfadeImmediately();
      } else if (displayedWaferIndexRef.current !== waferIndex) {
        startWaferCrossfade();
      }
      store.getState().setActiveWaferIndex(waferIndex);
    },
    [cancelCrossfadeImmediately, startWaferCrossfade, store],
  );

  const modeOptions = React.useMemo<
    readonly SegmentedControlOption<'pass-fail' | 'hbin' | 'sbin'>[]
  >(
    () => [
      { value: 'pass-fail', label: t('stage.mode.passFail') },
      { value: 'hbin', label: t('stage.mode.hbin') },
      { value: 'sbin', label: t('stage.mode.sbin') },
    ],
    [t],
  );

  const toolOptions = React.useMemo<
    readonly SegmentedControlOption<StageToolMode>[]
  >(
    () => [
      { value: 'pan', label: t('stage.tool.pan') },
      { value: 'select', label: t('stage.tool.select') },
    ],
    [t],
  );

  const segmentedValue: 'pass-fail' | 'hbin' | 'sbin' =
    colorMode === 'hbin' || colorMode === 'sbin' ? colorMode : 'pass-fail';

  const evidencePresence = React.useMemo(
    () =>
      claimHighlight && claimHighlightMask
        ? computeWaferEvidencePresence(lot, claimHighlightMask)
        : null,
    [claimHighlight, claimHighlightMask, lot],
  );
  // Strip evidence dots follow one interruptible render after the finding-click frame (§5.10)
  const deferredEvidencePresence = React.useDeferredValue(evidencePresence);

  const evidenceSummary = React.useMemo(() => {
    if (
      claimHighlight === null ||
      !claimHighlightMask ||
      claimHighlightMask.length < lot.dies.count ||
      !wafer
    ) {
      return null;
    }
    let totalDies = 0;
    let wafersWithEvidence = 0;
    let hereCount = 0;
    for (let w = 0; w < lot.wafers.length; w += 1) {
      const wm = lot.wafers[w]!;
      let hasAny = false;
      for (let i = wm.dieStartIndex; i < wm.dieEndIndex; i += 1) {
        if (claimHighlightMask[i] !== 0) {
          totalDies += 1;
          if (lot.dies.hasValidCoords[i] !== 0) {
            hasAny = true;
            if (w === safeWaferIndex) {
              hereCount += 1;
            }
          }
        }
      }
      if (hasAny) {
        wafersWithEvidence += 1;
      }
    }
    if (totalDies === 0) {
      return null;
    }
    return {
      totalDies,
      wafersWithEvidence: Math.max(1, wafersWithEvidence),
      hereCount,
    };
  }, [
    claimHighlight,
    claimHighlightMask,
    wafer,
    lot.dies.count,
    lot.wafers,
    lot.dies.hasValidCoords,
    safeWaferIndex,
  ]);


  const waferId = wafer?.waferId ?? 'W01';
  const testedCount = waferYield?.testedDies ?? 0;
  const passCount = waferYield?.finalPassDies ?? 0;
  const failCount = waferYield?.finalFailDies ?? 0;
  const fitWaferDiameter = (fitLayout?.fitWaferRadiusPx ?? 312) * 2;
  const vignetteDiameter = Math.round(fitWaferDiameter * 1.5);
  const topLightLeft =
    (fitLayout?.centerXCss ?? stageDims.width / 2) -
    (fitLayout?.fitWaferRadiusPx ?? 312);
  const topLightTop =
    (fitLayout?.centerYCss ?? stageDims.height / 2) -
    (fitLayout?.fitWaferRadiusPx ?? 312);

  return (
    <div className={cn('flex w-full flex-col xl:h-full', className)}>
      {/* Unclipped floating anchor wrapper so magnifier/popover can place above stage edge (§4.8) */}
      <div className="relative flex w-full flex-col xl:min-h-[600px] xl:flex-1">
        {/* Boxless Wafer Stage (§3.4: 783x720 desktop / 390x390 mobile; §4.7 role="application") */}
        <div
          ref={stageRef}
          role="application"
          aria-roledescription={t('stage.roleDescription')}
          aria-label={t('stage.aria', {
            wafer: waferId,
            dies: formatInteger(testedCount),
            fails: formatInteger(failCount),
          })}
          data-testid="wafer-stage"
          data-sweep="done"
          data-render-count={renderCountRef.current}
          data-wafer-diameter-px={Math.round(fitWaferDiameter)}
          data-stage-tool={stageTool}
          tabIndex={0}
          style={{ touchAction: stageTool === 'select' ? 'none' : 'pan-y' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleStageKeyDown}
          className={cn(
            'relative isolate h-[456px] w-full overflow-hidden bg-bg select-none',
            stageTool === 'select' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
            'md:mx-auto md:h-auto md:aspect-square md:max-w-[680px] xl:mx-0 xl:aspect-auto xl:min-h-[600px] xl:max-w-none xl:flex-1',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          )}
        >
          {/* Ambient radial stage vignette (diameter = wafer diameter x 1.5, §2.1) */}
          <div
            data-testid="wafer-stage-vignette"
            aria-hidden="true"
            style={{
              width: `${vignetteDiameter}px`,
              height: `${vignetteDiameter}px`,
              background: 'var(--vignette)',
            }}
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          />

          {/* Composite-only CSS-transform camera wrapper moving stacked Base layers, FailCanvas, and top-light (§4.7, §5.8) */}
          <div
            ref={cameraWrapperRef}
            data-testid="wafer-camera-wrapper"
            style={{
              transformOrigin: '0 0',
              transform: 'translate3d(0px, 0px, 0) scale(1)',
            }}
            className="pointer-events-none absolute inset-0"
          >
            <BaseCanvas
              ref={baseCanvasRef}
              lot={lot}
              waferIndex={safeWaferIndex}
              colorMode={colorMode}
              activeTestNum={activeTestNum}
              store={store}
              cssWidth={stageDims.width}
              cssHeight={stageDims.height}
              getRasterCamera={getRasterCamera}
              dpr={dpr}
              layout={fitLayout}
            />
            {/* Outgoing wafer crossfade layer (160 ms ease-out on click/step; 0 ms on key-repeat/reduced-motion, §5.8) */}
            <canvas
              ref={crossfadeCanvasRef}
              data-testid="wafer-crossfade-canvas"
              data-crossfading="false"
              aria-hidden="true"
              style={{
                width: `${stageDims.width}px`,
                height: `${stageDims.height}px`,
                opacity: 0,
                visibility: 'hidden',
              }}
              className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-base)] block select-none"
            />
            <FailCanvas
              ref={failCanvasRef}
              lot={lot}
              waferIndex={safeWaferIndex}
              colorMode={colorMode}
              store={store}
              cssWidth={stageDims.width}
              cssHeight={stageDims.height}
              dpr={dpr}
            />
            {/* Faint top light catching the top of the silicon wafer disc (§2.1) */}
            <div
              ref={topLightRef}
              data-testid="wafer-stage-top-light"
              aria-hidden="true"
              style={{
                width: `${fitWaferDiameter}px`,
                height: `${fitWaferDiameter}px`,
                left: `${topLightLeft}px`,
                top: `${topLightTop}px`,
                background: 'var(--top-light)',
              }}
              className="pointer-events-none absolute z-[2] rounded-full"
            />
          </div>

          {/* Screen-space OverlayCanvas (z: 3) */}
          <OverlayCanvas
            ref={overlayCanvasRef}
            lot={lot}
            waferIndex={safeWaferIndex}
            cssWidth={stageDims.width}
            cssHeight={stageDims.height}
            getCamera={getCamera}
            dpr={dpr}
            layout={fitLayout}
            store={store}
          />

          {/* Stage HUD Top-Left: Pass/Fail | HBIN | SBIN + Pan | Select Segmented Controls (§3.4, §3.6, §4.12) */}
          <div
            data-stage-hud="true"
            className="absolute top-2 left-3 z-[var(--z-stage-hud)] flex flex-nowrap items-center gap-2 md:top-4 md:left-4"
          >
            <SegmentedControl
              data-testid="stage-mode-segmented"
              ariaLabel={t('stage.roleDescription')}
              options={modeOptions}
              value={segmentedValue}
              onValueChange={(nextMode) => {
                store.getState().setColorMode(nextMode);
              }}
            />
            <SegmentedControl
              data-testid="stage-tool-segmented"
              ariaLabel={`${t('stage.tool.pan')} / ${t('stage.tool.select')}`}
              options={toolOptions}
              value={stageTool}
              onValueChange={(nextTool) => setStageTool(nextTool)}
            />
          </div>

          {/* Stage HUD Bottom-Left: Non-colour shape legend / interactive HBIN/SBIN bin toggles (§2.1, §3.4) */}
          <div
            data-stage-hud="true"
            data-testid="stage-legend"
            className={cn(
              'absolute bottom-3 left-3 z-[var(--z-stage-hud)] max-w-[calc(100%-120px)] transition-opacity duration-[160ms] ease-[var(--ease-out)] md:bottom-4 md:left-4',
              evidenceSummary !== null
                ? 'pointer-events-none opacity-0'
                : 'opacity-100',
            )}
          >
            <BinLegend
              lot={lot}
              waferIndex={safeWaferIndex}
              colorMode={colorMode}
              passCount={passCount}
              failCount={failCount}
              store={store}
            />
          </div>

          {/* Stage HUD Bottom-Centre: Sweep Skip Hint (§3.3) or Finding Evidence Caption Pill (§3.5) */}
          <p
            ref={skipHintRef}
            hidden
            data-testid="probe-sweep-skip-hint"
            className="pointer-events-none absolute bottom-3 left-1/2 z-[var(--z-stage-hud)] -translate-x-1/2 type-subhead whitespace-nowrap text-text-tertiary md:bottom-4"
          >
            {t('loading.skipHint')}
          </p>
          {evidenceSummary !== null ? (
            <div
              data-stage-hud="true"
              data-testid="stage-evidence-caption"
              className="surface-material pointer-events-none absolute bottom-3 left-1/2 z-[var(--z-stage-hud)] -translate-x-1/2 rounded-pill px-3 py-1 type-subhead whitespace-nowrap text-text-primary tabular-nums md:bottom-4"
            >
              {t('stage.evidenceCaption', {
                dies: formatInteger(evidenceSummary.totalDies),
                wafers: formatInteger(evidenceSummary.wafersWithEvidence),
                here: formatInteger(evidenceSummary.hereCount),
              })}
            </div>
          ) : null}

          {/* Stage HUD Bottom-Right: Current Wafer ID + Live Zoom Readout Pill (§3.4) */}
          <div
            data-stage-hud="true"
            className="absolute right-3 bottom-3 z-[var(--z-stage-hud)] flex items-center gap-2 md:right-4 md:bottom-4"
          >
            <span className="type-caption text-text-tertiary tabular-nums">
              <Untranslated>{waferId}</Untranslated>
            </span>
            <button
              ref={zoomPillRef}
              type="button"
              data-testid="stage-zoom-pill"
              aria-label={t('stage.zoomReset')}
              hidden
              onClick={() => {
                userMovedCameraSinceFindingRef.current = true;
                controllerRef.current?.resetToFit(true);
              }}
              className={cn(
                'surface-material cursor-pointer rounded-pill px-2.5 py-1 type-caption text-text-primary tabular-nums',
                "after:absolute after:-inset-1.5 after:content-['']",
                'relative transition-transform duration-[100ms] ease-[var(--ease-out)] active:scale-[0.97]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              )}
            >
              100%
            </button>
          </div>

          {/* Visually hidden table of failing dies on the active wafer (§4.7, §6.8) */}
          <FailingDiesTable lot={lot} waferIndex={safeWaferIndex} />
        </div>

        {/* Floating Hover Magnifier (z: 20, outside overflow-hidden so placedAboveStage never clips, §4.8) */}
        <HoverMagnifier
          ref={magnifierRef}
          lot={lot}
          waferIndex={safeWaferIndex}
          stageWidth={stageDims.width}
          stageHeight={stageDims.height}
          dpr={dpr}
          getBaseCanvas={getBaseCanvasElement}
          getCamera={getCamera}
          getRasterCamera={getRasterCamera}
          store={store}
        />

        {/* Box-Select Live & Committed Stats Popover (z: 30, §3.6, §4.14, §5.7) */}
        <SelectionPopover
          ref={selectionPopoverRef}
          committedStats={committedBrushStats}
          isCommitted={activeWaferBrush !== null}
          onClear={handleClearSelection}
          onZoomToSelection={handleZoomToSelection}
        />
      </div>

      {/* Horizontal Wafer Strip: 16 px below stage on desktop (783 x 64), 12 px on mobile (390 x 56) (§3.4, §4.9) */}
      <WaferSelector
        lotId={lot.lotId}
        wafers={lot.wafers}
        dies={lot.dies}
        byWaferYield={byWaferYield}
        activeWaferIndex={safeWaferIndex}
        evidencePresence={deferredEvidencePresence}
        dpr={dpr}
        onSelectWafer={handleSelectWafer}
        onPreviewWafer={handlePreviewWafer}
        className="mt-3 xl:mt-4"
      />
    </div>
  );
}

/** Memoized so parent-only state (e.g. the §5.2 verdict reveal) never re-renders the stage mid-gesture. */
export const WaferMapCanvas = React.memo(WaferMapCanvasImpl);
