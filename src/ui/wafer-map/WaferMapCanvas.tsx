'use client';

import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { YieldMetrics } from '@/core/analytics';
import { type LotModel, packWaferCoord } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { SegmentedControl, type SegmentedControlOption } from '@/ui/primitives';
import { cn } from '@/ui/primitives/cn';
import {
  EMPTY_HIDDEN_BINS,
  type SelectionStoreState,
  useSelectionStore,
  type WaferColorMode,
} from '@/ui/state';
import { COLOR_TOKENS, getFailBinColor } from '@/ui/tokens';
import { BaseCanvas, type BaseCanvasHandle } from './BaseCanvas';
import { FailCanvas, type FailCanvasHandle } from './FailCanvas';
import { OverlayCanvas, type OverlayCanvasHandle } from './OverlayCanvas';
import { WaferSelector } from './WaferSelector';
import {
  applyKeyboardZoom,
  cameraToViewportTransform,
  createWaferCameraController,
  DEFAULT_CAMERA_STATE,
  ensurePointWithinMargin,
  isCameraAtFit,
  type WaferCameraController,
} from './wafer-camera';
import {
  buildFailBinRankMap,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  dieCoordToCanvasRect,
  hitTestWaferDie,
} from './wafer-geometry';

export interface WaferMapCanvasProps {
  readonly lot: LotModel;
  readonly byWaferYield: readonly YieldMetrics[];
  readonly store?: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

const INITIAL_STAGE_WIDTH_PX = 783;
const INITIAL_STAGE_HEIGHT_PX = 720;
const MIN_STAGE_DIM_PX = 200;
const MAX_A11Y_FAILING_DIES_ROWS = 200;

interface StageDimensions {
  readonly width: number;
  readonly height: number;
}

interface BinLegendItem {
  readonly code: number;
  readonly label: string;
  readonly count: number;
  readonly isPass: boolean;
  readonly color: string;
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
 * Boxless Wafer Stage + Three-Layer Canvas + Physics Camera + HUD + Wafer Strip
 * (`src/ui/wafer-map/WaferMapCanvas.tsx`, `redesign.md` §2.1, §2.5, §3.4, §4.7, §4.9, §5.5, §5.10).
 *
 * Performance guarantees:
 * - Zero React re-renders during wheel zoom, pinch, drag pan, inertia coasting, or settle re-raster
 * - `will-change: transform` set on `wafer-camera-wrapper` strictly while gesture/spring is active
 * - Supersampled `BaseCanvas` (`2x DPR` up to `4096 px`) re-rastered `120 ms` after settling at `scale > 2`
 */
export function WaferMapCanvas({
  lot,
  byWaferYield,
  store = useSelectionStore,
  className,
}: WaferMapCanvasProps): React.JSX.Element {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const cameraWrapperRef = React.useRef<HTMLDivElement>(null);
  const topLightRef = React.useRef<HTMLDivElement>(null);
  const zoomPillRef = React.useRef<HTMLButtonElement>(null);
  const baseCanvasRef = React.useRef<BaseCanvasHandle>(null);
  const failCanvasRef = React.useRef<FailCanvasHandle>(null);
  const overlayCanvasRef = React.useRef<OverlayCanvasHandle>(null);
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;

  const [stageDims, setStageDims] = React.useState<StageDimensions>({
    width: INITIAL_STAGE_WIDTH_PX,
    height: INITIAL_STAGE_HEIGHT_PX,
  });
  const [moreBinsOpen, setMoreBinsOpen] = React.useState(false);
  const dpr = useDevicePixelRatio();

  const {
    storeLot,
    rawWaferIndex,
    rawColorMode,
    rawActiveTestNum,
    rawHiddenBins,
    rawClaimHighlight,
    rawOverlayMask,
    rawOverlayCount,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawWaferIndex: s.activeWaferIndex,
      rawColorMode: s.colorMode,
      rawActiveTestNum: s.activeTestNum,
      rawHiddenBins: s.hiddenBins,
      rawClaimHighlight: s.claimHighlight,
      rawOverlayMask: s.overlayHighlightMask,
      rawOverlayCount: s.overlayHighlightCount,
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
  const hiddenBins = isSynced ? rawHiddenBins : EMPTY_HIDDEN_BINS;
  const claimHighlight = isSynced ? rawClaimHighlight : null;
  const overlayHighlightMask = isSynced ? rawOverlayMask : null;
  const overlayHighlightCount = isSynced ? rawOverlayCount : 0;

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

  const reducedMotionRef = React.useRef(Boolean(shouldReduceMotion));
  reducedMotionRef.current = Boolean(shouldReduceMotion);

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
  });
  waferGeometryRef.current = {
    lot,
    wafer,
    safeWaferIndex,
  };

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
          stageEl.style.touchAction = camera.scale > 1.001 ? 'none' : 'pan-y';
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

  // Reset camera cleanly when a new lot is opened; preserve camera across wafers in the same lot (§5.8)
  const prevLotRef = React.useRef<LotModel>(lot);
  React.useEffect(() => {
    if (prevLotRef.current !== lot) {
      prevLotRef.current = lot;
      controllerRef.current?.resetToFit(false);
    }
  }, [lot]);

  React.useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
    };
  }, []);

  // Measure actual stage CSS dimensions via ResizeObserver (no artificial 560 px cap)
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

  const capturedPointersRef = React.useRef<Set<number>>(new Set());

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (isStageHudEventTarget(event.target)) {
        return;
      }
      const el = event.currentTarget;
      if (event.pointerType === 'mouse' && event.button === 0) {
        el.focus({ preventScroll: true });
      }
      const bounds = el.getBoundingClientRect();
      const startedPinch = controllerRef.current?.handlePointerDown({
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        button: event.button,
        shiftKey: event.shiftKey,
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        timeMs: event.timeStamp || performance.now(),
      });
      if (startedPinch && typeof el.setPointerCapture === 'function') {
        try {
          el.setPointerCapture(event.pointerId);
          capturedPointersRef.current.add(event.pointerId);
        } catch {
          // Ignore synthetic pointer events without active browser pointer id
        }
      }
    },
    [],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (isStageHudEventTarget(event.target) && !controllerRef.current?.isDragging()) {
        return;
      }
      const el = event.currentTarget;
      const bounds = el.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;

      const consumedByCamera = controllerRef.current?.handlePointerMove({
        pointerId: event.pointerId,
        x: pointerX,
        y: pointerY,
        timeMs: event.timeStamp || performance.now(),
      });

      if (consumedByCamera) {
        if (
          !capturedPointersRef.current.has(event.pointerId) &&
          typeof el.setPointerCapture === 'function'
        ) {
          try {
            el.setPointerCapture(event.pointerId);
            capturedPointersRef.current.add(event.pointerId);
          } catch {
            // Ignore synthetic pointer events in headless unit tests
          }
        }
        return;
      }

      if (event.buttons === 0 && event.pointerType !== 'touch') {
        const hitIndex = hitTestAtStagePoint(pointerX, pointerY);
        store.getState().setHoveredDieIndex(hitIndex);
      }
    },
    [hitTestAtStagePoint, store],
  );

  const finishPointer = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>, allowBackgroundClear: boolean): void => {
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
      const wasGesture = controllerRef.current?.handlePointerUp({
        pointerId: event.pointerId,
        x: pointerX,
        y: pointerY,
        timeMs: event.timeStamp || performance.now(),
      });

      if (
        allowBackgroundClear &&
        !wasGesture &&
        event.button === 0 &&
        !event.shiftKey &&
        !isStageHudEventTarget(event.target)
      ) {
        const hitIndex = hitTestAtStagePoint(pointerX, pointerY);
        if (hitIndex === null) {
          const state = store.getState();
          if (state.hasActiveFilter || state.claimHighlight !== null) {
            state.clearFilters();
          }
        }
      }
    },
    [hitTestAtStagePoint, store],
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
    if (!controllerRef.current?.isDragging()) {
      store.getState().setHoveredDieIndex(null);
    }
  }, [store]);

  const handleDoubleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (isStageHudEventTarget(event.target)) {
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      controllerRef.current?.handleDoubleClick(
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    },
    [],
  );

  const handleStageKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (isStageHudEventTarget(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        const state = store.getState();
        if (state.hasActiveFilter) {
          event.preventDefault();
          state.setBrush(null);
          state.setBinFilter(null);
          state.setSiteFilter(null);
          state.setDslFilter(null);
          return;
        }
        if (state.claimHighlight !== null) {
          event.preventDefault();
          state.setClaimHighlight(null);
        }
        return;
      }

      // Keyboard camera controls (§4.7: +/= zoom 1.5x about cursor die, - zoom out, 0 reset, 0 ms)
      if (event.key === '0' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        controllerRef.current?.resetToFit(false);
        return;
      }

      if (
        (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_') &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        const controller = controllerRef.current;
        if (!controller) {
          return;
        }
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
            controller.setCameraImmediate(panned);
          }
        }
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
    [fitLayout, lot.dies, lot.waferCoordIndex, safeWaferIndex, store, wafer],
  );

  const handleSelectWafer = React.useCallback(
    (waferIndex: number): void => {
      store.getState().setActiveWaferIndex(waferIndex);
    },
    [store],
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

  const segmentedValue: 'pass-fail' | 'hbin' | 'sbin' =
    colorMode === 'hbin' || colorMode === 'sbin' ? colorMode : 'pass-fail';

  const binLegendItems = React.useMemo<readonly BinLegendItem[]>(() => {
    if ((colorMode !== 'hbin' && colorMode !== 'sbin') || !wafer) {
      return [];
    }
    const isSbin = colorMode === 'sbin';
    const rankMap = buildFailBinRankMap(lot.dies, isSbin ? 'SBIN' : 'HBIN');
    const counts = new Map<number, { count: number; passCount: number }>();
    const binArr = isSbin ? lot.dies.sbin : lot.dies.hbin;
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (lot.dies.hasValidCoords[i] === 0) {
        continue;
      }
      const code = binArr[i]!;
      const entry = counts.get(code) ?? { count: 0, passCount: 0 };
      entry.count += 1;
      if (lot.dies.finalPass[i] !== 0) {
        entry.passCount += 1;
      }
      counts.set(code, entry);
    }
    const items: BinLegendItem[] = [];
    for (const [code, stats] of counts.entries()) {
      const meta = isSbin ? lot.sbins.get(code) : lot.hbins.get(code);
      const isPass = stats.passCount * 2 >= stats.count;
      const prefix = isSbin ? 'SBIN' : 'HBIN';
      const nameSuffix = meta?.name ? ` ${meta.name}` : '';
      const rank = rankMap.get(code) ?? 0;
      items.push({
        code,
        label: `${prefix} ${code}${nameSuffix}`,
        count: stats.count,
        isPass,
        color: isPass ? COLOR_TOKENS.passDie : getFailBinColor(rank),
      });
    }
    items.sort((a, b) => {
      if (a.isPass !== b.isPass) return a.isPass ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.code - b.code;
    });
    return items;
  }, [colorMode, wafer, lot.dies, lot.sbins, lot.hbins]);

  const evidenceSummary = React.useMemo(() => {
    if (
      claimHighlight === null ||
      !overlayHighlightMask ||
      overlayHighlightCount === 0 ||
      !wafer
    ) {
      return null;
    }
    let wafersWithEvidence = 0;
    let hereCount = 0;
    for (let w = 0; w < lot.wafers.length; w += 1) {
      const wm = lot.wafers[w]!;
      let hasAny = false;
      for (let i = wm.dieStartIndex; i < wm.dieEndIndex; i += 1) {
        if (overlayHighlightMask[i] !== 0 && lot.dies.hasValidCoords[i] !== 0) {
          hasAny = true;
          if (w === safeWaferIndex) {
            hereCount += 1;
          }
        }
      }
      if (hasAny) {
        wafersWithEvidence += 1;
      }
    }
    return {
      totalDies: overlayHighlightCount,
      wafersWithEvidence: Math.max(1, wafersWithEvidence),
      hereCount,
    };
  }, [
    claimHighlight,
    overlayHighlightMask,
    overlayHighlightCount,
    wafer,
    lot.wafers,
    lot.dies.hasValidCoords,
    safeWaferIndex,
  ]);

  const failingDieRows = React.useMemo(() => {
    if (!wafer) {
      return [];
    }
    const rows: Array<{
      readonly idx: number;
      readonly x: number;
      readonly y: number;
      readonly siteLabel: string;
      readonly sbin: number;
      readonly hbin: number;
    }> = [];
    for (
      let i = wafer.dieStartIndex;
      i < wafer.dieEndIndex && rows.length < MAX_A11Y_FAILING_DIES_ROWS;
      i += 1
    ) {
      if (lot.dies.finalPass[i] !== 0 || lot.dies.hasValidCoords[i] === 0) {
        continue;
      }
      const site = lot.sites[lot.dies.siteIndex[i]!];
      rows.push({
        idx: i,
        x: lot.dies.x[i]!,
        y: lot.dies.y[i]!,
        siteLabel: site ? `Head ${site.headNum} · Site ${site.siteNum}` : '—',
        sbin: lot.dies.sbin[i]!,
        hbin: lot.dies.hbin[i]!,
      });
    }
    return rows;
  }, [wafer, lot.dies, lot.sites]);

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

  const visibleBinItems = binLegendItems.slice(0, 6);
  const overflowBinItems = binLegendItems.slice(6);

  return (
    <div className={cn('flex w-full flex-col xl:h-full', className)}>
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
        data-render-count={renderCountRef.current}
        data-wafer-diameter-px={Math.round(fitWaferDiameter)}
        tabIndex={0}
        style={{ touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleStageKeyDown}
        className={cn(
          'relative isolate aspect-square w-full overflow-hidden bg-bg select-none',
          'md:mx-auto md:max-w-[680px] xl:mx-0 xl:aspect-auto xl:min-h-[600px] xl:max-w-none xl:flex-1',
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

        {/* Composite-only CSS-transform camera wrapper moving BaseCanvas, FailCanvas, and top-light (§4.7) */}
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
            hiddenBins={hiddenBins}
            cssWidth={stageDims.width}
            cssHeight={stageDims.height}
            getRasterCamera={getRasterCamera}
            dpr={dpr}
            layout={fitLayout}
          />
          <FailCanvas
            ref={failCanvasRef}
            lot={lot}
            waferIndex={safeWaferIndex}
            colorMode={colorMode}
            hiddenBins={hiddenBins}
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

        {/* Stage HUD Top-Left: Pass/Fail | HBIN | SBIN Segmented Control (§3.4, §4.12) */}
        <div
          data-stage-hud="true"
          className="absolute top-3 left-3 z-[var(--z-stage-hud)] md:top-4 md:left-4"
        >
          <SegmentedControl
            data-testid="stage-mode-segmented"
            ariaLabel={t('stage.roleDescription')}
            options={modeOptions}
            value={segmentedValue}
            onValueChange={(nextMode) => {
              setMoreBinsOpen(false);
              store.getState().setColorMode(nextMode);
            }}
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
          {colorMode === 'pass-fail' || colorMode === 'parametric' ? (
            <div className="flex flex-wrap items-center gap-3 type-footnote text-text-tertiary tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-flex h-2.5 w-2.5 items-center justify-center"
                >
                  <span className="h-[7px] w-[7px] rounded-[1px] bg-pass-die" />
                </span>
                <span>
                  {t('stage.legend.pass', {
                    count: formatInteger(passCount),
                  })}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-[1.5px] bg-failure"
                />
                <span>
                  {t('stage.legend.fail', {
                    count: formatInteger(failCount),
                  })}
                </span>
              </span>
            </div>
          ) : (
            <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 type-footnote tabular-nums">
              {visibleBinItems.map((item) => {
                const isHidden = hiddenBins.has(item.code);
                return (
                  <button
                    key={item.code}
                    type="button"
                    aria-pressed={!isHidden}
                    aria-label={t('stage.legend.toggleAria', { bin: item.label })}
                    onClick={() => store.getState().toggleHiddenBin(item.code)}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1.5 rounded-xs py-0.5 transition-colors duration-[120ms] ease-[var(--ease-out)]',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      isHidden
                        ? 'text-text-disabled line-through'
                        : 'text-text-tertiary hover:text-text-primary',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex h-2.5 w-2.5 items-center justify-center"
                    >
                      <span
                        style={{ backgroundColor: item.color }}
                        className={
                          item.isPass
                            ? 'h-[7px] w-[7px] rounded-[1px]'
                            : 'h-2.5 w-2.5 rounded-[1.5px]'
                        }
                      />
                    </span>
                    <Untranslated>{item.label}</Untranslated>
                    <span>{formatInteger(item.count)}</span>
                  </button>
                );
              })}
              {overflowBinItems.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={moreBinsOpen}
                  onClick={() => setMoreBinsOpen((v) => !v)}
                  className="cursor-pointer rounded-xs px-1 py-0.5 text-text-tertiary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {t('stage.legend.more', {
                    count: formatInteger(overflowBinItems.length),
                  })}
                </button>
              ) : null}

              {moreBinsOpen && overflowBinItems.length > 0 ? (
                <div
                  role="dialog"
                  className="surface-material absolute bottom-full left-0 mb-2 flex max-h-56 min-w-[220px] flex-col gap-1 overflow-y-auto rounded-md p-2.5"
                >
                  {binLegendItems.map((item) => {
                    const isHidden = hiddenBins.has(item.code);
                    return (
                      <button
                        key={item.code}
                        type="button"
                        aria-pressed={!isHidden}
                        aria-label={t('stage.legend.toggleAria', {
                          bin: item.label,
                        })}
                        onClick={() =>
                          store.getState().toggleHiddenBin(item.code)
                        }
                        className={cn(
                          'flex w-full cursor-pointer items-center justify-between gap-3 rounded-xs px-2 py-1 text-left type-footnote tabular-nums',
                          isHidden
                            ? 'text-text-disabled line-through'
                            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: item.color }}
                            className={
                              item.isPass
                                ? 'h-[7px] w-[7px] shrink-0 rounded-[1px]'
                                : 'h-2.5 w-2.5 shrink-0 rounded-[1.5px]'
                            }
                          />
                          <Untranslated className="truncate">
                            {item.label}
                          </Untranslated>
                        </span>
                        <span>{formatInteger(item.count)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Stage HUD Bottom-Centre: Finding Evidence Caption Pill (§3.5) */}
        {evidenceSummary !== null ? (
          <div
            data-stage-hud="true"
            data-testid="stage-evidence-caption"
            className="surface-material pointer-events-none absolute bottom-3 left-1/2 z-[var(--z-stage-hud)] -translate-x-1/2 rounded-pill px-3 py-1 type-footnote whitespace-nowrap text-text-primary tabular-nums md:bottom-4"
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
            onClick={() => controllerRef.current?.resetToFit(true)}
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
            {failingDieRows.map((row) => (
              <tr key={row.idx}>
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
      </div>

      {/* Horizontal Wafer Strip: 16 px below stage on desktop (783 x 64), 12 px on mobile (390 x 56) (§3.4, §4.9) */}
      <WaferSelector
        lotId={lot.lotId}
        wafers={lot.wafers}
        dies={lot.dies}
        byWaferYield={byWaferYield}
        activeWaferIndex={safeWaferIndex}
        dpr={dpr}
        onSelectWafer={handleSelectWafer}
        className="mt-3 xl:mt-4"
      />
    </div>
  );
}
