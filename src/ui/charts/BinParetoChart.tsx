'use client';

import { scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';
import * as React from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { computeBinPareto } from '@/core/analytics';
import type { BinMode, LotModel } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { SegmentedControl } from '@/ui/primitives/segmented-control';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import { COLOR_TOKENS, getFailBinColor } from '@/ui/tokens';
import { buildFailBinRankMap } from '@/ui/wafer-map/wafer-geometry';
import {
  PARETO_COLLAPSED_ROW_COUNT,
  resolveClaimParetoMode,
  resolveParetoMask,
  selectParetoRows,
} from './bin-pareto-view';

export interface BinParetoChartProps {
  readonly lot: LotModel;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

const TRACK_HEIGHT_PX = 6;
/** Narrowest bar, so a single failing die stays visible. */
const MIN_BAR_PERCENT = 0.6;

/**
 * Quiet Bin Pareto (`src/ui/charts/BinParetoChart.tsx`, Requirements 6.1 to 6.5, 10.4),
 * placed below Findings in the verdict column (`redesign.md` 3.4 has no Pareto slot).
 *
 * - One borderless row per failing bin: bin code and name, grouped die count, a visx bar sharing
 *   one axis with a cumulative-share tick, and a one-line `x% of tested, y% cumulative`.
 * - Bars use the wafer-map bin colours (dominant yield-loss bin `#FF6B2C`, then the
 *   equal-lightness LCH palette); the row text always names the bin, so colour is never the
 *   only cue.
 * - A bar click toggles the store's bin filter. The chart counts over the brush, site, and
 *   filter-DSL selection without its own bin filter, so the other bars stay available.
 * - A finding that cites a bin highlights the matching bar with an ice outline.
 */
export function BinParetoChart({
  lot,
  store = useSelectionStore,
  className,
}: BinParetoChartProps): React.JSX.Element | null {
  const { t, tPlural, formatInteger, formatPercent } = useT();
  const headingId = React.useId();

  const {
    storeLot,
    brush,
    binFilter,
    siteFilter,
    waferFilter,
    dslFilter,
    hasActiveFilter,
    selectedDieMask,
    claimHighlight,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      brush: s.brush,
      binFilter: s.binFilter,
      siteFilter: s.siteFilter,
      waferFilter: s.waferFilter,
      dslFilter: s.dslFilter,
      hasActiveFilter: s.hasActiveFilter,
      selectedDieMask: s.selectedDieMask,
      claimHighlight: s.claimHighlight,
    })),
  );
  const synced = storeLot === lot;

  const [mode, setMode] = React.useState<BinMode>('SBIN');
  const [expanded, setExpanded] = React.useState(false);

  // A finding that cites a bin of the other kind switches the chart to that kind
  const claimId = synced ? (claimHighlight?.claimId ?? null) : null;
  const [seenClaimId, setSeenClaimId] = React.useState<string | null>(null);
  if (claimId !== seenClaimId) {
    setSeenClaimId(claimId);
    const nextMode = resolveClaimParetoMode(mode, claimHighlight?.citedBins);
    if (claimId !== null && nextMode !== null) {
      setMode(nextMode);
    }
  }

  const mask = React.useMemo(
    () =>
      synced
        ? resolveParetoMask(lot, {
            brush,
            binFilter,
            siteFilter,
            waferFilter,
            dslFilter,
            hasActiveFilter,
            selectedDieMask,
          })
        : undefined,
    [
      synced,
      lot,
      brush,
      binFilter,
      siteFilter,
      waferFilter,
      dslFilter,
      hasActiveFilter,
      selectedDieMask,
    ],
  );

  const pareto = React.useMemo(
    () => computeBinPareto(lot, mode, mask),
    [lot, mode, mask],
  );

  const rankByCode = React.useMemo(
    () => buildFailBinRankMap(lot.dies, mode),
    [lot.dies, mode],
  );

  const activeFilterCode =
    synced && binFilter !== null && binFilter.mode === mode
      ? binFilter.code
      : null;
  const highlightedCodes = React.useMemo(() => {
    const codes = new Set<number>();
    if (synced && claimHighlight?.citedBins) {
      for (const bin of claimHighlight.citedBins) {
        if (bin.mode === mode) {
          codes.add(bin.code);
        }
      }
    }
    return codes;
  }, [synced, claimHighlight, mode]);

  const rows = selectParetoRows(
    pareto.entries,
    expanded,
    (entry) =>
      entry.binCode === activeFilterCode || highlightedCodes.has(entry.binCode),
  );

  const xScale = React.useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, Math.max(1, pareto.failCount)],
        range: [0, 100],
        clamp: true,
      }),
    [pareto.failCount],
  );

  const modeOptions = React.useMemo(
    () => [
      { value: 'SBIN' as const, label: t('stage.mode.sbin') },
      { value: 'HBIN' as const, label: t('stage.mode.hbin') },
    ],
    [t],
  );

  const handleToggle = React.useCallback(
    (code: number): void => {
      store.getState().toggleBinFilter({ mode, code });
    },
    [store, mode],
  );

  return (
    <section
      aria-labelledby={headingId}
      data-testid="bin-pareto"
      data-mode={mode}
      className={className}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id={headingId} className="type-headline text-text-primary">
          {t('pareto.heading')}
        </h2>
        <SegmentedControl
          data-testid="bin-pareto-mode"
          ariaLabel={t('pareto.modeAria')}
          size="sm"
          options={modeOptions}
          value={mode}
          onValueChange={setMode}
        />
      </div>

      {rows.length === 0 ? (
        <p
          data-testid="bin-pareto-empty"
          className="mt-3 type-callout text-text-secondary"
        >
          {t('pareto.empty')}
        </p>
      ) : (
        <ul data-testid="bin-pareto-rows" className="mt-2 flex flex-col">
          {rows.map((entry) => {
            const isFiltered = entry.binCode === activeFilterCode;
            const isHighlighted = highlightedCodes.has(entry.binCode);
            const label = `${mode} ${entry.binCode}${
              entry.binName ? ` ${entry.binName}` : ''
            }`;
            const color = getFailBinColor(rankByCode.get(entry.binCode) ?? 0);
            const barPercent = Math.max(
              MIN_BAR_PERCENT,
              xScale(entry.count),
            );
            const cumulativePercent = xScale(
              entry.cumulativeFailShare * pareto.failCount,
            );
            const diesLabel = tPlural('findings.dieCount', entry.count);
            return (
              <li key={entry.binCode} className="list-none">
                <button
                  type="button"
                  data-testid="bin-pareto-row"
                  data-bin-mode={mode}
                  data-bin-code={entry.binCode}
                  data-highlighted={isHighlighted ? 'true' : undefined}
                  aria-pressed={isFiltered}
                  aria-label={t('pareto.rowAria', {
                    bin: label,
                    dies: diesLabel,
                    share: formatPercent(entry.shareOfTested),
                  })}
                  onClick={() => handleToggle(entry.binCode)}
                  className={cn(
                    'block w-full cursor-pointer appearance-none rounded-lg border-0 px-4 py-3 text-left transition-[background-color] duration-120 ease-out',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    isFiltered || isHighlighted
                      ? 'bg-surface-2'
                      : 'bg-transparent hover:bg-surface-1',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0 truncate type-callout text-text-primary">
                      <Untranslated>{label}</Untranslated>
                    </span>
                    <span className="type-callout whitespace-nowrap text-text-secondary tabular-nums">
                      {formatInteger(entry.count)}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    width="100%"
                    height={TRACK_HEIGHT_PX}
                    className="mt-2 block overflow-visible"
                  >
                    <Bar
                      x={0}
                      y={0}
                      width="100%"
                      height={TRACK_HEIGHT_PX}
                      rx={TRACK_HEIGHT_PX / 2}
                      fill="rgba(255,255,255,0.08)"
                    />
                    <Bar
                      data-testid="bin-pareto-bar"
                      x={0}
                      y={0}
                      width={`${barPercent}%`}
                      height={TRACK_HEIGHT_PX}
                      rx={TRACK_HEIGHT_PX / 2}
                      fill={color}
                      stroke={isHighlighted ? COLOR_TOKENS.accent : 'none'}
                      strokeWidth={isHighlighted ? 1.5 : 0}
                    />
                    <rect
                      x={`${cumulativePercent}%`}
                      y={-2}
                      width={2}
                      height={TRACK_HEIGHT_PX + 4}
                      rx={1}
                      fill={COLOR_TOKENS.textSecondary}
                      style={{ transform: 'translateX(-2px)' }}
                    />
                  </svg>
                  <span className="mt-1.5 block type-footnote text-text-tertiary tabular-nums">
                    {t('pareto.rowDetail', {
                      share: formatPercent(entry.shareOfTested),
                      cumulative: formatPercent(entry.cumulativeFailShare),
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pareto.entries.length > PARETO_COLLAPSED_ROW_COUNT ? (
        <button
          type="button"
          data-testid="bin-pareto-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 cursor-pointer rounded-lg px-4 py-2 type-control text-text-secondary transition-colors duration-120 ease-out hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {expanded
            ? t('pareto.showFewer')
            : t('pareto.showAll', {
                count: formatInteger(pareto.entries.length),
              })}
        </button>
      ) : null}
    </section>
  );
}
