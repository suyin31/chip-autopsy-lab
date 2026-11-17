'use client';

import * as React from 'react';
import type { YieldMetrics } from '@/core/analytics';
import { type LotModel, packWaferCoord } from '@/core/model';
import { formatGroupedInt, formatYieldPct } from '@/ui/format';
import { Badge } from '@/ui/primitives';
import { useSelectionStore } from '@/ui/state';
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
}

const DEFAULT_STAGE_SIZE_PX = 500;

interface WaferDieReadoutProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
}

/**
 * Dedicated micro-subscriber for the hovered die telemetry bar so pointer scrubbing
 * updates only `OverlayCanvas` and this 1-line readout without re-rendering `BaseCanvas`.
 */
const WaferDieReadout = React.memo(function WaferDieReadout({
  lot,
  waferIndex,
}: WaferDieReadoutProps): React.JSX.Element {
  const storeLot = useSelectionStore((s) => s.lot);
  const hoveredDieIndex = useSelectionStore((s) => s.hoveredDieIndex);

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
        ? 'Notch Up'
        : flatCode === 'L'
          ? 'Notch Left'
          : flatCode === 'R'
            ? 'Notch Right'
            : 'Notch Down';
    return (
      <p className="min-h-5 text-center font-mono text-[12px] text-text-tertiary tabular-nums">
        {notchLabel} · POS_X {wafer?.geometry.posX ?? 'R'} · POS_Y{' '}
        {wafer?.geometry.posY ?? 'U'} · Hover or arrow-step dies to inspect
        coordinates, site, and bin
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
    <p className="min-h-5 text-center font-mono text-[12px] text-text-secondary tabular-nums">
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
}

const WaferHighlightBanner = React.memo(function WaferHighlightBanner({
  lot,
  waferIndex,
}: WaferHighlightBannerProps): React.JSX.Element | null {
  const storeLot = useSelectionStore((s) => s.lot);
  const siteFilter = useSelectionStore((s) => s.siteFilter);
  const binFilter = useSelectionStore((s) => s.binFilter);
  const claimHighlight = useSelectionStore((s) => s.claimHighlight);
  const overlayHighlightMask = useSelectionStore((s) => s.overlayHighlightMask);
  const overlayHighlightCount = useSelectionStore(
    (s) => s.overlayHighlightCount,
  );
  const clearFilters = useSelectionStore((s) => s.clearFilters);

  if (storeLot !== lot || overlayHighlightCount === 0) {
    return null;
  }

  const wafer = lot.wafers[waferIndex];
  let countOnWafer = 0;
  if (wafer && overlayHighlightMask.length >= wafer.dieEndIndex) {
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (overlayHighlightMask[i] !== 0 && lot.dies.hasValidCoords[i] !== 0) {
        countOnWafer += 1;
      }
    }
  }

  let scopeLabel = 'Active selection';
  if (siteFilter !== null && lot.sites[siteFilter]) {
    const s = lot.sites[siteFilter];
    scopeLabel = `Head ${s.headNum} · Site ${s.siteNum}`;
  } else if (binFilter !== null) {
    scopeLabel = `${binFilter.mode} ${binFilter.code}`;
  } else if (claimHighlight !== null) {
    scopeLabel = `Claim evidence`;
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
        onClick={clearFilters}
        aria-label="Clear active wafer highlight"
        className="ml-1 cursor-pointer rounded-xs px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Clear
      </button>
    </div>
  );
});

/**
 * Hero two-layer Canvas2D wafer map stage with generous Apple-like whitespace,
 * Pass/Fail non-color legend, O(1) hover readout, keyboard die stepping, and
 * 25-wafer keyboard-accessible selector.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 14.2, 14.3, 14.4, 15.4
 */
export function WaferMapCanvas({
  lot,
  byWaferYield,
}: WaferMapCanvasProps): React.JSX.Element {
  const stageContainerRef = React.useRef<HTMLDivElement>(null);
  const [stageSizePx, setStageSizePx] = React.useState<number>(
    DEFAULT_STAGE_SIZE_PX,
  );

  const storeLot = useSelectionStore((s) => s.lot);
  const rawWaferIndex = useSelectionStore((s) => s.activeWaferIndex);
  const rawColorMode = useSelectionStore((s) => s.colorMode);
  const rawActiveTestNum = useSelectionStore((s) => s.activeTestNum);
  const rawHiddenBins = useSelectionStore((s) => s.hiddenBins);
  const setActiveWaferIndex = useSelectionStore((s) => s.setActiveWaferIndex);

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
  const hiddenBins = isSynced ? rawHiddenBins : new Set<number>();

  React.useEffect(() => {
    const el = stageContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const updateSize = (width: number): void => {
      const next = Math.max(240, Math.min(600, Math.round(width)));
      setStageSizePx((prev) => (prev !== next ? next : prev));
    };
    updateSize(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        updateSize(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const wafer = lot.wafers[safeWaferIndex];
  const waferYield = byWaferYield[safeWaferIndex];

  const layoutRef = React.useRef(
    wafer
      ? computeWaferRenderLayout(
          wafer,
          stageSizePx,
          stageSizePx,
          lot.dies,
          DEFAULT_VIEWPORT_TRANSFORM,
        )
      : null,
  );

  React.useEffect(() => {
    layoutRef.current = wafer
      ? computeWaferRenderLayout(
          wafer,
          stageSizePx,
          stageSizePx,
          lot.dies,
          DEFAULT_VIEWPORT_TRANSFORM,
        )
      : null;
  }, [wafer, stageSizePx, lot.dies]);

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const currentLayout = layoutRef.current;
      if (!currentLayout) {
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const hitIndex = hitTestWaferDie(
        pointerX,
        pointerY,
        currentLayout,
        lot.waferCoordIndex[safeWaferIndex],
      );
      useSelectionStore.getState().setHoveredDieIndex(hitIndex);
    },
    [lot.waferCoordIndex, safeWaferIndex],
  );

  const handlePointerLeave = React.useCallback((): void => {
    useSelectionStore.getState().setHoveredDieIndex(null);
  }, []);

  const handleStageKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        const state = useSelectionStore.getState();
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
      const state = useSelectionStore.getState();
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
    [lot.dies, lot.waferCoordIndex, safeWaferIndex, wafer],
  );

  return (
    <section
      aria-label="Wafer Map Visual Centerpiece"
      className="flex flex-col items-center gap-6 py-4 sm:py-6"
    >
      {/* Top wafer metadata & Pass/Fail non-color legend */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-[20px] leading-snug text-text-primary">
            Wafer {wafer?.waferId ?? 'W01'}
          </h3>
          <span className="font-mono text-[13px] text-text-secondary tabular-nums">
            Final Yield {formatYieldPct(waferYield?.finalYield ?? null)}
          </span>
          <Badge variant="neutral">Pass / Fail</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <WaferHighlightBanner lot={lot} waferIndex={safeWaferIndex} />

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

      {/* Hero Wafer Stage — large, centered, generous dark whitespace */}
      <div className="flex w-full justify-center py-2 sm:py-4">
        <div
          ref={stageContainerRef}
          role="group"
          tabIndex={0}
          aria-label={`Interactive wafer map for Wafer ${wafer?.waferId ?? 'W01'}, ${formatGroupedInt(waferYield?.testedDies ?? 0)} tested dies, ${formatGroupedInt(waferYield?.finalFailDies ?? 0)} failing dies`}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleStageKeyDown}
          className="relative aspect-square w-full max-w-[500px] rounded-panel focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <BaseCanvas
            lot={lot}
            waferIndex={safeWaferIndex}
            colorMode={colorMode}
            activeTestNum={activeTestNum}
            hiddenBins={hiddenBins}
            cssWidth={stageSizePx}
            cssHeight={stageSizePx}
            transform={DEFAULT_VIEWPORT_TRANSFORM}
          />
          <OverlayCanvas
            lot={lot}
            waferIndex={safeWaferIndex}
            cssWidth={stageSizePx}
            cssHeight={stageSizePx}
            transform={DEFAULT_VIEWPORT_TRANSFORM}
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
      <WaferDieReadout lot={lot} waferIndex={safeWaferIndex} />

      {/* 25-wafer keyboard-operable selector */}
      <WaferSelector
        wafers={lot.wafers}
        byWaferYield={byWaferYield}
        activeWaferIndex={safeWaferIndex}
        onSelectWafer={setActiveWaferIndex}
      />
    </section>
  );
}
