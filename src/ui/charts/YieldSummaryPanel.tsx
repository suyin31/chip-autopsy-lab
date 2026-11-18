'use client';

import * as React from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { YieldMetrics, YieldSummary } from '@/core/analytics';
import type { LotModel } from '@/core/model';
import type { EngineFact } from '@/core/report';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import {
  isWaferTableCollapsible,
  resolveAnomalousSiteIndices,
  selectWaferRowIndices,
} from './yield-summary-view';

export interface YieldSummaryPanelProps {
  readonly lot: LotModel;
  readonly yieldSummary: YieldSummary;
  /** Engine facts; a `site-anomaly` fact marks its site row. */
  readonly facts?: readonly EngineFact[];
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

const NO_VALUE = '\u2013';

/** Name column, then First pass, Final, and Retests. Shared by header and rows so they align. */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_3.5rem] items-baseline gap-x-3';

/**
 * Quiet yield summary (`src/ui/charts/YieldSummaryPanel.tsx`, Requirement 7.3 to 7.5), below
 * "Yield loss by bin" in the verdict column.
 *
 * - Lot: first-pass yield, final yield, and retest count as three numbers.
 * - Test sites and wafers: borderless rows with first-pass yield, final yield, and retests.
 *   A row is a toggle that scopes the selection store to the dies on that site or wafer, so the
 *   wafer map, Pareto, and selection stats follow. A wafer click also shows that wafer.
 * - The wafer table collapses to the lowest-yield wafers, with a disclosure for the rest.
 * - A site the engine flagged as an anomaly says so in words, never by colour alone.
 */
export function YieldSummaryPanel({
  lot,
  yieldSummary,
  facts,
  store = useSelectionStore,
  className,
}: YieldSummaryPanelProps): React.JSX.Element {
  const { t, formatInteger, formatPercent } = useT();
  const headingId = React.useId();
  const wafersListId = React.useId();

  const { storeLot, siteFilter, waferFilter } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      siteFilter: s.siteFilter,
      waferFilter: s.waferFilter,
    })),
  );
  const synced = storeLot === lot;
  const activeSite = synced ? siteFilter : null;
  const activeWafer = synced ? waferFilter : null;

  const [expanded, setExpanded] = React.useState(false);

  const { overall, byWafer, bySite } = yieldSummary;

  const anomalousSites = React.useMemo(
    () => resolveAnomalousSiteIndices(lot, facts),
    [lot, facts],
  );

  const waferRowIndices = React.useMemo(
    () => selectWaferRowIndices(byWafer, expanded, (i) => i === activeWafer),
    [byWafer, expanded, activeWafer],
  );
  const collapsible = isWaferTableCollapsible(byWafer.length);
  const showingLowest = collapsible && !expanded;

  const formatYield = React.useCallback(
    (ratio: number | null): string =>
      ratio === null ? NO_VALUE : formatPercent(ratio),
    [formatPercent],
  );

  const handleSite = React.useCallback(
    (siteIndex: number): void => {
      store.getState().toggleSiteFilter(siteIndex);
    },
    [store],
  );
  const handleWafer = React.useCallback(
    (waferIndex: number): void => {
      store.getState().toggleWaferFilter(waferIndex);
    },
    [store],
  );

  const columnHeaders = (
    <>
      <span className="text-right">{t('yield.col.firstPass')}</span>
      <span className="text-right">{t('yield.col.final')}</span>
      <span className="text-right">{t('yield.col.retests')}</span>
    </>
  );

  const renderValues = (m: YieldMetrics): React.ReactNode => (
    <>
      <span className="text-right type-callout tabular-nums text-text-secondary">
        {formatYield(m.firstPassYield)}
      </span>
      <span className="text-right type-callout tabular-nums text-text-primary">
        {formatYield(m.finalYield)}
      </span>
      <span className="text-right type-callout tabular-nums text-text-secondary">
        {formatInteger(m.retestExecutions)}
      </span>
    </>
  );

  const rowClass = (pressed: boolean): string =>
    cn(
      ROW_GRID,
      'w-full cursor-pointer appearance-none rounded-md border-0 px-4 py-2.5 text-left transition-[background-color] duration-120 ease-out',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      pressed ? 'bg-surface-2' : 'bg-transparent hover:bg-surface-1',
    );

  return (
    <section
      aria-labelledby={headingId}
      data-testid="yield-summary"
      className={className}
    >
      <h2 id={headingId} className="type-headline text-text-primary">
        {t('yield.heading')}
      </h2>

      <dl
        data-testid="yield-lot-stats"
        className="mt-4 grid grid-cols-3 gap-3 px-4 md:gap-6"
      >
        {[
          {
            id: 'final',
            label: t('yield.col.final'),
            value: formatYield(overall.finalYield),
          },
          {
            id: 'first-pass',
            label: t('yield.col.firstPass'),
            value: formatYield(overall.firstPassYield),
          },
          {
            id: 'retests',
            label: t('yield.col.retests'),
            value: formatInteger(overall.retestExecutions),
          },
        ].map((stat) => (
          <div
            key={stat.id}
            className="flex min-w-0 flex-col-reverse justify-end gap-1"
          >
            <dt className="type-footnote text-text-secondary">{stat.label}</dt>
            <dd
              data-testid={`yield-lot-${stat.id}`}
              className="type-title-3 text-text-primary tabular-nums"
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {bySite.length >= 2 ? (
        <div data-testid="yield-sites" className="mt-6">
          <div
            className={cn(
              ROW_GRID,
              'px-4 pb-1 type-footnote text-text-tertiary',
            )}
          >
            <h3 className="min-w-0 truncate font-[inherit]">
              {t('yield.sites')}
            </h3>
            {columnHeaders}
          </div>
          <ul className="flex flex-col">
            {bySite.map((metrics, index) => {
              const site = lot.sites[index];
              if (site === undefined) {
                return null;
              }
              const isAnomaly = anomalousSites.has(index);
              const pressed = activeSite === index;
              const noteId = `${headingId}-site-${index}-note`;
              const siteName = t('yield.siteLabel', { site: site.label });
              return (
                <li key={site.siteIndex} className="list-none">
                  <button
                    type="button"
                    data-testid="yield-site-row"
                    data-site-index={index}
                    data-site-label={site.label}
                    data-anomaly={isAnomaly ? 'true' : undefined}
                    aria-pressed={pressed}
                    aria-label={t('yield.siteRowAria', {
                      site: site.label,
                      final: formatYield(metrics.finalYield),
                      firstPass: formatYield(metrics.firstPassYield),
                    })}
                    {...(isAnomaly ? { 'aria-describedby': noteId } : {})}
                    onClick={() => handleSite(index)}
                    className={rowClass(pressed)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate type-callout text-text-primary">
                        {siteName}
                      </span>
                      {isAnomaly ? (
                        <span
                          id={noteId}
                          data-testid="yield-site-anomaly"
                          className="block type-footnote text-text-secondary"
                        >
                          {t('yield.siteLow')}
                        </span>
                      ) : null}
                    </span>
                    {renderValues(metrics)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div data-testid="yield-wafers" className="mt-6">
        <div
          className={cn(
            ROW_GRID,
            'px-4 pb-1 type-footnote text-text-tertiary',
          )}
        >
          <h3 className="min-w-0 truncate font-[inherit]">
            {showingLowest ? t('yield.wafersLowest') : t('yield.wafers')}
          </h3>
          {columnHeaders}
        </div>
        <ul id={wafersListId} className="flex flex-col">
          {waferRowIndices.map((index) => {
            const wafer = lot.wafers[index];
            const metrics = byWafer[index];
            if (wafer === undefined || metrics === undefined) {
              return null;
            }
            const pressed = activeWafer === index;
            return (
              <li key={wafer.waferIndex} className="list-none">
                <button
                  type="button"
                  data-testid="yield-wafer-row"
                  data-wafer-index={index}
                  aria-pressed={pressed}
                  aria-label={t('yield.waferRowAria', {
                    wafer: wafer.waferId,
                    final: formatYield(metrics.finalYield),
                    firstPass: formatYield(metrics.firstPassYield),
                  })}
                  onClick={() => handleWafer(index)}
                  className={rowClass(pressed)}
                >
                  <span className="min-w-0 truncate type-callout text-text-primary">
                    <Untranslated>{wafer.waferId}</Untranslated>
                  </span>
                  {renderValues(metrics)}
                </button>
              </li>
            );
          })}
        </ul>
        {collapsible ? (
          <button
            type="button"
            data-testid="yield-wafers-toggle"
            aria-expanded={expanded}
            aria-controls={wafersListId}
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 cursor-pointer rounded-md px-4 py-2 type-control text-text-secondary transition-colors duration-120 ease-out hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {expanded
              ? t('yield.showFewer')
              : t('yield.showAllWafers', {
                  count: formatInteger(byWafer.length),
                })}
          </button>
        ) : null}
      </div>
    </section>
  );
}
