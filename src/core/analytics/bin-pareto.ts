/**
 * Bin Pareto over a die selection (`src/core/analytics/bin-pareto.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 *
 * Semantics:
 * - A die is **failing** when its resolved final state failed (`ColumnarDies.finalPass === 0`).
 *   Its bin is `ColumnarDies.sbin` (`SBIN`) or `ColumnarDies.hbin` (`HBIN`) from the last `PRR`.
 * - `selectionMask` follows the Selection Store contract: length `lot.dies.count`, `1` = selected.
 *   Omitted means every die; entries beyond the mask length count as unselected.
 * - Entries list failing bins only, sorted by `count` descending, ties broken by ascending
 *   `binCode` so the order is deterministic.
 * - `cumulativeFailShare` is computed from the integer running sum divided by the failing total,
 *   so the last entry is exactly `1`.
 *
 * Validates: Requirements 6.1, 6.2, 6.5
 */

import type { BinMode, LotModel } from '../model/types';

export interface BinParetoEntry {
  readonly binCode: number;
  /** `SBR` / `HBR` bin name for `binCode`, or `''` when the lot defines none. */
  readonly binName: string;
  /** Failing dies in this bin within the selection (always `> 0`). */
  readonly count: number;
  /** `count / testedCount`, in `[0, 1]`. */
  readonly shareOfTested: number;
  /** `count / failCount`, in `(0, 1]`. */
  readonly shareOfFailures: number;
  /** Running `sum(count) / failCount` through this entry, non-decreasing, `1` on the last entry. */
  readonly cumulativeFailShare: number;
  /** Ascending die indices into `LotModel.dies` of the failing dies in this bin. */
  readonly dieIndices: Uint32Array;
}

export interface BinParetoResult {
  readonly mode: BinMode;
  /** Selected dies whose final state passed. */
  readonly passingCount: number;
  /** Selected dies whose final state failed (`sum(entries.count)`). */
  readonly failCount: number;
  /** All selected dies (`passingCount + failCount`). */
  readonly testedCount: number;
  readonly entries: readonly BinParetoEntry[];
}

export function computeBinPareto(
  lot: LotModel,
  mode: BinMode,
  selectionMask?: Uint8Array,
): BinParetoResult {
  const { dies } = lot;
  const dieCount = dies.count;
  const binArr = mode === 'SBIN' ? dies.sbin : dies.hbin;
  const definitions = mode === 'SBIN' ? lot.sbins : lot.hbins;
  const finalPass = dies.finalPass;
  const hasMask = selectionMask !== undefined;
  const maskLen = selectionMask ? selectionMask.length : 0;

  let passingCount = 0;
  let failCount = 0;
  const countByBin = new Map<number, number>();

  for (let i = 0; i < dieCount; i += 1) {
    if (hasMask && (i >= maskLen || selectionMask![i] === 0)) {
      continue;
    }
    if (finalPass[i] !== 0) {
      passingCount += 1;
      continue;
    }
    failCount += 1;
    const code = binArr[i]!;
    countByBin.set(code, (countByBin.get(code) ?? 0) + 1);
  }

  const testedCount = passingCount + failCount;
  const ordered = Array.from(countByBin.entries()).sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0] - b[0],
  );

  const indexBuckets = new Map<number, Uint32Array>();
  const fillCursor = new Map<number, number>();
  for (const [code, count] of ordered) {
    indexBuckets.set(code, new Uint32Array(count));
    fillCursor.set(code, 0);
  }
  for (let i = 0; i < dieCount; i += 1) {
    if (finalPass[i] !== 0) {
      continue;
    }
    if (hasMask && (i >= maskLen || selectionMask![i] === 0)) {
      continue;
    }
    const code = binArr[i]!;
    const cursor = fillCursor.get(code)!;
    indexBuckets.get(code)![cursor] = i;
    fillCursor.set(code, cursor + 1);
  }

  const entries: BinParetoEntry[] = [];
  let runningCount = 0;
  for (const [code, count] of ordered) {
    runningCount += count;
    entries.push({
      binCode: code,
      binName: definitions.get(code)?.name ?? '',
      count,
      shareOfTested: count / testedCount,
      shareOfFailures: count / failCount,
      cumulativeFailShare: runningCount / failCount,
      dieIndices: indexBuckets.get(code)!,
    });
  }

  return { mode, passingCount, failCount, testedCount, entries };
}
