/**
 * Framework-free deterministic selection & brushing predicate engine
 * (`src/core/query/selection-predicates.ts`).
 *
 * Evaluates spatial brush rectangles (single-wafer or stacked multi-wafer),
 * Filter DSL die & capability clauses, and quick attribute filters (bin, wafer,
 * test site) as a deterministic set intersection over columnar `LotModel` arrays.
 *
 * Guarantees Property 12 (idempotence, containment, and commutativity under
 * conjunction) and runs in < 5 ms for 25 wafers x 10,000 dies (Req 15.5).
 *
 * Validates: Requirements 11.1, 11.2, 11.4, 12.2, 12.5, 15.5, 17.7
 */

import { computeParametricCapability } from '../analytics/parametric-stats';
import type { BinMode, LotModel } from '../model/types';

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

export interface QuickSelectionFilters {
  readonly bin?: { readonly mode: BinMode; readonly code: number } | null;
  readonly waferIndex?: number | null;
  readonly siteIndex?: number | null;
}

export interface FilterEvaluationResult {
  /** Length === `lot.dies.count`. `1` = selected, `0` = excluded. */
  readonly dieMask: Uint8Array;
  /** Number of `1` entries in `dieMask`. */
  readonly selectedDieCount: number;
  /** `TEST_NUM`s matching all `capabilityClauses` evaluated over `dieMask`. */
  readonly matchingTestNums: readonly number[];
  /** Matching test with the lowest finite `Cpk` (lowest `testNum` on tie), or `null`. */
  readonly lowestCpkTestNum: number | null;
}

const INNER_RHO_MAX = 0.38;
const MID_RHO_MAX = 0.75;
const EMPTY_UINT8 = new Uint8Array(0);

interface WaferRadialBounds {
  readonly cx: number;
  readonly cy: number;
  readonly rMax: number;
}

const RADIAL_BOUNDS_CACHE = new WeakMap<LotModel, readonly WaferRadialBounds[]>();

function getWaferRadialBounds(lot: LotModel): readonly WaferRadialBounds[] {
  const cached = RADIAL_BOUNDS_CACHE.get(lot);
  if (cached !== undefined) {
    return cached;
  }
  const { wafers, dies } = lot;
  const out: WaferRadialBounds[] = new Array<WaferRadialBounds>(wafers.length);
  for (let w = 0; w < wafers.length; w += 1) {
    const meta = wafers[w]!;
    const cx = (meta.minX + meta.maxX) / 2;
    const cy = (meta.minY + meta.maxY) / 2;
    let rMax = 1;
    for (let i = meta.dieStartIndex; i < meta.dieEndIndex; i += 1) {
      if (dies.hasValidCoords[i] === 0) {
        continue;
      }
      const dist = Math.hypot(dies.x[i]! - cx, dies.y[i]! - cy);
      if (dist > rMax) {
        rMax = dist;
      }
    }
    out[w] = { cx, cy, rMax };
  }
  RADIAL_BOUNDS_CACHE.set(lot, out);
  return out;
}

type CompiledDslClause = (dieIndex: number) => boolean;

function compileDslDieClauses(
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
          return (i: number) => codeSet.has(dies.sbin[i]!);
        }
        if (clause.mode === 'HBIN') {
          return (i: number) => codeSet.has(dies.hbin[i]!);
        }
        return (i: number) =>
          codeSet.has(dies.sbin[i]!) || codeSet.has(dies.hbin[i]!);
      }
      case 'edge-ring': {
        const maxRing = Math.max(0, Math.trunc(clause.maxRing));
        return (i: number) =>
          dies.hasValidCoords[i] === 1 &&
          dies.ringIndex[i]! >= 1 &&
          dies.ringIndex[i]! <= maxRing;
      }
      case 'radial-zone': {
        if (radialBounds === null) {
          radialBounds = getWaferRadialBounds(lot);
        }
        const boundsRef = radialBounds;
        const zone = clause.zone;
        return (i: number) => {
          if (dies.hasValidCoords[i] === 0) {
            return false;
          }
          const wb = boundsRef[dies.waferIndex[i]!];
          if (!wb) {
            return false;
          }
          const rho = Math.hypot(dies.x[i]! - wb.cx, dies.y[i]! - wb.cy) / wb.rMax;
          return zone === 'center'
            ? rho <= INNER_RHO_MAX
            : rho > INNER_RHO_MAX && rho <= MID_RHO_MAX;
        };
      }
      case 'wafer': {
        const waferSet = new Set<number>(clause.waferIndices);
        return (i: number) => waferSet.has(dies.waferIndex[i]!);
      }
      case 'site': {
        const matchingSites = new Set<number>();
        for (let s = 0; s < sites.length; s += 1) {
          const meta = sites[s]!;
          if (
            meta.siteNum === clause.siteNum &&
            (clause.headNum === undefined || meta.headNum === clause.headNum)
          ) {
            matchingSites.add(meta.siteIndex);
          }
        }
        return (i: number) => matchingSites.has(dies.siteIndex[i]!);
      }
    }
  });
}

function compareMetric(value: number, op: ComparisonOp, threshold: number): boolean {
  switch (op) {
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '=':
      return Math.abs(value - threshold) <= 1e-9;
  }
}

/**
 * Returns `true` when at least one die-level predicate is active across `brush`,
 * `dsl.dieClauses`, or `quickFilters`.
 */
export function hasActiveDiePredicate(
  brush: SpatialBrushRect | null,
  dsl: FilterDslAst | null,
  quickFilters?: QuickSelectionFilters,
): boolean {
  return (
    brush !== null ||
    (dsl !== null && dsl.dieClauses.length > 0) ||
    (quickFilters?.bin !== null && quickFilters?.bin !== undefined) ||
    (quickFilters?.waferIndex !== null && quickFilters?.waferIndex !== undefined) ||
    (quickFilters?.siteIndex !== null && quickFilters?.siteIndex !== undefined)
  );
}

/** Counts the number of non-zero entries in a die bitmask. */
export function countMaskDies(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] !== 0) {
      count += 1;
    }
  }
  return count;
}

/**
 * Evaluates the deterministic set intersection of an optional `inputMask` with
 * `brush`, `dsl.dieClauses`, and `quickFilters`, plus optional `dsl.capabilityClauses`
 * computed over the resulting die mask.
 *
 * When a single wafer is scoped (via `quickFilters.waferIndex` or a wafer-scoped `brush`),
 * only that wafer's contiguous `[dieStartIndex, dieEndIndex)` slice is visited so
 * 25-wafer x 10,000-die single-wafer brushing runs in sub-millisecond time.
 */
export function evaluateSelection(
  lot: LotModel,
  brush: SpatialBrushRect | null,
  dsl: FilterDslAst | null,
  quickFilters?: QuickSelectionFilters,
  inputMask?: Uint8Array,
): FilterEvaluationResult {
  const dieCount = lot.dies.count;
  const capabilityClauses = dsl?.capabilityClauses ?? [];

  if (dieCount === 0) {
    return {
      dieMask: EMPTY_UINT8,
      selectedDieCount: 0,
      matchingTestNums: [],
      lowestCpkTestNum: null,
    };
  }

  const binFilter = quickFilters?.bin ?? null;
  const waferFilter = quickFilters?.waferIndex ?? null;
  const siteFilter = quickFilters?.siteIndex ?? null;
  const dslDieClauses = dsl?.dieClauses ?? [];
  const hasAnyPredicate =
    brush !== null ||
    binFilter !== null ||
    waferFilter !== null ||
    siteFilter !== null ||
    dslDieClauses.length > 0;

  const dieMask = new Uint8Array(dieCount);
  let selectedDieCount = 0;

  if (!hasAnyPredicate) {
    if (inputMask === undefined) {
      dieMask.fill(1);
      selectedDieCount = dieCount;
    } else {
      const len = Math.min(dieCount, inputMask.length);
      for (let i = 0; i < len; i += 1) {
        if (inputMask[i] !== 0) {
          dieMask[i] = 1;
          selectedDieCount += 1;
        }
      }
    }
  } else {
    const { dies, sites, wafers } = lot;
    const siteOutOfRange =
      siteFilter !== null &&
      (!Number.isInteger(siteFilter) ||
        siteFilter < 0 ||
        siteFilter >= sites.length);
    const waferOutOfRange =
      waferFilter !== null &&
      (!Number.isInteger(waferFilter) ||
        waferFilter < 0 ||
        waferFilter >= wafers.length);
    const brushScopedWafer =
      brush !== null && brush.scope === 'wafer' && brush.waferIndex !== undefined
        ? brush.waferIndex
        : null;
    const brushWaferOutOfRange =
      brushScopedWafer !== null &&
      (!Number.isInteger(brushScopedWafer) ||
        brushScopedWafer < 0 ||
        brushScopedWafer >= wafers.length);
    const conflictingWafers =
      waferFilter !== null &&
      brushScopedWafer !== null &&
      waferFilter !== brushScopedWafer;

    if (
      !siteOutOfRange &&
      !waferOutOfRange &&
      !brushWaferOutOfRange &&
      !conflictingWafers
    ) {
      const brushLoX = brush !== null ? Math.min(brush.minX, brush.maxX) : 0;
      const brushHiX = brush !== null ? Math.max(brush.minX, brush.maxX) : 0;
      const brushLoY = brush !== null ? Math.min(brush.minY, brush.maxY) : 0;
      const brushHiY = brush !== null ? Math.max(brush.minY, brush.maxY) : 0;

      const compiledClauses =
        dslDieClauses.length > 0 ? compileDslDieClauses(lot, dslDieClauses) : null;

      // Narrow scan bounds to the single scoped wafer when possible
      const singleWaferIndex = waferFilter ?? brushScopedWafer;
      const startIndex =
        singleWaferIndex !== null ? wafers[singleWaferIndex]!.dieStartIndex : 0;
      const endIndex =
        singleWaferIndex !== null
          ? wafers[singleWaferIndex]!.dieEndIndex
          : dieCount;

      const hasInputMask = inputMask !== undefined;
      const inputMaskLen = inputMask ? inputMask.length : 0;

      const xArr = dies.x;
      const yArr = dies.y;
      const validCoordArr = dies.hasValidCoords;
      const waferIdxArr = dies.waferIndex;
      const siteIdxArr = dies.siteIndex;
      const sbinArr = dies.sbin;
      const hbinArr = dies.hbin;

      for (let i = startIndex; i < endIndex; i += 1) {
        if (hasInputMask && (i >= inputMaskLen || inputMask![i] === 0)) {
          continue;
        }

        if (siteFilter !== null && siteIdxArr[i] !== siteFilter) {
          continue;
        }

        if (waferFilter !== null && waferIdxArr[i] !== waferFilter) {
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
          const dx = xArr[i]!;
          const dy = yArr[i]!;
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
            if (!compiledClauses[c]!(i)) {
              allMatch = false;
              break;
            }
          }
          if (!allMatch) {
            continue;
          }
        }

        dieMask[i] = 1;
        selectedDieCount += 1;
      }
    }
  }

  // Evaluate capability predicates only when requested so hot-path brushing stays O(dies)
  if (capabilityClauses.length === 0) {
    return {
      dieMask,
      selectedDieCount,
      matchingTestNums: Array.from(lot.tests.keys()),
      lowestCpkTestNum: null,
    };
  }

  const matchingTestNums: number[] = [];
  let lowestCpk = Number.POSITIVE_INFINITY;
  let lowestCpkTestNum: number | null = null;

  for (const [testNum, testCol] of lot.tests.entries()) {
    const stats = computeParametricCapability(testCol, dieMask);
    let matches = true;
    for (let c = 0; c < capabilityClauses.length; c += 1) {
      const clause = capabilityClauses[c]!;
      const metricVal = clause.metric === 'cpk' ? stats.cpk : stats.cp;
      if (
        metricVal === null ||
        !Number.isFinite(metricVal) ||
        !compareMetric(metricVal, clause.op, clause.threshold)
      ) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    matchingTestNums.push(testNum);
    if (stats.cpk !== null && Number.isFinite(stats.cpk)) {
      if (
        stats.cpk < lowestCpk ||
        (stats.cpk === lowestCpk &&
          (lowestCpkTestNum === null || testNum < lowestCpkTestNum))
      ) {
        lowestCpk = stats.cpk;
        lowestCpkTestNum = testNum;
      }
    }
  }

  return {
    dieMask,
    selectedDieCount,
    matchingTestNums,
    lowestCpkTestNum,
  };
}

/** Pure set operator: `select(brush, inputMask)` over `lot.dies`. */
export function selectDiesByBrush(
  lot: LotModel,
  brush: SpatialBrushRect | null,
  inputMask?: Uint8Array,
): Uint8Array {
  return evaluateSelection(lot, brush, null, undefined, inputMask).dieMask;
}

/** Pure set operator: `select(dsl, inputMask)` over `lot.dies` (die clauses only). */
export function selectDiesByDsl(
  lot: LotModel,
  dsl: FilterDslAst | null,
  inputMask?: Uint8Array,
): Uint8Array {
  const dieOnlyDsl: FilterDslAst | null =
    dsl !== null ? { dieClauses: dsl.dieClauses, capabilityClauses: [] } : null;
  return evaluateSelection(lot, null, dieOnlyDsl, undefined, inputMask).dieMask;
}

/** Pure set operator: `select(quickFilters, inputMask)` over `lot.dies`. */
export function selectDiesByQuickFilters(
  lot: LotModel,
  quickFilters: QuickSelectionFilters | undefined,
  inputMask?: Uint8Array,
): Uint8Array {
  return evaluateSelection(lot, null, null, quickFilters, inputMask).dieMask;
}
