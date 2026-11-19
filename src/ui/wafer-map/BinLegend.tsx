'use client';

import * as React from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { LotModel } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { MENU_SURFACE_CLASS } from '@/ui/primitives/surfaces';
import {
  EMPTY_HIDDEN_BINS,
  type SelectionStoreState,
  type WaferColorMode,
} from '@/ui/state';
import {
  paintMagmaLegendCanvas,
  STACKED_LEGEND_HEIGHT_PX,
  STACKED_LEGEND_WIDTH_PX,
} from './stacked-heatmap-view';
import {
  buildStageLegendModel,
  INLINE_FAIL_BIN_ENTRIES,
  LEGEND_FAILED_KEY,
  LEGEND_PASSED_KEY,
  resolveGroupToggleCodes,
  type StageLegendBin,
} from './stage-legend';
import {
  computeParametricRange,
  resolveCanvasPixelSize,
} from './wafer-geometry';

export interface BinLegendProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly colorMode: WaferColorMode;
  /** Active parametric `TEST_NUM` when `colorMode === 'parametric'`. */
  readonly activeTestNum?: number | null;
  /** Final-state pass and fail die counts of the active wafer (Pass/fail legend). */
  readonly passCount: number;
  readonly failCount: number;
  readonly store: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

type SwatchKind = 'fail-tile' | 'hollow-tile' | 'dot';

function LegendSwatch({
  kind,
  inkIndex = 0,
  hidden,
}: {
  readonly kind: SwatchKind;
  readonly inkIndex?: number;
  readonly hidden: boolean;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-legend-swatch={kind}
      style={
        kind === 'dot' ? { backgroundColor: `var(--bin-ink-${inkIndex})` } : undefined
      }
      className={cn(
        'inline-block shrink-0 transition-opacity duration-[120ms] ease-[var(--ease-out)]',
        kind === 'fail-tile' && 'size-3 rounded-xs bg-ember-mark',
        kind === 'hollow-tile' &&
          'size-3 rounded-xs shadow-[inset_0_0_0_1px_var(--hairline-strong)]',
        kind === 'dot' && 'size-2 rounded-full',
        hidden ? 'opacity-40' : 'opacity-100',
      )}
    />
  );
}

interface LegendEntryProps {
  readonly swatch: SwatchKind;
  readonly inkIndex?: number;
  readonly label: React.ReactNode;
  readonly count: string;
  readonly hidden: boolean;
  readonly primaryLabel?: boolean;
  readonly ariaLabel: string;
  readonly title?: string;
  readonly onToggle?: () => void;
}

/** One legend entry: swatch, label, and tabular count; a `button` with `aria-pressed` when it toggles (premium §5.7). */
function LegendEntry({
  swatch,
  inkIndex,
  label,
  count,
  hidden,
  primaryLabel = false,
  ariaLabel,
  title,
  onToggle,
}: LegendEntryProps): React.JSX.Element {
  const content = (
    <>
      <LegendSwatch kind={swatch} inkIndex={inkIndex ?? 0} hidden={hidden} />
      <span
        data-legend-label=""
        className={cn(
          'ml-1.5 transition-[color] duration-[120ms] ease-[var(--ease-out)]',
          hidden
            ? 'text-text-disabled line-through'
            : primaryLabel
              ? 'font-medium text-text-primary'
              : 'text-text-secondary group-hover:text-text-primary',
        )}
      >
        {label}
      </span>
      <span
        data-legend-count=""
        className={cn(
          'ml-1 tabular-nums',
          hidden ? 'text-text-disabled line-through' : 'text-text-tertiary',
        )}
      >
        {count}
      </span>
    </>
  );
  if (!onToggle) {
    return (
      <span className="inline-flex items-center whitespace-nowrap">{content}</span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={!hidden}
      aria-label={ariaLabel}
      title={title}
      onClick={onToggle}
      className={cn(
        'group relative inline-flex cursor-pointer items-center rounded-xs whitespace-nowrap',
        "after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']",
        'focus-visible:shadow-focus-ring focus-visible:outline-none',
      )}
    >
      {content}
    </button>
  );
}

function binTitle(bin: StageLegendBin): string {
  return bin.name ? `${bin.codeLabel} ${bin.name}` : bin.codeLabel;
}

/**
 * Stage legend in the control row (premium §5.7). Pass/fail: "Failed" and "Passed" tiles.
 * Bins: up to 4 fail bins by count, a "+N more" popover listing every bin with its name, and
 * the good bins grouped as "Good". Every entry toggles visibility through the store's
 * `hiddenBins`; the canvas layers repaint imperatively, so only this component re-renders.
 */
export function BinLegend({
  lot,
  waferIndex,
  colorMode,
  activeTestNum = null,
  passCount,
  failCount,
  store,
  className,
}: BinLegendProps): React.JSX.Element {
  const { t, formatInteger, formatParametricValue } = useT();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreButtonRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const magmaLegendCanvasRef = React.useRef<HTMLCanvasElement>(null);

  const storeLot = useStore(store, (s) => s.lot);
  const storeHiddenBins = useStore(store, (s) => s.hiddenBins);
  const hiddenBins = storeLot === lot ? storeHiddenBins : EMPTY_HIDDEN_BINS;

  const toggle = React.useCallback(
    (code: number): void => store.getState().toggleHiddenBin(code),
    [store],
  );
  const toggleGroup = React.useCallback(
    (codes: readonly number[]): void => {
      const state = store.getState();
      for (const code of resolveGroupToggleCodes(state.hiddenBins, codes)) {
        state.toggleHiddenBin(code);
      }
    },
    [store],
  );

  const model = React.useMemo(
    () => buildStageLegendModel(lot, waferIndex, colorMode),
    [lot, waferIndex, colorMode],
  );

  // Close the popover when the colour mode changes
  const lastModeRef = React.useRef(colorMode);
  if (lastModeRef.current !== colorMode) {
    lastModeRef.current = colorMode;
    if (moreOpen) {
      setMoreOpen(false);
    }
  }

  // Menus close on Esc (focus returns to the trigger) and on outside click (premium §7.12)
  React.useEffect(() => {
    if (!moreOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (
        target &&
        !popoverRef.current?.contains(target) &&
        !moreButtonRef.current?.contains(target)
      ) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [moreOpen]);

  const parametricCol = React.useMemo(() => {
    if (colorMode !== 'parametric') return undefined;
    if (activeTestNum !== null && lot.tests.has(activeTestNum)) {
      return lot.tests.get(activeTestNum);
    }
    return lot.tests.values().next().value;
  }, [colorMode, activeTestNum, lot.tests]);

  const parametricRange = React.useMemo(
    () => (colorMode === 'parametric' ? computeParametricRange(parametricCol) : null),
    [colorMode, parametricCol],
  );

  // Paint the 160 x 6 px magma color-bar legend when in Parametric mode (premium §3.6, Req 8.6)
  React.useEffect(() => {
    if (colorMode !== 'parametric') return;
    const canvas = magmaLegendCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dims = resolveCanvasPixelSize(
      STACKED_LEGEND_WIDTH_PX,
      STACKED_LEGEND_HEIGHT_PX,
      dpr,
    );
    if (canvas.width !== dims.pixelWidth) canvas.width = dims.pixelWidth;
    if (canvas.height !== dims.pixelHeight) canvas.height = dims.pixelHeight;
    paintMagmaLegendCanvas(
      ctx,
      STACKED_LEGEND_WIDTH_PX,
      STACKED_LEGEND_HEIGHT_PX,
      dims.dpr,
    );
  }, [colorMode, parametricCol]);

  if (colorMode === 'parametric') {
    const testLabel =
      parametricCol?.testName && parametricCol.testName.length > 0
        ? parametricCol.testName
        : parametricCol
          ? `Test ${parametricCol.testNum}`
          : '';
    const minStr =
      parametricCol && parametricRange
        ? formatParametricValue(
            parametricRange.min,
            parametricCol.units,
            parametricCol.resScal,
          )
        : null;
    const maxStr =
      parametricCol && parametricRange
        ? formatParametricValue(
            parametricRange.max,
            parametricCol.units,
            parametricCol.resScal,
          )
        : null;

    return (
      <div
        data-testid="stage-legend"
        data-legend-mode="parametric"
        className={cn(
          'flex flex-wrap items-center gap-x-2.5 gap-y-1 type-caption',
          className,
        )}
      >
        {testLabel ? (
          <Untranslated className="max-w-[120px] truncate text-text-secondary">
            {testLabel}
          </Untranslated>
        ) : null}
        {minStr !== null && maxStr !== null ? (
          <div
            data-testid="parametric-magma-legend"
            role="img"
            aria-label={t('parametric.legendAria', {
              test: testLabel,
              min: minStr,
              max: maxStr,
            })}
            className="flex items-center gap-2"
          >
            <span
              data-testid="parametric-legend-min"
              className="type-caption text-text-tertiary tabular-nums"
            >
              <Untranslated>{minStr}</Untranslated>
            </span>
            <canvas
              ref={magmaLegendCanvasRef}
              data-testid="parametric-magma-legend-bar"
              aria-hidden="true"
              style={{
                width: `${STACKED_LEGEND_WIDTH_PX}px`,
                height: `${STACKED_LEGEND_HEIGHT_PX}px`,
              }}
              className="block shrink-0 rounded-[3px]"
            />
            <span
              data-testid="parametric-legend-max"
              className="type-caption text-text-tertiary tabular-nums"
            >
              <Untranslated>{maxStr}</Untranslated>
            </span>
          </div>
        ) : (
          <span className="type-caption text-text-tertiary">
            {t('parametric.legendNoData')}
          </span>
        )}
      </div>
    );
  }

  if (colorMode !== 'hbin' && colorMode !== 'sbin') {
    const interactive = colorMode === 'pass-fail';
    const failedHidden = interactive && hiddenBins.has(LEGEND_FAILED_KEY);
    const passedHidden = interactive && hiddenBins.has(LEGEND_PASSED_KEY);
    const failedLabel = t('legend.failed');
    const passedLabel = t('legend.passed');
    return (
      <div
        data-testid="stage-legend"
        className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 type-subhead', className)}
      >
        <LegendEntry
          swatch="fail-tile"
          label={failedLabel}
          count={formatInteger(failCount)}
          hidden={failedHidden}
          ariaLabel={t('stage.legend.toggleAria', { bin: failedLabel })}
          {...(interactive ? { onToggle: () => toggle(LEGEND_FAILED_KEY) } : {})}
        />
        <LegendEntry
          swatch="hollow-tile"
          label={passedLabel}
          count={formatInteger(passCount)}
          hidden={passedHidden}
          ariaLabel={t('stage.legend.toggleAria', { bin: passedLabel })}
          {...(interactive ? { onToggle: () => toggle(LEGEND_PASSED_KEY) } : {})}
        />
      </div>
    );
  }

  const inlineFail = model.failBins.slice(0, INLINE_FAIL_BIN_ENTRIES);
  const overflowCount = model.failBins.length - inlineFail.length;
  const goodCodes = model.goodBins.map((b) => b.code);
  const goodHidden =
    goodCodes.length > 0 && goodCodes.every((c) => hiddenBins.has(c));
  const goodLabel = t('legend.good');
  const allBins = [...model.failBins, ...model.goodBins];

  return (
    <div
      data-testid="stage-legend"
      className={cn(
        'relative flex flex-wrap items-center gap-x-4 gap-y-2 type-subhead',
        className,
      )}
    >
      {inlineFail.map((bin) => (
        <LegendEntry
          key={bin.code}
          swatch="dot"
          inkIndex={bin.inkIndex}
          label={<Untranslated>{bin.codeLabel}</Untranslated>}
          count={formatInteger(bin.count)}
          hidden={hiddenBins.has(bin.code)}
          primaryLabel
          ariaLabel={t('stage.legend.toggleAria', { bin: binTitle(bin) })}
          title={binTitle(bin)}
          onToggle={() => toggle(bin.code)}
        />
      ))}
      {overflowCount > 0 ? (
        <button
          ref={moreButtonRef}
          type="button"
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            'relative cursor-pointer rounded-xs whitespace-nowrap text-text-secondary tabular-nums',
            'transition-[color] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary active:opacity-64',
            "after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']",
            'focus-visible:shadow-focus-ring focus-visible:outline-none',
          )}
        >
          {t('legend.more', { count: formatInteger(overflowCount) })}
        </button>
      ) : null}
      {model.goodBins.length > 0 ? (
        <LegendEntry
          swatch="hollow-tile"
          label={goodLabel}
          count={formatInteger(model.goodCount)}
          hidden={goodHidden}
          ariaLabel={t('stage.legend.toggleAria', { bin: goodLabel })}
          title={model.goodBins.map(binTitle).join(', ')}
          onToggle={() => toggleGroup(goodCodes)}
        />
      ) : null}

      {moreOpen && overflowCount > 0 ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={t('legend.more', { count: formatInteger(overflowCount) })}
          data-testid="stage-legend-popover"
          className={cn(
            MENU_SURFACE_CLASS,
            'absolute bottom-full left-0 z-[var(--z-menus)] mb-2 flex max-h-80 w-60 flex-col overflow-y-auto',
          )}
        >
          {allBins.map((bin) => {
            const isHidden = hiddenBins.has(bin.code);
            return (
              <button
                key={bin.code}
                type="button"
                aria-pressed={!isHidden}
                aria-label={t('stage.legend.toggleAria', { bin: binTitle(bin) })}
                title={binTitle(bin)}
                onClick={() => toggle(bin.code)}
                className={cn(
                  'flex h-10 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left type-control',
                  'transition-[background-color] duration-[120ms] ease-[var(--ease-out)] hover:bg-fill-1 active:bg-fill-2',
                  'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  isHidden ? 'text-text-disabled line-through' : 'text-text-primary',
                )}
              >
                <LegendSwatch
                  kind={bin.isPass ? 'hollow-tile' : 'dot'}
                  inkIndex={bin.inkIndex}
                  hidden={isHidden}
                />
                <Untranslated className="min-w-0 flex-1 truncate">
                  {binTitle(bin)}
                </Untranslated>
                <span
                  className={cn(
                    'tabular-nums',
                    isHidden ? 'text-text-disabled' : 'text-text-tertiary',
                  )}
                >
                  {formatInteger(bin.count)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
