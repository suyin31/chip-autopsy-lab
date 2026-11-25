'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import * as React from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  computeLotParametricSummaries,
  computeParametricHistogram,
  resolveScaledUnitLabel,
} from '@/core/analytics';
import type { GlossaryTermId } from '@/core/i18n';
import type { LotModel } from '@/core/model';
import { evaluateSelection } from '@/core/query';
import { useProximityRim } from '@/ui/atelier/ProximityPlate';
import { GlossaryText, Untranslated, useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/primitives/cn';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import { ParametricHistogram } from './ParametricHistogram';
import {
  DEFAULT_PARAMETRIC_SORT,
  type ParametricSortKey,
  type ParametricSortState,
  resolveActiveParametricTestNum,
  resolveParametricTakeaway,
  sortParametricSummaries,
  toggleParametricSort,
} from './parametric-view';

export interface ParametricPanelProps {
  readonly lot: LotModel;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

const TAKEAWAY_TERMS_CPK: readonly GlossaryTermId[] = ['cpk'];
const TAKEAWAY_TERMS_LIMITS: readonly GlossaryTermId[] = ['limits'];

/**
 * "Parametric tests" section card (`src/ui/charts/ParametricPanel.tsx`, Task 13.2):
 * - Matches the `surface` section-card shell of `BinParetoChart`, `YieldSummaryPanel`,
 *   and `StackedWaferPanel` (`r-2xl`, `shadow-card`, padding 24 / 16 mobile, warm paper contrast).
 * - Displays a plain-language takeaway, a secondary toggle to activate Wafer Map Parametric mode,
 *   the interactive `ParametricHistogram` (LO/HI limit markers, scrub readout above the bars),
 *   and a sortable test catalog (`TEST_NUM`, test name, units, `n`, fail count, mean, sigma,
 *   `Cp`, `Cpk` formatted to 2 decimals or `N/A`) recomputed over the active `SelectionStore` mask.
 * - Uses zero ember tokens (strictly neutral/ink palette per premium §3.4 & P33 audit).
 */
export function ParametricPanel({
  lot,
  store = useSelectionStore,
  className,
}: ParametricPanelProps): React.JSX.Element | null {
  const { t, formatInteger, formatDecimal2, formatParametricValue } = useT();
  const headingId = React.useId();
  const sectionRef = React.useRef<HTMLElement | null>(null);
  useProximityRim(sectionRef, { reachPx: 220 });

  const {
    storeLot,
    activeTestNum,
    colorMode,
    hasActiveFilter,
    selectedDieMask,
    brush,
    binFilter,
    siteFilter,
    waferFilter,
    dslFilter,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      activeTestNum: s.activeTestNum,
      colorMode: s.colorMode,
      hasActiveFilter: s.hasActiveFilter,
      selectedDieMask: s.selectedDieMask,
      brush: s.brush,
      binFilter: s.binFilter,
      siteFilter: s.siteFilter,
      waferFilter: s.waferFilter,
      dslFilter: s.dslFilter,
    })),
  );
  const synced = storeLot === lot;
  const activeMask = synced && hasActiveFilter ? selectedDieMask : undefined;

  const [sort, setSort] = React.useState<ParametricSortState>(
    DEFAULT_PARAMETRIC_SORT,
  );

  const summaries = React.useMemo(
    () => computeLotParametricSummaries(lot, activeMask),
    [lot, activeMask],
  );

  const matchingTestNumSet = React.useMemo<ReadonlySet<number> | null>(() => {
    if (
      !synced ||
      dslFilter === null ||
      dslFilter.capabilityClauses.length === 0
    ) {
      return null;
    }
    const evaluated = evaluateSelection(lot, brush, dslFilter, {
      bin: binFilter,
      siteIndex: siteFilter,
      waferIndex: waferFilter,
    });
    return new Set<number>(evaluated.matchingTestNums);
  }, [synced, lot, brush, dslFilter, binFilter, siteFilter, waferFilter]);

  const visibleSummaries = React.useMemo(
    () =>
      matchingTestNumSet === null
        ? summaries
        : summaries.filter((s) => matchingTestNumSet.has(s.testNum)),
    [summaries, matchingTestNumSet],
  );

  const sortedSummaries = React.useMemo(
    () => sortParametricSummaries(visibleSummaries, sort),
    [visibleSummaries, sort],
  );

  const resolvedTestNum = React.useMemo(
    () =>
      resolveActiveParametricTestNum(
        visibleSummaries,
        synced ? activeTestNum : null,
      ),
    [visibleSummaries, synced, activeTestNum],
  );

  const selectedSummary = React.useMemo(
    () =>
      resolvedTestNum !== null
        ? (visibleSummaries.find((s) => s.testNum === resolvedTestNum) ??
          sortedSummaries[0] ??
          null)
        : null,
    [visibleSummaries, sortedSummaries, resolvedTestNum],
  );

  const selectedCol =
    selectedSummary !== null ? lot.tests.get(selectedSummary.testNum) : undefined;

  const histogram = React.useMemo(
    () =>
      selectedCol
        ? computeParametricHistogram(selectedCol, activeMask)
        : null,
    [selectedCol, activeMask],
  );

  const takeaway = React.useMemo(
    () => resolveParametricTakeaway(visibleSummaries),
    [visibleSummaries],
  );

  const handleSort = React.useCallback((key: ParametricSortKey): void => {
    setSort((prev) => toggleParametricSort(prev, key));
  }, []);

  const handleSelectTest = React.useCallback(
    (testNum: number): void => {
      store.getState().setActiveTestNum(testNum);
    },
    [store],
  );

  const isParametricMode = synced && colorMode === 'parametric';
  const handleToggleParametricMap = React.useCallback((): void => {
    const state = store.getState();
    if (resolvedTestNum !== null && state.activeTestNum !== resolvedTestNum) {
      state.setActiveTestNum(resolvedTestNum);
    }
    state.setColorMode(
      state.colorMode === 'parametric' ? 'pass-fail' : 'parametric',
    );
  }, [store, resolvedTestNum]);

  if (lot.tests.size === 0 || summaries.length === 0) {
    return null;
  }

  const formatCap = (value: number | null): string =>
    value === null ? t('parametric.na') : formatDecimal2(value);

  const renderSortHeader = (
    key: ParametricSortKey,
    label: string,
    alignRight = false,
  ): React.JSX.Element => {
    const isActive = sort.key === key;
    const ariaSort: 'ascending' | 'descending' | 'none' = isActive
      ? sort.direction === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
    const handleKeyDown = (event: React.KeyboardEvent<HTMLTableCellElement>): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleSort(key);
      }
    };
    return (
      <th
        scope="col"
        tabIndex={0}
        aria-sort={ariaSort}
        data-testid={`parametric-sort-${key}`}
        onClick={() => handleSort(key)}
        onKeyDown={handleKeyDown}
        className={cn(
          'cursor-pointer py-2 font-normal whitespace-nowrap select-none rounded-xs',
          'transition-[color] duration-[120ms] ease-[var(--ease-out)]',
          'focus-visible:shadow-focus-ring focus-visible:outline-none',
          isActive
            ? 'text-text-primary'
            : 'text-text-tertiary hover:text-text-primary',
          alignRight ? 'text-right' : 'text-left',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-1 type-subhead',
            alignRight && 'flex-row-reverse',
          )}
        >
          <span>{label}</span>
          {isActive ? (
            sort.direction === 'asc' ? (
              <ArrowUp aria-hidden="true" size={12} strokeWidth={1.75} />
            ) : (
              <ArrowDown aria-hidden="true" size={12} strokeWidth={1.75} />
            )
          ) : null}
        </span>
      </th>
    );
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      data-testid="parametric-panel"
      className={cn(
        'at-bento min-w-0 max-w-full overflow-x-clip rounded-[24px] p-5 sm:p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h2
          id={headingId}
          className="min-w-0 type-title-2 text-balance text-text-primary"
        >
          {t('parametric.title')}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          data-testid="parametric-map-toggle"
          aria-pressed={isParametricMode}
          onClick={handleToggleParametricMap}
        >
          {isParametricMode
            ? t('parametric.mapActive')
            : t('parametric.mapOnWafer')}
        </Button>
      </div>

      {takeaway !== null ? (
        <p
          data-testid="parametric-takeaway"
          className="mt-2 line-clamp-2 max-w-[520px] type-body text-pretty text-text-secondary"
        >
          {takeaway.kind === 'lowCpk' ? (
            <GlossaryText
              text={t('parametric.takeaway.lowCpk', {
                test: takeaway.testName,
                cpk: formatDecimal2(takeaway.cpk),
              })}
              terms={TAKEAWAY_TERMS_CPK}
              untranslatedTokens={{ test: takeaway.testName }}
            />
          ) : takeaway.kind === 'healthy' ? (
            <GlossaryText
              text={t('parametric.takeaway.healthy', {
                count: formatInteger(takeaway.count),
              })}
              terms={TAKEAWAY_TERMS_LIMITS}
            />
          ) : (
            t('parametric.takeaway.noLimits', {
              count: formatInteger(takeaway.count),
            })
          )}
        </p>
      ) : null}

      {/* Selected test distribution histogram with LO/HI limit markers and top-margin scrub */}
      {selectedSummary && histogram ? (
        <div className="at-well-crisp mt-5 rounded-[18px] px-3 pt-1 pb-3.5 sm:px-4">
          <ParametricHistogram summary={selectedSummary} histogram={histogram} />
        </div>
      ) : null}

      {/* Sortable parametric test catalog (Req 8.1) */}
      <div className="mt-6 w-full min-w-0 overflow-x-auto">
        <table
          data-testid="parametric-catalog"
          aria-label={t('parametric.catalogAria')}
          className="w-full min-w-[440px] border-collapse"
        >
          <thead>
            <tr className="border-b border-hairline">
              {renderSortHeader('testNum', t('parametric.col.test'))}
              {renderSortHeader('units', t('parametric.col.units'))}
              {renderSortHeader('n', t('parametric.col.n'), true)}
              {renderSortHeader('failCount', t('parametric.col.fail'), true)}
              {renderSortHeader('mean', t('parametric.col.mean'), true)}
              {renderSortHeader('sigma', t('parametric.col.sigma'), true)}
              {renderSortHeader('cp', t('parametric.col.cp'), true)}
              {renderSortHeader('cpk', t('parametric.col.cpk'), true)}
            </tr>
          </thead>
          <tbody>
            {sortedSummaries.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  data-testid="parametric-catalog-empty"
                  className="py-4 type-subhead text-text-secondary"
                >
                  {t('parametric.empty')}
                </td>
              </tr>
            ) : (
              sortedSummaries.map((row) => {
              const isSelected = selectedSummary?.testNum === row.testNum;
              const unitInfo = resolveScaledUnitLabel(
                row.units,
                row.displayScaleExp,
              );
              const meanText =
                row.mean !== null
                  ? formatParametricValue(row.mean, row.units, row.displayScaleExp)
                  : t('parametric.na');
              const sigmaText =
                row.sigma !== null
                  ? formatParametricValue(row.sigma, row.units, row.displayScaleExp)
                  : t('parametric.na');

              return (
                <tr
                  key={row.testNum}
                  data-testid="parametric-catalog-row"
                  data-test-num={row.testNum}
                  data-selected={isSelected ? 'true' : undefined}
                  aria-selected={isSelected}
                  onClick={() => handleSelectTest(row.testNum)}
                  className={cn(
                    'cursor-pointer border-b border-hairline last:border-b-0',
                    'transition-[background-color] duration-[120ms] ease-[var(--ease-out)]',
                    isSelected ? 'bg-fill-2' : 'hover:bg-fill-1',
                  )}
                >
                  <td className="py-2.5 pr-2">
                    <button
                      type="button"
                      data-testid="parametric-catalog-select"
                      aria-pressed={isSelected}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectTest(row.testNum);
                      }}
                      className={cn(
                        'flex flex-col items-start rounded-xs text-left',
                        'focus-visible:shadow-focus-ring focus-visible:outline-none',
                      )}
                    >
                      <Untranslated className="type-row-title text-text-primary">
                        {row.testName || `Test ${row.testNum}`}
                      </Untranslated>
                      <Untranslated
                        className={cn(
                          'font-mono-id type-caption tabular-nums',
                          isSelected
                            ? 'text-text-secondary'
                            : 'text-text-tertiary',
                        )}
                      >
                        {row.testNum}
                      </Untranslated>
                    </button>
                  </td>
                  <td
                    className={cn(
                      'py-2.5 pr-2 type-subhead',
                      isSelected ? 'text-text-secondary' : 'text-text-tertiary',
                    )}
                  >
                    <Untranslated>
                      {unitInfo.unitLabel || '\u2013'}
                    </Untranslated>
                  </td>
                  <td className="py-2.5 pl-2 text-right type-subhead text-text-secondary tabular-nums">
                    {formatInteger(row.n)}
                  </td>
                  <td className="py-2.5 pl-2 text-right type-subhead text-text-secondary tabular-nums">
                    {formatInteger(row.failCount)}
                  </td>
                  <td className="py-2.5 pl-2 text-right type-subhead whitespace-nowrap text-text-secondary tabular-nums">
                    <Untranslated>{meanText}</Untranslated>
                  </td>
                  <td
                    className={cn(
                      'py-2.5 pl-2 text-right type-subhead whitespace-nowrap tabular-nums',
                      isSelected ? 'text-text-secondary' : 'text-text-tertiary',
                    )}
                  >
                    <Untranslated>{sigmaText}</Untranslated>
                  </td>
                  <td className="py-2.5 pl-2 text-right type-subhead text-text-secondary tabular-nums">
                    {formatCap(row.cp)}
                  </td>
                  <td
                    className={cn(
                      'py-2.5 pl-2 text-right type-subhead tabular-nums',
                      isSelected
                        ? 'font-[590] text-text-primary'
                        : 'text-text-primary',
                    )}
                  >
                    {formatCap(row.cpk)}
                  </td>
                </tr>
              );
            })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
