/**
 * Central Zustand Selection Store (`src/ui/state/selection-store.ts`).
 *
 * Single client-side source of truth uniting active spatial brush bounds,
 * Bin Pareto bar filters, Test Site scoping, Filter DSL predicates, legend bin
 * visibility toggles, hovered die state, and Autopsy Report claim highlights,
 * deriving flat `Uint8Array` die masks for sub-100 ms cross-chart updates and
 * zero-base-repaint `#D6E6FF` wafer overlay rendering.
 *
 * Validates: Requirements 4.1, 4.6, 6.4, 7.5, 10.4, 11.1, 11.4, 11.5, 12.2, 12.5
 */

import { create, type StateCreator } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { BinMode, LotModel } from '@/core/model';
import {
  type CapabilityPredicateClause,
  type ComparisonOp,
  type DiePredicateClause,
  evaluateSelection,
  type FilterDslAst,
  type SpatialBrushRect,
} from '@/core/query';

export type WaferColorMode = 'pass-fail' | 'hbin' | 'sbin' | 'parametric';

export type {
  CapabilityPredicateClause,
  ComparisonOp,
  DiePredicateClause,
  FilterDslAst,
  SpatialBrushRect,
};

export interface BinSelectionFilter {
  readonly mode: BinMode;
  readonly code: number;
}

export type ClaimGlowOrderMode =
  | 'polar-cw'
  | 'principal-axis'
  | 'centroid-distance';

export interface ClaimHighlightState {
  readonly claimId: string;
  readonly dieIndices: Uint32Array;
  readonly citedBins?: ReadonlyArray<{
    readonly mode: BinMode;
    readonly code: number;
  }>;
  readonly citedTestNums?: readonly number[];
  readonly citedSites?: ReadonlyArray<{
    readonly headNum: number;
    readonly siteNum: number;
  }>;
  /** Optional wafer index selected atomically when activating a wafer-specific claim. */
  readonly targetWaferIndex?: number;
  /** Ordered glow stagger mode (`redesign.md` §5.4). */
  readonly glowOrderMode?: ClaimGlowOrderMode;
}

export interface SelectionMaskInputs {
  readonly brush: SpatialBrushRect | null;
  readonly binFilter: BinSelectionFilter | null;
  /** Dense `0 .. lot.sites.length - 1` index into `LotModel.sites`. */
  readonly siteFilter: number | null;
  /**
   * Dense `0 .. lot.wafers.length - 1` index into `LotModel.wafers`; scopes every view to the
   * dies tested on that wafer (yield summary wafer click, Requirement 7.5). Omitted means `null`.
   */
  readonly waferFilter?: number | null;
  readonly dslFilter: FilterDslAst | null;
  readonly claimHighlight: ClaimHighlightState | null;
}

export interface DerivedSelectionMasks {
  /**
   * `true` when at least one die filter predicate (`brush`, `binFilter`,
   * `siteFilter`, `waferFilter`, or non-empty `dslFilter.dieClauses`) is active.
   */
  readonly hasActiveFilter: boolean;
  /**
   * Length === `lot.dies.count`. `1` when die satisfies the intersection of all
   * active filter predicates (all `1`s when `hasActiveFilter === false`).
   */
  readonly selectedDieMask: Uint8Array;
  /** Total `1` entries in `selectedDieMask`. */
  readonly selectedDieCount: number;
  /**
   * Length === `lot.dies.count`. `1` when die is cited by `claimHighlight`, else `0`.
   */
  readonly claimHighlightMask: Uint8Array;
  /** Validated unique in-bounds die indices cited by `claimHighlight`. */
  readonly highlightedDieIndices: Uint32Array;
  /**
   * Length === `lot.dies.count`. Effective `#D6E6FF` wafer overlay highlight mask:
   * `(hasActiveFilter ? selectedDieMask[i] : 0) | claimHighlightMask[i]`.
   * A `waferFilter` on its own does not light dies (the wafer map already shows that wafer), so
   * it contributes only while another die filter is active.
   * All `0`s when neither a filter nor a claim highlight is active.
   */
  readonly overlayHighlightMask: Uint8Array;
  /** Total `1` entries in `overlayHighlightMask`. */
  readonly overlayHighlightCount: number;
}

const EMPTY_UINT8 = new Uint8Array(0);
const EMPTY_UINT32 = new Uint32Array(0);
export const EMPTY_HIDDEN_BINS: ReadonlySet<number> = new Set<number>();

const ZERO_MASK_BY_LOT = new WeakMap<LotModel, Uint8Array>();

function getZeroMaskForLot(lot: LotModel): Uint8Array {
  let mask = ZERO_MASK_BY_LOT.get(lot);
  if (!mask || mask.length !== lot.dies.count) {
    mask = new Uint8Array(lot.dies.count);
    ZERO_MASK_BY_LOT.set(lot, mask);
  }
  return mask;
}

export function areHiddenBinSetsEqual(
  a: ReadonlySet<number>,
  b: ReadonlySet<number>,
): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Pure, deterministic `Uint8Array` bitmask evaluator uniting spatial brush bounds,
 * Bin Pareto bar toggles, Test Site scoping, Filter DSL die clauses, and
 * Autopsy Report claim highlights.
 */
export function deriveSelectionMasks(
  lot: LotModel | null,
  inputs: SelectionMaskInputs,
): DerivedSelectionMasks {
  const { brush, binFilter, siteFilter, dslFilter, claimHighlight } = inputs;
  const waferFilter = inputs.waferFilter ?? null;
  const dslDieClauses = dslFilter?.dieClauses ?? [];
  const hasHighlightingFilter =
    brush !== null ||
    binFilter !== null ||
    siteFilter !== null ||
    dslDieClauses.length > 0;
  const hasActiveFilter = hasHighlightingFilter || waferFilter !== null;

  if (lot === null || lot.dies.count === 0) {
    return {
      hasActiveFilter,
      selectedDieMask: EMPTY_UINT8,
      selectedDieCount: 0,
      claimHighlightMask: EMPTY_UINT8,
      highlightedDieIndices: EMPTY_UINT32,
      overlayHighlightMask: EMPTY_UINT8,
      overlayHighlightCount: 0,
    };
  }

  const dieCount = lot.dies.count;

  // 1. Evaluate intersection of active filter predicates -> selectedDieMask (via core query engine)
  const dieOnlyDsl: FilterDslAst | null =
    dslDieClauses.length > 0
      ? { dieClauses: dslDieClauses, capabilityClauses: [] }
      : null;
  const evaluated = evaluateSelection(lot, brush, dieOnlyDsl, {
    bin: binFilter,
    siteIndex: siteFilter,
    waferIndex: waferFilter,
  });
  const selectedDieMask = evaluated.dieMask;
  const selectedDieCount = evaluated.selectedDieCount;

  // 2. Evaluate claimHighlight -> claimHighlightMask + deduplicated highlightedDieIndices
  let claimHighlightMask: Uint8Array;
  let highlightedDieIndices: Uint32Array = EMPTY_UINT32;

  if (claimHighlight !== null && claimHighlight.dieIndices.length > 0) {
    const mutableClaimMask = new Uint8Array(dieCount);
    const rawIndices = claimHighlight.dieIndices;
    const dedup = new Uint32Array(rawIndices.length);
    let writePos = 0;
    for (let k = 0; k < rawIndices.length; k += 1) {
      const idx = rawIndices[k];
      if (idx < dieCount && mutableClaimMask[idx] === 0) {
        mutableClaimMask[idx] = 1;
        dedup[writePos] = idx;
        writePos += 1;
      }
    }
    claimHighlightMask =
      writePos === 0 ? getZeroMaskForLot(lot) : mutableClaimMask;
    highlightedDieIndices =
      writePos === dedup.length ? dedup : dedup.slice(0, writePos);
  } else {
    claimHighlightMask = getZeroMaskForLot(lot);
  }

  // 3. Derive effective wafer overlay highlight mask (#D6E6FF outline/glow)
  let overlayHighlightMask: Uint8Array;
  let overlayHighlightCount = 0;

  if (!hasHighlightingFilter && highlightedDieIndices.length === 0) {
    overlayHighlightMask = getZeroMaskForLot(lot);
    overlayHighlightCount = 0;
  } else if (hasHighlightingFilter && highlightedDieIndices.length === 0) {
    overlayHighlightMask = new Uint8Array(selectedDieMask);
    overlayHighlightCount = selectedDieCount;
  } else if (!hasHighlightingFilter) {
    overlayHighlightMask = new Uint8Array(claimHighlightMask);
    overlayHighlightCount = highlightedDieIndices.length;
  } else {
    overlayHighlightMask = new Uint8Array(dieCount);
    for (let i = 0; i < dieCount; i += 1) {
      const bit = selectedDieMask[i] | claimHighlightMask[i];
      if (bit !== 0) {
        overlayHighlightMask[i] = 1;
        overlayHighlightCount += 1;
      }
    }
  }

  return {
    hasActiveFilter,
    selectedDieMask,
    selectedDieCount,
    claimHighlightMask,
    highlightedDieIndices,
    overlayHighlightMask,
    overlayHighlightCount,
  };
}

export interface SelectionStoreState extends DerivedSelectionMasks {
  readonly lot: LotModel | null;
  readonly activeWaferIndex: number;
  readonly colorMode: WaferColorMode;
  readonly activeTestNum: number | null;
  readonly hiddenBins: ReadonlySet<number>;
  readonly hoveredDieIndex: number | null;
  readonly brush: SpatialBrushRect | null;
  readonly binFilter: BinSelectionFilter | null;
  readonly siteFilter: number | null;
  readonly waferFilter: number | null;
  readonly dslFilter: FilterDslAst | null;
  readonly claimHighlight: ClaimHighlightState | null;

  readonly setLot: (lot: LotModel | null) => void;
  readonly setActiveWaferIndex: (waferIndex: number) => void;
  readonly setColorMode: (mode: WaferColorMode) => void;
  readonly setActiveTestNum: (testNum: number | null) => void;
  readonly toggleHiddenBin: (binCode: number) => void;
  readonly clearHiddenBins: () => void;
  readonly setHoveredDieIndex: (dieIndex: number | null) => void;
  readonly setBrush: (brush: SpatialBrushRect | null) => void;
  readonly setBinFilter: (binFilter: BinSelectionFilter | null) => void;
  readonly toggleBinFilter: (binFilter: BinSelectionFilter) => void;
  readonly setSiteFilter: (siteIndex: number | null) => void;
  readonly toggleSiteFilter: (siteIndex: number) => void;
  readonly setWaferFilter: (waferIndex: number | null) => void;
  /** Scopes to one wafer and shows it on the wafer map; a second call clears the scope. */
  readonly toggleWaferFilter: (waferIndex: number) => void;
  readonly setDslFilter: (dslFilter: FilterDslAst | null) => void;
  readonly setClaimHighlight: (highlight: ClaimHighlightState | null) => void;
  readonly toggleClaimHighlight: (highlight: ClaimHighlightState) => void;
  readonly clearFilters: () => void;
  readonly reset: () => void;
}

const INITIAL_MASKS: DerivedSelectionMasks = deriveSelectionMasks(null, {
  brush: null,
  binFilter: null,
  siteFilter: null,
  dslFilter: null,
  claimHighlight: null,
});

function clampWaferIndex(lot: LotModel | null, requested: number): number {
  if (lot === null || lot.wafers.length === 0) {
    return 0;
  }
  const intIdx = Math.trunc(requested);
  if (!Number.isFinite(intIdx) || intIdx <= 0) {
    return 0;
  }
  if (intIdx >= lot.wafers.length) {
    return lot.wafers.length - 1;
  }
  return intIdx;
}

const buildSelectionStoreSlice: StateCreator<SelectionStoreState> = (
  set,
  get,
) => {
  const recomputeWith = (
    lot: LotModel | null,
    overrides: Partial<SelectionMaskInputs>,
  ): (SelectionMaskInputs & DerivedSelectionMasks) | null => {
    const current = get();
    const nextInputs: SelectionMaskInputs = {
      brush: overrides.brush !== undefined ? overrides.brush : current.brush,
      binFilter:
        overrides.binFilter !== undefined
          ? overrides.binFilter
          : current.binFilter,
      siteFilter:
        overrides.siteFilter !== undefined
          ? overrides.siteFilter
          : current.siteFilter,
      waferFilter:
        overrides.waferFilter !== undefined
          ? overrides.waferFilter
          : current.waferFilter,
      dslFilter:
        overrides.dslFilter !== undefined
          ? overrides.dslFilter
          : current.dslFilter,
      claimHighlight:
        overrides.claimHighlight !== undefined
          ? overrides.claimHighlight
          : current.claimHighlight,
    };
    if (
      lot === current.lot &&
      nextInputs.brush === current.brush &&
      nextInputs.binFilter === current.binFilter &&
      nextInputs.siteFilter === current.siteFilter &&
      nextInputs.waferFilter === current.waferFilter &&
      nextInputs.dslFilter === current.dslFilter &&
      nextInputs.claimHighlight === current.claimHighlight
    ) {
      return null;
    }
    const masks = deriveSelectionMasks(lot, nextInputs);
    return { ...nextInputs, ...masks };
  };

  return {
    lot: null,
    activeWaferIndex: 0,
    colorMode: 'pass-fail',
    activeTestNum: null,
    hiddenBins: EMPTY_HIDDEN_BINS,
    hoveredDieIndex: null,
    brush: null,
    binFilter: null,
    siteFilter: null,
    waferFilter: null,
    dslFilter: null,
    claimHighlight: null,
    ...INITIAL_MASKS,

    setLot: (lot) => {
      if (get().lot === lot) {
        return;
      }
      const cleanInputs = {
        brush: null,
        binFilter: null,
        siteFilter: null,
        waferFilter: null,
        dslFilter: null,
        claimHighlight: null,
      };
      const masks = deriveSelectionMasks(lot, cleanInputs);
      const firstTestNum =
        lot !== null && lot.tests.size > 0
          ? (lot.tests.keys().next().value ?? null)
          : null;
      set({
        lot,
        activeWaferIndex: 0,
        colorMode: 'pass-fail',
        activeTestNum: firstTestNum,
        hiddenBins: EMPTY_HIDDEN_BINS,
        hoveredDieIndex: null,
        ...cleanInputs,
        ...masks,
      });
    },

    setActiveWaferIndex: (waferIndex) => {
      const next = clampWaferIndex(get().lot, waferIndex);
      if (next !== get().activeWaferIndex) {
        set({ activeWaferIndex: next, hoveredDieIndex: null });
      }
    },

    setColorMode: (colorMode) => {
      if (colorMode !== get().colorMode) {
        set({ colorMode });
      }
    },

    setActiveTestNum: (activeTestNum) => {
      if (activeTestNum !== get().activeTestNum) {
        set({ activeTestNum });
      }
    },

    toggleHiddenBin: (binCode) => {
      if (!Number.isInteger(binCode) || binCode < 0) {
        return;
      }
      const prev = get().hiddenBins;
      const next = new Set<number>(prev);
      if (next.has(binCode)) {
        next.delete(binCode);
      } else {
        next.add(binCode);
      }
      const resolved: ReadonlySet<number> =
        next.size === 0 ? EMPTY_HIDDEN_BINS : next;
      if (!areHiddenBinSetsEqual(prev, resolved)) {
        set({ hiddenBins: resolved });
      }
    },

    clearHiddenBins: () => {
      if (get().hiddenBins.size > 0) {
        set({ hiddenBins: EMPTY_HIDDEN_BINS });
      }
    },

    setHoveredDieIndex: (hoveredDieIndex) => {
      const lot = get().lot;
      const valid =
        hoveredDieIndex !== null &&
        lot !== null &&
        hoveredDieIndex >= 0 &&
        hoveredDieIndex < lot.dies.count
          ? hoveredDieIndex
          : null;
      if (valid !== get().hoveredDieIndex) {
        set({ hoveredDieIndex: valid });
      }
    },

    setBrush: (brush) => {
      const patch = recomputeWith(get().lot, { brush });
      if (patch) {
        set(patch);
      }
    },

    setBinFilter: (binFilter) => {
      const patch = recomputeWith(get().lot, { binFilter });
      if (patch) {
        set(patch);
      }
    },

    toggleBinFilter: (binFilter) => {
      const current = get().binFilter;
      const isSame =
        current !== null &&
        current.mode === binFilter.mode &&
        current.code === binFilter.code;
      const patch = recomputeWith(get().lot, {
        binFilter: isSame ? null : binFilter,
      });
      if (patch) {
        set(patch);
      }
    },

    setSiteFilter: (siteFilter) => {
      const patch = recomputeWith(get().lot, { siteFilter });
      if (patch) {
        set(patch);
      }
    },

    toggleSiteFilter: (siteIndex) => {
      const current = get().siteFilter;
      const patch = recomputeWith(get().lot, {
        siteFilter: current === siteIndex ? null : siteIndex,
      });
      if (patch) {
        set(patch);
      }
    },

    setWaferFilter: (waferFilter) => {
      const lot = get().lot;
      const valid =
        waferFilter === null ? null : clampWaferIndex(lot, waferFilter);
      const patch = recomputeWith(lot, { waferFilter: valid });
      if (patch) {
        set(
          valid !== null && valid !== get().activeWaferIndex
            ? { ...patch, activeWaferIndex: valid, hoveredDieIndex: null }
            : patch,
        );
      } else if (valid !== null && valid !== get().activeWaferIndex) {
        set({ activeWaferIndex: valid, hoveredDieIndex: null });
      }
    },

    toggleWaferFilter: (waferIndex) => {
      const { waferFilter, lot } = get();
      const target = clampWaferIndex(lot, waferIndex);
      get().setWaferFilter(waferFilter === target ? null : target);
    },

    setDslFilter: (dslFilter) => {
      const current = get();
      const lot = current.lot;
      const patch = recomputeWith(lot, { dslFilter });
      let nextActiveTestNum = current.activeTestNum;
      if (
        lot !== null &&
        dslFilter !== null &&
        dslFilter.capabilityClauses.length > 0
      ) {
        const evaluated = evaluateSelection(
          lot,
          patch ? patch.brush : current.brush,
          dslFilter,
          {
            bin: patch ? patch.binFilter : current.binFilter,
            siteIndex: patch ? patch.siteFilter : current.siteFilter,
            waferIndex: patch ? patch.waferFilter : current.waferFilter,
          },
        );
        if (evaluated.lowestCpkTestNum !== null) {
          nextActiveTestNum = evaluated.lowestCpkTestNum;
        } else if (evaluated.matchingTestNums.length > 0) {
          nextActiveTestNum = evaluated.matchingTestNums[0]!;
        }
      }
      if (patch) {
        set(
          nextActiveTestNum !== current.activeTestNum
            ? { ...patch, activeTestNum: nextActiveTestNum }
            : patch,
        );
      } else if (nextActiveTestNum !== current.activeTestNum) {
        set({ activeTestNum: nextActiveTestNum });
      }
    },

    setClaimHighlight: (claimHighlight) => {
      const current = get();
      const nextTestNum =
        claimHighlight?.citedTestNums && claimHighlight.citedTestNums.length > 0
          ? claimHighlight.citedTestNums[0]
          : current.activeTestNum;
      const nextWaferIndex =
        claimHighlight?.targetWaferIndex !== undefined
          ? clampWaferIndex(current.lot, claimHighlight.targetWaferIndex)
          : current.activeWaferIndex;
      const waferChanged = nextWaferIndex !== current.activeWaferIndex;
      const patch = recomputeWith(current.lot, { claimHighlight });
      if (patch) {
        set({
          activeTestNum: nextTestNum,
          activeWaferIndex: nextWaferIndex,
          ...(waferChanged ? { hoveredDieIndex: null } : {}),
          ...patch,
        });
      } else if (nextTestNum !== current.activeTestNum || waferChanged) {
        set({
          activeTestNum: nextTestNum,
          activeWaferIndex: nextWaferIndex,
          ...(waferChanged ? { hoveredDieIndex: null } : {}),
        });
      }
    },

    toggleClaimHighlight: (highlight) => {
      const current = get().claimHighlight;
      const isSame = current !== null && current.claimId === highlight.claimId;
      if (isSame) {
        const patch = recomputeWith(get().lot, { claimHighlight: null });
        if (patch) {
          set(patch);
        }
        return;
      }
      const prev = get();
      const nextTestNum =
        highlight.citedTestNums && highlight.citedTestNums.length > 0
          ? highlight.citedTestNums[0]
          : prev.activeTestNum;
      const nextWaferIndex =
        highlight.targetWaferIndex !== undefined
          ? clampWaferIndex(prev.lot, highlight.targetWaferIndex)
          : prev.activeWaferIndex;
      const waferChanged = nextWaferIndex !== prev.activeWaferIndex;
      const patch = recomputeWith(prev.lot, { claimHighlight: highlight });
      if (patch) {
        set({
          activeTestNum: nextTestNum,
          activeWaferIndex: nextWaferIndex,
          ...(waferChanged ? { hoveredDieIndex: null } : {}),
          ...patch,
        });
      } else if (nextTestNum !== prev.activeTestNum || waferChanged) {
        set({
          activeTestNum: nextTestNum,
          activeWaferIndex: nextWaferIndex,
          ...(waferChanged ? { hoveredDieIndex: null } : {}),
        });
      }
    },

    clearFilters: () => {
      const patch = recomputeWith(get().lot, {
        brush: null,
        binFilter: null,
        siteFilter: null,
        waferFilter: null,
        dslFilter: null,
        claimHighlight: null,
      });
      if (patch) {
        set(patch);
      }
    },

    reset: () => {
      set({
        lot: null,
        activeWaferIndex: 0,
        colorMode: 'pass-fail',
        activeTestNum: null,
        hiddenBins: EMPTY_HIDDEN_BINS,
        hoveredDieIndex: null,
        brush: null,
        binFilter: null,
        siteFilter: null,
        waferFilter: null,
        dslFilter: null,
        claimHighlight: null,
        ...INITIAL_MASKS,
      });
    },
  };
};

/** Creates an isolated Zustand vanilla store instance for unit testing. */
export function createSelectionStore(): StoreApi<SelectionStoreState> {
  return createStore<SelectionStoreState>(buildSelectionStoreSlice);
}

/** Singleton React Zustand hook for the application workbench. */
export const useSelectionStore = create<SelectionStoreState>(
  buildSelectionStoreSlice,
);
