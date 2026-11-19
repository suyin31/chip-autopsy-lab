import { describe, expect, it } from 'vitest';
import { computeBinPareto } from '../analytics/bin-pareto';
import {
  computeLotParametricSummaries,
  computeParametricHistogram,
} from '../analytics/parametric-stats';
import { computeYieldSummary } from '../analytics/yield-summary';
import { generateDemoStdfBytes } from '../demo/demo-generator';
import { buildLotModel } from '../model/lot-builder';
import type { LotModel, ParametricTestColumn, WaferSummaryMeta } from '../model/types';
import { parseStdfBytes } from '../stdf/stdf-parser';
import { evaluateSelection, type SpatialBrushRect } from './selection-predicates';

/**
 * Builds a synthetic 25-wafer x 10,000-die (250,000 dies) columnar `LotModel`
 * with two parametric test columns to validate the Requirement 15.5 100 ms brush budget.
 */
function buildLarge250kLot(): LotModel {
  const waferCount = 25;
  const side = 100; // 100 x 100 = 10,000 dies per wafer
  const diesPerWafer = side * side;
  const totalDies = waferCount * diesPerWafer;

  const waferIndex = new Uint16Array(totalDies);
  const siteIndex = new Uint8Array(totalDies);
  const firstSiteIndex = new Uint8Array(totalDies);
  const x = new Int16Array(totalDies);
  const y = new Int16Array(totalDies);
  const hasValidCoords = new Uint8Array(totalDies).fill(1);
  const ringIndex = new Uint16Array(totalDies);
  const firstPass = new Uint8Array(totalDies);
  const finalPass = new Uint8Array(totalDies);
  const hbin = new Uint16Array(totalDies);
  const sbin = new Uint16Array(totalDies);
  const retestCount = new Uint16Array(totalDies);
  const firstPrrOrder = new Uint32Array(totalDies);
  for (let i = 0; i < totalDies; i += 1) {
    firstPrrOrder[i] = i;
  }

  const t1Values = new Float32Array(totalDies);
  const t2Values = new Float32Array(totalDies);
  const wafers: WaferSummaryMeta[] = [];

  for (let w = 0; w < waferCount; w += 1) {
    const start = w * diesPerWafer;
    const end = start + diesPerWafer;
    wafers.push({
      waferIndex: w,
      waferId: `W${String(w + 1).padStart(2, '0')}`,
      dieStartIndex: start,
      dieEndIndex: end,
      minX: 0,
      maxX: side - 1,
      minY: 0,
      maxY: side - 1,
      maxRingIndex: 50,
      geometry: { wfFlat: 'D', posX: 'R', posY: 'U' },
    });

    for (let dy = 0; dy < side; dy += 1) {
      for (let dx = 0; dx < side; dx += 1) {
        const idx = start + dy * side + dx;
        waferIndex[idx] = w;
        const site = (dx + dy) & 3;
        siteIndex[idx] = site;
        firstSiteIndex[idx] = site;
        x[idx] = dx;
        y[idx] = dy;
        const edgeDist = Math.min(dx, side - 1 - dx, dy, side - 1 - dy);
        ringIndex[idx] = edgeDist + 1;

        const isEdgeFail = edgeDist < 3 && (idx % 3 !== 0);
        firstPass[idx] = isEdgeFail ? 0 : 1;
        finalPass[idx] = isEdgeFail ? 0 : 1;
        hbin[idx] = isEdgeFail ? 4 : 1;
        sbin[idx] = isEdgeFail ? 7 : 1;
        t1Values[idx] = isEdgeFail ? 18e-6 : 5e-6 + ((idx % 17) * 0.2e-6);
        t2Values[idx] = 1.0 + ((idx % 11) - 5) * 0.01;
      }
    }
  }

  const tests = new Map<number, ParametricTestColumn>([
    [
      1001,
      {
        testNum: 1001,
        testName: 'IDDQ_LEAK',
        units: 'A',
        resScal: 6,
        llmScal: 6,
        hlmScal: 6,
        loLimit: 0.2e-6,
        hiLimit: 15e-6,
        values: t1Values,
      },
    ],
    [
      1002,
      {
        testNum: 1002,
        testName: 'VDD_MIN',
        units: 'V',
        resScal: 3,
        llmScal: 3,
        hlmScal: 3,
        loLimit: 0.9,
        hiLimit: 1.1,
        values: t2Values,
      },
    ],
  ]);

  return {
    lotId: 'PERF-250K',
    partTyp: 'DUT-250K',
    jobNam: 'SORT1',
    parseMode: 'full',
    endianness: 'little',
    wafers,
    sites: [
      { siteIndex: 0, headNum: 1, siteNum: 1, label: '1:1' },
      { siteIndex: 1, headNum: 1, siteNum: 2, label: '1:2' },
      { siteIndex: 2, headNum: 1, siteNum: 3, label: '1:3' },
      { siteIndex: 3, headNum: 1, siteNum: 4, label: '1:4' },
    ],
    hbins: new Map([
      [1, { mode: 'HBIN', code: 1, name: 'PASS', passFail: 'P' }],
      [4, { mode: 'HBIN', code: 4, name: 'LEAKAGE', passFail: 'F' }],
    ]),
    sbins: new Map([
      [1, { mode: 'SBIN', code: 1, name: 'GOOD', passFail: 'P' }],
      [7, { mode: 'SBIN', code: 7, name: 'IDDQ_EDGE_LEAK', passFail: 'F' }],
    ]),
    dies: {
      count: totalDies,
      waferIndex,
      siteIndex,
      firstSiteIndex,
      x,
      y,
      hasValidCoords,
      ringIndex,
      firstPass,
      finalPass,
      hbin,
      sbin,
      retestCount,
      firstPrrOrder,
    },
    dieIds: [],
    dieIndexById: new Map(),
    waferCoordIndex: [],
    tests,
    warnings: [],
  };
}

describe('selection-predicates unit tests and 250k-die brush latency budget (Req 11, 15.5)', () => {
  it('intersects single-wafer or stacked brush with bin and site filters deterministically', () => {
    const bytes = generateDemoStdfBytes('edge-ring-etch');
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const lot = buildLotModel(parsed.value);

    const w0 = lot.wafers[0]!;
    const brush: SpatialBrushRect = {
      scope: 'wafer',
      waferIndex: 0,
      minX: w0.maxX - 3, // reversed bounds also normalized cleanly
      maxX: w0.minX + 3,
      minY: w0.minY,
      maxY: w0.maxY,
    };

    const brushOnly = evaluateSelection(lot, brush, null);
    expect(brushOnly.selectedDieCount).toBeGreaterThan(0);
    expect(brushOnly.selectedDieCount).toBeLessThan(w0.dieEndIndex - w0.dieStartIndex);

    const brushAndBin = evaluateSelection(lot, brush, null, {
      bin: { mode: 'SBIN', code: 7 },
    });
    expect(brushAndBin.selectedDieCount).toBeLessThanOrEqual(
      brushOnly.selectedDieCount,
    );
    for (let i = 0; i < lot.dies.count; i += 1) {
      if (brushAndBin.dieMask[i] === 1) {
        expect(brushOnly.dieMask[i]).toBe(1);
        expect(lot.dies.sbin[i]).toBe(7);
        expect(lot.dies.waferIndex[i]).toBe(0);
      }
    }

    const stackedBrush: SpatialBrushRect = {
      scope: 'stacked',
      minX: w0.minX,
      maxX: w0.minX + 4,
      minY: w0.minY,
      maxY: w0.maxY,
    };
    const stackedRes = evaluateSelection(lot, stackedBrush, null);
    expect(stackedRes.selectedDieCount).toBeGreaterThan(brushOnly.selectedDieCount);
  });

  it('recomputes brush selection + Bin Pareto + Yield Summary + Parametric stats & histogram in <= 100 ms for 25 x 10,000 dies (Req 15.5)', () => {
    const lot = buildLarge250kLot();
    expect(lot.dies.count).toBe(250_000);

    const singleWaferBrush: SpatialBrushRect = {
      scope: 'wafer',
      waferIndex: 0,
      minX: 0,
      maxX: 35,
      minY: 10,
      maxY: 60,
    };
    const stackedBrush: SpatialBrushRect = {
      scope: 'stacked',
      minX: 0,
      maxX: 35,
      minY: 10,
      maxY: 60,
    };

    // Warm up JIT once
    const warm = evaluateSelection(lot, stackedBrush, null);
    computeBinPareto(lot, 'SBIN', warm.dieMask);
    computeYieldSummary(lot, warm.dieMask);
    computeLotParametricSummaries(lot, warm.dieMask);
    computeParametricHistogram(lot.tests.get(1001)!, warm.dieMask);

    for (const brush of [singleWaferBrush, stackedBrush]) {
      const t0 = performance.now();
      const sel = evaluateSelection(lot, brush, null);
      const pareto = computeBinPareto(lot, 'SBIN', sel.dieMask);
      const yieldSum = computeYieldSummary(lot, sel.dieMask);
      const paramSummaries = computeLotParametricSummaries(lot, sel.dieMask);
      const hist = computeParametricHistogram(lot.tests.get(1001)!, sel.dieMask);
      const elapsedMs = performance.now() - t0;

      expect(sel.selectedDieCount).toBeGreaterThan(0);
      expect(pareto.testedCount).toBe(sel.selectedDieCount);
      expect(yieldSum.overall.testedDies).toBe(sel.selectedDieCount);
      expect(paramSummaries[0]!.n).toBe(sel.selectedDieCount);
      expect(hist.n).toBe(sel.selectedDieCount);
      expect(elapsedMs).toBeLessThan(100);
    }
  });
});
