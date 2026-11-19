'use client';

import { SquareDashed, X } from 'lucide-react';
import * as React from 'react';
import { useStore, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { LotModel } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/primitives/cn';
import {
  type SelectionStoreState,
  type SpatialBrushRect,
  useSelectionStore,
} from '@/ui/state';
import { formatDieCoordinate } from './linked-interactions';

export interface ActiveFilterChipsProps {
  readonly lot: LotModel;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

/**
 * Formats a `SpatialBrushRect` into a compact, normalized coordinate range string
 * using true minus signs (`U+2212`) per `premium.md` §9 & §12.4.
 */
export function formatBrushCoordinateRange(
  brush: SpatialBrushRect,
  formatRange: (params: {
    readonly minX: string;
    readonly maxX: string;
    readonly minY: string;
    readonly maxY: string;
  }) => string,
  formatSingle: (params: { readonly x: string; readonly y: string }) => string,
): string {
  const minX = Math.min(brush.minX, brush.maxX);
  const maxX = Math.max(brush.minX, brush.maxX);
  const minY = Math.min(brush.minY, brush.maxY);
  const maxY = Math.max(brush.minY, brush.maxY);
  if (minX === maxX && minY === maxY) {
    return formatSingle({
      x: formatDieCoordinate(minX),
      y: formatDieCoordinate(minY),
    });
  }
  return formatRange({
    minX: formatDieCoordinate(minX),
    maxX: formatDieCoordinate(maxX),
    minY: formatDieCoordinate(minY),
    maxY: formatDieCoordinate(maxY),
  });
}

function stampAck(event: React.PointerEvent<HTMLElement>): void {
  if (typeof performance !== 'undefined') {
    event.currentTarget.dataset.ack = String(performance.now());
  }
}

const CHIP_CLASS =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-pill border border-hairline-strong bg-surface pl-2.5 pr-1 type-caption text-text-primary shadow-card';

const CHIP_REMOVE_BUTTON_CLASS = cn(
  'relative inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-pill text-text-secondary outline-none',
  'transition-[background-color,color,transform] duration-[var(--dur-1)] ease-[var(--ease-out)]',
  'hover:bg-fill-2 hover:text-text-primary motion-safe:active:scale-[0.94]',
  'motion-reduce:transition-none motion-reduce:active:scale-100',
  'focus-visible:shadow-focus-ring',
  // Extended hit target so close buttons stay comfortable without bloating pill chrome
  "after:absolute after:-inset-2 after:content-['']",
);

/**
 * Removable active filter chips for spatial brush and attribute filters
 * (`src/ui/wafer-map/ActiveFilterChips.tsx`, Requirements 11.3, 11.4, 11.5, 14.4).
 *
 * - Renders `null` when no filter is active (zero layout footprint in the default state).
 * - Uses only existing neutral/surface/hairline/ink tokens (zero ember/orange).
 * - Respects `prefers-reduced-motion: reduce` (`motion-reduce:transition-none`).
 * - Announces selection updates through a polite ARIA live region.
 */
export function ActiveFilterChips({
  lot,
  store = useSelectionStore,
  className,
}: ActiveFilterChipsProps): React.JSX.Element | null {
  const { t, tPlural } = useT();

  const {
    storeLot,
    brush,
    binFilter,
    siteFilter,
    waferFilter,
    selectedDieCount,
    hasActiveFilter,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      brush: s.brush,
      binFilter: s.binFilter,
      siteFilter: s.siteFilter,
      waferFilter: s.waferFilter,
      selectedDieCount: s.selectedDieCount,
      hasActiveFilter: s.hasActiveFilter,
    })),
  );

  const synced = storeLot === lot;
  const activeBrush = synced ? brush : null;
  const activeBin = synced ? binFilter : null;
  const activeSite = synced ? siteFilter : null;
  const activeWafer = synced ? waferFilter : null;
  const activeCount = synced ? selectedDieCount : 0;

  if (
    !synced ||
    !hasActiveFilter ||
    (activeBrush === null &&
      activeBin === null &&
      activeSite === null &&
      activeWafer === null)
  ) {
    return null;
  }

  const diesLabel = tPlural('findings.dieCount', activeCount);
  const brushCoordsText =
    activeBrush !== null
      ? formatBrushCoordinateRange(
          activeBrush,
          (params) => t('filter.brushCoords', params),
          (params) => t('filter.brushSingleCoord', params),
        )
      : null;

  const binLabel =
    activeBin !== null ? `${activeBin.mode} ${activeBin.code}` : null;
  const siteMeta =
    activeSite !== null ? (lot.sites[activeSite] ?? null) : null;
  const siteLabel =
    siteMeta !== null ? t('yield.siteLabel', { site: siteMeta.label }) : null;
  const waferMeta =
    activeWafer !== null ? (lot.wafers[activeWafer] ?? null) : null;
  const waferLabel =
    waferMeta !== null
      ? t('stage.title', { wafer: waferMeta.waferId })
      : null;

  const chipCount =
    (activeBrush !== null ? 1 : 0) +
    (binLabel !== null ? 1 : 0) +
    (siteLabel !== null ? 1 : 0) +
    (waferLabel !== null ? 1 : 0);

  return (
    <div
      role="region"
      aria-label={t('filter.barAria')}
      data-testid="active-filter-chips"
      data-selected-die-count={activeCount}
      data-chip-count={chipCount}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      {activeBrush !== null && brushCoordsText !== null ? (
        <span
          data-testid="brush-filter-chip"
          data-brush-scope={activeBrush.scope}
          data-min-x={Math.min(activeBrush.minX, activeBrush.maxX)}
          data-max-x={Math.max(activeBrush.minX, activeBrush.maxX)}
          data-min-y={Math.min(activeBrush.minY, activeBrush.maxY)}
          data-max-y={Math.max(activeBrush.minY, activeBrush.maxY)}
          data-selected-dies={activeCount}
          className={CHIP_CLASS}
        >
          <SquareDashed
            aria-hidden="true"
            size={12}
            strokeWidth={1.75}
            className="shrink-0 text-text-secondary"
          />
          {activeBrush.scope === 'stacked' ? (
            <span className="shrink-0 text-text-secondary">
              {t('filter.stackedScope')}
            </span>
          ) : null}
          <Untranslated className="font-mono-id shrink-0 text-text-primary tabular-nums">
            {brushCoordsText}
          </Untranslated>
          <span
            data-testid="brush-filter-chip-count"
            className="shrink-0 text-text-secondary tabular-nums"
          >
            {diesLabel}
          </span>
          <button
            type="button"
            data-testid="brush-filter-chip-clear"
            aria-label={t('filter.brushChipAria', {
              coords: brushCoordsText,
              dies: diesLabel,
            })}
            onPointerDown={stampAck}
            onClick={() => store.getState().setBrush(null)}
            className={CHIP_REMOVE_BUTTON_CLASS}
          >
            <X aria-hidden="true" size={12} strokeWidth={1.75} />
          </button>
        </span>
      ) : null}

      {binLabel !== null ? (
        <span data-testid="bin-filter-chip" className={CHIP_CLASS}>
          <Untranslated className="font-mono-id text-text-primary tabular-nums">
            {binLabel}
          </Untranslated>
          <button
            type="button"
            data-testid="bin-filter-chip-clear"
            aria-label={t('filter.removeChipAria', { label: binLabel })}
            onPointerDown={stampAck}
            onClick={() => store.getState().setBinFilter(null)}
            className={CHIP_REMOVE_BUTTON_CLASS}
          >
            <X aria-hidden="true" size={12} strokeWidth={1.75} />
          </button>
        </span>
      ) : null}

      {siteLabel !== null ? (
        <span data-testid="site-filter-chip" className={CHIP_CLASS}>
          <span className="text-text-primary tabular-nums">{siteLabel}</span>
          <button
            type="button"
            data-testid="site-filter-chip-clear"
            aria-label={t('filter.removeChipAria', { label: siteLabel })}
            onPointerDown={stampAck}
            onClick={() => store.getState().setSiteFilter(null)}
            className={CHIP_REMOVE_BUTTON_CLASS}
          >
            <X aria-hidden="true" size={12} strokeWidth={1.75} />
          </button>
        </span>
      ) : null}

      {waferLabel !== null && waferMeta !== null ? (
        <span data-testid="wafer-filter-chip" className={CHIP_CLASS}>
          <Untranslated className="font-mono-id text-text-primary">
            {waferMeta.waferId}
          </Untranslated>
          <button
            type="button"
            data-testid="wafer-filter-chip-clear"
            aria-label={t('filter.removeChipAria', { label: waferLabel })}
            onPointerDown={stampAck}
            onClick={() => store.getState().setWaferFilter(null)}
            className={CHIP_REMOVE_BUTTON_CLASS}
          >
            <X aria-hidden="true" size={12} strokeWidth={1.75} />
          </button>
        </span>
      ) : null}

      {chipCount >= 2 ? (
        <Button
          variant="text"
          size="sm"
          data-testid="filter-chips-clear-all"
          onPointerDown={stampAck}
          onClick={() => store.getState().clearFilters()}
        >
          {t('filter.clearAll')}
        </Button>
      ) : null}

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {t('filter.announcement', { dies: diesLabel })}
      </span>
    </div>
  );
}
