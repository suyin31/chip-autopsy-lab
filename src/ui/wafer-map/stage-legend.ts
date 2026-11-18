import type { LotModel } from '@/core/model';
import type { WaferColorMode } from '@/ui/state';
import { buildFailBinRankMap } from './wafer-geometry';

export { LEGEND_FAILED_KEY, LEGEND_PASSED_KEY } from './wafer-geometry';

/** Fail bins listed inline before the "+N more" popover (premium §5.7). */
export const INLINE_FAIL_BIN_ENTRIES = 4;

export interface StageLegendBin {
  /** `SBIN 7` / `HBIN 3`, never translated. */
  readonly code: number;
  readonly codeLabel: string;
  readonly name: string | null;
  readonly count: number;
  readonly isPass: boolean;
  /** Index into `bin-ink-N` (0 = dominant, ember). Unused for good bins. */
  readonly inkIndex: number;
}

export interface StageLegendModel {
  readonly failBins: readonly StageLegendBin[];
  readonly goodBins: readonly StageLegendBin[];
  readonly goodCount: number;
}

/** `bin-n-ink` slot for a yield-loss rank: rank 0 is ember, ranks 1+ cycle the 7 hues (premium §3.5). */
export function resolveBinInkIndex(rank: number): number {
  const safe = Math.max(0, Math.trunc(rank));
  return safe === 0 ? 0 : 1 + ((safe - 1) % 7);
}

/**
 * Bins-mode legend model for the active wafer (premium §5.7): fail bins by count (desc, then
 * code), and good bins grouped. A bin is good when most of its dies pass.
 */
export function buildStageLegendModel(
  lot: LotModel,
  waferIndex: number,
  colorMode: WaferColorMode,
): StageLegendModel {
  const wafer = lot.wafers[waferIndex];
  if ((colorMode !== 'hbin' && colorMode !== 'sbin') || !wafer) {
    return { failBins: [], goodBins: [], goodCount: 0 };
  }
  const isSbin = colorMode === 'sbin';
  const prefix = isSbin ? 'SBIN' : 'HBIN';
  const rankMap = buildFailBinRankMap(lot.dies, isSbin ? 'SBIN' : 'HBIN');
  const binArr = isSbin ? lot.dies.sbin : lot.dies.hbin;
  const counts = new Map<number, { count: number; passCount: number }>();
  for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
    if (lot.dies.hasValidCoords[i] === 0) {
      continue;
    }
    const code = binArr[i]!;
    const entry = counts.get(code) ?? { count: 0, passCount: 0 };
    entry.count += 1;
    if (lot.dies.finalPass[i] !== 0) {
      entry.passCount += 1;
    }
    counts.set(code, entry);
  }
  const failBins: StageLegendBin[] = [];
  const goodBins: StageLegendBin[] = [];
  let goodCount = 0;
  for (const [code, stats] of counts.entries()) {
    const meta = isSbin ? lot.sbins.get(code) : lot.hbins.get(code);
    const isPass = stats.passCount * 2 >= stats.count;
    const bin: StageLegendBin = {
      code,
      codeLabel: `${prefix} ${code}`,
      name: meta?.name ? meta.name : null,
      count: stats.count,
      isPass,
      inkIndex: resolveBinInkIndex(rankMap.get(code) ?? 0),
    };
    if (isPass) {
      goodBins.push(bin);
      goodCount += stats.count;
    } else {
      failBins.push(bin);
    }
  }
  const byCount = (a: StageLegendBin, b: StageLegendBin): number =>
    b.count !== a.count ? b.count - a.count : a.code - b.code;
  failBins.sort(byCount);
  goodBins.sort(byCount);
  return { failBins, goodBins, goodCount };
}

/**
 * Codes to toggle so a grouped entry ("Good") flips as one: when every code is hidden, show
 * them all; otherwise hide the visible ones.
 */
export function resolveGroupToggleCodes(
  hiddenBins: ReadonlySet<number>,
  codes: readonly number[],
): readonly number[] {
  const allHidden = codes.length > 0 && codes.every((c) => hiddenBins.has(c));
  return allHidden ? codes : codes.filter((c) => !hiddenBins.has(c));
}
