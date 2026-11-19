import { describe, expect, it } from 'vitest';
import { generateDemoStdfBytes } from '../demo/demo-generator';
import { buildLotModel } from '../model/lot-builder';
import { packWaferCoord } from '../model/types';
import { parseStdfBytes } from '../stdf/stdf-parser';
import { writeStdfBytes } from '../stdf/stdf-writer';
import { PRR_PART_FLG, STDF_MISSING_COORD } from '../stdf/types';
import {
  computeStackedHeatmap,
  computeStackedHeatmapSummary,
} from './stacked-heatmap';

function makeHandcraftedLot() {
  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'STACK-UNIT', partTyp: 'CAL-TEST', jobNam: 'SORT' },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1], cardId: 'CARD-1' }],
    hbrs: [
      { hbinNum: 1, hbinCnt: 4, hbinPf: 'P', hbinNam: 'PASS' },
      { hbinNum: 2, hbinCnt: 2, hbinPf: 'F', hbinNam: 'FAIL_A' },
      { hbinNum: 3, hbinCnt: 2, hbinPf: 'F', hbinNam: 'FAIL_B' },
    ],
    sbrs: [
      { sbinNum: 1, sbinCnt: 4, sbinPf: 'P', sbinNam: 'GOOD' },
      { sbinNum: 7, sbinCnt: 2, sbinPf: 'F', sbinNam: 'LEAK' },
      { sbinNum: 9, sbinCnt: 2, sbinPf: 'F', sbinNam: 'OPEN' },
    ],
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
        touchdowns: [
          [
            // (0,0) fails with SBIN 9 / HBIN 3
            { headNum: 1, siteNum: 1, partFlg: PRR_PART_FLG.FAILED, hardBin: 3, softBin: 9, xCoord: 0, yCoord: 0 },
            // (1,0) fails first, then passes on retest (must count as pass in final state)
            { headNum: 1, siteNum: 1, partFlg: PRR_PART_FLG.FAILED, hardBin: 2, softBin: 7, xCoord: 1, yCoord: 0 },
            // missing coordinate die (must be excluded)
            { headNum: 1, siteNum: 1, partFlg: PRR_PART_FLG.FAILED, hardBin: 2, softBin: 7, xCoord: STDF_MISSING_COORD, yCoord: STDF_MISSING_COORD },
          ],
          [
            { headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 1, yCoord: 0 },
          ],
        ],
        wrr: { headNum: 1, siteGrp: 1, finishT: 1_700_000_010, partCnt: 4, waferId: 'W01' },
      },
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_100, waferId: 'W02' },
        touchdowns: [
          [
            // (0,0) fails with SBIN 7 / HBIN 2 -> tie between (7,9) and (2,3) -> lowest code wins (7, 2)
            { headNum: 1, siteNum: 1, partFlg: PRR_PART_FLG.FAILED, hardBin: 2, softBin: 7, xCoord: 0, yCoord: 0 },
            // (1,0) passes
            { headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 1, yCoord: 0 },
            // (2,0) tested only on W02 and fails with omitted soft bin
            { headNum: 1, siteNum: 1, partFlg: PRR_PART_FLG.FAILED, hardBin: 3, omitOptionalAfterCoords: false, xCoord: 2, yCoord: 0 },
          ],
        ],
        wrr: { headNum: 1, siteGrp: 1, finishT: 1_700_000_110, partCnt: 3, waferId: 'W02' },
      },
    ],
    mrr: { finishT: 1_700_000_200, dispCod: '0' },
  });
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

describe('computeStackedHeatmap', () => {
  it('aggregates per-(x,y) final failures, ignores missing coords, resolves retests, and breaks bin ties by lowest code', () => {
    const lot = makeHandcraftedLot();
    const cells = computeStackedHeatmap(lot);

    expect(cells).toHaveLength(3);

    const byKey = new Map(cells.map((c) => [packWaferCoord(c.x, c.y), c]));

    const c00 = byKey.get(packWaferCoord(0, 0))!;
    expect(c00.testedWaferCount).toBe(2);
    expect(c00.failCount).toBe(2);
    expect(c00.failRate).toBe(1);
    expect(c00.dominantSbin).toBe(7); // tie 7 vs 9 -> 7 wins
    expect(c00.dominantHbin).toBe(2); // tie 2 vs 3 -> 2 wins
    expect(c00.failingDieIndices).toHaveLength(2);

    const c10 = byKey.get(packWaferCoord(1, 0))!;
    expect(c10.testedWaferCount).toBe(2);
    expect(c10.failCount).toBe(0); // W01 recovered on retest
    expect(c10.failRate).toBe(0);
    expect(c10.dominantSbin).toBeNull();
    expect(c10.dominantHbin).toBeNull();
    expect(c10.failingDieIndices).toHaveLength(0);

    const c20 = byKey.get(packWaferCoord(2, 0))!;
    expect(c20.testedWaferCount).toBe(1);
    expect(c20.failCount).toBe(1);
    expect(c20.failRate).toBe(1);
    expect(c20.dominantSbin).toBeNull(); // softBin omitted -> STDF_MISSING_U2 ignored
    expect(c20.dominantHbin).toBe(3);
  });

  it('filters cleanly by waferSubset and returns empty for an empty subset', () => {
    const lot = makeHandcraftedLot();
    expect(computeStackedHeatmap(lot, new Set())).toEqual([]);

    const w0Only = computeStackedHeatmap(lot, new Set([0]));
    expect(w0Only).toHaveLength(2);
    const c00 = w0Only.find((c) => c.x === 0 && c.y === 0)!;
    expect(c00.testedWaferCount).toBe(1);
    expect(c00.failCount).toBe(1);
    expect(c00.dominantSbin).toBe(9);
    expect(c00.dominantHbin).toBe(3);
  });

  it('computes summary metadata and matches demo lot edge-ring-etch totals', () => {
    const bytes = generateDemoStdfBytes('edge-ring-etch');
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const lot = buildLotModel(parsed.value);

    const cells = computeStackedHeatmap(lot);
    const summary = computeStackedHeatmapSummary(cells, lot.wafers.length);

    expect(cells).toHaveLength(633);
    expect(summary.waferCount).toBe(25);
    expect(summary.maxFailRate).toBeGreaterThan(0.5);
    expect(summary.peakCell).not.toBeNull();
    expect(summary.peakCell!.failCount).toBeGreaterThan(12);
    expect(summary.peakCell!.testedWaferCount).toBe(25);
    expect(summary.cellByCoord.get(packWaferCoord(summary.peakCell!.x, summary.peakCell!.y))).toBe(
      summary.peakCell,
    );
    expect(summary.minX).toBeLessThan(summary.maxX);
    expect(summary.minY).toBeLessThan(summary.maxY);
  });
});
