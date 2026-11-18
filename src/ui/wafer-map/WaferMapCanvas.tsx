'use client';

import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { YieldMetrics } from '@/core/analytics';
import { type LotModel, packWaferCoord } from '@/core/model';
import { formatGroupedInt, formatYieldPct } from '@/ui/format';
import { Badge } from '@/ui/primitives';
import {
  EMPTY_HIDDEN_BINS,
  type SelectionStoreState,
  useSelectionStore,
} from '@/ui/state';
import { BaseCanvas } from './BaseCanvas';
import { OverlayCanvas } from './OverlayCanvas';
import { WaferSelector } from './WaferSelector';
import {
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  hitTestWaferDie,
} from './wafer-geometry';

export interface WaferMapCanvasProps {
  readonly lot: LotModel;
  readonly byWaferYield: readonly YieldMetrics[];
  readonly store?: StoreApi<SelectionStoreState>;
}

const DEFAULT_STAGE_SIZE_PX = 520;
const MIN_STAGE_SIZE_PX = 240;
const MAX_STAGE_SIZE_PX = 560;

interface StageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Subscribes to `window.devicePixelRatio` changes (e.g. dragging the window between
 * Retina and standard displays) while initializing at `1` for SSR hydration parity.
 */
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

interface WaferDieReadoutProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly store: StoreApi<SelectionStoreState>;
}

/**
 * Dedicated micro-subscriber for the hovered die telemetry bar so pointer scrubbing
 * updates only `OverlayCanvas` and this 1-line readout without re-rendering `BaseCanvas`.
 */
const WaferDieReadout = React.memo(function WaferDieReadout({
  lot,
  waferIndex,
  store,
}: WaferDieReadoutProps): React.JSX.Element {
  const { storeLot, hoveredDieIndex } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      hoveredDieIndex: s.hoveredDieIndex,
    })),
  );

  const wafer = lot.wafers[waferIndex];
  const validHover =
    storeLot === lot &&
    hoveredDieIndex !== null &&
    wafer !== undefined &&
    hoveredDieIndex >= wafer.dieStartIndex &&
    hoveredDieIndex < wafer.dieEndIndex
      ? hoveredDieIndex
      : null;

  if (validHover === null) {
    const flatCode = wafer?.geometry.wfFlat ?? 'D';
    const notchLabel =
      flatCode === 'U'
        ? 'Notch 12 o’clock'
        : flatCode === 'L'
          ? 'Notch 9 o’clock'
          : flatCode === 'R'
            ? 'Notch 3 o’clock'
            : 'Notch 6 o’clock';
    return (
      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-center font-mono text-[12px] text-text-tertiary tabular-nums"
      >
        {notchLabel} · POS_X {wafer?.geometry.posX ?? 'R'} · POS_Y{' '}
        {wafer?.geometry.posY ?? 'U'} · Hover or arrow-step dies to inspect
        site and bin
      </p>
    );
  }

  const { dies, sites, dieIds } = lot;
  const x = dies.x[validHover];
  const y = dies.y[validHover];
  const passed = dies.finalPass[validHover] !== 0;
  const sbin = dies.sbin[validHover];
  const hbin = dies.hbin[validHover];
  const retests = dies.retestCount[validHover];
  const site = sites[dies.siteIndex[validHover]];

  return (
    <p
      role="status"
      aria-live="polite"
      className="min-h-5 text-center font-mono text-[12px] text-text-secondary tabular-nums"
    >
      <span className="text-text-primary">{dieIds[validHover]}</span>
      {' · '}
      <span>
        ({x}, {y})
      </span>
      {site ? (
        <>
          {' · '}
          <span>
            Head {site.headNum} · Site {site.siteNum}
          </span>
        </>
      ) : null}
      {' · '}
      <span>SBIN {sbin === 65535 ? 'N/A' : sbin}</span>
      {' · '}
      <span>HBIN {hbin}</span>
      {retests > 0 ? (
        <>
          {' · '}
          <span>
            {retests} retest{retests === 1 ? '' : 's'}
          </span>
        </>
      ) : null}
      {' · '}
      <span className={passed ? 'text-text-primary' : 'text-failure'}>
        {passed ? 'PASS' : 'FAIL'}
      </span>
    </p>
  );
});

interface WaferHighlightBannerProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly store: StoreApi<SelectionStoreState>;
}

const WaferHighlightBanner = React.memo(function WaferHighlightBanner({
  lot,
  waferIndex,
  store,
}: WaferHighlightBannerProps): React.JSX.Element | null {
  const {
    storeLot,
    siteFilter,
    binFilter,
    claimHighlight,
    overlayHighlightMask,
    overlayHighlightCount,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      siteFilter: s.siteFilter,
      binFilter: s.binFilter,
      claimHighlight: s.claimHighlight,
      overlayHighlightMask: s.overlayHighlightMask,
      overlayHighlightCount: s.overlayHighlightCount,
    })),
  );

  const wafer = lot.wafers[waferIndex];
  const countOnWafer = React.useMemo(() => {
    if (
      storeLot !== lot ||
      overlayHighlightCount === 0 ||
      !wafer ||
      overlayHighlightMask.length < wafer.dieEndIndex
    ) {
      return 0;
    }
    let count = 0;
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (overlayHighlightMask[i] !== 0 && lot.dies.hasValidCoords[i] !== 0) {
        count += 1;
      }
    }
    return count;
  }, [
    storeLot,
    lot,
    overlayHighlightCount,
    wafer,
    overlayHighlightMask,
  ]);

  if (storeLot !== lot || overlayHighlightCount === 0) {
    return null;
  }

  let scopeLabel = 'Active selection';
  if (siteFilter !== null && lot.sites[siteFilter]) {
    const s = lot.sites[siteFilter];
    scopeLabel = `Head ${s.headNum} · Site ${s.siteNum}`;
  } else if (binFilter !== null) {
    scopeLabel = `${binFilter.mode} ${binFilter.code}`;
  } else if (claimHighlight !== null) {
    scopeLabel = 'Claim evidence';
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex flex-wrap items-center gap-2 rounded-control border border-accent/45 bg-accent/10 px-2.5 py-1 font-mono text-[12px] text-text-primary tabular-nums"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-xs border border-accent bg-transparent"
      />
      <span>
        {scopeLabel} · {formatGroupedInt(countOnWafer)} dies on{' '}
        {wafer?.waferId ?? 'wafer'} ({formatGroupedInt(overlayHighlightCount)}{' '}
        in lot)
      </span>
      <button
        type="button"
        onClick={() => store.getState().clearFilters()}
        aria-label="Clear active wafer highlight"
        className="ml-1 cursor-pointer rounded-xs px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Clear
      </button>
    </div>
  );
});

/**
 * Hero two-layer Canvas2D wafer map stage with tightened vertical framing,
 * Pass/Fail non-color legend, O(1) hover readout, keyboard die stepping, and
 * 25-wafer horizontal thumbnail lot strip.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 14.2, 14.3, 14.4, 15.4
 */
export function WaferMapCanvas({
  lot,
  byWaferYield,
  store = useSelectionStore,
}: WaferMapCanvasProps): React.JSX.Element {
  const stageContainerRef = React.useRef<HTMLDivElement>(null);
  const [stageDims, setStageDims] = React.useState<StageDimensions>({
    width: DEFAULT_STAGE_SIZE_PX,
    height: DEFAULT_STAGE_SIZE_PX,
  });
  const dpr = useDevicePixelRatio();

  const {
    storeLot,
    rawWaferIndex,
    rawColorMode,
    rawActiveTestNum,
    rawHiddenBins,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      rawWaferIndex: s.activeWaferIndex,
      rawColorMode: s.colorMode,
      rawActiveTestNum: s.activeTestNum,
      rawHiddenBins: s.hiddenBins,
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
  const colorMode = isSynced ? rawColorMode : 'pass-fail';
  const activeTestNum = isSynced ? rawActiveTestNum : null;
  const hiddenBins = isSynced ? rawHiddenBins : EMPTY_HIDDEN_BINS;

  const handleSelectWafer = React.useCallback(
    (waferIndex: number): void => {
      store.getState().setActiveWaferIndex(waferIndex);
    },
    [store],
  );

  React.useEffect(() => {
    const el = stageContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const clampDim = (raw: number): number =>
      Math.max(MIN_STAGE_SIZE_PX, Math.min(MAX_STAGE_SIZE_PX, Math.round(raw)));

    const updateDims = (rawWidth: number, rawHeight: number): void => {
      const nextWidth = clampDim(rawWidth);
      const nextHeight = clampDim(rawHeight > 0 ? rawHeight : rawWidth);
      setStageDims((prev) =>
        prev.width !== nextWidth || prev.height !== nextHeight
          ? { width: nextWidth, height: nextHeight }
          : prev,
      );
    };
    const rect = el.getBoundingClientRect();
    updateDims(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        updateDims(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const wafer = lot.wafers[safeWaferIndex];
  const waferYield = byWaferYield[safeWaferIndex];

  const layout = React.useMemo(
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

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!layout) {
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const hitIndex = hitTestWaferDie(
        pointerX,
        pointerY,
        layout,
        lot.waferCoordIndex[safeWaferIndex],
      );
      store.getState().setHoveredDieIndex(hitIndex);
    },
    [layout, lot.waferCoordIndex, safeWaferIndex, store],
  );

  const handlePointerLeave = React.useCallback((): void => {
    store.getState().setHoveredDieIndex(null);
  }, [store]);

  const handleStageKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        const state = store.getState();
        if (state.hasActiveFilter || state.claimHighlight !== null) {
          event.preventDefault();
          state.clearFilters();
        }
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

      if (
        currentIdx === null ||
        currentIdx < wafer.dieStartIndex ||
        currentIdx >= wafer.dieEndIndex ||
        lot.dies.hasValidCoords[currentIdx] === 0
      ) {
        // Focus closest die to grid center
        const cx = Math.round((wafer.minX + wafer.maxX) / 2);
        const cy = Math.round((wafer.minY + wafer.maxY) / 2);
        const centerHit = coordMap.get(packWaferCoord(cx, cy));
        if (centerHit !== undefined) {
          state.setHoveredDieIndex(centerHit);
          return;
        }
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (lot.dies.hasValidCoords[i] !== 0) {
            state.setHoveredDieIndex(i);
            return;
          }
        }
        return;
      }

      const curX = lot.dies.x[currentIdx];
      const curY = lot.dies.y[currentIdx];
      for (let dist = 1; dist <= 6; dist += 1) {
        const nextHit = coordMap.get(
          packWaferCoord(curX + stepX * dist, curY + stepY * dist),
        );
        if (nextHit !== undefined) {
          state.setHoveredDieIndex(nextHit);
          return;
        }
      }
    },
    [lot.dies, lot.waferCoordIndex, safeWaferIndex, store, wafer],
  );

  return (
    <section
      aria-label="Wafer Map Visual Centerpiece"
      className="flex flex-col items-center gap-2.5"
    >
      {/* Top wafer metadata & Pass/Fail non-color legend */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-[20px] leading-snug text-text-primary">
            Wafer {wafer?.waferId ?? 'W01'}
          </h3>
          <span className="font-mono text-[13px] text-text-secondary tabular-nums">
            Final Yield {formatYieldPct(waferYield?.finalYield ?? null)}
          </span>
          <Badge variant="neutral">Pass / Fail</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <WaferHighlightBanner
            lot={lot}
            waferIndex={safeWaferIndex}
            store={store}
          />

          <div
            aria-label="Wafer Pass/Fail Legend"
            className="flex items-center gap-3 rounded-control border border-hairline bg-raised px-3 py-1.5 font-mono text-[12px] tabular-nums"
          >
            <span className="inline-flex items-center gap-1.5 text-text-secondary">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 border border-bg bg-pass-die"
              />
              Pass {formatGroupedInt(waferYield?.finalPassDies ?? 0)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-text-primary">
              <span
                aria-hidden="true"
                className="relative inline-flex h-2.5 w-2.5 items-center justify-center border border-bg bg-failure"
              >
                <span className="h-1 w-1 bg-bg" />
              </span>
              Fail {formatGroupedInt(waferYield?.finalFailDies ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Hero Wafer Stage — sized so wafer + 25-wafer lot strip sit above the fold at 1440x900 */}
      <div className="flex w-full justify-center">
        <div
          ref={stageContainerRef}
          role="group"
          aria-roledescription="interactive wafer map"
          tabIndex={0}
          aria-label={`Interactive wafer map for Wafer ${wafer?.waferId ?? 'W01'}, ${formatGroupedInt(waferYield?.testedDies ?? 0)} tested dies, ${formatGroupedInt(waferYield?.finalFailDies ?? 0)} failing dies`}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleStageKeyDown}
          className="relative aspect-square w-full max-w-[520px] overflow-hidden rounded-panel focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent xl:max-w-[460px]"
        >
          <BaseCanvas
            lot={lot}
            waferIndex={safeWaferIndex}
            colorMode={colorMode}
            activeTestNum={activeTestNum}
            hiddenBins={hiddenBins}
            cssWidth={stageDims.width}
            cssHeight={stageDims.height}
            transform={DEFAULT_VIEWPORT_TRANSFORM}
            dpr={dpr}
            layout={layout}
          />
          <OverlayCanvas
            lot={lot}
            waferIndex={safeWaferIndex}
            cssWidth={stageDims.width}
            cssHeight={stageDims.height}
            transform={DEFAULT_VIEWPORT_TRANSFORM}
            dpr={dpr}
            layout={layout}
            store={store}
          />
        </div>
      </div>

      {/* Screen-reader tabular summary of wafer pass/fail counts (Req 14.4) */}
      <div className="sr-only">
        Wafer {wafer?.waferId ?? 'W01'} summary:{' '}
        {formatGroupedInt(waferYield?.testedDies ?? 0)} tested dies,{' '}
        {formatGroupedInt(waferYield?.finalPassDies ?? 0)} passing dies,{' '}
        {formatGroupedInt(waferYield?.finalFailDies ?? 0)} failing dies, final
        yield {formatYieldPct(waferYield?.finalYield ?? null)}.
      </div>

      {/* Non-occluding hover/keyboard coordinate readout */}
      <WaferDieReadout
        lot={lot}
        waferIndex={safeWaferIndex}
        store={store}
      />

      {/* 25-wafer horizontal thumbnail lot strip */}
      <WaferSelector
        wafers={lot.wafers}
        dies={lot.dies}
        byWaferYield={byWaferYield}
        activeWaferIndex={safeWaferIndex}
        dpr={dpr}
        onSelectWafer={handleSelectWafer}
      />
    </section>
  );
}
