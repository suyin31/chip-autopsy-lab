'use client';

import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react';
import * as React from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  computeStackedHeatmap,
  computeStackedHeatmapSummary,
  type StackedCellStat,
  type YieldMetrics,
} from '@/core/analytics';
import { type LotModel, packWaferCoord } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import {
  Button,
  MATERIAL_THICK_CLASS,
  SegmentedControl,
  type SegmentedControlOption,
} from '@/ui/primitives';
import { cn } from '@/ui/primitives/cn';
import {
  type SelectionStoreState,
  type SpatialBrushRect,
  useSelectionStore,
} from '@/ui/state';
import { WAFER_TOKENS } from '@/ui/tokens';
import { formatBrushCoordinateRange } from './ActiveFilterChips';
import { formatDieCoordinate } from './linked-interactions';
import { readPrefersReducedMotionSync } from './probe-sweep';
import { computeStageDiscLayerRects } from './stage-layers';
import {
  computeGalleryCollapseOffset,
  computeStackedRenderLayout,
  countDiesInStackedBrush,
  GALLERY_COLLAPSE_DURATION_S,
  GALLERY_REDUCED_FADE_DURATION_S,
  hitTestStackedCell,
  paintMagmaLegendCanvas,
  paintStackedHeatmapBase,
  paintStackedHeatmapOverlay,
  resolveStackedCellColor,
  type ScreenSelectionRect,
  screenRectToStackedBrush,
  STACKED_LEGEND_HEIGHT_PX,
  STACKED_LEGEND_WIDTH_PX,
} from './stacked-heatmap-view';
import { usePrefersMoreContrast } from './use-prefers-more-contrast';
import {
  dieCoordToCanvasRect,
  paintWaferThumbnail,
  resolveCanvasPixelSize,
} from './wafer-geometry';

export type StackedPanelViewMode = 'gallery' | 'stacked';

export interface StackedWaferPanelProps {
  readonly lot: LotModel;
  readonly byWaferYield: readonly YieldMetrics[];
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  /** Initial view mode (defaults to `'gallery'` so all wafers can collapse into the stacked heatmap). */
  readonly initialViewMode?: StackedPanelViewMode;
  readonly className?: string;
}

const GALLERY_THUMB_CSS_PX = 52;
const DEFAULT_STACKED_STAGE_PX = 320;
const DRAG_THRESHOLD_PX = 6;
const READOUT_WIDTH_PX = 216;
const READOUT_HEIGHT_EST_PX = 94;

interface ActiveDragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

function stampAck(event: React.PointerEvent<HTMLElement>): void {
  if (typeof performance !== 'undefined') {
    event.currentTarget.dataset.ack = String(performance.now());
  }
}

/**
 * "Across all wafers" — Multi-wafer gallery and stacked failure-density heatmap
 * (`src/ui/wafer-map/StackedWaferPanel.tsx`, Task 12, Requirements 5.1–5.5 & 14.5).
 *
 * - Shown for multi-wafer lots (`lot.wafers.length >= 2`) as a `surface` section card
 *   (`r-2xl`, `shadow-card`) matching `BinParetoChart` and `YieldSummaryPanel`.
 * - Gallery view renders all wafers of the lot with silicon disc thumbnails, wafer IDs, and
 *   1-decimal final yields; clicking a wafer activates it on the main stage.
 * - Switching to Stacked collapses the gallery into the stacked magma heatmap (`<= 800 ms`,
 *   Motion layout + inward disc convergence, bounce 0); under `prefers-reduced-motion: reduce`,
 *   becomes an instant opacity cross-fade.
 * - Stacked heatmap draws `magma` on `t ∈ [0.18, 1.0]` over the silicon disc material with a
 *   `160 x 6 px` numeric legend, hover/keyboard cell readout (`(X, Y)`, fail/tested wafers,
 *   1-decimal rate, dominant SBIN/HBIN), and click/drag region brushing into `SelectionStore`.
 */
export function StackedWaferPanel({
  lot,
  byWaferYield,
  store = useSelectionStore,
  initialViewMode = 'gallery',
  className,
}: StackedWaferPanelProps): React.JSX.Element | null {
  const { t, tPlural, formatInteger, formatPercent } = useT();
  const headingId = React.useId();
  const layoutGroupId = React.useId();
  const shouldReduceMotion = useReducedMotion();
  const reduced = readPrefersReducedMotionSync(shouldReduceMotion);
  const highContrast = usePrefersMoreContrast();

  const { storeLot, activeWaferIndex, brush } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      activeWaferIndex: s.activeWaferIndex,
      brush: s.brush,
    })),
  );
  const synced = storeLot === lot;
  const safeActiveWafer = synced
    ? Math.min(Math.max(0, activeWaferIndex), Math.max(0, lot.wafers.length - 1))
    : 0;
  const activeBrush = synced ? brush : null;

  const [viewMode, setViewMode] =
    React.useState<StackedPanelViewMode>(initialViewMode);
  const [transitionState, setTransitionState] = React.useState<
    'idle' | 'animating'
  >('idle');
  const [hoveredCell, setHoveredCell] = React.useState<StackedCellStat | null>(
    null,
  );
  const [stageCssSize, setStageCssSize] = React.useState<number>(
    DEFAULT_STACKED_STAGE_PX,
  );

  // Reset hover and transient state when a new lot loads
  const prevLotRef = React.useRef(lot);
  if (prevLotRef.current !== lot) {
    prevLotRef.current = lot;
    if (hoveredCell !== null) {
      setHoveredCell(null);
    }
  }

  const cells = React.useMemo(() => computeStackedHeatmap(lot), [lot]);
  const summary = React.useMemo(
    () => computeStackedHeatmapSummary(cells, lot.wafers.length),
    [cells, lot.wafers.length],
  );

  const referenceGeometry = lot.wafers[0]?.geometry ?? {
    wfFlat: 'D' as const,
    posX: 'R' as const,
    posY: 'U' as const,
  };

  const dpr =
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const stackedLayout = React.useMemo(
    () =>
      computeStackedRenderLayout(
        cells,
        summary,
        referenceGeometry,
        stageCssSize,
        stageCssSize,
        dpr,
      ),
    [cells, summary, referenceGeometry, stageCssSize, dpr],
  );

  // Gallery thumbnail canvas refs
  const galleryCanvasRefs = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const galleryCtxRefs = React.useRef<Array<CanvasRenderingContext2D | null>>([]);

  // Stacked heatmap canvas & container refs
  const stageContainerRef = React.useRef<HTMLDivElement>(null);
  const baseCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const legendCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const dragRef = React.useRef<ActiveDragState | null>(null);
  const liveDragRectRef = React.useRef<ScreenSelectionRect | null>(null);
  const hoveredCellRef = React.useRef<StackedCellStat | null>(null);
  hoveredCellRef.current = hoveredCell;

  // Measure stacked stage container cleanly via ResizeObserver
  React.useEffect(() => {
    if (viewMode !== 'stacked') {
      return;
    }
    const el = stageContainerRef.current;
    if (!el) {
      return;
    }
    const updateSize = (): void => {
      const next = Math.max(200, Math.min(340, Math.round(el.clientWidth)));
      if (next > 0) {
        setStageCssSize((prev) => (Math.abs(prev - next) >= 1 ? next : prev));
      }
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode]);

  // Paint all gallery wafer thumbnails when in gallery view
  React.useEffect(() => {
    if (viewMode !== 'gallery' || lot.wafers.length < 2) {
      return;
    }
    const dims = resolveCanvasPixelSize(
      GALLERY_THUMB_CSS_PX,
      GALLERY_THUMB_CSS_PX,
      dpr,
    );
    const total = lot.wafers.length;

    const paintRange = (start: number, end: number): void => {
      for (let i = start; i < end && i < total; i += 1) {
        const canvas = galleryCanvasRefs.current[i];
        const wafer = lot.wafers[i];
        if (!canvas || !wafer) continue;
        let ctx = galleryCtxRefs.current[i] ?? null;
        if (!ctx || ctx.canvas !== canvas) {
          ctx = canvas.getContext('2d');
          galleryCtxRefs.current[i] = ctx;
        }
        if (!ctx) continue;
        if (canvas.width !== dims.pixelWidth) canvas.width = dims.pixelWidth;
        if (canvas.height !== dims.pixelHeight) canvas.height = dims.pixelHeight;
        paintWaferThumbnail(ctx, {
          wafer,
          dies: lot.dies,
          cssSize: dims.cssWidth,
          dpr: dims.dpr,
          highContrast,
        });
      }
    };

    // Paint all demo wafers (up to 30) synchronously; batch larger lots across frames
    const immediateEnd = Math.min(total, 30);
    paintRange(0, immediateEnd);
    if (immediateEnd >= total) {
      return;
    }

    let cursor = immediateEnd;
    let cancelled = false;
    let rafId: number | null = null;
    const step = (): void => {
      if (cancelled) return;
      paintRange(cursor, cursor + 10);
      cursor += 10;
      if (cursor < total && typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(step);
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(step);
    } else {
      paintRange(cursor, total);
    }
    return () => {
      cancelled = true;
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
    };
  }, [viewMode, lot, dpr, highContrast]);

  // Paint stacked heatmap base layer & magma legend canvas (never repainted on hover or drag)
  React.useEffect(() => {
    if (viewMode !== 'stacked' || lot.wafers.length < 2) {
      return;
    }
    const baseCanvas = baseCanvasRef.current;
    if (baseCanvas) {
      const dims = resolveCanvasPixelSize(stageCssSize, stageCssSize, dpr);
      if (baseCanvas.width !== dims.pixelWidth) baseCanvas.width = dims.pixelWidth;
      if (baseCanvas.height !== dims.pixelHeight) {
        baseCanvas.height = dims.pixelHeight;
      }
      const ctx = baseCanvas.getContext('2d');
      if (ctx) {
        paintStackedHeatmapBase(ctx, {
          cells,
          summary,
          geometry: referenceGeometry,
          layout: stackedLayout,
          dpr: dims.dpr,
          deviceDpr: dpr,
          highContrast,
        });
      }
    }

    const legendCanvas = legendCanvasRef.current;
    if (legendCanvas) {
      const dims = resolveCanvasPixelSize(
        STACKED_LEGEND_WIDTH_PX,
        STACKED_LEGEND_HEIGHT_PX,
        dpr,
      );
      if (legendCanvas.width !== dims.pixelWidth) {
        legendCanvas.width = dims.pixelWidth;
      }
      if (legendCanvas.height !== dims.pixelHeight) {
        legendCanvas.height = dims.pixelHeight;
      }
      const ctx = legendCanvas.getContext('2d');
      if (ctx) {
        paintMagmaLegendCanvas(ctx, dims.cssWidth, dims.cssHeight, dims.dpr);
      }
    }
  }, [
    viewMode,
    lot.wafers.length,
    stageCssSize,
    dpr,
    cells,
    summary,
    referenceGeometry,
    stackedLayout,
    highContrast,
  ]);

  const paintOverlayNow = React.useCallback(
    (
      nextHover: StackedCellStat | null,
      nextBrush: SpatialBrushRect | null,
      nextDragRect: ScreenSelectionRect | null,
    ): void => {
      const overlayCanvas = overlayCanvasRef.current;
      if (!overlayCanvas) return;
      const dims = resolveCanvasPixelSize(stageCssSize, stageCssSize, dpr);
      if (overlayCanvas.width !== dims.pixelWidth) {
        overlayCanvas.width = dims.pixelWidth;
      }
      if (overlayCanvas.height !== dims.pixelHeight) {
        overlayCanvas.height = dims.pixelHeight;
      }
      const ctx = overlayCanvas.getContext('2d');
      if (!ctx) return;
      paintStackedHeatmapOverlay(ctx, {
        layout: stackedLayout,
        dpr: dims.dpr,
        hoveredCell: nextHover,
        brush: nextBrush,
        liveDragRect: nextDragRect,
      });
    },
    [stageCssSize, dpr, stackedLayout],
  );

  // Repaint overlay whenever hoveredCell, committed brush, or layout changes
  React.useEffect(() => {
    if (viewMode !== 'stacked' || lot.wafers.length < 2) {
      return;
    }
    paintOverlayNow(hoveredCell, activeBrush, liveDragRectRef.current);
  }, [viewMode, lot.wafers.length, hoveredCell, activeBrush, paintOverlayNow]);

  const handleViewModeChange = React.useCallback(
    (nextMode: StackedPanelViewMode): void => {
      if (nextMode === viewMode) return;
      setHoveredCell(null);
      liveDragRectRef.current = null;
      dragRef.current = null;
      setTransitionState('animating');
      setViewMode(nextMode);
    },
    [viewMode],
  );

  // Safety fallback so data-transition-state always returns to idle
  React.useEffect(() => {
    if (transitionState !== 'animating') return;
    const ms = Math.round(
      (reduced ? GALLERY_REDUCED_FADE_DURATION_S : GALLERY_COLLAPSE_DURATION_S) *
        1000 +
        60,
    );
    const timer = setTimeout(() => setTransitionState('idle'), ms);
    return () => clearTimeout(timer);
  }, [transitionState, reduced]);

  // Require >= 2 wafers per Requirement 5.1
  if (lot.wafers.length < 2) {
    return null;
  }

  const viewOptions: readonly SegmentedControlOption<StackedPanelViewMode>[] = [
    { value: 'gallery', label: t('stacked.mode.gallery') },
    { value: 'stacked', label: t('stacked.mode.stacked') },
  ];

  const scaleMax = summary.maxFailRate > 0 ? summary.maxFailRate : 1;
  const peak = summary.peakCell;
  const takeawayText =
    peak !== null
      ? t('stacked.takeaway.peak', {
          failed: formatInteger(peak.failCount),
          tested: formatInteger(peak.testedWaferCount),
          rate: formatPercent(peak.failRate),
        })
      : t('stacked.takeaway.clean', {
          wafers: formatInteger(lot.wafers.length),
        });

  const activeStackedBrush =
    activeBrush !== null && activeBrush.scope === 'stacked' ? activeBrush : null;
  const selectedStackedDieCount =
    activeStackedBrush !== null
      ? countDiesInStackedBrush(lot, activeStackedBrush)
      : 0;

  const getLocalCoords = (
    event: React.PointerEvent<HTMLDivElement>,
  ): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handleStagePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) return;
    stampAck(event);
    const pt = getLocalCoords(event);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: pt.x,
      startY: pt.y,
      currentX: pt.x,
      currentY: pt.y,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignore synthetic pointer events without an active pointer ID
    }
  };

  const handleStagePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const pt = getLocalCoords(event);
    const drag = dragRef.current;

    if (drag !== null && drag.pointerId === event.pointerId) {
      drag.currentX = pt.x;
      drag.currentY = pt.y;
      if (
        !drag.moved &&
        Math.hypot(pt.x - drag.startX, pt.y - drag.startY) >= DRAG_THRESHOLD_PX
      ) {
        drag.moved = true;
      }
      if (drag.moved) {
        const nextRect: ScreenSelectionRect = {
          left: drag.startX,
          top: drag.startY,
          right: pt.x,
          bottom: pt.y,
        };
        liveDragRectRef.current = nextRect;
        paintOverlayNow(null, activeBrush, nextRect);
        return;
      }
    }

    const hit = hitTestStackedCell(
      pt.x,
      pt.y,
      stackedLayout,
      summary.cellByCoord,
    );
    const prev = hoveredCellRef.current;
    if (hit !== prev) {
      setHoveredCell(hit);
    }
  };

  const handleStagePointerUp = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if capture was not set
    }

    const pt = getLocalCoords(event);
    if (drag.moved) {
      const finalRect: ScreenSelectionRect = {
        left: drag.startX,
        top: drag.startY,
        right: pt.x,
        bottom: pt.y,
      };
      liveDragRectRef.current = null;
      const nextBrush = screenRectToStackedBrush(
        finalRect,
        stackedLayout,
        summary,
      );
      store.getState().setBrush(nextBrush);
      paintOverlayNow(hoveredCellRef.current, nextBrush, null);
      return;
    }

    // Single click: toggle single-cell stacked region selection, or clear on empty disc click
    liveDragRectRef.current = null;
    const hit = hitTestStackedCell(
      pt.x,
      pt.y,
      stackedLayout,
      summary.cellByCoord,
    );
    if (hit === null) {
      if (activeBrush !== null) {
        store.getState().setBrush(null);
      }
      return;
    }
    setHoveredCell(hit);
    const sameSingleCell =
      activeStackedBrush !== null &&
      activeStackedBrush.minX === hit.x &&
      activeStackedBrush.maxX === hit.x &&
      activeStackedBrush.minY === hit.y &&
      activeStackedBrush.maxY === hit.y;
    const nextBrush: SpatialBrushRect | null = sameSingleCell
      ? null
      : {
          scope: 'stacked',
          minX: hit.x,
          maxX: hit.x,
          minY: hit.y,
          maxY: hit.y,
        };
    store.getState().setBrush(nextBrush);
  };

  const handleStagePointerLeave = (): void => {
    if (dragRef.current !== null) return;
    if (hoveredCellRef.current !== null) {
      setHoveredCell(null);
    }
  };

  const handleStageKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === 'Escape') {
      if (activeBrush !== null) {
        event.preventDefault();
        store.getState().setBrush(null);
      }
      if (hoveredCellRef.current !== null) {
        setHoveredCell(null);
      }
      return;
    }

    if (cells.length === 0) return;

    if (event.key === 'Enter' || event.key === ' ') {
      const target = hoveredCellRef.current ?? summary.peakCell ?? cells[0]!;
      event.preventDefault();
      setHoveredCell(target);
      const sameSingleCell =
        activeStackedBrush !== null &&
        activeStackedBrush.minX === target.x &&
        activeStackedBrush.maxX === target.x &&
        activeStackedBrush.minY === target.y &&
        activeStackedBrush.maxY === target.y;
      store.getState().setBrush(
        sameSingleCell
          ? null
          : {
              scope: 'stacked',
              minX: target.x,
              maxX: target.x,
              minY: target.y,
              maxY: target.y,
            },
      );
      return;
    }

    let stepX = 0;
    let stepY = 0;
    if (event.key === 'ArrowRight') stepX = stackedLayout.dirX;
    else if (event.key === 'ArrowLeft') stepX = -stackedLayout.dirX;
    else if (event.key === 'ArrowDown') stepY = stackedLayout.dirY;
    else if (event.key === 'ArrowUp') stepY = -stackedLayout.dirY;
    else return;

    event.preventDefault();
    const cur = hoveredCellRef.current ?? summary.peakCell ?? cells[0]!;
    let nextCell: StackedCellStat | null = null;
    for (let dist = 1; dist <= 6; dist += 1) {
      const candidate = summary.cellByCoord.get(
        packWaferCoord(cur.x + stepX * dist, cur.y + stepY * dist),
      );
      if (candidate) {
        nextCell = candidate;
        break;
      }
    }
    setHoveredCell(nextCell ?? cur);
  };

  // Compute floating readout placement clamped inside the stage wrapper
  const readoutPlacement = (() => {
    if (hoveredCell === null) return null;
    const cellRect = dieCoordToCanvasRect(
      hoveredCell.x,
      hoveredCell.y,
      stackedLayout,
    );
    const pad = 10;
    let left = cellRect.centerX + 14;
    if (left + READOUT_WIDTH_PX > stageCssSize - 4) {
      left = cellRect.centerX - READOUT_WIDTH_PX - 14;
    }
    left = Math.max(4, Math.min(stageCssSize - READOUT_WIDTH_PX - 4, left));

    let top = cellRect.centerY - READOUT_HEIGHT_EST_PX - pad;
    if (top < 4) {
      top = cellRect.centerY + pad + 8;
    }
    top = Math.max(4, Math.min(stageCssSize - READOUT_HEIGHT_EST_PX - 4, top));

    return { left: Math.round(left), top: Math.round(top) };
  })();

  const discShadows = computeStageDiscLayerRects(
    stackedLayout.centerXCss,
    stackedLayout.centerYCss,
    stackedLayout.fitWaferRadiusPx,
  );
  const shadowBox = (key: 'ambient' | 'contact' | 'halo'): React.CSSProperties => {
    const r = discShadows[key];
    return {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    };
  };

  const hoveredSbinDef =
    hoveredCell !== null && hoveredCell.dominantSbin !== null
      ? lot.sbins.get(hoveredCell.dominantSbin)
      : undefined;
  const hoveredHbinDef =
    hoveredCell !== null && hoveredCell.dominantHbin !== null
      ? lot.hbins.get(hoveredCell.dominantHbin)
      : undefined;

  const collapseTransition = reduced
    ? { duration: GALLERY_REDUCED_FADE_DURATION_S }
    : {
        type: 'spring' as const,
        duration: GALLERY_COLLAPSE_DURATION_S,
        bounce: 0,
      };

  return (
    <section
      aria-labelledby={headingId}
      data-testid="stacked-wafer-panel"
      data-view-mode={viewMode}
      data-transition-state={transitionState}
      data-reduced-motion={reduced ? 'true' : 'false'}
      data-wafer-count={lot.wafers.length}
      className={cn(
        'rounded-2xl bg-surface p-4 shadow-card sm:p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className="type-title-2 text-text-primary">
          {t('stacked.title')}
        </h2>
        <SegmentedControl
          data-testid="stacked-view-segmented"
          ariaLabel={t('stacked.modeAria')}
          options={viewOptions}
          value={viewMode}
          onValueChange={handleViewModeChange}
        />
      </div>

      <p
        data-testid="stacked-takeaway"
        className="mt-2 type-body text-text-secondary tabular-nums"
      >
        {takeawayText}
      </p>

      <LayoutGroup id={layoutGroupId}>
        <div className="relative mt-5">
          <AnimatePresence
            mode="popLayout"
            initial={false}
            onExitComplete={() => setTransitionState('idle')}
          >
            {viewMode === 'gallery' ? (
              <motion.div
                key="gallery"
                data-testid="wafer-gallery"
                role="group"
                aria-label={t('stacked.galleryAria', {
                  count: formatInteger(lot.wafers.length),
                  lotId: lot.lotId,
                })}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={
                  reduced
                    ? { duration: GALLERY_REDUCED_FADE_DURATION_S }
                    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
                }
                onAnimationComplete={() => setTransitionState('idle')}
                className="grid grid-cols-4 gap-1.5 min-[420px]:grid-cols-5 sm:gap-2"
              >
                {lot.wafers.map((wafer, idx) => {
                  const isActive = idx === safeActiveWafer;
                  const yieldRatio = byWaferYield[idx]?.finalYield ?? 0;
                  const yieldLabel = formatPercent(yieldRatio);
                  const offset = computeGalleryCollapseOffset(
                    idx,
                    lot.wafers.length,
                    5,
                    84,
                    reduced,
                  );

                  return (
                    <motion.button
                      key={`${wafer.waferId}-${wafer.waferIndex}`}
                      type="button"
                      data-testid="wafer-gallery-item"
                      data-wafer-index={idx}
                      data-wafer-id={wafer.waferId}
                      aria-pressed={isActive}
                      aria-label={t('strip.itemAria', {
                        wafer: wafer.waferId,
                        yield: yieldLabel,
                      })}
                      exit={
                        reduced
                          ? { opacity: 0 }
                          : {
                              x: offset.x,
                              y: offset.y,
                              scale: 0.55,
                              opacity: 0,
                            }
                      }
                      transition={
                        reduced
                          ? { duration: GALLERY_REDUCED_FADE_DURATION_S }
                          : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }
                      }
                      onPointerDown={stampAck}
                      onClick={() => {
                        store.getState().setActiveWaferIndex(idx);
                      }}
                      className={cn(
                        'group flex cursor-pointer flex-col items-center rounded-md px-1 py-2 outline-none select-none',
                        'transition-[background-color,transform] duration-[var(--dur-1)] ease-[var(--ease-out)]',
                        'hover:bg-fill-1 motion-safe:active:scale-[0.985]',
                        'focus-visible:shadow-focus-ring',
                        isActive && 'bg-fill-1',
                      )}
                    >
                      <motion.span
                        layoutId={
                          !reduced && isActive
                            ? 'stacked-wafer-disc'
                            : undefined
                        }
                        transition={collapseTransition}
                        className={cn(
                          'relative block size-12 shrink-0 rounded-full sm:size-[52px]',
                          isActive &&
                            'shadow-[0_0_0_2px_var(--surface),0_0_0_3.5px_var(--ink)]',
                        )}
                      >
                        <canvas
                          ref={(el) => {
                            galleryCanvasRefs.current[idx] = el;
                          }}
                          data-testid="wafer-gallery-thumb"
                          aria-hidden="true"
                          width={GALLERY_THUMB_CSS_PX}
                          height={GALLERY_THUMB_CSS_PX}
                          className="pointer-events-none block size-full rounded-full select-none"
                        />
                      </motion.span>
                      <span className="mt-1.5 type-caption leading-none text-text-primary">
                        <Untranslated className="font-mono-id">
                          {wafer.waferId}
                        </Untranslated>
                      </span>
                      <span className="mt-0.5 type-caption leading-none text-text-tertiary tabular-nums">
                        {yieldLabel}
                      </span>
                    </motion.button>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div
                key="stacked"
                data-testid="stacked-heatmap-view"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.84 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                transition={collapseTransition}
                onAnimationComplete={() => setTransitionState('idle')}
                className="flex flex-col items-center"
              >
                {/* Stacked heatmap interactive disc stage */}
                <div
                  ref={stageContainerRef}
                  role="application"
                  tabIndex={0}
                  data-testid="stacked-heatmap-stage"
                  data-cell-count={summary.cellCount}
                  data-max-fail-rate={summary.maxFailRate.toFixed(4)}
                  data-peak-x={peak !== null ? String(peak.x) : ''}
                  data-peak-y={peak !== null ? String(peak.y) : ''}
                  aria-label={t('stacked.canvasAria', {
                    wafers: formatInteger(lot.wafers.length),
                  })}
                  style={{ touchAction: 'none' }}
                  onPointerDown={handleStagePointerDown}
                  onPointerMove={handleStagePointerMove}
                  onPointerUp={handleStagePointerUp}
                  onPointerCancel={handleStagePointerUp}
                  onPointerLeave={handleStagePointerLeave}
                  onKeyDown={handleStageKeyDown}
                  className={cn(
                    'relative mx-auto aspect-square w-full max-w-[340px] cursor-crosshair rounded-3xl outline-none select-none',
                    'focus-visible:shadow-focus-ring',
                  )}
                >
                  {/* Stage shadows behind the stacked silicon disc (§3.3) */}
                  <div
                    aria-hidden="true"
                    style={{
                      ...shadowBox('ambient'),
                      backgroundImage: WAFER_TOKENS.ambientShadow,
                    }}
                    className="pointer-events-none absolute dark:hidden"
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      ...shadowBox('contact'),
                      backgroundImage: WAFER_TOKENS.contactShadow,
                    }}
                    className="pointer-events-none absolute dark:hidden"
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      ...shadowBox('halo'),
                      backgroundImage: WAFER_TOKENS.halo,
                    }}
                    className="pointer-events-none absolute hidden dark:block"
                  />

                  <motion.div
                    layoutId={!reduced ? 'stacked-wafer-disc' : undefined}
                    transition={collapseTransition}
                    className="pointer-events-none absolute inset-0"
                  >
                    <canvas
                      ref={baseCanvasRef}
                      data-testid="stacked-heatmap-base-canvas"
                      aria-hidden="true"
                      style={{
                        width: `${stageCssSize}px`,
                        height: `${stageCssSize}px`,
                      }}
                      className="block size-full select-none"
                    />
                  </motion.div>

                  <canvas
                    ref={overlayCanvasRef}
                    data-testid="stacked-heatmap-overlay-canvas"
                    aria-hidden="true"
                    style={{
                      width: `${stageCssSize}px`,
                      height: `${stageCssSize}px`,
                    }}
                    className="pointer-events-none absolute inset-0 block size-full select-none"
                  />

                  {/* Floating hover / keyboard coordinate readout (Req 5.4, material-thick, zero orange) */}
                  {hoveredCell !== null && readoutPlacement !== null ? (
                    <div
                      data-testid="stacked-hover-readout"
                      data-coord-x={hoveredCell.x}
                      data-coord-y={hoveredCell.y}
                      role="status"
                      aria-live="polite"
                      style={{
                        transform: `translate3d(${readoutPlacement.left}px, ${readoutPlacement.top}px, 0)`,
                        width: `${READOUT_WIDTH_PX}px`,
                      }}
                      className={cn(
                        MATERIAL_THICK_CLASS,
                        'pointer-events-none absolute top-0 left-0 z-[var(--z-magnifier)] rounded-lg px-3 py-2.5',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          data-legend-swatch="true"
                          aria-hidden="true"
                          style={
                            hoveredCell.failCount > 0
                              ? {
                                  backgroundColor: resolveStackedCellColor(
                                    hoveredCell.failRate,
                                    scaleMax,
                                    highContrast,
                                  ),
                                }
                              : undefined
                          }
                          className={cn(
                            'inline-block size-2.5 shrink-0 rounded-xs',
                            hoveredCell.failCount === 0 &&
                              'border border-hairline-strong bg-transparent',
                          )}
                        />
                        <span
                          data-testid="stacked-readout-coord"
                          className="type-row-title text-text-primary tabular-nums"
                        >
                          {t('magnifier.place', {
                            x: formatDieCoordinate(hoveredCell.x),
                            y: formatDieCoordinate(hoveredCell.y),
                          })}
                        </span>
                      </div>

                      <div
                        data-testid="stacked-readout-rate"
                        className="mt-1 flex items-baseline justify-between gap-2 type-subhead tabular-nums"
                      >
                        <span className="text-text-secondary">
                          {hoveredCell.failCount > 0
                            ? t('stacked.readout.wafers', {
                                failed: formatInteger(hoveredCell.failCount),
                                tested: formatInteger(
                                  hoveredCell.testedWaferCount,
                                ),
                              })
                            : t('stacked.readout.allPassed', {
                                tested: formatInteger(
                                  hoveredCell.testedWaferCount,
                                ),
                              })}
                        </span>
                        <span className="font-[500] text-text-primary">
                          {formatPercent(hoveredCell.failRate)}
                        </span>
                      </div>

                      {hoveredCell.failCount > 0 &&
                      (hoveredCell.dominantSbin !== null ||
                        hoveredCell.dominantHbin !== null) ? (
                        <div
                          data-testid="stacked-readout-bin"
                          className="mt-1 flex flex-col gap-0.5 type-caption text-text-secondary tabular-nums"
                        >
                          {hoveredCell.dominantSbin !== null ? (
                            <span className="truncate">
                              {t('stacked.readout.dominantSbin', {
                                bin: '',
                              }).trim()}{' '}
                              <Untranslated className="text-text-primary">
                                {`SBIN ${hoveredCell.dominantSbin}${
                                  hoveredSbinDef?.name
                                    ? ` ${hoveredSbinDef.name}`
                                    : ''
                                }`}
                              </Untranslated>
                            </span>
                          ) : null}
                          {hoveredCell.dominantHbin !== null ? (
                            <span className="truncate">
                              {t('stacked.readout.dominantHbin', {
                                bin: '',
                              }).trim()}{' '}
                              <Untranslated className="text-text-primary">
                                {`HBIN ${hoveredCell.dominantHbin}${
                                  hoveredHbinDef?.name
                                    ? ` ${hoveredHbinDef.name}`
                                    : ''
                                }`}
                              </Untranslated>
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Numeric magma legend (premium §3.6: 160 x 6 px, radius 3, min/max caption tabular + unit) */}
                <div
                  data-testid="stacked-magma-legend"
                  role="img"
                  aria-label={t('stacked.legendAria', {
                    min: formatPercent(0),
                    max: formatPercent(scaleMax),
                  })}
                  className="mt-4 flex flex-wrap items-center justify-center gap-2.5"
                >
                  <span
                    data-testid="stacked-legend-min"
                    className="type-caption text-text-secondary tabular-nums"
                  >
                    {formatPercent(0)}
                  </span>
                  <canvas
                    ref={legendCanvasRef}
                    data-testid="stacked-magma-legend-bar"
                    data-legend-swatch="true"
                    aria-hidden="true"
                    width={STACKED_LEGEND_WIDTH_PX}
                    height={STACKED_LEGEND_HEIGHT_PX}
                    style={{
                      width: `${STACKED_LEGEND_WIDTH_PX}px`,
                      height: `${STACKED_LEGEND_HEIGHT_PX}px`,
                    }}
                    className="block shrink-0 rounded-[3px] shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]"
                  />
                  <span
                    data-testid="stacked-legend-max"
                    className="type-caption text-text-secondary tabular-nums"
                  >
                    {`${formatPercent(scaleMax)} ${t('stacked.legendUnit')}`}
                  </span>
                </div>

                {/* Region selection status & clear action, or quiet interaction hint */}
                <div
                  data-testid="stacked-selection-bar"
                  className="mt-3 flex min-h-7 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center"
                >
                  {activeStackedBrush !== null ? (
                    <>
                      <Untranslated
                        data-testid="stacked-selection-coords"
                        className="font-mono-id type-caption text-text-primary tabular-nums"
                      >
                        {formatBrushCoordinateRange(
                          activeStackedBrush,
                          (params) => t('filter.brushCoords', params),
                          (params) => t('filter.brushSingleCoord', params),
                        )}
                      </Untranslated>
                      <span
                        data-testid="stacked-selection-summary"
                        className="type-subhead text-text-secondary tabular-nums"
                      >
                        {t('stacked.selection.summary', {
                          dies: tPlural(
                            'findings.dieCount',
                            selectedStackedDieCount,
                          ),
                          wafers: formatInteger(lot.wafers.length),
                        })}
                      </span>
                      <Button
                        variant="text"
                        size="sm"
                        data-testid="stacked-selection-clear"
                        onClick={() => store.getState().setBrush(null)}
                      >
                        {t('selection.clear')}
                      </Button>
                    </>
                  ) : (
                    <p className="type-caption text-text-tertiary">
                      {t('stacked.selection.hint')}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>

      {/* Accessible tabular summary of stacked coordinate failure rates (Req 14.4) */}
      <div className="sr-only">
        <table data-testid="stacked-heatmap-sr-table">
          <caption>
            {t('stacked.canvasAria', {
              wafers: formatInteger(lot.wafers.length),
            })}
          </caption>
          <thead>
            <tr>
              <th scope="col">X, Y</th>
              <th scope="col">{t('legend.failed')}</th>
              <th scope="col">{t('stacked.legendUnit')}</th>
            </tr>
          </thead>
          <tbody>
            {cells
              .filter((cell) => cell.failCount > 0)
              .slice()
              .sort(
                (a, b) =>
                  b.failRate - a.failRate ||
                  b.failCount - a.failCount ||
                  a.y - b.y ||
                  a.x - b.x,
              )
              .slice(0, 25)
              .map((cell) => (
                <tr key={`${cell.x},${cell.y}`}>
                  <th scope="row">
                    ({formatDieCoordinate(cell.x)}, {formatDieCoordinate(cell.y)})
                  </th>
                  <td>
                    {t('stacked.readout.wafers', {
                      failed: formatInteger(cell.failCount),
                      tested: formatInteger(cell.testedWaferCount),
                    })}
                  </td>
                  <td>{formatPercent(cell.failRate)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
