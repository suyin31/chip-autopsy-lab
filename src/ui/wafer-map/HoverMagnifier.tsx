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
import {
  type SelectionStoreState,
  useSelectionStore,
  type WaferColorMode,
} from '@/ui/state';
import { COLOR_TOKENS, getFailBinColor, SPRING_TOKENS } from '@/ui/tokens';
import { computeMagnifierPlacement } from './linked-interactions';
import type { CameraState } from './wafer-camera';
import { cameraToViewportTransform } from './wafer-camera';
import {
  buildFailBinRankMap,
  computeWaferRenderLayout,
  dieCoordToCanvasRect,
  resolveCanvasPixelSize,
} from './wafer-geometry';

export const MAGNIFIER_WIDTH_PX = 184 as const;
export const LOUPE_WIDTH_PX = 168 as const;
export const LOUPE_HEIGHT_PX = 120 as const;
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
  /** Suppresses hover display while dragging/panning or box-selecting. */
  setGestureSuppressed(suppressed: boolean): void;
  /** Repositions the magnifier when camera zooms/pans or keyboard steps dies. */
  syncPositionForCamera(): void;
  /** Positions relative to a keyboard-stepped die's screen centre. */
  notifyKeyboardStepDie(dieIndex: number): void;
  /** Toggles Enter-key or touch-tap pin on a die (§4.7, §4.8). */
  togglePinAtDie(dieIndex: number | null): boolean;
  /** Clears pinned magnifier (`true` if a pin was active and cleared). */
  clearPin(): boolean;
  hasPin(): boolean;
}

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
}

function resolveNotchClock(wfFlat: 'U' | 'D' | 'L' | 'R' | ' '): number {
  if (wfFlat === 'U') return 12;
  if (wfFlat === 'R') return 3;
  if (wfFlat === 'L') return 9;
  return 6;
}

interface KeyTestReadout {
  readonly testNum: number;
  readonly label: string;
  readonly valueText: string;
  readonly outOfLimits: boolean;
}

function selectKeyTestsForDie(
  lot: LotModel,
  dieIndex: number,
  preferredTestNum: number | null,
): readonly KeyTestReadout[] {
  if (lot.tests.size === 0) {
    return [];
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

  return candidates.slice(0, 2).map((item) => {
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
  });
}

/**
 * Self-contained Floating Hover Magnifier (`src/ui/wafer-map/HoverMagnifier.tsx`, `redesign.md` §4.8, §5.6).
 *
 * Subscribes directly to `SelectionStore` so `WaferMapCanvas` incurs ZERO re-renders on hover,
 * wheel zoom, or drag pan:
 * - Material container (`z: 20`, radius `16`, padding `8`, width `184`)
 * - Desktop `168 x 120` (`rounded-sm` `12 px`) loupe blitting a `3x` neighbourhood from
 *   `BaseCanvas` via `drawImage` strictly once per hovered-die change + `1.5 px` `#D6E6FF` reticle;
 *   hidden on mobile (`hidden md:block`, readout-only on mobile)
 * - 2-column readout (`footnote` sans labels, `mono-data` values): `X, Y`, `Site`, `Bin`
 *   (with pass/fail swatch shape), `HBIN`, up to 2 key tests (`failure-text` + `"out of limits"`),
 *   `Retested` (when retested), and `Notch`
 * - 1:1 pointer tracking via imperative `transform` written in rAF; `80 ms` leave delay before
 *   `120 ms` fade-out; supports `Enter` / touch-tap pinning.
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
  },
  ref,
): React.JSX.Element {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const outerRef = React.useRef<HTMLDivElement>(null);
  const loupeCanvasRef = React.useRef<HTMLCanvasElement>(null);

  const {
    storeLot,
    rawHoveredDieIndex,
    rawColorMode,
    rawActiveTestNum,
    rawClaimCitedTestNum,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawHoveredDieIndex: s.hoveredDieIndex,
      rawColorMode: s.colorMode,
      rawActiveTestNum: s.activeTestNum,
      rawClaimCitedTestNum: s.claimHighlight?.citedTestNums?.[0] ?? null,
    })),
  );

  const isSynced = storeLot === lot;
  const hoveredDieIndex = isSynced ? rawHoveredDieIndex : null;
  const colorMode: WaferColorMode = isSynced ? rawColorMode : 'pass-fail';
  const preferredTestNum = isSynced
    ? (rawClaimCitedTestNum ?? rawActiveTestNum)
    : null;

  const [pinnedDieIndex, setPinnedDieIndex] = React.useState<number | null>(
    null,
  );
  const [hoverActive, setHoverActive] = React.useState(false);
  const [gestureSuppressed, setGestureSuppressedState] = React.useState(false);

  const pinnedRef = React.useRef<number | null>(null);
  pinnedRef.current = pinnedDieIndex;
  const suppressedRef = React.useRef(false);
  suppressedRef.current = gestureSuppressed;

  const pointerPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const posRafRef = React.useRef<number | null>(null);
  const lastValidDieRef = React.useRef<number | null>(null);

  // Clear pin when wafer or lot changes
  React.useEffect(() => {
    setPinnedDieIndex(null);
  }, [lot, waferIndex]);

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

      const measuredHeight = el.offsetHeight > 0 ? el.offsetHeight : 236;
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
  }, [visible, displayedDieIndex, pinnedDieIndex, applyPlacementNow]);

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
        if (suppressedRef.current === suppressed) {
          return;
        }
        suppressedRef.current = suppressed;
        if (suppressed) {
          clearHideTimer();
        }
        setGestureSuppressedState(suppressed);
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
      togglePinAtDie(dieIndex: number | null): boolean {
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
    if (!visible || displayedDieIndex === null || !wafer) {
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
    ctx.fillStyle = COLOR_TOKENS.bg;
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

    // Hovered die 1.5 px ice (#D6E6FF) outline at loupe centre (with 1 px #000 keyline)
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

    ctx.strokeStyle = COLOR_TOKENS.bg;
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - half, cy - half, loupeDieSize, loupeDieSize);

    ctx.strokeStyle = COLOR_TOKENS.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - half, cy - half, loupeDieSize, loupeDieSize);
  }, [
    visible,
    displayedDieIndex,
    lot,
    wafer,
    colorMode,
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
      : '—';

    const useHbin = colorMode === 'hbin' || sbin === 65535;
    const binCode = useHbin ? hbin : sbin;
    const binDef = useHbin ? lot.hbins.get(hbin) : lot.sbins.get(sbin);
    const cleanBinName = binDef?.name ? sanitizeReportProseText(binDef.name) : '';
    const binPrefix = useHbin ? 'HBIN' : 'SBIN';
    const binLabel =
      cleanBinName.length > 0
        ? `${binPrefix} ${binCode} ${cleanBinName}`
        : `${binPrefix} ${binCode}`;

    const rank = useHbin
      ? (hbinRankMap.get(hbin) ?? 0)
      : (sbinRankMap.get(sbin) ?? 0);
    const swatchColor = isPass ? COLOR_TOKENS.passDie : getFailBinColor(rank);

    const keyTests = selectKeyTestsForDie(
      lot,
      displayedDieIndex,
      preferredTestNum,
    );
    const notchClock = resolveNotchClock(wafer?.geometry.wfFlat ?? 'D');

    return {
      coordsText: `${x}, ${y}`,
      siteText,
      isPass,
      binLabel,
      swatchColor,
      hbinText: String(hbin),
      keyTests,
      retestCount,
      notchClock,
    };
  }, [
    displayedDieIndex,
    lot,
    colorMode,
    hbinRankMap,
    sbinRankMap,
    preferredTestNum,
    wafer,
  ]);

  const isShown = visible && readout !== null;

  return (
    <div
      ref={outerRef}
      data-testid="wafer-hover-magnifier"
      data-visible={isShown ? 'true' : 'false'}
      data-pinned={pinnedDieIndex !== null ? 'true' : 'false'}
      aria-hidden={!isShown}
      style={{
        transform: 'translate3d(0px, 0px, 0)',
        transformOrigin: 'bottom left',
        visibility: isShown ? 'visible' : 'hidden',
      }}
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-magnifier)] w-[184px] select-none"
    >
      <motion.div
        initial={false}
        animate={
          isShown
            ? { opacity: 1, scale: 1 }
            : { opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }
        }
        transition={
          shouldReduceMotion
            ? { duration: 0.12 }
            : isShown
              ? SPRING_TOKENS.snappy
              : { duration: 0.12 }
        }
        style={{ transformOrigin: 'inherit' }}
        className="surface-material flex flex-col gap-2 rounded-md p-2"
      >
        {/* Desktop 168 x 120 rounded-12 3x die-neighbourhood loupe (§4.8) */}
        <canvas
          ref={loupeCanvasRef}
          data-testid="magnifier-loupe-canvas"
          aria-hidden="true"
          style={{ width: `${LOUPE_WIDTH_PX}px`, height: `${LOUPE_HEIGHT_PX}px` }}
          className="hidden rounded-sm bg-bg md:block"
        />

        {/* Readout: footnote labels in sans, mono-data values (§4.8, §6.8) */}
        {readout ? (
          <div
            data-testid="magnifier-readout"
            className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 px-0.5"
          >
            <span className="type-footnote leading-[18px] text-text-tertiary">
              {t('magnifier.coords')}
            </span>
            <span
              data-testid="magnifier-coords-value"
              className="truncate text-right type-mono-data leading-[18px] text-text-primary"
            >
              <Untranslated>{readout.coordsText}</Untranslated>
            </span>

            <span className="type-footnote leading-[18px] text-text-tertiary">
              {t('magnifier.site')}
            </span>
            <span className="truncate text-right type-mono-data leading-[18px] text-text-primary">
              <Untranslated>{readout.siteText}</Untranslated>
            </span>

            <span className="type-footnote leading-[18px] text-text-tertiary">
              {t('magnifier.bin')}
            </span>
            <span className="inline-flex min-w-0 items-center justify-end gap-1.5 text-right type-mono-data leading-[18px] text-text-primary">
              <span
                aria-hidden="true"
                className="inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
              >
                <span
                  style={{ backgroundColor: readout.swatchColor }}
                  className={
                    readout.isPass
                      ? 'h-[7px] w-[7px] rounded-[1px]'
                      : 'h-2.5 w-2.5 rounded-[1.5px]'
                  }
                />
              </span>
              <Untranslated className="truncate">{readout.binLabel}</Untranslated>
            </span>

            <span className="type-footnote leading-[18px] text-text-tertiary">
              {t('magnifier.hbin')}
            </span>
            <span className="truncate text-right type-mono-data leading-[18px] text-text-primary">
              <Untranslated>{readout.hbinText}</Untranslated>
            </span>

            {readout.keyTests.map((kt) => (
              <React.Fragment key={kt.testNum}>
                <span className="truncate type-footnote leading-[18px] text-text-tertiary">
                  <Untranslated>{kt.label}</Untranslated>
                </span>
                <span
                  className={cn(
                    'truncate text-right type-mono-data leading-[18px]',
                    kt.outOfLimits ? 'text-failure-text' : 'text-text-primary',
                  )}
                >
                  <Untranslated>{kt.valueText}</Untranslated>
                  {kt.outOfLimits ? (
                    <span className="ml-1 font-sans text-[11px] text-failure-text">
                      {t('magnifier.outOfLimits')}
                    </span>
                  ) : null}
                </span>
              </React.Fragment>
            ))}

            {readout.retestCount > 0 ? (
              <>
                <span className="type-footnote leading-[18px] text-text-tertiary">
                  {t('magnifier.retested')}
                </span>
                <span className="truncate text-right type-mono-data leading-[18px] text-text-primary">
                  {t('magnifier.retestedValue', {
                    count: formatInteger(readout.retestCount + 1),
                  })}
                </span>
              </>
            ) : null}

            <span className="type-footnote leading-[18px] text-text-tertiary">
              {t('magnifier.notch')}
            </span>
            <span className="truncate text-right type-mono-data leading-[18px] text-text-tertiary">
              {t('magnifier.notchValue', {
                clock: formatInteger(readout.notchClock),
              })}
            </span>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
});

export const HoverMagnifier = React.memo(HoverMagnifierImpl);
