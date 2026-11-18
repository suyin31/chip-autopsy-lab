import type { BinParetoEntry } from '@/core/analytics';
import type { BinMode, LotModel } from '@/core/model';
import {
  type BinSelectionFilter,
  deriveSelectionMasks,
  type FilterDslAst,
  type SpatialBrushRect,
} from '@/ui/state';

/** Rows shown before "Show all N bins". */
export const PARETO_COLLAPSED_ROW_COUNT = 8;

export interface ParetoMaskInputs {
  readonly brush: SpatialBrushRect | null;
  readonly binFilter: BinSelectionFilter | null;
  readonly siteFilter: number | null;
  readonly waferFilter?: number | null;
  readonly dslFilter: FilterDslAst | null;
  readonly hasActiveFilter: boolean;
  readonly selectedDieMask: Uint8Array;
}

/**
 * Selection mask the Pareto counts over (Requirement 6.5): the active brush, site, wafer, and
 * filter-DSL selection. The Pareto's own bin filter is left out, so clicking a bar keeps the
 * other bars visible and a second click can switch or clear the filter.
 *
 * Returns `undefined` when no other filter is active (the whole lot).
 */
export function resolveParetoMask(
  lot: LotModel,
  inputs: ParetoMaskInputs,
): Uint8Array | undefined {
  if (!inputs.hasActiveFilter) {
    return undefined;
  }
  if (inputs.binFilter === null) {
    return inputs.selectedDieMask;
  }
  const withoutBin = deriveSelectionMasks(lot, {
    brush: inputs.brush,
    binFilter: null,
    siteFilter: inputs.siteFilter,
    waferFilter: inputs.waferFilter ?? null,
    dslFilter: inputs.dslFilter,
    claimHighlight: null,
  });
  return withoutBin.hasActiveFilter ? withoutBin.selectedDieMask : undefined;
}

/**
 * Entries to draw: the first `PARETO_COLLAPSED_ROW_COUNT` unless expanded. Rows that are
 * highlighted by a claim or selected as the bin filter always stay visible, in rank order.
 */
export function selectParetoRows(
  entries: readonly BinParetoEntry[],
  expanded: boolean,
  isPinned: (entry: BinParetoEntry) => boolean,
): readonly BinParetoEntry[] {
  if (expanded || entries.length <= PARETO_COLLAPSED_ROW_COUNT) {
    return entries;
  }
  return entries.filter(
    (entry, index) => index < PARETO_COLLAPSED_ROW_COUNT || isPinned(entry),
  );
}

/** Mode a claim's cited bins imply, or `null` when the current mode already has one. */
export function resolveClaimParetoMode(
  currentMode: BinMode,
  citedBins: ReadonlyArray<{ readonly mode: BinMode; readonly code: number }> | undefined,
): BinMode | null {
  if (!citedBins || citedBins.length === 0) {
    return null;
  }
  if (citedBins.some((bin) => bin.mode === currentMode)) {
    return null;
  }
  return citedBins[0]!.mode;
}
