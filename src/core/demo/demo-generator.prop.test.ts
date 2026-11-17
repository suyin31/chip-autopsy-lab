/**
 * Property 9: Synthetic Demo Lot Determinism and Ground-Truth Pattern Recovery (`fast-check`).
 *
 * Verifies (Sub-Tasks 4.1 & 4.4):
 * 1. Repeated calls to `generateDemoStdfBytes(presetId, seed)` with the same 32-bit
 *    seed yield byte-for-byte identical STDF V4 `Uint8Array` buffers.
 * 2. Parsing through `parseStdfBytes` and `buildLotModel` succeeds with zero warnings,
 *    recovering all 25 wafers x 633 circular-grid dies (`15,825` dies), 4 concurrent
 *    `2x2` prober Test Sites, HBIN/SBR definitions, 4 parametric `PTR` columns with
 *    base-unit limits, and multi-PRR retest executions.
 * 3. Every preset's embedded `DemoLotGroundTruth` matches the resolved `LotModel` and
 *    is recovered by `computeYieldSummary`, `detectSiteAnomalies`, `classifyStackedPattern`,
 *    and `classifyWaferPattern`:
 *    - `'Edge-Ring'` on `edge-ring-etch` stacked map and all 25 wafers (`confidence >= 0.75` on default seed)
 *    - `'Scratch'` on `handling-scratch` stacked map and affected wafers `W05–W22` (`confidence >= 0.75` on default seed), `'None'` on clean wafers `W01–W04, W23–W25`
 *    - `'Random'` spatially on `site2-probe-contact` alongside the `Head 1 / Site 2` (`1:2`) concentration anomaly (`confidence >= 0.75` on default seed)
 *
 * Validates: Requirements 3.1, 3.3, 7.4, 9.1
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeYieldSummary,
  detectSiteAnomalies,
} from '../analytics/yield-summary';
import { buildLotModel } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import { getSiteConcentrationHypotheses } from '../patterns/root-causes';
import {
  classifyStackedPattern,
  classifyWaferPattern,
} from '../patterns/wm811k-classifier';
import { parseStdfBytes } from '../stdf/stdf-parser';

type ParsedStdfStream = Extract<
  ReturnType<typeof parseStdfBytes>,
  { readonly ok: true }
>['value'];
import {
  computeSeededScratchChordGeometry,
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

// MINOR-8: Keep full Vitest suite fast (well under ~60 s budget; override via env in deep soak).
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

function parseAndBuildLot(bytes: Uint8Array): {
  readonly raw: ParsedStdfStream;
  readonly lot: LotModel;
} {
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
  return { raw: parsed.value, lot };
}

function assertGroundTruthAndYieldSignature(
  raw: ParsedStdfStream,
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

  // J-3: Verify HBR, SBR, WRR, and PCR counts reflect unique final-state dies (not inflated PRR executions)
  expect(raw.validPrrCount).toBe(lot.dies.count + truth.retestedDieIds.length);
  expect(raw.validPrrCount).toBeGreaterThan(lot.dies.count);

  const expectedHbinFinal = new Map<number, number>();
  const expectedSbinFinal = new Map<number, number>();
  for (let i = 0; i < lot.dies.count; i += 1) {
    const hb = lot.dies.hbin[i]!;
    const sb = lot.dies.sbin[i]!;
    expectedHbinFinal.set(hb, (expectedHbinFinal.get(hb) ?? 0) + 1);
    expectedSbinFinal.set(sb, (expectedSbinFinal.get(sb) ?? 0) + 1);
  }

  const hbrTotal = raw.hbrs.reduce((acc, h) => acc + h.hbinCnt, 0);
  const sbrTotal = raw.sbrs.reduce((acc, s) => acc + s.sbinCnt, 0);
  expect(hbrTotal).toBe(lot.dies.count);
  expect(sbrTotal).toBe(lot.dies.count);
  for (const hbr of raw.hbrs) {
    expect(hbr.hbinCnt).toBe(expectedHbinFinal.get(hbr.hbinNum) ?? 0);
  }
  for (const sbr of raw.sbrs) {
    expect(sbr.sbinCnt).toBe(expectedSbinFinal.get(sbr.sbinNum) ?? 0);
  }

  const summaryPcr = raw.pcrs.find((p) => p.headNum === 255);
  expect(summaryPcr).toBeDefined();
  expect(summaryPcr!.partCnt).toBe(lot.dies.count);
  expect(summaryPcr!.rtstCnt).toBe(truth.retestedDieIds.length);
  for (const wf of raw.wafers) {
    expect(wf.wrr?.partCnt).toBe(DEMO_DIES_PER_WAFER);
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

    // M-10: Verify final-passing dies remain strictly within parametric spec limits
    for (let i = 0; i < lot.dies.count; i += 47) {
      if (lot.dies.finalPass[i] === 1) {
        const v = col!.values[i]!;
        expect(v).toBeGreaterThanOrEqual(col!.loLimit!);
        expect(v).toBeLessThanOrEqual(col!.hiLimit!);
      }
    }
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
  const stackedClass = classifyStackedPattern(lot);

  expect(stackedClass.pattern).toBe(truth.expectedStackedPattern);
  expect(stackedClass.signatureDieIndices.length).toBeGreaterThan(0);
  expect(stackedClass.signatureDieIds).toHaveLength(
    stackedClass.signatureDieIndices.length,
  );
  expect(stackedClass.candidateHypotheses.length).toBeGreaterThan(0);
  if (isDefaultSeed) {
    expect(stackedClass.confidence).toBeGreaterThanOrEqual(0.75);
  }

  for (let w = 0; w < DEMO_WAFER_COUNT; w += 1) {
    const waferClass = classifyWaferPattern(lot, w);
    expect(waferClass.pattern).toBe(truth.expectedWaferPatterns[w]);
    if (waferClass.pattern !== 'None') {
      expect(waferClass.signatureDieIndices.length).toBeGreaterThan(0);
      expect(waferClass.signatureDieIds).toHaveLength(
        waferClass.signatureDieIndices.length,
      );
      expect(waferClass.candidateHypotheses.length).toBeGreaterThan(0);
      if (isDefaultSeed) {
        expect(waferClass.confidence).toBeGreaterThanOrEqual(0.75);
      }
    } else {
      expect(waferClass.signatureDieIds).toEqual([]);
      expect(waferClass.candidateHypotheses).toEqual([]);
    }
  }

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
    const siteHypotheses = getSiteConcentrationHypotheses(topAnomaly.site);
    expect(siteHypotheses.length).toBeGreaterThan(0);
    expect(siteHypotheses[0]!.summary).toContain('Head 1 Site 2');
    if (isDefaultSeed) {
      expect(topAnomaly.confidence).toBeGreaterThanOrEqual(0.75);
    }
  }
}

describe('Property 9: Demo Generator Determinism & Ground-Truth Recovery (fast-check)', () => {
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

      const { raw, lot: parsedLot } = parseAndBuildLot(lotA.stdfBytes);
      expect(parsedLot.wafers[0]!.geometry.posX).toBe('R');
      expect(parsedLot.wafers[0]!.geometry.posY).toBe('U');
      expect(parsedLot.wafers[0]!.geometry.wfFlat).toBe('D');
      expect(parsedLot.hbins.size).toBe(5);
      expect(parsedLot.sbins.size).toBe(5);
      assertGroundTruthAndYieldSignature(raw, parsedLot, lotA.groundTruth, true);
    },
  );

  it(
    'produces byte-for-byte identical STDF V4 streams and recovers yield/site ground truth across arbitrary seeds and presets',
    () => {
      const arbPresetAndSeed = fc.record({
        presetId: fc.constantFrom(...ALL_PRESET_IDS),
        seed: fc.integer(),
      });

      fc.assert(
        fc.property(arbPresetAndSeed, ({ presetId, seed }) => {
          const generatedA = generateDemoLot(presetId, seed);
          const bytesB = generateDemoStdfBytes(presetId, seed);

          expect(areBytesIdentical(generatedA.stdfBytes, bytesB)).toBe(true);

          const { raw, lot: parsedLot } = parseAndBuildLot(generatedA.stdfBytes);
          assertGroundTruthAndYieldSignature(raw, parsedLot, generatedA.groundTruth, false);
        }),
        { numRuns: DEMO_LOT_NUM_RUNS },
      );
    },
    20_000,
  );

  it('varies the handling-scratch chord angle across seeds while staying non-axis-aligned and recovering ground truth (MINOR-2)', () => {
    const distinctAngles = new Set<string>();
    for (const seed of [0x20261202, 0, 1, 2, 7, 42, -99]) {
      const geom = computeSeededScratchChordGeometry(seed);
      const absDeg = Math.abs(geom.angleDeg);
      // Strictly non-axis-aligned (away from 0° and 90°) and non-45°
      expect(absDeg).toBeGreaterThanOrEqual(22);
      expect(absDeg).toBeLessThanOrEqual(68);
      expect(Math.abs(absDeg - 45)).toBeGreaterThanOrEqual(7);
      distinctAngles.add(geom.angleDeg.toFixed(2));
    }
    expect(distinctAngles.size).toBeGreaterThanOrEqual(6);

    // Explicit regression check for seed=2 alongside a contrasting seed
    for (const seed of [2, 42]) {
      const generated = generateDemoLot('handling-scratch', seed);
      const { raw, lot } = parseAndBuildLot(generated.stdfBytes);
      assertGroundTruthAndYieldSignature(raw, lot, generated.groundTruth, false);
    }
  });
});
