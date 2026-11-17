/**
 * Property 9 (Determinism & Parse/Yield Ground-Truth Half — Sub-Task 4.1 / 4.4):
 * Synthetic Demo Lot Determinism and Ground-Truth Recovery (`fast-check`).
 *
 * Verifies now (Task 4.1):
 * 1. Repeated calls to `generateDemoStdfBytes(presetId, seed)` with the same 32-bit
 *    seed yield byte-for-byte identical STDF V4 `Uint8Array` buffers.
 * 2. Parsing through `parseStdfBytes` and `buildLotModel` succeeds with zero warnings,
 *    recovering all 25 wafers x 633 circular-grid dies (`15,825` dies), 4 concurrent
 *    `2x2` prober Test Sites, HBIN/SBR definitions, 4 parametric `PTR` columns with
 *    base-unit limits, and multi-PRR retest executions.
 * 3. Every preset's embedded `DemoLotGroundTruth` (`injectedFinalFailDieIds`,
 *    `injectedFirstPassFailDieIds`, `retestedDieIds`, `recoveredRetestDieIds`,
 *    `dominantFailSbin`, `dominantFailHbin`, `primaryInjectedTestNum`, and
 *    `injectedAnomalousSite`) matches the resolved `LotModel` and is directly visible
 *    in `computeYieldSummary` and `detectSiteAnomalies` (including the `Test Site 1:2`
 *    first-pass yield drop, retest recovery, and z-test anomaly with `confidence >= 0.75`
 *    on `site2-probe-contact`).
 *
 * TODO(Task 4.4 / after Task 6 implements `src/core/patterns/wm811k-classifier.ts`):
 * Complete the spatial-classifier half of Property 9 by asserting that
 * `classifyStackedPattern` and `classifyWaferPattern` recover:
 * - `'Edge-Ring'` on `edge-ring-etch` (`confidence >= 0.75` on default seed)
 * - `'Scratch'` on `handling-scratch` stacked map and `W05–W22` (`confidence >= 0.75` on default seed)
 * - `'Random'` spatially on `site2-probe-contact` alongside the `Test Site 1:2` anomaly
 *
 * Validates: Requirements 3.1, 3.3, 7.4
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeYieldSummary,
  detectSiteAnomalies,
} from '../analytics/yield-summary';
import { buildLotModel } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import { parseStdfBytes } from '../stdf/stdf-parser';
import {
  DEMO_DIES_PER_WAFER,
  DEMO_PARAMETRIC_SPECS,
  DEMO_WAFER_COUNT,
  type DemoLotGroundTruth,
  type DemoPresetId,
  generateDemoLot,
  generateDemoStdfBytes,
  listDemoPresets,
} from './demo-generator';
import { createPrng, mulberry32 } from './prng';

const PRNG_NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);
const DEMO_LOT_NUM_RUNS = Number(process.env.FC_DEMO_NUM_RUNS ?? 15);

const ALL_PRESET_IDS: readonly DemoPresetId[] = [
  'edge-ring-etch',
  'handling-scratch',
  'site2-probe-contact',
];

function areBytesIdentical(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function parseAndBuildLot(bytes: Uint8Array): LotModel {
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error(
      `Expected demo STDF parse success, got ${parsed.error.code}: ${parsed.error.message}`,
    );
  }
  expect(parsed.value.warnings).toEqual([]);
  expect(parsed.value.sdrs).toHaveLength(1);
  expect(parsed.value.pcrs).toHaveLength(5);
  expect(parsed.value.tsrs).toHaveLength(DEMO_PARAMETRIC_SPECS.length);
  const lot = buildLotModel(parsed.value);
  expect(lot.warnings).toEqual([]);
  return lot;
}

function assertGroundTruthAndYieldSignature(
  lot: LotModel,
  truth: DemoLotGroundTruth,
  isDefaultSeed: boolean,
): void {
  expect(lot.lotId).toBe(truth.lotId);
  expect(lot.wafers).toHaveLength(DEMO_WAFER_COUNT);
  expect(lot.dies.count).toBe(DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER);
  expect(lot.sites.map((s) => s.label)).toEqual(['1:1', '1:2', '1:3', '1:4']);
  expect(lot.tests.size).toBe(DEMO_PARAMETRIC_SPECS.length);

  for (let w = 0; w < DEMO_WAFER_COUNT; w += 1) {
    const wf = lot.wafers[w]!;
    expect(wf.dieEndIndex - wf.dieStartIndex).toBe(DEMO_DIES_PER_WAFER);
  }

  // Verify parametric test metadata & base-unit limits round-tripped via compact PTR inheritance
  for (const expectedTest of DEMO_PARAMETRIC_SPECS) {
    const col = lot.tests.get(expectedTest.testNum);
    expect(col).toBeDefined();
    expect(col!.testName).toBe(expectedTest.testTxt);
    expect(col!.units).toBe(expectedTest.units);
    expect(col!.resScal).toBe(expectedTest.resScal);
    expect(col!.loLimit).toBeCloseTo(expectedTest.loLimit, 6);
    expect(col!.hiLimit).toBeCloseTo(expectedTest.hiLimit, 6);
  }

  // Verify ground-truth Die IDs align 1-to-1 with resolved LotModel columnar arrays
  const primaryCol = lot.tests.get(truth.primaryInjectedTestNum)!;
  expect(truth.injectedFinalFailDieIds.length).toBeGreaterThan(100);
  expect(truth.retestedDieIds.length).toBeGreaterThan(0);

  for (const dieId of truth.injectedFinalFailDieIds) {
    const idx = lot.dieIndexById.get(dieId);
    expect(idx).toBeDefined();
    expect(lot.dies.finalPass[idx!]).toBe(0);
    expect(lot.dies.sbin[idx!]).toBe(truth.dominantFailSbin);
    expect(lot.dies.hbin[idx!]).toBe(truth.dominantFailHbin);
    const val = primaryCol.values[idx!]!;
    expect(Number.isFinite(val)).toBe(true);
    expect(val).toBeGreaterThan(primaryCol.hiLimit!);
  }

  for (const dieId of truth.injectedFirstPassFailDieIds) {
    const idx = lot.dieIndexById.get(dieId);
    expect(idx).toBeDefined();
    expect(lot.dies.firstPass[idx!]).toBe(0);
  }

  for (const dieId of truth.retestedDieIds) {
    const idx = lot.dieIndexById.get(dieId);
    expect(idx).toBeDefined();
    expect(lot.dies.retestCount[idx!]).toBe(1);
  }

  for (const dieId of truth.recoveredRetestDieIds) {
    const idx = lot.dieIndexById.get(dieId);
    expect(idx).toBeDefined();
    expect(lot.dies.firstPass[idx!]).toBe(0);
    expect(lot.dies.finalPass[idx!]).toBe(1);
    expect(lot.dies.retestCount[idx!]).toBe(1);
  }

  // Verify dominant failing SBIN/HBIN across the entire lot matches ground truth
  const sbinFailTally = new Map<number, number>();
  for (let i = 0; i < lot.dies.count; i += 1) {
    if (lot.dies.finalPass[i] === 0) {
      const sb = lot.dies.sbin[i]!;
      sbinFailTally.set(sb, (sbinFailTally.get(sb) ?? 0) + 1);
    }
  }
  let topSbin = -1;
  let topSbinCount = -1;
  for (const [sb, cnt] of sbinFailTally.entries()) {
    if (cnt > topSbinCount) {
      topSbin = sb;
      topSbinCount = cnt;
    }
  }
  expect(topSbin).toBe(truth.dominantFailSbin);

  // Verify preset-specific signature in `computeYieldSummary` and `detectSiteAnomalies`
  const summary = computeYieldSummary(lot);
  expect(summary.overall.retestExecutions).toBe(truth.retestedDieIds.length);
  expect(summary.overall.finalYield!).toBeGreaterThanOrEqual(
    summary.overall.firstPassYield!,
  );

  const anomalies = detectSiteAnomalies(lot);

  if (truth.presetId === 'edge-ring-etch') {
    const edgeMask = new Uint8Array(lot.dies.count);
    const interiorMask = new Uint8Array(lot.dies.count);
    for (let i = 0; i < lot.dies.count; i += 1) {
      if (lot.dies.ringIndex[i]! <= 3) {
        edgeMask[i] = 1;
      } else {
        interiorMask[i] = 1;
      }
    }
    const edgeYield = computeYieldSummary(lot, edgeMask).overall.finalYield!;
    const interiorYield = computeYieldSummary(lot, interiorMask).overall.finalYield!;

    expect(interiorYield - edgeYield).toBeGreaterThan(0.35);
    expect(anomalies).toEqual([]);
  } else if (truth.presetId === 'handling-scratch') {
    let scratchedYieldSum = 0;
    let cleanYieldSum = 0;
    for (let w = 0; w < DEMO_WAFER_COUNT; w += 1) {
      const wy = summary.byWafer[w]!.finalYield!;
      if (w >= 4 && w <= 21) {
        scratchedYieldSum += wy;
      } else {
        cleanYieldSum += wy;
      }
    }
    const meanScratchedYield = scratchedYieldSum / 18;
    const meanCleanYield = cleanYieldSum / 7;

    expect(meanCleanYield).toBeGreaterThan(0.97);
    expect(meanCleanYield - meanScratchedYield).toBeGreaterThan(0.04);
    expect(anomalies).toEqual([]);
  } else {
    // 'site2-probe-contact': Site 1:2 (index 1) first-pass yield drop + retest recovery
    const site2Metrics = summary.bySite[1]!;
    const otherSiteAvgFirstPass =
      (summary.bySite[0]!.firstPassYield! +
        summary.bySite[2]!.firstPassYield! +
        summary.bySite[3]!.firstPassYield!) /
      3;

    expect(otherSiteAvgFirstPass - site2Metrics.firstPassYield!).toBeGreaterThan(0.3);
    expect(site2Metrics.finalYield!).toBeGreaterThan(site2Metrics.firstPassYield! + 0.03);

    expect(anomalies).toHaveLength(1);
    const topAnomaly = anomalies[0]!;
    expect(topAnomaly.site.headNum).toBe(1);
    expect(topAnomaly.site.siteNum).toBe(2);
    expect(topAnomaly.site.label).toBe('1:2');
    expect(topAnomaly.yieldDeltaPp).toBeLessThan(-5.0);
    expect(topAnomaly.twoProportionZ).toBeGreaterThanOrEqual(3.0);
    expect(topAnomaly.excessFailShare).toBeGreaterThanOrEqual(0.5);
    if (isDefaultSeed) {
      expect(topAnomaly.confidence).toBeGreaterThanOrEqual(0.75);
    }
  }
}

describe('Property 9 (Determinism & Parse/Yield Half): Demo Generator (fast-check)', () => {
  it('enforces Mulberry32 PRNG determinism across arbitrary 32-bit seeds', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rawA = mulberry32(seed);
        const rawB = mulberry32(seed);
        const prngA = createPrng(seed);
        const prngB = createPrng(seed);

        for (let i = 0; i < 16; i += 1) {
          const uA = rawA();
          const uB = rawB();
          expect(uA).toBe(uB);
          expect(prngA.next()).toBe(uA);
          expect(prngB.next()).toBe(uB);
        }

        for (let i = 0; i < 8; i += 1) {
          const nA = prngA.nextNormal();
          const nB = prngB.nextNormal();
          expect(nA).toBe(nB);
          expect(Number.isFinite(nA)).toBe(true);
        }
      }),
      { numRuns: PRNG_NUM_RUNS },
    );
  });

  it.each(listDemoPresets())(
    'produces byte-identical 25-wafer x 633-die STDF V4 output and recovers ground truth for default preset $id',
    (preset) => {
      const lotA = generateDemoLot(preset.id);
      const bytesB = generateDemoStdfBytes(preset.id, preset.defaultSeed);
      const bytesOtherSeed = generateDemoStdfBytes(preset.id, preset.defaultSeed + 1);

      expect(areBytesIdentical(lotA.stdfBytes, bytesB)).toBe(true);
      expect(areBytesIdentical(lotA.stdfBytes, bytesOtherSeed)).toBe(false);

      const parsedLot = parseAndBuildLot(lotA.stdfBytes);
      expect(parsedLot.wafers[0]!.geometry.posX).toBe('R');
      expect(parsedLot.wafers[0]!.geometry.posY).toBe('U');
      expect(parsedLot.wafers[0]!.geometry.wfFlat).toBe('D');
      expect(parsedLot.hbins.size).toBe(5);
      expect(parsedLot.sbins.size).toBe(5);
      assertGroundTruthAndYieldSignature(parsedLot, lotA.groundTruth, true);
    },
  );

  it('produces byte-for-byte identical STDF V4 streams and recovers yield/site ground truth across arbitrary seeds and presets', () => {
    const arbPresetAndSeed = fc.record({
      presetId: fc.constantFrom(...ALL_PRESET_IDS),
      seed: fc.integer(),
    });

    fc.assert(
      fc.property(arbPresetAndSeed, ({ presetId, seed }) => {
        const generatedA = generateDemoLot(presetId, seed);
        const bytesB = generateDemoStdfBytes(presetId, seed);

        expect(areBytesIdentical(generatedA.stdfBytes, bytesB)).toBe(true);

        const parsedLot = parseAndBuildLot(generatedA.stdfBytes);
        assertGroundTruthAndYieldSignature(parsedLot, generatedA.groundTruth, false);
      }),
      { numRuns: DEMO_LOT_NUM_RUNS },
    );
  });
});
