'use client';

import { TriangleAlert } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { YieldMetrics, YieldSummary } from '@/core/analytics';
import type { LotModel } from '@/core/model';
import type { EngineFact } from '@/core/report';
import type { GlossaryTermId } from '@/core/i18n';
import { GlossaryText, Untranslated, useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/primitives/cn';
import {
  DISCLOSURE_SCOPE_ATTR,
  DisclosureGlide,
  DisclosureListItem,
  useDisclosureList,
} from '@/ui/primitives/disclosure';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import {
  isWaferTableCollapsible,
  resolveAnomalousSiteIndices,
  resolveYieldSummaryForSelection,
  resolveYieldTakeaway,
  selectWaferRowIndices,
} from './yield-summary-view';

// Premium §2.2, §7.10: "on the first test", "retests", and "Test sites" define their terms
const NO_TERMS: readonly GlossaryTermId[] = [];
const FIRST_TEST_TERMS: readonly GlossaryTermId[] = ['firstTest'];
const RETEST_TERMS: readonly GlossaryTermId[] = ['retest'];
const TEST_SITE_TERMS: readonly GlossaryTermId[] = ['testSite'];

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

/**
 * Name column, then First test, Final, and Retests (premium §7.10). Shared by header and rows so
 * they align. Viewports narrower than 400 px drop the Retests column.
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_72px_72px_56px] items-center gap-3 max-[400px]:grid-cols-[minmax(0,1fr)_72px_72px]';
const RETESTS_CELL = 'max-[400px]:hidden';

/**
 * "Yield by test site and wafer" (premium §7.10), below "Where the yield went" in the verdict
 * column.
 *
 * - `surface` section card (`r-2xl`, `shadow-card`, padding 24, 16 on mobile): `title-2` title, a
 *   one-sentence takeaway (the flagged site's drop, or the points retests recovered), then the lot
 *   final yield, first-test yield, and retest count as three `stat-s` numbers.
 * - "Test sites" and "Wafers" tables: 44 px rows with first-test yield, final yield, and retests,
 *   split by inset hairlines. A row is a toggle that scopes the selection store to the dies on
 *   that site or wafer, so the wafer map, Pareto, and selection stats follow. A wafer click also
 *   shows that wafer.
 * - The wafer table collapses to the 5 lowest-yield wafers, with a disclosure for the rest.
 * - A site the engine flagged says "Lowest yield" in words, in grey, never by colour alone.
 */
export function YieldSummaryPanel({
  lot,
  yieldSummary,
  facts,
  store = useSelectionStore,
  className,
}: YieldSummaryPanelProps): React.JSX.Element {
  const { locale, t, formatInteger, formatPercent } = useT();
  const headingId = React.useId();
  const wafersListId = React.useId();
  const sectionRef = React.useRef<HTMLElement | null>(null);

  const {
    storeLot,
    brush,
    binFilter,
    siteFilter,
    waferFilter,
    dslFilter,
    hasActiveFilter,
    selectedDieMask,
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
    })),
  );
  const synced = storeLot === lot;
  const activeSite = synced ? siteFilter : null;
  const activeWafer = synced ? waferFilter : null;

  // Premium §8.6: "Show all N wafers" mounts the rows with a fade; rows and toggle glide
  const reduced = Boolean(useReducedMotion());
  const disclosure = useDisclosureList(reduced);
  const { expanded } = disclosure;

  const effectiveYieldSummary = React.useMemo(
    () =>
      synced
        ? resolveYieldSummaryForSelection(lot, yieldSummary, {
            brush,
            binFilter,
            siteFilter,
            waferFilter,
            dslFilter,
            hasActiveFilter,
            selectedDieMask,
          })
        : yieldSummary,
    [
      synced,
      lot,
      yieldSummary,
      brush,
      binFilter,
      siteFilter,
      waferFilter,
      dslFilter,
      hasActiveFilter,
      selectedDieMask,
    ],
  );
  const { overall, byWafer, bySite } = effectiveYieldSummary;

  const anomalousSites = React.useMemo(
    () => resolveAnomalousSiteIndices(lot, facts),
    [lot, facts],
  );
  const takeaway = React.useMemo(
    () => resolveYieldTakeaway(lot, overall, facts),
    [lot, overall, facts],
  );

  const waferRowIndices = React.useMemo(
    () => selectWaferRowIndices(byWafer, expanded, (i) => i === activeWafer),
    [byWafer, expanded, activeWafer],
  );
  const collapsedWaferRows = React.useMemo(
    () =>
      expanded
        ? new Set(
            selectWaferRowIndices(byWafer, false, (i) => i === activeWafer),
          )
        : null,
    [byWafer, expanded, activeWafer],
  );
  const collapsible = isWaferTableCollapsible(byWafer.length);

  const pointsFormat = React.useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );

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

  const takeawayText =
    takeaway === null
      ? null
      : takeaway.kind === 'site'
        ? t('yield.takeaway.site', {
            site: takeaway.siteLabel,
            yield: formatPercent(takeaway.yieldRatio),
            points: pointsFormat.format(takeaway.points),
          })
        : t('yield.takeaway.retests', {
            points: pointsFormat.format(takeaway.points),
          });

  const columnHeader = (nameLabel: string): React.ReactNode => (
    <div
      aria-hidden="true"
      className={cn(ROW_GRID, 'mt-2 type-subhead text-text-tertiary')}
    >
      <span className="min-w-0 truncate">{nameLabel}</span>
      <span className="text-right">{t('yield.col.firstPass')}</span>
      <span className="text-right">{t('yield.col.final')}</span>
      <span className={cn('text-right', RETESTS_CELL)}>
        {t('yield.col.retests')}
      </span>
    </div>
  );

  const renderYield = (
    ratio: number | null,
    tone: string,
  ): React.ReactNode =>
    ratio === null ? (
      <span className="text-right type-callout text-text-tertiary">
        {NO_VALUE}
      </span>
    ) : (
      <span className={cn('text-right type-callout tabular-nums', tone)}>
        {formatPercent(ratio)}
      </span>
    );

  const renderValues = (m: YieldMetrics, pressed: boolean): React.ReactNode => (
    <>
      {renderYield(m.firstPassYield, 'text-text-secondary')}
      {renderYield(
        m.finalYield,
        cn('text-text-primary', pressed && 'font-[590]'),
      )}
      <span
        className={cn(
          'text-right type-callout tabular-nums text-text-secondary',
          RETESTS_CELL,
        )}
      >
        {formatInteger(m.retestExecutions)}
      </span>
    </>
  );

  const rowClass = (pressed: boolean): string =>
    cn(
      ROW_GRID,
      'h-11 w-full origin-center cursor-pointer appearance-none rounded-md border-0 px-3 text-left',
      'transition-[background-color,scale] duration-120 ease-out active:scale-[0.985] active:bg-fill-2 motion-reduce:active:scale-100',
      'focus-visible:shadow-focus-ring focus-visible:outline-none',
      pressed ? 'bg-fill-2' : 'bg-transparent hover:bg-fill-1',
    );

  const separator = (
    <div
      aria-hidden="true"
      className="yield-row-separator mx-3 h-px bg-hairline transition-opacity duration-120 ease-out"
    />
  );

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      data-testid="yield-summary"
      className={cn('at-chart-section', className)}
    >
      <h2
        id={headingId}
        className="type-title-2 text-balance text-text-primary"
      >
        {t('yield.title')}
      </h2>

      {takeawayText !== null ? (
        <p
          data-testid="yield-takeaway"
          className="mt-2 line-clamp-2 max-w-[520px] type-body text-pretty text-text-secondary"
        >
          {takeawayText}
        </p>
      ) : null}

      <dl
        data-testid="yield-lot-stats"
        className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-4"
      >
        {[
          {
            id: 'final',
            label: t('yield.lot.final'),
            terms: NO_TERMS,
            value: formatYield(overall.finalYield),
          },
          {
            id: 'first-pass',
            label: t('yield.lot.firstPass'),
            terms: FIRST_TEST_TERMS,
            value: formatYield(overall.firstPassYield),
          },
          {
            id: 'retests',
            label: t('yield.lot.retests'),
            terms: RETEST_TERMS,
            value: formatInteger(overall.retestExecutions),
          },
        ].map((stat) => (
          <div
            key={stat.id}
            className="at-well-crisp flex min-w-0 flex-col-reverse justify-end gap-1.5 rounded-[16px] px-3 py-3 sm:px-4"
          >
            <dt className="type-subhead text-pretty text-text-secondary">
              <GlossaryText text={stat.label} terms={stat.terms} />
            </dt>
            <dd
              data-testid={`yield-lot-${stat.id}`}
              className="type-stat-s text-text-primary tabular-nums"
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {bySite.length >= 2 ? (
        <div data-testid="yield-sites" className="mt-8">
          <h3 className="type-headline text-text-primary">
            <GlossaryText text={t('yield.sites')} terms={TEST_SITE_TERMS} />
          </h3>
          {columnHeader(t('yield.col.site'))}
          <ul className="-mx-3 flex flex-col">
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
                <li
                  key={site.siteIndex}
                  data-active={pressed ? 'true' : undefined}
                  className="yield-list-item list-none"
                >
                  {index > 0 ? separator : null}
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
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate type-callout text-text-primary">
                        {siteName}
                      </span>
                      {isAnomaly ? (
                        <span
                          id={noteId}
                          data-testid="yield-site-anomaly"
                          className="inline-flex min-w-0 shrink items-center gap-1 type-subhead text-text-secondary"
                        >
                          <TriangleAlert
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.75}
                            className="shrink-0"
                          />
                          <span className="truncate">{t('yield.lowest')}</span>
                        </span>
                      ) : null}
                    </span>
                    {renderValues(metrics, pressed)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div
        data-testid="yield-wafers"
        {...{ [DISCLOSURE_SCOPE_ATTR]: '' }}
        className="mt-8"
      >
        <h3 className="type-headline text-text-primary">
          {t('yield.wafers')}
        </h3>
        {columnHeader(t('yield.col.wafer'))}
        <ul
          ref={disclosure.listRef}
          id={wafersListId}
          className="-mx-3 flex flex-col"
        >
          {waferRowIndices.map((index, position) => {
            const wafer = lot.wafers[index];
            const metrics = byWafer[index];
            if (wafer === undefined || metrics === undefined) {
              return null;
            }
            const pressed = activeWafer === index;
            return (
              <DisclosureListItem
                key={wafer.waferIndex}
                revealOnMount={disclosure.revealNewRows}
                reduced={reduced}
                layoutEpoch={disclosure.layoutEpoch}
                extra={
                  collapsedWaferRows !== null && !collapsedWaferRows.has(index)
                }
                data-active={pressed ? 'true' : undefined}
                className="yield-list-item list-none"
              >
                {position > 0 ? separator : null}
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
                    <Untranslated className="font-mono-id">{wafer.waferId}</Untranslated>
                  </span>
                  {renderValues(metrics, pressed)}
                </button>
              </DisclosureListItem>
            );
          })}
        </ul>
        {collapsible ? (
          <DisclosureGlide
            reduced={reduced}
            layoutEpoch={disclosure.layoutEpoch}
            className="mt-4"
          >
            <Button
              variant="text"
              data-testid="yield-wafers-toggle"
              aria-expanded={expanded}
              aria-controls={wafersListId}
              onClick={disclosure.toggle}
            >
              {expanded
                ? t('yield.showFewer')
                : t('yield.showAll', {
                    count: formatInteger(byWafer.length),
                  })}
            </Button>
          </DisclosureGlide>
        ) : null}
      </div>
    </section>
  );
}
