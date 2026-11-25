'use client';

import { Minus, Plus, SquareDashed } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { YieldMetrics } from '@/core/analytics';
import { resolveGlossaryEntry } from '@/core/i18n';
import {
  buildWaferProbeOrder,
  type LotModel,
  packWaferCoord,
} from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { formatPinnedDieAnnouncement } from '@/ui/layout/a11y-announcements';
import {
  Button,
  SegmentedControl,
  Term,
  type SegmentedControlOption,
} from '@/ui/primitives';
import { cn } from '@/ui/primitives/cn';
import {
  type SelectionStoreState,
  type SpatialBrushRect,
  useSelectionStore,
  type WaferColorMode,
} from '@/ui/state';
import { SPRING_PHYSICS_EQUIVALENTS, WAFER_TOKENS } from '@/ui/tokens';
import { ActiveFilterChips } from './ActiveFilterChips';
import { BaseCanvas, type BaseCanvasHandle } from './BaseCanvas';
import { BinLegend } from './BinLegend';
import { FailCanvas, type FailCanvasHandle } from './FailCanvas';
import { HoverMagnifier, type HoverMagnifierHandle } from './HoverMagnifier';
import {
  computeEvidenceFramingCamera,
  computeLiveBoxSelectStats,
  computePopoverPlacement,
  computeWaferEvidencePresence,
  formatDieCoordinate,
  sampleCubicEaseOut,
  type ScreenBox,
  screenRectToWaferGridBounds,
} from './linked-interactions';
import { OverlayCanvas, type OverlayCanvasHandle } from './OverlayCanvas';
import {
  computeProbeLightOpacity,
  computeProbeSweepFraction,
  type InitialRevealPlan,
  PROBE_SWEEP_FAIL_FADE_MS,
  PROBE_SWEEP_REVEAL_MS,
  PROBE_SWEEP_SESSION_KEY,
  readPrefersReducedMotionSync,
  resolveInitialRevealMode,
} from './probe-sweep';
import {
  SELECTION_POPOVER_WIDTH_PX,
  SelectionPopover,
  type SelectionPopoverHandle,
} from './SelectionPopover';
import { type WaferSelectOptions, WaferSelector } from './WaferSelector';
import {
  applyKeyboardZoom,
  BUTTON_ZOOM_STEP_FACTOR,
  type CameraState,
  cameraToViewportTransform,
  computeRelativeWrapperTransform,
  createWaferCameraController,
  DEFAULT_CAMERA_STATE,
  ensurePointWithinMargin,
  formatWrapperCssTransform,
  isCameraAtFit,
  MAX_CAMERA_SCALE,
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
import {
  applyStageLayerRect,
  buildWaferDiscMaskImage,
  computeSheenEllipseRestStyle,
  computeStageDiscLayerRects,
} from './stage-layers';
import {
  bindScrollLightSheen,
  canSheenFollow,
  computeSheenTarget,
  createSheenFollower,
  readSheenFollowEnvironment,
  SHEEN_REST,
  SHEEN_STAGE_AMPLITUDE_D,
  type SheenFollower,
} from './sheen-motion';
import { usePrefersMoreContrast } from './use-prefers-more-contrast';

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
 * - Two-stacked-base-canvas `160 ms` `ease-out` wafer crossfade on a thumbnail click, and a `0 ms`
 *   swap on every wafer key (arrows, Home/End, PageUp/PageDown, repeat) or `prefers-reduced-motion`.
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
        siteLabel: site
          ? t('a11y.headSite', { head: site.headNum, site: site.siteNum })
          : '—',
        sbin: lot.dies.sbin[i]!,
        hbin: lot.dies.hbin[i]!,
      });
    }
    return nextRows;
  }, [wafer, lot.dies, lot.sites, t]);

  return (
    <div className="sr-only">
      <table data-testid="wafer-sr-table">
        <caption>
          {t('a11y.failingDiesTable', { wafer: waferId })}
        </caption>
        <thead>
          <tr>
            <th scope="col">X, Y</th>
            <th scope="col">{t('yield.col.site')}</th>
            <th scope="col">SBIN</th>
            <th scope="col">HBIN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowPos) => (
            <tr key={rowPos}>
              <th scope="row">
                ({formatDieCoordinate(row.x)}, {formatDieCoordinate(row.y)})
              </th>
              <td>{row.siteLabel}</td>
              <td>SBIN {row.sbin}</td>
              <td>HBIN {row.hbin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const { t, tPlural, formatInteger, locale } = useT();
  const shouldReduceMotion = useReducedMotion();
  const prefersReduced = readPrefersReducedMotionSync(shouldReduceMotion);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const cameraWrapperRef = React.useRef<HTMLDivElement>(null);
  const crossfadeCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const crossfadeAnimRef = React.useRef<Animation | null>(null);
  const crossfadeScratchRef = React.useRef<HTMLCanvasElement | null>(null);
  const ambientShadowRef = React.useRef<HTMLDivElement>(null);
  const contactShadowRef = React.useRef<HTMLDivElement>(null);
  const haloRef = React.useRef<HTMLDivElement>(null);
  const sheenRef = React.useRef<HTMLDivElement>(null);
  const sheenEllipseRef = React.useRef<HTMLDivElement>(null);
  // Premium §8.11: pointer-follow sheen; last hover pointer (client px) for the post-settle re-target
  const sheenFollowerRef = React.useRef<SheenFollower | null>(null);
  const sheenPointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const resetViewRef = React.useRef<HTMLDivElement>(null);
  const zoomInBtnRef = React.useRef<HTMLButtonElement>(null);
  const zoomOutBtnRef = React.useRef<HTMLButtonElement>(null);
  const skipHintRef = React.useRef<HTMLParagraphElement>(null);
  const finishSweepRef = React.useRef<(() => void) | null>(null);
  // Premium §8.1: the stage caption reads "Reading…" while the sweep runs, until ignite start.
  // Swapped imperatively (React sets this span's text through `textContent`), so no stage render.
  const defaultCaptionElRef = React.useRef<HTMLSpanElement>(null);
  const defaultCaptionTextRef = React.useRef('');
  const readingCaptionTextRef = React.useRef('');
  const setSweepReading = React.useCallback((reading: boolean): void => {
    const el = defaultCaptionElRef.current;
    if (!el) {
      return;
    }
    const next = reading
      ? readingCaptionTextRef.current
      : defaultCaptionTextRef.current;
    if (el.textContent !== next) {
      el.textContent = next;
    }
  }, []);
  const baseCanvasRef = React.useRef<BaseCanvasHandle>(null);
  const failCanvasRef = React.useRef<FailCanvasHandle>(null);
  const overlayCanvasRef = React.useRef<OverlayCanvasHandle>(null);
  const magnifierRef = React.useRef<HoverMagnifierHandle>(null);
  const handlePinnedDieChange = React.useCallback(
    (dieIndex: number | null): void => {
      overlayCanvasRef.current?.setPinnedDieIndex(dieIndex);
    },
    [],
  );
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
  const stageLiveRef = React.useRef<HTMLSpanElement | null>(null);

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
            dpr,
          )
        : null,
    [wafer, stageDims.width, stageDims.height, lot.dies, dpr],
  );
  const highContrast = usePrefersMoreContrast();

  const reducedMotionRef = React.useRef(prefersReduced);
  reducedMotionRef.current = prefersReduced;

  if (sheenFollowerRef.current === null && typeof window !== 'undefined') {
    sheenFollowerRef.current = createSheenFollower({
      write: (transform) => {
        const el = sheenEllipseRef.current;
        if (el) {
          el.style.transform = transform;
        }
      },
      requestFrame: (cb) => window.requestAnimationFrame(cb),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
    });
  }

  // Sheen target for a pointer in client px, from the disc's on-screen box (camera included)
  const retargetSheen = React.useCallback((clientX: number, clientY: number) => {
    const follower = sheenFollowerRef.current;
    const sheenEl = sheenRef.current;
    if (!follower || !sheenEl) {
      return;
    }
    const r = sheenEl.getBoundingClientRect();
    follower.setTarget(
      computeSheenTarget(
        clientX,
        clientY,
        r.left + r.width / 2,
        r.top + r.height / 2,
        r.width / 2,
        SHEEN_STAGE_AMPLITUDE_D,
      ),
    );
  }, []);

  React.useEffect(() => {
    if (prefersReduced) {
      sheenPointerRef.current = null;
      sheenFollowerRef.current?.snapToRest();
    }
  }, [prefersReduced]);

  // Touch screens: the sheen follows an overhead scroll light instead of a hovering pointer
  React.useEffect(() => {
    const follower = sheenFollowerRef.current;
    if (prefersReduced || !follower) {
      return undefined;
    }
    return bindScrollLightSheen({
      getDisc: () => sheenRef.current,
      follower,
      amplitudeD: SHEEN_STAGE_AMPLITUDE_D,
    });
  }, [prefersReduced]);

  React.useEffect(
    () => () => {
      sheenFollowerRef.current?.dispose();
    },
    [],
  );

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

  // Re-place the DOM shadow, halo, and sheen layers (premium §5.1) in the raster's CSS px
  const syncDiscLayersForRaster = React.useCallback(
    (rasterScale: number, rasterTx: number, rasterTy: number): void => {
      const curWafer = waferGeometryRef.current.wafer;
      if (!curWafer) {
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
      const rects = computeStageDiscLayerRects(
        rasterLayout.centerXCss,
        rasterLayout.centerYCss,
        rasterLayout.waferRadiusPx,
      );
      const pairs: ReadonlyArray<
        readonly [HTMLDivElement | null, keyof typeof rects]
      > = [
        [ambientShadowRef.current, 'ambient'],
        [contactShadowRef.current, 'contact'],
        [haloRef.current, 'halo'],
        [sheenRef.current, 'sheen'],
      ];
      for (const [el, key] of pairs) {
        if (el) {
          applyStageLayerRect(el.style, rects[key]);
        }
      }
    },
    [],
  );

  const syncCameraHud = React.useCallback((camera: CameraState): void => {
    const stageEl = stageRef.current;
    const atFit = isCameraAtFit(camera);
    if (stageEl) {
      const zoomed = camera.scale > 1.001 ? 'true' : 'false';
      if (stageEl.dataset.zoomed !== zoomed) {
        stageEl.dataset.zoomed = zoomed;
      }
      stageEl.dataset.cameraScale = camera.scale.toFixed(4);
      stageEl.dataset.cameraTx = camera.tx.toFixed(2);
      stageEl.dataset.cameraTy = camera.ty.toFixed(2);
    }
    const resetViewEl = resetViewRef.current;
    if (resetViewEl) {
      resetViewEl.hidden = atFit;
      if (!atFit) {
        const label = `${Math.round(camera.scale * 100)}%`;
        resetViewEl
          .querySelectorAll<HTMLElement>('[data-zoom-value]')
          .forEach((el) => {
            if (el.textContent !== label) {
              el.textContent = label;
            }
          });
      }
    }
    const zoomOutEl = zoomOutBtnRef.current;
    if (zoomOutEl) {
      const outDisabled = atFit;
      zoomOutEl.disabled = outDisabled;
      if (outDisabled) {
        zoomOutEl.setAttribute('aria-disabled', 'true');
      } else {
        zoomOutEl.removeAttribute('aria-disabled');
      }
    }
    const zoomInEl = zoomInBtnRef.current;
    if (zoomInEl) {
      const inDisabled = camera.scale >= MAX_CAMERA_SCALE - 0.001;
      zoomInEl.disabled = inDisabled;
      if (inDisabled) {
        zoomInEl.setAttribute('aria-disabled', 'true');
      } else {
        zoomInEl.removeAttribute('aria-disabled');
      }
    }
  }, []);

  const controllerRef = React.useRef<WaferCameraController | null>(null);
  const cameraMotionActiveRef = React.useRef(false);
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
        // Premium §7.7 + Task 15: Reset view, zoom buttons, and camera attributes sync without a React render
        syncCameraHud(camera);
        overlayCanvasRef.current?.paintForCamera(camera);
        // Premium §8.4: the magnifier hides while a gesture, spring, or inertia moves the camera
        if (cameraMotionActiveRef.current !== motionActive) {
          cameraMotionActiveRef.current = motionActive;
          magnifierRef.current?.setCameraMotion(motionActive);
          // Premium §8.11: the sheen target holds while the camera moves, then re-aims at the pointer
          const follower = sheenFollowerRef.current;
          if (follower) {
            if (motionActive) {
              follower.setFrozen(true);
            } else {
              const pointer = sheenPointerRef.current;
              if (pointer) {
                retargetSheen(pointer.x, pointer.y);
              }
              follower.setFrozen(false);
            }
          }
        }
        magnifierRef.current?.syncPositionForCamera();
        syncCommittedPopoverForCamera(camera);
      },
      onSettleReRaster: (rasterCamera) => {
        baseCanvasRef.current?.paintForCamera(rasterCamera);
        syncDiscLayersForRaster(
          rasterCamera.scale,
          rasterCamera.tx,
          rasterCamera.ty,
        );
      },
      onRestoreFitRaster: () => {
        baseCanvasRef.current?.paintForCamera(DEFAULT_CAMERA_STATE);
        syncDiscLayersForRaster(1, 0, 0);
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

  // Premium §8.1 load reveal: probe sweep + ignite on the first load per session, the ignite alone on
  // later loads, a 120 ms base fade under reduced motion; any key, click, or wheel completes it
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
      setSweepReading(false);
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

    const waferIdx = waferGeometryRef.current.safeWaferIndex;
    const probeOrder =
      plan.mode === 'reduced'
        ? new Uint32Array(0)
        : (probeOrderByWaferRef.current?.[waferIdx] ??
          buildWaferProbeOrder(lot, waferIdx));

    // A lot whose reveal already completed (cached with 0 ms) redraws at once on remount
    const alreadyRevealed = plan.mode === 'ignite' && plan.fadeDurationMs <= 0;
    if (plan.mode === 'reduced' || alreadyRevealed || probeOrder.length === 0) {
      finishSweepRef.current = null;
      baseCanvasRef.current?.setSweepSuppressAutoPaint(false);
      overlayCanvasRef.current?.setProbeHeadDieIndex(null);
      failCanvasRef.current?.setOpacity(0);
      if (skipHintRef.current) {
        skipHintRef.current.hidden = true;
      }
      setSweepReading(false);
      onVerdictRevealTriggerRef.current?.();
      if (stageRef.current) {
        stageRef.current.dataset.sweep = 'done';
      }

      // Reduced motion: final dies drawn, base canvas opacity 0 -> 1 in 120 ms (§8.1, §8.16)
      const baseEl = baseCanvasRef.current?.getCanvasElement();
      if (
        plan.mode === 'reduced' &&
        baseEl &&
        typeof baseEl.animate === 'function' &&
        plan.fadeDurationMs > 0
      ) {
        const anim = baseEl.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: plan.fadeDurationMs,
          easing: 'linear',
        });
        return () => anim.cancel();
      }
      return;
    }

    // Later loads skip to the ignite step: every die drawn as a pass tile, then the fail canvas ignites
    const igniteOnly = plan.mode === 'ignite';

    if (stageRef.current) {
      stageRef.current.dataset.sweep = igniteOnly ? 'ignite' : 'running';
    }
    if (skipHintRef.current) {
      skipHintRef.current.hidden = igniteOnly;
    }
    setSweepReading(!igniteOnly);

    baseCanvasRef.current?.setSweepSuppressAutoPaint(true);
    baseCanvasRef.current?.paintSubstrateOnly();
    failCanvasRef.current?.paintForCamera(DEFAULT_CAMERA_STATE);
    failCanvasRef.current?.setOpacity(0);

    let lastStageW = stageMetricsRef.current.stageWidth;
    let lastStageH = stageMetricsRef.current.stageHeight;
    let revealedCount = 0;
    let verdictTriggered = false;
    let igniteStarted = false;
    let finished = false;
    let rafId: number | null = null;
    const nowStart =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    // The ignite-only path starts its clock at the end of the sweep
    const startMs = igniteOnly ? nowStart - PROBE_SWEEP_REVEAL_MS : nowStart;
    const totalSweepMs = PROBE_SWEEP_REVEAL_MS + PROBE_SWEEP_FAIL_FADE_MS;

    if (igniteOnly) {
      baseCanvasRef.current?.paintSweepBatch(probeOrder, 0, probeOrder.length);
      revealedCount = probeOrder.length;
      verdictTriggered = true;
      onVerdictRevealTriggerRef.current?.();
    }

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
        mode: 'ignite',
        fadeDurationMs: 0,
      });

      // Fail canvas merges into the base: the base repaints every die in its final colour
      baseCanvasRef.current?.setSweepSuppressAutoPaint(false);
      overlayCanvasRef.current?.setProbeHeadDieIndex(null);
      failCanvasRef.current?.setOpacity(0);
      failCanvasRef.current?.clear();
      baseCanvasRef.current?.paintForCamera(getRasterCamera());

      setSweepReading(false);
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

      if (elapsed < PROBE_SWEEP_REVEAL_MS) {
        const headDie =
          revealedCount > 0 ? probeOrder[revealedCount - 1]! : null;
        overlayCanvasRef.current?.setProbeHeadDieIndex(
          headDie,
          computeProbeLightOpacity(elapsed, PROBE_SWEEP_REVEAL_MS),
        );
        rafId = requestAnimationFrame(stepSweep);
        return;
      }

      // Sweep complete: all pass tiles drawn, probe light off, then the 280 ms ignite
      if (revealedCount < probeOrder.length) {
        baseCanvasRef.current?.paintSweepBatch(
          probeOrder,
          revealedCount,
          probeOrder.length,
        );
        revealedCount = probeOrder.length;
      }
      if (!igniteStarted) {
        igniteStarted = true;
        overlayCanvasRef.current?.setProbeHeadDieIndex(null);
        // Header caption swaps from "Reading…" to the fail count at ignite start (0 ms)
        setSweepReading(false);
        if (skipHintRef.current) {
          skipHintRef.current.hidden = true;
        }
        // Premium §8.2: the verdict rise-in starts at ignite start
        if (!verdictTriggered) {
          verdictTriggered = true;
          onVerdictRevealTriggerRef.current?.();
        }
      }

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
  }, [lot, enableInitialReveal, getRasterCamera, setSweepReading]);

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

    // Premium §8.3: the camera follows evidence only while the user has not panned or zoomed
    // since the last evidence change (set, switch, or clear); the flag restarts at each change.
    const userMoved = userMovedCameraSinceFindingRef.current;
    userMovedCameraSinceFindingRef.current = false;
    if (nextClaimId === null) {
      if (!userMoved) {
        controller.resetToFit(true);
      }
      return;
    }

    if (!userMoved && fitLayout && claimHighlightMask) {
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
      cancelSnapAnimation();
      overlayCanvasRef.current?.setLiveBrushScreenRect(null);
    }
  }, [
    activeWaferBrush,
    cancelSnapAnimation,
    committedBrushStats,
    getCamera,
    syncCommittedPopoverForCamera,
  ]);

  // Keep imperative wrapper transform, disc-layer raster geometry, and touch-action synced across stage resizes or discrete store re-renders
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
    syncCameraHud(cam);
    syncDiscLayersForRaster(rasterCam.scale, rasterCam.tx, rasterCam.ty);
  }, [fitLayout, safeWaferIndex, stageTool, syncCameraHud, syncDiscLayersForRaster]);

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

      // Premium §8.11: sheen follows a hovering mouse or pen; touch keeps it at rest
      if (canSheenFollow(event.pointerType, readSheenFollowEnvironment())) {
        sheenPointerRef.current = { x: event.clientX, y: event.clientY };
        retargetSheen(event.clientX, event.clientY);
      }

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
    [
      clearTouchLongPress,
      flushBoxSelectFrame,
      hitTestAtStagePoint,
      retargetSheen,
      store,
    ],
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
          magnifierRef.current?.togglePinAtDie(hitIndex, 'touch');
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
    if (sheenPointerRef.current !== null) {
      sheenPointerRef.current = null;
      sheenFollowerRef.current?.setTarget(SHEEN_REST);
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
          if (stageLiveRef.current && magnifierRef.current?.hasPin()) {
            stageLiveRef.current.textContent =
              formatPinnedDieAnnouncement(lot, locale, curHovered) ?? '';
          }
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
    // §8.7 interrupt: a click mid-fade snapshots the frame on screen (new wafer under the
    // outgoing snapshot at its current opacity), then restarts the fade from 1
    let outgoingAlpha = 0;
    let outgoing: HTMLCanvasElement | null = null;
    if (crossfadeAnimRef.current) {
      outgoingAlpha = Number(getComputedStyle(cfEl).opacity) || 0;
      if (outgoingAlpha > 0) {
        outgoing = crossfadeScratchRef.current ?? document.createElement('canvas');
        crossfadeScratchRef.current = outgoing;
        outgoing.width = cfEl.width;
        outgoing.height = cfEl.height;
        const scratchCtx = outgoing.getContext('2d');
        if (scratchCtx) {
          scratchCtx.clearRect(0, 0, outgoing.width, outgoing.height);
          scratchCtx.drawImage(cfEl, 0, 0);
        } else {
          outgoing = null;
        }
      }
    }
    cfCtx.setTransform(1, 0, 0, 1, 0, 0);
    cfCtx.clearRect(0, 0, cfEl.width, cfEl.height);
    cfCtx.drawImage(baseEl, 0, 0);
    if (outgoing) {
      cfCtx.globalAlpha = Math.min(1, outgoingAlpha);
      cfCtx.drawImage(outgoing, 0, 0);
      cfCtx.globalAlpha = 1;
    }
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

  // §8.7: 160 ms ease-out wafer crossfade on a thumbnail click; 0 ms swap on keys or reduced motion
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

  // Premium §5.6: "Hard bins" and "Soft bins" are Terms; the definition shows after 600 ms
  const modeTermId = React.useId();
  const hasParametricTests = lot.tests.size > 0;
  const modeOptions = React.useMemo<
    readonly SegmentedControlOption<WaferColorMode>[]
  >(() => {
    const hard = resolveGlossaryEntry(locale, 'hardBin');
    const soft = resolveGlossaryEntry(locale, 'softBin');
    const base: SegmentedControlOption<WaferColorMode>[] = [
      { value: 'pass-fail', label: t('mode.passFail') },
      {
        value: 'hbin',
        label: (
          <Term
            variant="label"
            termId="hardBin"
            descriptionId={`${modeTermId}-hard`}
            term={hard.term}
            definition={hard.definition}
          >
            {t('mode.hardBins')}
          </Term>
        ),
        ariaDescribedBy: `${modeTermId}-hard`,
      },
      {
        value: 'sbin',
        label: (
          <Term
            variant="label"
            termId="softBin"
            descriptionId={`${modeTermId}-soft`}
            term={soft.term}
            definition={soft.definition}
          >
            {t('mode.softBins')}
          </Term>
        ),
        ariaDescribedBy: `${modeTermId}-soft`,
      },
    ];
    if (hasParametricTests) {
      base.push({ value: 'parametric', label: t('mode.parametric') });
    }
    return base;
  }, [hasParametricTests, locale, modeTermId, t]);

  const segmentedValue: WaferColorMode =
    colorMode === 'hbin' ||
    colorMode === 'sbin' ||
    (colorMode === 'parametric' && hasParametricTests)
      ? colorMode
      : 'pass-fail';

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

  // The wafer ID stays untranslated inside the localized title (premium §9.2)
  const titleParts = t('stage.title', { wafer: '\u0001' }).split('\u0001');
  // Premium §5.5: the stage caption; box select wins over evidence, evidence over the default
  const captionKind: 'default' | 'evidence' | 'selected' =
    committedBrushStats !== null
      ? 'selected'
      : evidenceSummary !== null
        ? 'evidence'
        : 'default';
  const defaultCaption = t('stage.caption', {
    failed: formatInteger(failCount),
    total: formatInteger(testedCount),
  });
  defaultCaptionTextRef.current = defaultCaption;
  readingCaptionTextRef.current = t('stage.reading');
  const evidenceText =
    evidenceSummary !== null
      ? t('stage.evidenceCaption', {
          dies: formatInteger(evidenceSummary.totalDies),
          wafers: formatInteger(evidenceSummary.wafersWithEvidence),
          here: formatInteger(evidenceSummary.hereCount),
        })
      : null;
  // Keep the last text mounted so it can fade out (120 ms opacity) after evidence clears
  const lastEvidenceTextRef = React.useRef('');
  if (evidenceText !== null) {
    lastEvidenceTextRef.current = evidenceText;
  }
  const evidenceCaption = evidenceText ?? lastEvidenceTextRef.current;
  const lastSelectedTextRef = React.useRef('');
  if (committedBrushStats !== null) {
    lastSelectedTextRef.current = tPlural(
      'stage.selected',
      committedBrushStats.dieCount,
    );
  }
  const selectedCaption = lastSelectedTextRef.current;
  const fitWaferDiameter = (fitLayout?.fitWaferRadiusPx ?? 312) * 2;
  const discLayerRects = computeStageDiscLayerRects(
    fitLayout?.centerXCss ?? stageDims.width / 2,
    fitLayout?.centerYCss ?? stageDims.height / 2,
    fitLayout?.fitWaferRadiusPx ?? 312,
  );
  const discMaskImage = buildWaferDiscMaskImage(wafer?.geometry.wfFlat ?? 'D');
  const sheenEllipseRest = computeSheenEllipseRestStyle();
  const layerBox = (key: keyof typeof discLayerRects): React.CSSProperties => {
    const r = discLayerRects[key];
    return {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    };
  };

  return (
    <div
      className={cn(
        // Premium §6.2 xs: grid so the legend line sits under the strip (390 x 844 order)
        'grid w-full grid-cols-[minmax(0,1fr)_auto] sm:flex sm:flex-col lg:h-full',
        className,
      )}
    >
      {/* Stage header (premium §5.5): wafer title, caption, and removable active filter chips (Req 11.3) */}
      <div
        data-testid="stage-header"
        className="col-span-2 flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-4 pb-2 sm:min-h-10 sm:items-end sm:px-0"
      >
        <h2 className="text-[19px] leading-[1.2] font-[540] tracking-[-0.022em] text-text-primary [font-family:var(--font-display)]">
          {titleParts[0]}
          <Untranslated className="font-mono-id">{waferId}</Untranslated>
          {titleParts.slice(1).join('')}
        </h2>
        <p className="grid type-subhead text-text-secondary tabular-nums">
          {(
            [
              ['default', defaultCaption],
              ['evidence', evidenceCaption],
              ['selected', selectedCaption],
            ] as const
          ).map(([kind, text]) => (
            <span
              key={kind}
              ref={kind === 'default' ? defaultCaptionElRef : undefined}
              data-testid={`stage-${kind === 'default' ? 'caption' : kind === 'evidence' ? 'evidence-caption' : 'selected-caption'}`}
              data-active={captionKind === kind}
              aria-hidden={captionKind === kind ? undefined : true}
              className={cn(
                '[grid-area:1/1] transition-opacity duration-[120ms] ease-[var(--ease-out)] motion-reduce:transition-none',
                captionKind === kind ? 'opacity-100' : 'opacity-0',
              )}
            >
              {text}
            </span>
          ))}
        </p>
        <p
          ref={skipHintRef}
          hidden
          data-testid="probe-sweep-skip-hint"
          className="pointer-events-none ml-auto self-baseline type-subhead whitespace-nowrap text-text-tertiary"
        >
          {t('loading.skipHint')}
        </p>
        <ActiveFilterChips lot={lot} store={store} className="ml-auto self-end" />
      </div>

      {/* Unclipped floating anchor wrapper so magnifier/popover can place above stage edge (§4.8) */}
      <div className="relative col-span-2 flex w-full flex-col lg:min-h-0 lg:flex-1">
        {/* Boxless Wafer Stage (premium §6.2: flex-1 wafer area, 783 x 644 at 1440 x 900; 390 x 390 mobile; §4.7 role="application") */}
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
          data-vt="wafer"
          data-sweep="done"
          data-render-count={renderCountRef.current}
          data-wafer-diameter-px={Math.round(fitWaferDiameter)}
          data-disc-center-x={Math.round(fitLayout?.centerXCss ?? stageDims.width / 2)}
          data-disc-center-y={Math.round(fitLayout?.centerYCss ?? stageDims.height / 2)}
          data-wcr-flat={wafer?.geometry.wfFlat ?? ' '}
          data-wcr-pos-x={wafer?.geometry.posX ?? 'R'}
          data-wcr-pos-y={wafer?.geometry.posY ?? 'U'}
          data-camera-scale="1.0000"
          data-camera-tx="0.00"
          data-camera-ty="0.00"
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
            'relative isolate aspect-square w-full overflow-hidden select-none',
            // Premium §7.7: default at zoom 1, grab when zoomed, crosshair in Select mode
            stageTool === 'select'
              ? 'cursor-crosshair'
              : 'cursor-default data-[zoomed=true]:cursor-grab data-[zoomed=true]:active:cursor-grabbing',
            // Premium §6.2: square below 1024 (390 x 390 full-bleed, sm column width), flex-1 wafer area from 1024
            'lg:aspect-auto lg:min-h-0 lg:flex-1',
            // Premium §7.7: keyboard-only 2 px ink ring with 28 px corners, inset 8 px from the wafer area
            'focus-visible:shadow-none focus-visible:outline-none',
            "focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-2 focus-visible:after:z-[var(--z-stage-hud)] focus-visible:after:rounded-3xl focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ink focus-visible:after:content-['']",
          )}
        >
          {/* Composite-only CSS-transform camera wrapper moving the disc shadows, Base layers, FailCanvas, and sheen (§4.7, premium §5.1) */}
          <div
            ref={cameraWrapperRef}
            data-testid="wafer-camera-wrapper"
            style={{
              transformOrigin: '0 0',
              transform: 'translate3d(0px, 0px, 0) scale(1)',
            }}
            className="pointer-events-none absolute inset-0"
          >
            {/* Stage shadows (premium §5.1 step 2, §3.3): light ambient then contact; dark halo */}
            <div
              ref={ambientShadowRef}
              data-testid="wafer-stage-ambient-shadow"
              aria-hidden="true"
              style={{ ...layerBox('ambient'), backgroundImage: WAFER_TOKENS.ambientShadow }}
              className="pointer-events-none absolute dark:hidden"
            />
            <div
              ref={contactShadowRef}
              data-testid="wafer-stage-contact-shadow"
              aria-hidden="true"
              style={{ ...layerBox('contact'), backgroundImage: WAFER_TOKENS.contactShadow }}
              className="pointer-events-none absolute dark:hidden"
            />
            <div
              ref={haloRef}
              data-testid="wafer-stage-halo"
              aria-hidden="true"
              style={{ ...layerBox('halo'), backgroundImage: WAFER_TOKENS.halo }}
              className="pointer-events-none absolute hidden dark:block"
            />
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
              highContrast={highContrast}
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
            {/* Specular sheen at rest, masked to the notch-cut disc (premium §5.2 step 6) */}
            <div
              ref={sheenRef}
              data-testid="wafer-stage-sheen"
              aria-hidden="true"
              style={{
                ...layerBox('sheen'),
                maskImage: discMaskImage,
                WebkitMaskImage: discMaskImage,
                maskSize: '100% 100%',
                WebkitMaskSize: '100% 100%',
                maskRepeat: 'no-repeat',
                WebkitMaskRepeat: 'no-repeat',
              }}
              className="wafer-sheen pointer-events-none absolute z-[2] overflow-hidden rounded-full mix-blend-screen"
            >
              <div
                ref={sheenEllipseRef}
                data-testid="wafer-stage-sheen-ellipse"
                style={{
                  ...sheenEllipseRest,
                  backgroundImage: WAFER_TOKENS.sheen,
                }}
                className="absolute mix-blend-screen"
              />
            </div>
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

          {/* Visually hidden table of failing dies on the active wafer (§4.7, §6.8) */}
          <FailingDiesTable lot={lot} waferIndex={safeWaferIndex} />
          <span
            ref={stageLiveRef}
            data-testid="stage-live-region"
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          />
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
          onPinnedDieChange={handlePinnedDieChange}
        />

        {/* Box-Select Live & Committed Stats Popover (z: 30, premium §7.14, redesign §4.14, §5.7) */}
        <SelectionPopover
          ref={selectionPopoverRef}
          committedStats={committedBrushStats}
          isCommitted={activeWaferBrush !== null}
          onClear={handleClearSelection}
        />
      </div>

      {/* Control row (premium §5.6, §7.7): segmented control, legend, Reset view, Select an area */}
      <div
        data-testid="stage-control-row"
        className="at-dock relative z-[3] contents sm:flex sm:flex-wrap sm:items-center sm:gap-1 sm:rounded-2xl sm:px-2.5 sm:py-1.5"
      >
        <div className="mt-2 flex h-9 items-center pl-4 sm:mt-0 sm:h-10 sm:pl-0">
          <SegmentedControl
            data-testid="stage-mode-segmented"
            ariaLabel={t('stage.roleDescription')}
            options={modeOptions}
            value={segmentedValue}
            onValueChange={(nextMode) => {
              store.getState().setColorMode(nextMode);
            }}
          />
        </div>
        <BinLegend
          lot={lot}
          waferIndex={safeWaferIndex}
          colorMode={colorMode}
          activeTestNum={activeTestNum}
          passCount={passCount}
          failCount={failCount}
          store={store}
          className={cn(
            'order-last col-span-2 mt-2 min-h-6 px-4 sm:basis-full sm:px-0',
            colorMode !== 'parametric' &&
              'xl:order-none xl:mt-0 xl:ml-2 xl:min-h-0 xl:basis-auto',
          )}
        />
        <div className="mt-2 ml-auto flex h-9 items-center gap-1.5 pr-4 pl-1 sm:mt-0 sm:h-10 sm:pr-0 sm:pl-1">
          <div
            ref={resetViewRef}
            data-testid="stage-reset-view"
            hidden
            className="flex items-center gap-1"
          >
            <span
              data-zoom-value=""
              data-testid="stage-zoom-value"
              className="hidden type-caption text-text-tertiary tabular-nums sm:inline"
            >
              100%
            </span>
            <Button
              variant="ghost"
              data-testid="stage-reset-view-button"
              aria-label={t('stage.resetView')}
              className="px-1.5"
              onClick={() => {
                finishSweepRef.current?.();
                userMovedCameraSinceFindingRef.current = true;
                controllerRef.current?.resetToFit(true);
              }}
            >
              <span className="hidden sm:inline">{t('stage.resetView')}</span>
              <span data-zoom-value="" className="tabular-nums sm:hidden">
                100%
              </span>
            </Button>
          </div>
          <div className="hidden items-center gap-1.5 sm:flex">
            <Button
              ref={zoomOutBtnRef}
              variant="icon"
              data-testid="stage-zoom-out"
              aria-label={t('stage.zoomOut')}
              title={t('stage.zoomOutHint')}
              className="size-7 after:-inset-x-0.5 after:-inset-y-1.5"
              onClick={() => {
                finishSweepRef.current?.();
                userMovedCameraSinceFindingRef.current = true;
                controllerRef.current?.zoomByFactor(
                  1 / BUTTON_ZOOM_STEP_FACTOR,
                );
              }}
            >
              <Minus aria-hidden="true" strokeWidth={1.5} />
            </Button>
            <Button
              ref={zoomInBtnRef}
              variant="icon"
              data-testid="stage-zoom-in"
              aria-label={t('stage.zoomIn')}
              title={t('stage.zoomInHint')}
              className="size-7 after:-inset-x-0.5 after:-inset-y-1.5"
              onClick={() => {
                finishSweepRef.current?.();
                userMovedCameraSinceFindingRef.current = true;
                controllerRef.current?.zoomByFactor(BUTTON_ZOOM_STEP_FACTOR);
              }}
            >
              <Plus aria-hidden="true" strokeWidth={1.5} />
            </Button>
          </div>
          <Button
            variant="icon"
            data-testid="stage-select-area"
            aria-pressed={stageTool === 'select'}
            aria-label={t('stage.selectArea')}
            title={t('stage.selectAreaHint')}
            onClick={() =>
              setStageTool((prev) => (prev === 'select' ? 'pan' : 'select'))
            }
          >
            <SquareDashed aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      {/* Horizontal wafer strip: 76 px desktop, 64 px mobile (premium §5.8) */}
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
        className="at-well-crisp col-span-2 mt-2 rounded-2xl sm:mt-2.5"
      />
    </div>
  );
}

/** Memoized so parent-only state (e.g. the §5.2 verdict reveal) never re-renders the stage mid-gesture. */
export const WaferMapCanvas = React.memo(WaferMapCanvasImpl);
