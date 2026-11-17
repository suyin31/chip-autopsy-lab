/**
 * Central Zustand Selection Store (`src/ui/state/selection-store.ts`).
 *
 * Single client-side source of truth uniting active spatial brush bounds,
 * Bin Pareto bar filters, Test Site scoping, Filter DSL predicates, legend bin
 * visibility toggles, hovered die state, and Autopsy Report claim highlights,
 * deriving flat `Uint8Array` die masks for sub-100 ms cross-chart updates and
 * zero-base-repaint `#7CF2C1` wafer overlay rendering.
 *
 * Validates: Requirements 4.1, 4.6, 6.4, 7.5, 10.4, 11.1, 11.4, 11.5, 12.2, 12.5
 */

import { create, type StateCreator } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { BinMode, LotModel } from '@/core/model';

export type WaferColorMode = 'pass-fail' | 'hbin' | 'sbin' | 'parametric';

export type ComparisonOp = '<' | '<=' | '>' | '>=' | '=';

export type DiePredicateClause =
  | { readonly kind: 'pass-status'; readonly status: 'fail' | 'pass' }
  | {
      readonly kind: 'bin';
      readonly mode: BinMode | 'ANY_BIN';
      readonly codes: readonly number[];
    }
  | { readonly kind: 'edge-ring'; readonly maxRing: number }
  | { readonly kind: 'radial-zone'; readonly zone: 'center' | 'donut' }
  | { readonly kind: 'wafer'; readonly waferIndices: readonly number[] }
  | {
      readonly kind: 'site';
      readonly headNum?: number;
      readonly siteNum: number;
    };

export interface CapabilityPredicateClause {
  readonly kind: 'capability';
  readonly metric: 'cpk' | 'cp';
  readonly op: ComparisonOp;
  readonly threshold: number;
}

export interface FilterDslAst {
  readonly dieClauses: readonly DiePredicateClause[];
  readonly capabilityClauses: readonly CapabilityPredicateClause[];
}

export interface SpatialBrushRect {
  readonly scope: 'wafer' | 'stacked';
  /** Optional wafer index when brushing on a single-wafer view. */
  readonly waferIndex?: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface BinSelectionFilter {
  readonly mode: BinMode;
  readonly code: number;
}

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
}

export interface SelectionMaskInputs {
  readonly brush: SpatialBrushRect | null;
  readonly binFilter: BinSelectionFilter | null;
  /** Dense `0 .. lot.sites.length - 1` index into `LotModel.sites`. */
  readonly siteFilter: number | null;
  readonly dslFilter: FilterDslAst | null;
  readonly claimHighlight: ClaimHighlightState | null;
}

export interface DerivedSelectionMasks {
  /**
   * `true` when at least one die filter predicate (`brush`, `binFilter`,
   * `siteFilter`, or non-empty `dslFilter.dieClauses`) is active.
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
   * Length === `lot.dies.count`. Effective `#7CF2C1` wafer overlay highlight mask:
   * `(hasActiveFilter ? selectedDieMask[i] : 0) | claimHighlightMask[i]`.
   * All `0`s when neither a filter nor a claim highlight is active.
   */
  readonly overlayHighlightMask: Uint8Array;
  /** Total `1` entries in `overlayHighlightMask`. */
  readonly overlayHighlightCount: number;
}

const INNER_RHO_MAX = 0.38;
const MID_RHO_MAX = 0.75;

const EMPTY_UINT8 = new Uint8Array(0);
const EMPTY_UINT32 = new Uint32Array(0);
const EMPTY_HIDDEN_BINS: ReadonlySet<number> = new Set<number>();

interface WaferRadialBounds {
  readonly cx: number;
  readonly cy: number;
  readonly rMax: number;
}

function computeWaferRadialBounds(lot: LotModel): readonly WaferRadialBounds[] {
  const { wafers, dies } = lot;
  const out: WaferRadialBounds[] = new Array<WaferRadialBounds>(wafers.length);
  for (let w = 0; w < wafers.length; w += 1) {
    const meta = wafers[w];
    const cx = (meta.minX + meta.maxX) / 2;
    const cy = (meta.minY + meta.maxY) / 2;
    let rMax = 1;
    for (let i = meta.dieStartIndex; i < meta.dieEndIndex; i += 1) {
      if (dies.hasValidCoords[i] === 0) {
        continue;
      }
      const dist = Math.hypot(dies.x[i] - cx, dies.y[i] - cy);
      if (dist > rMax) {
        rMax = dist;
      }
    }
    out[w] = { cx, cy, rMax };
  }
  return out;
}

type CompiledDslClause = (dieIndex: number) => boolean;

function compileDslClauses(
  lot: LotModel,
  clauses: readonly DiePredicateClause[],
): readonly CompiledDslClause[] {
  const { dies, sites } = lot;
  let radialBounds: readonly WaferRadialBounds[] | null = null;

  return clauses.map((clause): CompiledDslClause => {
    switch (clause.kind) {
      case 'pass-status': {
        const wantPass = clause.status === 'pass';
        return (i: number) =>
          wantPass ? dies.finalPass[i] !== 0 : dies.finalPass[i] === 0;
      }
      case 'bin': {
        const codeSet = new Set<number>(clause.codes);
        if (clause.mode === 'SBIN') {
          return (i: number) => codeSet.has(dies.sbin[i]);
        }
        if (clause.mode === 'HBIN') {
          return (i: number) => codeSet.has(dies.hbin[i]);
        }
        return (i: number) =>
          codeSet.has(dies.sbin[i]) || codeSet.has(dies.hbin[i]);
      }
      case 'edge-ring': {
        const maxRing = Math.max(0, Math.trunc(clause.maxRing));
        return (i: number) =>
          dies.hasValidCoords[i] === 1 &&
          dies.ringIndex[i] >= 1 &&
          dies.ringIndex[i] <= maxRing;
      }
      case 'radial-zone': {
        if (radialBounds === null) {
          radialBounds = computeWaferRadialBounds(lot);
        }
        const boundsRef = radialBounds;
        const zone = clause.zone;
        return (i: number) => {
          if (dies.hasValidCoords[i] === 0) {
            return false;
          }
          const wb = boundsRef[dies.waferIndex[i]];
          if (!wb) {
            return false;
          }
          const rho = Math.hypot(dies.x[i] - wb.cx, dies.y[i] - wb.cy) / wb.rMax;
          return zone === 'center'
            ? rho <= INNER_RHO_MAX
            : rho > INNER_RHO_MAX && rho <= MID_RHO_MAX;
        };
      }
      case 'wafer': {
        const waferSet = new Set<number>(clause.waferIndices);
        return (i: number) => waferSet.has(dies.waferIndex[i]);
      }
      case 'site': {
        const matchingSites = new Set<number>();
        for (let s = 0; s < sites.length; s += 1) {
          const meta = sites[s];
          if (
            meta.siteNum === clause.siteNum &&
            (clause.headNum === undefined || meta.headNum === clause.headNum)
          ) {
            matchingSites.add(meta.siteIndex);
          }
        }
        return (i: number) => matchingSites.has(dies.siteIndex[i]);
      }
    }
  });
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
  const dslDieClauses = dslFilter?.dieClauses ?? [];
  const hasActiveFilter =
    brush !== null ||
    binFilter !== null ||
    siteFilter !== null ||
    dslDieClauses.length > 0;

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

  const { dies, sites } = lot;
  const dieCount = dies.count;

  // 1. Evaluate intersection of active filter predicates -> selectedDieMask
  const selectedDieMask = new Uint8Array(dieCount);
  let selectedDieCount = 0;

  if (!hasActiveFilter) {
    selectedDieMask.fill(1);
    selectedDieCount = dieCount;
  } else {
    const siteOutOfRange =
      siteFilter !== null &&
      (!Number.isInteger(siteFilter) ||
        siteFilter < 0 ||
        siteFilter >= sites.length);

    if (!siteOutOfRange) {
      const brushLoX = brush !== null ? Math.min(brush.minX, brush.maxX) : 0;
      const brushHiX = brush !== null ? Math.max(brush.minX, brush.maxX) : 0;
      const brushLoY = brush !== null ? Math.min(brush.minY, brush.maxY) : 0;
      const brushHiY = brush !== null ? Math.max(brush.minY, brush.maxY) : 0;
      const brushScopedWafer =
        brush !== null && brush.scope === 'wafer' && brush.waferIndex !== undefined
          ? brush.waferIndex
          : null;

      const compiledClauses =
        dslDieClauses.length > 0 ? compileDslClauses(lot, dslDieClauses) : null;

      const xArr = dies.x;
      const yArr = dies.y;
      const validCoordArr = dies.hasValidCoords;
      const waferIdxArr = dies.waferIndex;
      const siteIdxArr = dies.siteIndex;
      const sbinArr = dies.sbin;
      const hbinArr = dies.hbin;

      for (let i = 0; i < dieCount; i += 1) {
        if (siteFilter !== null && siteIdxArr[i] !== siteFilter) {
          continue;
        }

        if (binFilter !== null) {
          const code = binFilter.mode === 'SBIN' ? sbinArr[i] : hbinArr[i];
          if (code !== binFilter.code) {
            continue;
          }
        }

        if (brush !== null) {
          if (validCoordArr[i] === 0) {
            continue;
          }
          if (brushScopedWafer !== null && waferIdxArr[i] !== brushScopedWafer) {
            continue;
          }
          const dx = xArr[i];
          const dy = yArr[i];
          if (
            dx < brushLoX ||
            dx > brushHiX ||
            dy < brushLoY ||
            dy > brushHiY
          ) {
            continue;
          }
        }

        if (compiledClauses !== null) {
          let allMatch = true;
          for (let c = 0; c < compiledClauses.length; c += 1) {
            if (!compiledClauses[c](i)) {
              allMatch = false;
              break;
            }
          }
          if (!allMatch) {
            continue;
          }
        }

        selectedDieMask[i] = 1;
        selectedDieCount += 1;
      }
    }
  }

  // 2. Evaluate claimHighlight -> claimHighlightMask + deduplicated highlightedDieIndices
  const claimHighlightMask = new Uint8Array(dieCount);
  let highlightedDieIndices: Uint32Array = EMPTY_UINT32;

  if (claimHighlight !== null && claimHighlight.dieIndices.length > 0) {
    const rawIndices = claimHighlight.dieIndices;
    const dedup = new Uint32Array(rawIndices.length);
    let writePos = 0;
    for (let k = 0; k < rawIndices.length; k += 1) {
      const idx = rawIndices[k];
      if (idx < dieCount && claimHighlightMask[idx] === 0) {
        claimHighlightMask[idx] = 1;
        dedup[writePos] = idx;
        writePos += 1;
      }
    }
    highlightedDieIndices =
      writePos === dedup.length ? dedup : dedup.slice(0, writePos);
  }

  // 3. Derive effective wafer overlay highlight mask (#7CF2C1 outline/glow)
  let overlayHighlightMask: Uint8Array;
  let overlayHighlightCount = 0;

  if (!hasActiveFilter && highlightedDieIndices.length === 0) {
    overlayHighlightMask = new Uint8Array(dieCount);
    overlayHighlightCount = 0;
  } else if (hasActiveFilter && highlightedDieIndices.length === 0) {
    overlayHighlightMask = new Uint8Array(selectedDieMask);
    overlayHighlightCount = selectedDieCount;
  } else if (!hasActiveFilter) {
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
  ): SelectionMaskInputs & DerivedSelectionMasks => {
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
      dslFilter:
        overrides.dslFilter !== undefined
          ? overrides.dslFilter
          : current.dslFilter,
      claimHighlight:
        overrides.claimHighlight !== undefined
          ? overrides.claimHighlight
          : current.claimHighlight,
    };
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
    dslFilter: null,
    claimHighlight: null,
    ...INITIAL_MASKS,

    setLot: (lot) => {
      if (get().lot === lot) {
        return;
      }
      const cleanInputs: SelectionMaskInputs = {
        brush: null,
        binFilter: null,
        siteFilter: null,
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
      const next = new Set<number>(get().hiddenBins);
      if (next.has(binCode)) {
        next.delete(binCode);
      } else {
        next.add(binCode);
      }
      set({ hiddenBins: next });
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
      set(recomputeWith(get().lot, { brush }));
    },

    setBinFilter: (binFilter) => {
      set(recomputeWith(get().lot, { binFilter }));
    },

    toggleBinFilter: (binFilter) => {
      const current = get().binFilter;
      const isSame =
        current !== null &&
        current.mode === binFilter.mode &&
        current.code === binFilter.code;
      set(recomputeWith(get().lot, { binFilter: isSame ? null : binFilter }));
    },

    setSiteFilter: (siteFilter) => {
      set(recomputeWith(get().lot, { siteFilter }));
    },

    toggleSiteFilter: (siteIndex) => {
      const current = get().siteFilter;
      set(
        recomputeWith(get().lot, {
          siteFilter: current === siteIndex ? null : siteIndex,
        }),
      );
    },

    setDslFilter: (dslFilter) => {
      set(recomputeWith(get().lot, { dslFilter }));
    },

    setClaimHighlight: (claimHighlight) => {
      const nextTestNum =
        claimHighlight?.citedTestNums && claimHighlight.citedTestNums.length > 0
          ? claimHighlight.citedTestNums[0]
          : get().activeTestNum;
      set({
        activeTestNum: nextTestNum,
        ...recomputeWith(get().lot, { claimHighlight }),
      });
    },

    toggleClaimHighlight: (highlight) => {
      const current = get().claimHighlight;
      const isSame = current !== null && current.claimId === highlight.claimId;
      if (isSame) {
        set(recomputeWith(get().lot, { claimHighlight: null }));
        return;
      }
      const nextTestNum =
        highlight.citedTestNums && highlight.citedTestNums.length > 0
          ? highlight.citedTestNums[0]
          : get().activeTestNum;
      set({
        activeTestNum: nextTestNum,
        ...recomputeWith(get().lot, { claimHighlight: highlight }),
      });
    },

    clearFilters: () => {
      set(
        recomputeWith(get().lot, {
          brush: null,
          binFilter: null,
          siteFilter: null,
          dslFilter: null,
          claimHighlight: null,
        }),
      );
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
