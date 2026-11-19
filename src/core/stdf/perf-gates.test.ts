/**
 * Task 20 Vitest Performance Gates — Core Parse Throughput & 250k-Die Brush Budget
 * (`src/core/stdf/perf-gates.test.ts`).
 *
 * Pure Node/Core benchmarks (zero DOM/UI imports, Requirement 17.7):
 * - Parse throughput (`MB/s`) on all 3 bundled demo STDF V4 lots (Requirement 15.1).
 *   Target on Apple M1 Chrome: `>= 15 MB/s`; generous CI floor: `>= 5 MB/s` so a
 *   2-core CI box passes reliably while catching genuine O(n^2) regressions.
 * - Cross-chart brush recompute latency (`evaluateSelection` + `computeBinPareto` +
 *   `computeYieldSummary` + `computeParametricCapability` + `computeParametricHistogram`)
 *   on a synthetic 25-wafer x 10,000-die (`250,000`-die) columnar lot (Requirement 15.5).
 *
 * Validates: Requirements 15.1, 15.5, 17.7
 */

import { describe, expect, it } from 'vitest';
import {
  computeBinPareto,
  computeParametricCapability,
  computeParametricHistogram,
  computeYieldSummary,
} from '../analytics';
import { type DemoPresetId, generateDemoStdfBytes } from '../demo';
import {
  type BinDefinition,
  buildLotModel,
  type LotModel,
  type ParametricTestColumn,
  type TestSiteMeta,
  type WaferSummaryMeta,
} from '../model';
import { evaluateSelection } from '../query';
import { parseStdfBytes } from './stdf-parser';

const DEMO_PRESETS: readonly DemoPresetId[] = [
  'edge-ring-etch',
  'handling-scratch',
  'site2-probe-contact',
];

const BYTES_PER_MIB = 1024 * 1024;
/** Generous 2-core CI threshold (Req 15.1 M1 Chrome target is >= 15 MB/s). */
const CI_MIN_PARSE_THROUGHPUT_MBPS = 5;
/** Generous 2-core CI threshold for 250k-die brush + linked analytics (Req 15.5 target <= 100 ms). */
const CI_MAX_BRUSH_250K_MS = 250;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Builds a synthetic 25-wafer x 10,000-die (`250,000`-die) columnar `LotModel`
 * directly in typed arrays so Requirement 15.5 brush recompute latency can be
 * benchmarked deterministically in Vitest without paying multi-second STDF
 * serialization setup cost.
 */
function buildSynthetic250kLot(): LotModel {
  const waferCount = 25;
  const diesPerWafer = 10_000;
  const totalDies = waferCount * diesPerWafer;

  const waferIndex = new Uint16Array(totalDies);
  const x = new Int16Array(totalDies);
  const y = new Int16Array(totalDies);
  const hasValidCoords = new Uint8Array(totalDies);
  const firstSiteIndex = new Uint8Array(totalDies);
  const siteIndex = new Uint8Array(totalDies);
  const firstPass = new Uint8Array(totalDies);
  const finalPass = new Uint8Array(totalDies);
  const hbin = new Uint16Array(totalDies);
  const sbin = new Uint16Array(totalDies);
  const retestCount = new Uint16Array(totalDies);
  const ringIndex = new Uint16Array(totalDies);
  const firstPrrOrder = new Uint32Array(totalDies);
  const paramValues = new Float32Array(totalDies);

  const wafers: WaferSummaryMeta[] = [];
  const waferCoordIndex: ReadonlyMap<number, number>[] = [];

  for (let w = 0; w < waferCount; w += 1) {
    const start = w * diesPerWafer;
    const end = start + diesPerWafer;
    wafers.push({
      waferIndex: w,
      waferId: `W${String(w + 1).padStart(2, '0')}`,
      dieStartIndex: start,
      dieEndIndex: end,
      minX: -50,
      maxX: 49,
      minY: -50,
      maxY: 49,
      maxRingIndex: 50,
      geometry: {
        wfSize: 300,
        wfUnits: 2,
        wfFlat: 'D',
        posX: 'R',
        posY: 'U',
      },
    });
    waferCoordIndex.push(new Map());

    for (let i = 0; i < diesPerWafer; i += 1) {
      const idx = start + i;
      const gx = (i % 100) - 50;
      const gy = Math.floor(i / 100) - 50;
      const edgeDist = Math.min(gx + 50, 49 - gx, gy + 50, 49 - gy) + 1;
      const isFail = edgeDist <= 3 || (idx & 31) === 0;
      const site = ((gx & 1) << 1) | (gy & 1);

      waferIndex[idx] = w;
      x[idx] = gx;
      y[idx] = gy;
      hasValidCoords[idx] = 1;
      firstSiteIndex[idx] = site;
      siteIndex[idx] = site;
      firstPass[idx] = isFail ? 0 : 1;
      finalPass[idx] = isFail ? 0 : 1;
      hbin[idx] = isFail ? (edgeDist <= 3 ? 4 : 2) : 1;
      sbin[idx] = isFail ? (edgeDist <= 3 ? 7 : 5) : 1;
      retestCount[idx] = 0;
      ringIndex[idx] = edgeDist;
      firstPrrOrder[idx] = idx;
      paramValues[idx] = isFail ? 18.5 + (i % 7) * 0.4 : 4.2 + (i % 11) * 0.2;
    }
  }

  const sites: TestSiteMeta[] = [0, 1, 2, 3].map((s) => ({
    siteIndex: s,
    headNum: 1,
    siteNum: s + 1,
    label: `1:${s + 1}`,
  }));

  const hbins = new Map<number, BinDefinition>([
    [1, { code: 1, name: 'PASS', passFail: 'P' }],
    [2, { code: 2, name: 'CONT', passFail: 'F' }],
    [4, { code: 4, name: 'LEAK', passFail: 'F' }],
  ]);

  const sbins = new Map<number, BinDefinition>([
    [1, { code: 1, name: 'GOOD', passFail: 'P' }],
    [5, { code: 5, name: 'CONT_OPEN', passFail: 'F' }],
    [7, { code: 7, name: 'IDDQ_EDGE_LEAK', passFail: 'F' }],
  ]);

  const testCol: ParametricTestColumn = {
    testNum: 204,
    testName: 'IDDQ_LEAK',
    units: 'A',
    resScal: 6,
    llmScal: 6,
    hlmScal: 6,
    loLimit: 0,
    hiLimit: 15,
    values: paramValues,
  };

  return {
    lotId: 'CAL-PERF-250K',
    partTyp: 'CAL-BENCH',
    jobNam: 'SORT',
    parseMode: 'full',
    endianness: 'little',
    wafers,
    sites,
    hbins,
    sbins,
    dies: {
      count: totalDies,
      waferIndex,
      x,
      y,
      hasValidCoords,
      firstSiteIndex,
      siteIndex,
      firstPass,
      finalPass,
      hbin,
      sbin,
      retestCount,
      ringIndex,
      firstPrrOrder,
    },
    dieIds: [],
    dieIndexById: new Map(),
    waferCoordIndex,
    tests: new Map([[204, testCol]]),
    warnings: [],
  };
}

describe('Task 20 Vitest performance gates (Requirements 15.1, 15.5)', () => {
  it('measures STDF V4 parse throughput (MB/s) across all 3 bundled demo lots above CI threshold', () => {
    const metrics: Array<{
      readonly presetId: DemoPresetId;
      readonly sizeMiB: number;
      readonly parseMedianMs: number;
      readonly parseMbps: number;
      readonly parseAndModelMedianMs: number;
      readonly parseAndModelMbps: number;
      readonly diesResolved: number;
    }> = [];

    for (const presetId of DEMO_PRESETS) {
      const bytes = generateDemoStdfBytes(presetId);
      const sizeMiB = bytes.byteLength / BYTES_PER_MIB;

      // Untimed JIT warm-up
      const warm = parseStdfBytes(bytes, { mode: 'full' });
      expect(warm.ok).toBe(true);
      if (!warm.ok) continue;
      const warmLot = buildLotModel(warm.value);
      expect(warmLot.dies.count).toBe(15_825);

      const parseDurationsMs: number[] = [];
      const fullDurationsMs: number[] = [];

      for (let run = 0; run < 3; run += 1) {
        const t0 = performance.now();
        const parsed = parseStdfBytes(bytes, { mode: 'full' });
        const t1 = performance.now();
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) continue;
        const lot = buildLotModel(parsed.value);
        const t2 = performance.now();

        expect(lot.dies.count).toBe(15_825);
        parseDurationsMs.push(t1 - t0);
        fullDurationsMs.push(t2 - t0);
      }

      const parseMedianMs = median(parseDurationsMs);
      const parseAndModelMedianMs = median(fullDurationsMs);
      const parseMbps = sizeMiB / (parseMedianMs / 1000);
      const parseAndModelMbps = sizeMiB / (parseAndModelMedianMs / 1000);

      metrics.push({
        presetId,
        sizeMiB: Number(sizeMiB.toFixed(3)),
        parseMedianMs: Number(parseMedianMs.toFixed(2)),
        parseMbps: Number(parseMbps.toFixed(1)),
        parseAndModelMedianMs: Number(parseAndModelMedianMs.toFixed(2)),
        parseAndModelMbps: Number(parseAndModelMbps.toFixed(1)),
        diesResolved: warmLot.dies.count,
      });

      expect(parseMbps).toBeGreaterThanOrEqual(CI_MIN_PARSE_THROUGHPUT_MBPS);
      expect(parseAndModelMbps).toBeGreaterThanOrEqual(
        CI_MIN_PARSE_THROUGHPUT_MBPS * 0.5,
      );
    }

    console.info('[PERF_T20_PARSE]', JSON.stringify(metrics));
  });

  it('recomputes linked brush analytics (selection, Pareto, yield, capability, histogram) on 25x10,000 dies within budget', () => {
    const lot = buildSynthetic250kLot();
    expect(lot.dies.count).toBe(250_000);

    const brush = {
      scope: 'stacked' as const,
      minX: -25,
      maxX: 25,
      minY: -25,
      maxY: 25,
    };

    // Warm-up
    const warmSel = evaluateSelection(lot, brush, null);
    expect(warmSel.selectedDieCount).toBeGreaterThan(0);
    expect(warmSel.selectedDieCount).toBeLessThan(lot.dies.count);

    const runsMs: number[] = [];
    let selectedCount = 0;

    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      const sel = evaluateSelection(lot, brush, null);
      const pareto = computeBinPareto(lot, 'SBIN', sel.dieMask);
      const yieldSummary = computeYieldSummary(lot, sel.dieMask);
      const testCol = lot.tests.get(204)!;
      const cap = computeParametricCapability(testCol, sel.dieMask);
      const hist = computeParametricHistogram(testCol, sel.dieMask, {
        binCount: 24,
      });
      const elapsed = performance.now() - t0;

      expect(pareto.testedCount).toBe(sel.selectedDieCount);
      expect(yieldSummary.overall.testedDies).toBe(sel.selectedDieCount);
      expect(cap.n).toBe(sel.selectedDieCount);
      expect(hist.n).toBe(sel.selectedDieCount);
      selectedCount = sel.selectedDieCount;
      runsMs.push(elapsed);
    }

    const medianMs = Number(median(runsMs).toFixed(2));
    const maxMs = Number(Math.max(...runsMs).toFixed(2));
    console.info(
      '[PERF_T20_BRUSH_250K]',
      JSON.stringify({
        totalDies: lot.dies.count,
        selectedDies: selectedCount,
        medianMs,
        maxMs,
      }),
    );

    expect(medianMs).toBeLessThanOrEqual(CI_MAX_BRUSH_250K_MS);
  });
});
