'use client';

import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { LotModel, ParametricTestColumn } from '@/core/model';
import {
  formatScaledParametricValue,
  sanitizeReportProseText,
} from '@/core/report';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { MATERIAL_THICK_CLASS } from '@/ui/primitives/surfaces';
import {
  EMPTY_HIDDEN_BINS,
  type SelectionStoreState,
  useResolvedTheme,
  useSelectionStore,
  type WaferColorMode,
} from '@/ui/state';
import {
  MOTION_TOKENS,
  SPRING_TOKENS,
  THEME_TOKENS,
  WAFER_TOKENS,
} from '@/ui/tokens';
import {
  computeMagnifierPlacement,
  computePinnedReadoutPlacement,
  formatDieCoordinate,
} from './linked-interactions';
import type { CameraState } from './wafer-camera';
import { cameraToViewportTransform } from './wafer-camera';
import {
  buildFailBinRankMap,
  computeWaferRenderLayout,
  dieCoordToCanvasRect,
  resolveCanvasPixelSize,
} from './wafer-geometry';

export const MAGNIFIER_WIDTH_PX = 200 as const;
export const LOUPE_WIDTH_PX = 184 as const;
export const LOUPE_HEIGHT_PX = 112 as const;
const HIDE_DELAY_MS = 80 as const;

export interface HoverMagnifierHandle {
  /** Updates pointer coordinates and hit-tested die without re-rendering `WaferMapCanvas`. */
  notifyStagePointer(
    pointerX: number,
    pointerY: number,
    hitDieIndex: number | null,
  ): void;
  /** Starts the 80 ms leave delay when pointer exits the stage (unless pinned). */
  notifyStagePointerLeave(): void;
  /**
   * Suppresses hover display while dragging/panning or box-selecting. On release the hover
   * readout returns at the next pointer move over a die (premium §8.4).
   */
  setGestureSuppressed(suppressed: boolean): void;
  /**
   * Hides the magnifier while a camera gesture, spring, or inertia runs; it returns after the
   * camera settles and the pointer moves (premium §8.4).
   */
  setCameraMotion(active: boolean): void;
  /** Repositions the magnifier when camera zooms/pans or keyboard steps dies. */
  syncPositionForCamera(): void;
  /** Positions relative to a keyboard-stepped die's screen centre. */
  notifyKeyboardStepDie(dieIndex: number): void;
  /**
   * Toggles Enter-key or touch-tap pin on a die (§4.7, §4.8). A touch pin shows the readout
   * without the loupe, 12 px above the die (premium §7.15).
   */
  togglePinAtDie(dieIndex: number | null, source?: MagnifierPinSource): boolean;
  /** Clears pinned magnifier (`true` if a pin was active and cleared). */
  clearPin(): boolean;
  hasPin(): boolean;
}

export type MagnifierPinSource = 'keyboard' | 'touch';

export interface HoverMagnifierProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly dpr: number;
  readonly getBaseCanvas: () => HTMLCanvasElement | null;
  readonly getCamera: () => CameraState;
  readonly getRasterCamera: () => CameraState;
  readonly store?: StoreApi<SelectionStoreState>;
  /** Called after the pinned die changes, so the overlay can draw `pinned-stroke` (premium §5.4). */
  readonly onPinnedDieChange?: (dieIndex: number | null) => void;
}

interface KeyTestReadout {
  readonly testNum: number;
  readonly label: string;
  readonly valueText: string;
  readonly outOfLimits: boolean;
}

/** The one key test for the readout's row 3: the cited/active test, else the first out-of-limits test, else the lowest test number. */
function selectKeyTestForDie(
  lot: LotModel,
  dieIndex: number,
  preferredTestNum: number | null,
): KeyTestReadout | null {
  if (lot.tests.size === 0) {
    return null;
  }
  const candidates: Array<{
    readonly col: ParametricTestColumn;
    readonly value: number;
    readonly outOfLimits: boolean;
    readonly isPreferred: boolean;
  }> = [];

  for (const col of lot.tests.values()) {
    const val = col.values[dieIndex];
    if (val === undefined || !Number.isFinite(val)) {
      continue;
    }
    const outLo = col.loLimit !== null && val < col.loLimit;
    const outHi = col.hiLimit !== null && val > col.hiLimit;
    candidates.push({
      col,
      value: val,
      outOfLimits: outLo || outHi,
      isPreferred: preferredTestNum !== null && col.testNum === preferredTestNum,
    });
  }

  candidates.sort((a, b) => {
    if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
    if (a.outOfLimits !== b.outOfLimits) return a.outOfLimits ? -1 : 1;
    return a.col.testNum - b.col.testNum;
  });

  const item = candidates[0];
  if (item === undefined) {
    return null;
  }
  const scaled = formatScaledParametricValue(
    item.value,
    item.col.units,
    item.col.resScal,
  );
  const cleanName = sanitizeReportProseText(item.col.testName);
  return {
    testNum: item.col.testNum,
    label: cleanName.length > 0 ? cleanName : `T${item.col.testNum}`,
    valueText: scaled.displayValue,
    outOfLimits: item.outOfLimits,
  };
}

/** `--bin-ink-N` index for a fail-bin rank (rank 0 is ember; ranks 1+ cycle through 7 hues, premium §3.5). */
function binInkIndexForRank(rank: number): number {
  const safe = Math.max(0, Math.trunc(rank));
  return safe === 0 ? 0 : 1 + ((safe - 1) % 7);
}

/**
 * Self-contained Floating Hover Magnifier (`src/ui/wafer-map/HoverMagnifier.tsx`, premium §5.9, §7.15, §8.4).
 *
 * Subscribes directly to `SelectionStore` so `WaferMapCanvas` incurs ZERO re-renders on hover,
 * wheel zoom, or drag pan:
 * - `material-thick` + `shadow-popover` container (`z: 20`, `r-lg`, padding `8`, width `200`)
 * - Hover devices: `184 x 112` `r-sm` loupe blitting a `3x` neighbourhood from `BaseCanvas`
 *   once per hovered-die change, with a `1.5 px` white rim on the die and an inner 1 px ring
 * - Inter readout, at most 4 rows, primary and secondary text only: status (swatch +
 *   "Failed"/"Passed", bin code), place ("X 12, Y −4", site), one key test (value, "out of
 *   limits"), and the retest line when the die was retested
 * - 1:1 pointer tracking via imperative `transform` written in rAF; `80 ms` leave delay before
 *   `120 ms` fade-out; `Enter` pins at the cursor; a touch tap pins the readout 12 px above the die.
 */
const HoverMagnifierImpl = React.forwardRef<
  HoverMagnifierHandle,
  HoverMagnifierProps
>(function HoverMagnifier(
  {
    lot,
    waferIndex,
    stageWidth,
    stageHeight,
    dpr,
    getBaseCanvas,
    getCamera,
    getRasterCamera,
    store = useSelectionStore,
    onPinnedDieChange,
  },
  ref,
): React.JSX.Element {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const resolvedTheme = useResolvedTheme();
  const outerRef = React.useRef<HTMLDivElement>(null);
  const loupeCanvasRef = React.useRef<HTMLCanvasElement>(null);

  const {
    storeLot,
    rawHoveredDieIndex,
    rawColorMode,
    rawActiveTestNum,
    rawHiddenBins,
    rawClaimCitedTestNum,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawHoveredDieIndex: s.hoveredDieIndex,
      rawColorMode: s.colorMode,
      rawActiveTestNum: s.activeTestNum,
      rawHiddenBins: s.hiddenBins,
      rawClaimCitedTestNum: s.claimHighlight?.citedTestNums?.[0] ?? null,
    })),
  );

  const isSynced = storeLot === lot;
  const hoveredDieIndex = isSynced ? rawHoveredDieIndex : null;
  const colorMode: WaferColorMode = isSynced ? rawColorMode : 'pass-fail';
  const hiddenBins = isSynced ? rawHiddenBins : EMPTY_HIDDEN_BINS;
  // A finding click only reorders the readout's key tests; defer that so the click frame
  // carries just the urgent highlight render (§5.10)
  const preferredTestNum = React.useDeferredValue(
    isSynced ? (rawClaimCitedTestNum ?? rawActiveTestNum) : null,
  );

  const [pinnedDieIndex, setPinnedDieIndex] = React.useState<number | null>(
    null,
  );
  const [pinSource, setPinSource] = React.useState<MagnifierPinSource | null>(
    null,
  );
  const pinSourceRef = React.useRef<MagnifierPinSource | null>(null);
  pinSourceRef.current = pinnedDieIndex !== null ? pinSource : null;
  const touchPinned = pinnedDieIndex !== null && pinSource === 'touch';
  const [hoverActive, setHoverActive] = React.useState(false);
  const [gestureSuppressedFlag, setGestureSuppressedState] = React.useState(false);
  const [cameraMoving, setCameraMovingState] = React.useState(false);
  const gestureSuppressed = gestureSuppressedFlag || cameraMoving;

  const pinnedRef = React.useRef<number | null>(null);
  pinnedRef.current = pinnedDieIndex;
  const gestureFlagRef = React.useRef(false);
  const cameraMovingRef = React.useRef(false);
  const suppressedRef = React.useRef(false);
  suppressedRef.current = gestureSuppressed;

  const pointerPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const lastPlacedRef = React.useRef<{
    x: number;
    y: number;
    origin: string;
  }>({ x: 0, y: 0, origin: 'bottom left' });
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRafRef = React.useRef<number | null>(null);
  const lastValidDieRef = React.useRef<number | null>(null);

  // Clear pin when wafer or lot changes
  React.useEffect(() => {
    setPinnedDieIndex(null);
  }, [lot, waferIndex]);

  const onPinnedDieChangeRef = React.useRef(onPinnedDieChange);
  onPinnedDieChangeRef.current = onPinnedDieChange;
  React.useEffect(() => {
    onPinnedDieChangeRef.current?.(pinnedDieIndex);
  }, [pinnedDieIndex]);

  const activeDieIndex = pinnedDieIndex ?? hoveredDieIndex;
  const wafer = lot.wafers[waferIndex];

  if (
    activeDieIndex !== null &&
    wafer !== undefined &&
    activeDieIndex >= wafer.dieStartIndex &&
    activeDieIndex < wafer.dieEndIndex &&
    lot.dies.hasValidCoords[activeDieIndex] !== 0
  ) {
    lastValidDieRef.current = activeDieIndex;
  }

  const displayedDieIndex =
    activeDieIndex !== null &&
    wafer !== undefined &&
    activeDieIndex >= wafer.dieStartIndex &&
    activeDieIndex < wafer.dieEndIndex &&
    lot.dies.hasValidCoords[activeDieIndex] !== 0
      ? activeDieIndex
      : lastValidDieRef.current !== null &&
          wafer !== undefined &&
          lastValidDieRef.current >= wafer.dieStartIndex &&
          lastValidDieRef.current < wafer.dieEndIndex &&
          lot.dies.hasValidCoords[lastValidDieRef.current] !== 0
        ? lastValidDieRef.current
        : null;

  const visible =
    !gestureSuppressed &&
    displayedDieIndex !== null &&
    (pinnedDieIndex !== null || hoverActive);

  const clearHideTimer = React.useCallback((): void => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const latestGeomRef = React.useRef({
    lot,
    waferIndex,
    stageWidth,
    stageHeight,
    getCamera,
  });
  latestGeomRef.current = {
    lot,
    waferIndex,
    stageWidth,
    stageHeight,
    getCamera,
  };

  const applyPlacementNow = React.useCallback(
    (targetDieIdx: number | null, useDieCenterForPointer = false): void => {
      const el = outerRef.current;
      const cur = latestGeomRef.current;
      const curWafer = cur.lot.wafers[cur.waferIndex];
      if (
        !el ||
        !curWafer ||
        targetDieIdx === null ||
        targetDieIdx < curWafer.dieStartIndex ||
        targetDieIdx >= curWafer.dieEndIndex ||
        cur.lot.dies.hasValidCoords[targetDieIdx] === 0
      ) {
        return;
      }

      const cam = cur.getCamera();
      const vp = cameraToViewportTransform(cam, cur.stageWidth, cur.stageHeight);
      const liveLayout = computeWaferRenderLayout(
        curWafer,
        cur.stageWidth,
        cur.stageHeight,
        cur.lot.dies,
        vp,
      );
      const dieRect = dieCoordToCanvasRect(
        cur.lot.dies.x[targetDieIdx]!,
        cur.lot.dies.y[targetDieIdx]!,
        liveLayout,
      );

      const ptr =
        !useDieCenterForPointer &&
        pinnedRef.current === null &&
        pointerPosRef.current !== null
          ? pointerPosRef.current
          : { x: dieRect.centerX, y: dieRect.centerY };

      const measuredHeight = el.offsetHeight > 0 ? el.offsetHeight : 216;
      if (pinnedRef.current !== null && pinSourceRef.current === 'touch') {
        const pinned = computePinnedReadoutPlacement({
          dieRect: {
            x: dieRect.x,
            y: dieRect.y,
            width: dieRect.width,
            height: dieRect.height,
          },
          readoutWidth: MAGNIFIER_WIDTH_PX,
          readoutHeight: measuredHeight,
          stageWidth: cur.stageWidth,
        });
        lastPlacedRef.current = {
          x: pinned.x,
          y: pinned.y,
          origin: pinned.transformOrigin,
        };
        el.style.transform = `translate3d(${pinned.x}px, ${pinned.y}px, 0)`;
        el.style.transformOrigin = pinned.transformOrigin;
        el.dataset.x = String(pinned.x);
        el.dataset.y = String(pinned.y);
        return;
      }
      const placed = computeMagnifierPlacement({
        pointerX: ptr.x,
        pointerY: ptr.y,
        dieRect: {
          x: dieRect.x,
          y: dieRect.y,
          width: dieRect.width,
          height: dieRect.height,
        },
        magnifierWidth: MAGNIFIER_WIDTH_PX,
        magnifierHeight: measuredHeight,
        stageWidth: cur.stageWidth,
        stageHeight: cur.stageHeight,
      });

      lastPlacedRef.current = {
        x: placed.x,
        y: placed.y,
        origin: placed.transformOrigin,
      };
      el.style.transform = `translate3d(${placed.x}px, ${placed.y}px, 0)`;
      el.style.transformOrigin = placed.transformOrigin;
      el.dataset.x = String(placed.x);
      el.dataset.y = String(placed.y);
    },
    [],
  );

  const schedulePointerPlacement = React.useCallback(
    (dieIdx: number): void => {
      if (posRafRef.current !== null) {
        return;
      }
      if (typeof requestAnimationFrame === 'function') {
        posRafRef.current = requestAnimationFrame(() => {
          posRafRef.current = null;
          const curDie =
            pinnedRef.current ??
            store.getState().hoveredDieIndex ??
            dieIdx;
          applyPlacementNow(curDie, false);
        });
      } else {
        applyPlacementNow(dieIdx, false);
      }
    },
    [applyPlacementNow, store],
  );

  React.useEffect(() => {
    return () => {
      clearHideTimer();
      if (posRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(posRafRef.current);
      }
    };
  }, [clearHideTimer]);

  // Reposition whenever displayedDieIndex or pinned state changes (e.g. after first layout measure)
  React.useLayoutEffect(() => {
    if (visible && displayedDieIndex !== null) {
      applyPlacementNow(displayedDieIndex, pinnedDieIndex !== null);
    }
  }, [visible, displayedDieIndex, pinnedDieIndex, touchPinned, applyPlacementNow]);

  React.useImperativeHandle(
    ref,
    () => ({
      notifyStagePointer(
        pointerX: number,
        pointerY: number,
        hitDieIndex: number | null,
      ): void {
        pointerPosRef.current = { x: pointerX, y: pointerY };
        if (suppressedRef.current) {
          return;
        }
        if (hitDieIndex !== null) {
          clearHideTimer();
          setHoverActive((prev) => (prev ? prev : true));
          schedulePointerPlacement(hitDieIndex);
        } else if (pinnedRef.current === null) {
          if (hideTimerRef.current === null) {
            hideTimerRef.current = setTimeout(() => {
              hideTimerRef.current = null;
              setHoverActive(false);
            }, HIDE_DELAY_MS);
          }
        }
      },
      notifyStagePointerLeave(): void {
        if (pinnedRef.current !== null) {
          return;
        }
        clearHideTimer();
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          setHoverActive(false);
        }, HIDE_DELAY_MS);
      },
      setGestureSuppressed(suppressed: boolean): void {
        if (gestureFlagRef.current === suppressed) {
          return;
        }
        gestureFlagRef.current = suppressed;
        suppressedRef.current = suppressed || cameraMovingRef.current;
        clearHideTimer();
        if (!suppressed && pinnedRef.current === null) {
          // Returns on the next pointer move over a die, not at release (§8.4)
          setHoverActive(false);
        }
        setGestureSuppressedState(suppressed);
      },
      setCameraMotion(active: boolean): void {
        if (cameraMovingRef.current === active) {
          return;
        }
        cameraMovingRef.current = active;
        suppressedRef.current = active || gestureFlagRef.current;
        clearHideTimer();
        if (!active && pinnedRef.current === null) {
          // Returns after the camera settles and the pointer moves (§8.4)
          setHoverActive(false);
        }
        setCameraMovingState(active);
      },
      syncPositionForCamera(): void {
        const target =
          pinnedRef.current ??
          store.getState().hoveredDieIndex ??
          lastValidDieRef.current;
        if (target !== null) {
          applyPlacementNow(target, pinnedRef.current !== null);
        }
      },
      notifyKeyboardStepDie(dieIndex: number): void {
        clearHideTimer();
        pointerPosRef.current = null;
        setHoverActive(true);
        applyPlacementNow(dieIndex, true);
      },
      togglePinAtDie(
        dieIndex: number | null,
        source: MagnifierPinSource = 'keyboard',
      ): boolean {
        clearHideTimer();
        if (dieIndex === null) {
          if (pinnedRef.current !== null) {
            pinnedRef.current = null;
            setPinnedDieIndex(null);
            setHoverActive(false);
            return true;
          }
          return false;
        }
        if (pinnedRef.current === dieIndex) {
          pinnedRef.current = null;
          setPinnedDieIndex(null);
          return true;
        }
        pinnedRef.current = dieIndex;
        pinSourceRef.current = source;
        setPinSource(source);
        setPinnedDieIndex(dieIndex);
        setHoverActive(true);
        applyPlacementNow(dieIndex, true);
        return true;
      },
      clearPin(): boolean {
        if (pinnedRef.current === null) {
          return false;
        }
        pinnedRef.current = null;
        setPinnedDieIndex(null);
        return true;
      },
      hasPin(): boolean {
        return pinnedRef.current !== null;
      },
    }),
    [applyPlacementNow, clearHideTimer, schedulePointerPlacement, store],
  );

  const sbinRankMap = React.useMemo(
    () => buildFailBinRankMap(lot.dies, 'SBIN'),
    [lot.dies],
  );
  const hbinRankMap = React.useMemo(
    () => buildFailBinRankMap(lot.dies, 'HBIN'),
    [lot.dies],
  );

  // Draw 3x neighbourhood loupe ONCE per hovered-die / wafer / mode change (§4.8, §5.6)
  React.useEffect(() => {
    if (!visible || touchPinned || displayedDieIndex === null || !wafer) {
      return;
    }
    const loupeCanvas = loupeCanvasRef.current;
    const baseCanvas = getBaseCanvas();
    if (!loupeCanvas || !baseCanvas || baseCanvas.width === 0) {
      return;
    }
    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dims = resolveCanvasPixelSize(LOUPE_WIDTH_PX, LOUPE_HEIGHT_PX, dpr);
    if (loupeCanvas.width !== dims.pixelWidth) {
      loupeCanvas.width = dims.pixelWidth;
    }
    if (loupeCanvas.height !== dims.pixelHeight) {
      loupeCanvas.height = dims.pixelHeight;
    }

    ctx.setTransform(dims.dpr, 0, 0, dims.dpr, 0, 0);
    ctx.fillStyle = THEME_TOKENS[resolvedTheme].bg;
    ctx.fillRect(0, 0, LOUPE_WIDTH_PX, LOUPE_HEIGHT_PX);

    const liveCam = getCamera();
    const rasterCam = getRasterCamera();
    const rasterVp = cameraToViewportTransform(
      rasterCam,
      stageWidth,
      stageHeight,
    );
    const rasterLayout = computeWaferRenderLayout(
      wafer,
      stageWidth,
      stageHeight,
      lot.dies,
      rasterVp,
    );

    const dieX = lot.dies.x[displayedDieIndex]!;
    const dieY = lot.dies.y[displayedDieIndex]!;
    const rasterDieRect = dieCoordToCanvasRect(dieX, dieY, rasterLayout);

    // 3x current on-screen die size: srcCssW = (LOUPE_W / 3) * (rasterScale / liveScale)
    const scaleRatio =
      (rasterCam.scale > 0 ? rasterCam.scale : 1) /
      Math.max(0.25, liveCam.scale);
    const srcCssW = (LOUPE_WIDTH_PX / 3) * scaleRatio;
    const srcCssH = (LOUPE_HEIGHT_PX / 3) * scaleRatio;

    const basePxPerCssX = baseCanvas.width / Math.max(1, stageWidth);
    const basePxPerCssY = baseCanvas.height / Math.max(1, stageHeight);

    const rawSx = (rasterDieRect.centerX - srcCssW / 2) * basePxPerCssX;
    const rawSy = (rasterDieRect.centerY - srcCssH / 2) * basePxPerCssY;
    const rawSw = srcCssW * basePxPerCssX;
    const rawSh = srcCssH * basePxPerCssY;

    const clampedSx = Math.max(0, rawSx);
    const clampedSy = Math.max(0, rawSy);
    const clampedRight = Math.min(baseCanvas.width, rawSx + rawSw);
    const clampedBottom = Math.min(baseCanvas.height, rawSy + rawSh);
    const sw = clampedRight - clampedSx;
    const sh = clampedBottom - clampedSy;

    if (sw > 0.5 && sh > 0.5 && rawSw > 0 && rawSh > 0) {
      const dx = ((clampedSx - rawSx) / rawSw) * LOUPE_WIDTH_PX;
      const dy = ((clampedSy - rawSy) / rawSh) * LOUPE_HEIGHT_PX;
      const dw = (sw / rawSw) * LOUPE_WIDTH_PX;
      const dh = (sh / rawSh) * LOUPE_HEIGHT_PX;
      ctx.drawImage(baseCanvas, clampedSx, clampedSy, sw, sh, dx, dy, dw, dh);
    }

    // Hovered die: 1.5 px white rim at the loupe centre (premium §5.9)
    const liveVp = cameraToViewportTransform(liveCam, stageWidth, stageHeight);
    const liveLayout = computeWaferRenderLayout(
      wafer,
      stageWidth,
      stageHeight,
      lot.dies,
      liveVp,
    );
    const isPass = lot.dies.finalPass[displayedDieIndex] !== 0;
    const loupeDieSize =
      (isPass ? liveLayout.passDieSizePx : liveLayout.dieSizePx) * 3;
    const half = loupeDieSize / 2;
    const cx = LOUPE_WIDTH_PX / 2;
    const cy = LOUPE_HEIGHT_PX / 2;

    ctx.strokeStyle = WAFER_TOKENS.hoverStroke.inner;
    ctx.lineWidth = WAFER_TOKENS.hoverStroke.innerWidthPx;
    ctx.strokeRect(cx - half, cy - half, loupeDieSize, loupeDieSize);
  }, [
    visible,
    touchPinned,
    resolvedTheme,
    displayedDieIndex,
    lot,
    wafer,
    colorMode,
    hiddenBins,
    stageWidth,
    stageHeight,
    dpr,
    getBaseCanvas,
    getCamera,
    getRasterCamera,
  ]);

  const readout = React.useMemo(() => {
    if (displayedDieIndex === null) {
      return null;
    }
    const { dies } = lot;
    const x = dies.x[displayedDieIndex]!;
    const y = dies.y[displayedDieIndex]!;
    const isPass = dies.finalPass[displayedDieIndex] !== 0;
    const hbin = dies.hbin[displayedDieIndex]!;
    const sbin = dies.sbin[displayedDieIndex]!;
    const retestCount = dies.retestCount[displayedDieIndex]!;

    const site = lot.sites[dies.siteIndex[displayedDieIndex]!];
    let multiHead = false;
    for (let i = 1; i < lot.sites.length; i += 1) {
      if (lot.sites[i]!.headNum !== lot.sites[0]!.headNum) {
        multiHead = true;
        break;
      }
    }
    const siteText = site
      ? multiHead
        ? `${site.headNum}:${site.siteNum}`
        : String(site.siteNum)
      : null;

    const useHbin = colorMode === 'hbin' || sbin === 65535;
    const binCode = useHbin ? hbin : sbin;
    const binLabel = `${useHbin ? 'HBIN' : 'SBIN'} ${binCode}`;

    // Swatch: full ember square for failed, hollow for passed; bin colour in bin modes (§7.15)
    const rank = useHbin
      ? (hbinRankMap.get(hbin) ?? 0)
      : (sbinRankMap.get(sbin) ?? 0);
    const swatchInkIndex =
      !isPass && colorMode !== 'pass-fail' ? binInkIndexForRank(rank) : null;

    return {
      xText: formatDieCoordinate(x),
      yText: formatDieCoordinate(y),
      siteText,
      isPass,
      binLabel,
      swatchInkIndex,
      keyTest: selectKeyTestForDie(lot, displayedDieIndex, preferredTestNum),
      retestCount,
    };
  }, [
    displayedDieIndex,
    lot,
    colorMode,
    hbinRankMap,
    sbinRankMap,
    preferredTestNum,
  ]);

  const isShown = visible && readout !== null;
  const [domVisible, setDomVisible] = React.useState(false);

  if (isShown && !domVisible) {
    setDomVisible(true);
  }

  React.useEffect(() => {
    if (isShown || !domVisible) {
      return;
    }
    // Keep the layer visible through the `dur-1` fade (also under reduced motion, §8.4)
    const timer = setTimeout(
      () => setDomVisible(false),
      MOTION_TOKENS.dur1Ms + 10,
    );
    return () => clearTimeout(timer);
  }, [isShown, domVisible]);

  // Touch pin and reduced motion: opacity only, 120 ms (premium §8.4)
  const opacityOnly = Boolean(shouldReduceMotion) || touchPinned;
  // Show: opacity 0 -> 1 and scale 0.96 -> 1 on `spring-snappy`. Hide: opacity -> 0 over
  // `dur-1` at the current scale, so re-entering mid-fade reverses from the current opacity;
  // the scale resets to 0.96 only once fully hidden (premium §8.4)
  const fadeTransition = {
    duration: MOTION_TOKENS.dur1Ms / 1000,
    ease: MOTION_TOKENS.easeOutTuple,
  };

  return (
    <div
      ref={outerRef}
      data-testid="wafer-hover-magnifier"
      data-visible={isShown ? 'true' : 'false'}
      data-pinned={pinnedDieIndex !== null ? 'true' : 'false'}
      data-pin-source={pinnedDieIndex !== null ? (pinSource ?? 'keyboard') : undefined}
      aria-hidden={!isShown}
      style={{
        transform: `translate3d(${lastPlacedRef.current.x}px, ${lastPlacedRef.current.y}px, 0)`,
        transformOrigin: lastPlacedRef.current.origin,
        visibility: isShown || domVisible ? 'visible' : 'hidden',
      }}
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-magnifier)] w-[200px] select-none"
    >
      <motion.div
        initial={false}
        animate={
          isShown
            ? { opacity: 1, scale: 1 }
            : domVisible || opacityOnly
              ? { opacity: 0, scale: 1 }
              : { opacity: 0, scale: 0.96 }
        }
        transition={
          isShown && !opacityOnly
            ? SPRING_TOKENS.snappy
            : !isShown && !domVisible
              ? { duration: 0 }
              : fadeTransition
        }
        style={{ transformOrigin: 'inherit' }}
        className={cn(MATERIAL_THICK_CLASS, 'flex flex-col gap-2 rounded-lg p-2')}
      >
        {/* Loupe on hover devices only: 184 x 112, r-sm, inner 1 px ring (premium §5.9, §7.15) */}
        {touchPinned ? null : (
          <div
            data-testid="magnifier-loupe"
            className="relative [@media(hover:none)]:hidden"
          >
            <canvas
              ref={loupeCanvasRef}
              data-testid="magnifier-loupe-canvas"
              aria-hidden="true"
              style={{ width: `${LOUPE_WIDTH_PX}px`, height: `${LOUPE_HEIGHT_PX}px` }}
              className="block rounded-sm bg-bg"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
            />
          </div>
        )}

        {/* Inter readout: at most 4 rows, status first, primary and secondary text only (premium §7.15) */}
        {readout ? (
          <div
            data-testid="magnifier-readout"
            className="flex flex-col gap-1 px-1 pt-0.5 pb-1 font-sans"
          >
            <div
              data-magnifier-row="status"
              className="flex min-w-0 items-center justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  data-magnifier-swatch={
                    readout.isPass
                      ? 'hollow'
                      : readout.swatchInkIndex === null
                        ? 'fail'
                        : 'bin'
                  }
                  style={
                    readout.swatchInkIndex !== null
                      ? { backgroundColor: `var(--bin-ink-${readout.swatchInkIndex})` }
                      : undefined
                  }
                  className={cn(
                    'size-2.5 shrink-0 rounded-xs',
                    readout.isPass
                      ? 'shadow-[inset_0_0_0_1px_var(--hairline-strong)]'
                      : readout.swatchInkIndex === null && 'bg-ember',
                  )}
                />
                <span className="truncate type-row-title text-text-primary">
                  {readout.isPass ? t('magnifier.passed') : t('magnifier.failed')}
                </span>
              </span>
              <span className="shrink-0 type-subhead text-text-secondary">
                <Untranslated>{readout.binLabel}</Untranslated>
              </span>
            </div>

            <div
              data-magnifier-row="place"
              className="flex min-w-0 items-baseline justify-between gap-2"
            >
              <span
                data-testid="magnifier-coords-value"
                className="truncate type-subhead text-text-secondary"
              >
                {t('magnifier.place', { x: readout.xText, y: readout.yText })}
              </span>
              {readout.siteText !== null ? (
                <span className="shrink-0 type-subhead text-text-secondary">
                  {t('yield.siteLabel', { site: readout.siteText })}
                </span>
              ) : null}
            </div>

            {readout.keyTest ? (
              <div
                data-magnifier-row="test"
                className="flex min-w-0 items-baseline justify-between gap-2"
              >
                <span className="max-w-[96px] truncate type-subhead text-text-secondary">
                  <Untranslated>{readout.keyTest.label}</Untranslated>
                </span>
                <span className="flex min-w-0 flex-col items-end">
                  <span className="truncate type-subhead text-text-primary tabular-nums">
                    <Untranslated>{readout.keyTest.valueText}</Untranslated>
                  </span>
                  {readout.keyTest.outOfLimits ? (
                    <span className="type-caption text-text-primary">
                      {t('magnifier.outOfLimits')}
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}

            {readout.retestCount > 0 ? (
              <div
                data-magnifier-row="retest"
                className="truncate type-subhead text-text-secondary"
              >
                {t(
                  readout.isPass
                    ? 'magnifier.retested'
                    : 'magnifier.retestedFailed',
                  { n: formatInteger(readout.retestCount + 1) },
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
});

export const HoverMagnifier = React.memo(HoverMagnifierImpl);
