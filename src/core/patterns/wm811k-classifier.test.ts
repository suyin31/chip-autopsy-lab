import { describe, expect, it } from 'vitest';
import { createPrng } from '../demo/prng';
import { buildLotModel, computeWaferEdgeRingIndices } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import {
  type ParsedLotBuildInput,
  type ParsedPartExecution,
  PRR_PART_FLG,
  STDF_MISSING_COORD,
  STDF_MISSING_U1,
  STDF_MISSING_U2,
  STDF_V4_VERSION,
} from '../stdf/types';
import {
  formatPatternCandidateHypotheses,
  formatSiteConcentrationHypotheses,
  getPatternRootCauseHypotheses,
  getSiteConcentrationHypotheses,
} from './root-causes';
import {
  CLASSIFIER_THRESHOLDS,
  classifyStackedPattern,
  classifyWaferPattern,
  MIN_CLASS_CONFIDENCE,
  MIN_FAIL_COUNT,
  MIN_FAIL_FRACTION,
  STACK_CELL_MIN_FAIL_RATE,
  type StackedPatternCellInput,
  WM811K_CLASSES,
} from './wm811k-classifier';

function buildCircularTestLot(
  wafers: ReadonlyArray<
    ReadonlyArray<{ readonly x: number; readonly y: number; readonly failed: boolean }>
  >,
): LotModel {
  let prrIndex = 0;
  const parsedWafers = wafers.map((cells, wIdx) => {
    const waferId = `W${String(wIdx + 1).padStart(2, '0')}`;
    const parts: ParsedPartExecution[] = cells.map((c) => {
      const idx = prrIndex;
      prrIndex += 1;
      return {
        prrIndex: idx,
        byteOffset: 64 + idx * 16,
        headNum: 1,
        siteNum: 1,
        partFlg: c.failed ? PRR_PART_FLG.FAILED : 0,
        numTest: 0,
        hardBin: c.failed ? 4 : 1,
        softBin: c.failed ? 7 : 1,
        xCoord: c.x,
        yCoord: c.y,
        testT: 1,
        partId: `${idx}`,
        partTxt: '',
        ptrs: [],
        mprs: [],
        ftrs: [],
      };
    });

    return {
      waferIndex: wIdx,
      implicit: false,
      wir: { headNum: 1, siteGrp: STDF_MISSING_U1, startT: 1, waferId },
      wrr: {
        headNum: 1,
        siteGrp: STDF_MISSING_U1,
        finishT: 2,
        partCnt: parts.length,
        rtstCnt: STDF_MISSING_U2,
        abrtCnt: STDF_MISSING_U2,
        goodCnt: STDF_MISSING_U2,
        funcCnt: STDF_MISSING_U2,
        waferId,
        fabwfId: '',
        frameId: '',
        maskId: '',
        usrDesc: '',
        excDesc: '',
      },
      wcr: null,
      parts,
    };
  });

  const input: ParsedLotBuildInput = {
    parseMode: 'bins-only',
    endianness: 'little',
    stdfVersion: STDF_V4_VERSION,
    mir: null,
    mrr: null,
    pcrs: [],
    hbrs: [
      { headNum: 255, siteNum: 0, hbinNum: 1, hbinCnt: 0, hbinPf: 'P', hbinNam: 'PASS' },
      { headNum: 255, siteNum: 0, hbinNum: 4, hbinCnt: 0, hbinPf: 'F', hbinNam: 'FAIL' },
    ],
    sbrs: [],
    sdrs: [],
    tsrs: [],
    defaultWaferConfig: null,
    ptrDefaults: new Map(),
    wafers: parsedWafers,
    recordsDecoded: prrIndex + 4,
    validPrrCount: prrIndex,
    skippedRecordCount: 0,
    warnings: [],
  };

  return buildLotModel(input);
}

function makeDiscCoords(radius = 12.2): Array<{ readonly x: number; readonly y: number }> {
  const out: Array<{ readonly x: number; readonly y: number }> = [];
  const ceilR = Math.ceil(radius);
  for (let x = -ceilR; x <= ceilR; x += 1) {
    for (let y = -ceilR; y <= ceilR; y += 1) {
      if (Math.hypot(x, y) <= radius) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

describe('WM-811K spatial classifier & root-cause hypotheses', () => {
  it('exports locked design.md thresholds', () => {
    expect(MIN_FAIL_FRACTION).toBe(0.015);
    expect(MIN_FAIL_COUNT).toBe(5);
    expect(MIN_CLASS_CONFIDENCE).toBe(0.45);
    expect(STACK_CELL_MIN_FAIL_RATE).toBe(0.2);
    expect(CLASSIFIER_THRESHOLDS.CONFIDENCE_CAP).toBe(0.98);
  });

  it('enforces noise gate for zero fails, < MIN_FAIL_COUNT, < MIN_FAIL_FRACTION, and missing -32768 coords', () => {
    const disc = makeDiscCoords(12.2); // ~465 cells

    // 0 coordinate fails + 20 failing missing-coordinate parts -> still 'None' (1.00)
    const zeroSpatialFails = [
      ...disc.map((c) => ({ ...c, failed: false })),
      ...Array.from({ length: 20 }, () => ({
        x: STDF_MISSING_COORD,
        y: STDF_MISSING_COORD,
        failed: true,
      })),
    ];
    const resZero = classifyWaferPattern(buildCircularTestLot([zeroSpatialFails]), 0);
    expect(resZero.pattern).toBe('None');
    expect(resZero.confidence).toBe(1);
    expect(resZero.features.testedCellCount).toBe(disc.length);
    expect(resZero.features.activeFailCellCount).toBe(0);

    // 4 fails (< MIN_FAIL_COUNT = 5) -> 'None' (0.98)
    const fourFails = disc.map((c, idx) => ({ ...c, failed: idx < 4 }));
    const resFour = classifyWaferPattern(buildCircularTestLot([fourFails]), 0);
    expect(resFour.pattern).toBe('None');
    expect(resFour.confidence).toBe(0.98);

    // 6 fails on 465 cells (6/465 = 1.29% < 1.5% MIN_FAIL_FRACTION) -> 'None'
    const sixFails = disc.map((c, idx) => ({ ...c, failed: idx < 6 }));
    const resLowFrac = classifyWaferPattern(buildCircularTestLot([sixFails]), 0);
    expect(resLowFrac.pattern).toBe('None');
    expect(resLowFrac.confidence).toBeGreaterThanOrEqual(0.85);
    expect(resLowFrac.signatureDieIds).toEqual([]);
  });

  it('filters non-recurring single-wafer noise on multi-wafer stacks via STACK_CELL_MIN_FAIL_RATE', () => {
    const disc = makeDiscCoords(10.2);
    // 10 wafers: inner center (rho <= 3.2) fails on 6/10 wafers (failRate 0.60 >= 0.20),
    // while each wafer also has 15 non-overlapping single-wafer fails (failRate 0.10 < 0.20)
    const wafers = Array.from({ length: 10 }, (_, wIdx) =>
      disc.map((c, cIdx) => {
        const inCenter = Math.hypot(c.x, c.y) <= 3.2;
        const recurringCenterFail = inCenter && wIdx < 6;
        const nonRecurringNoise = !inCenter && cIdx % 10 === wIdx && cIdx < 150;
        return { x: c.x, y: c.y, failed: recurringCenterFail || nonRecurringNoise };
      }),
    );

    const lot = buildCircularTestLot(wafers);
    const stacked = classifyStackedPattern(lot);
    expect(stacked.pattern).toBe('Center');
    expect(stacked.confidence).toBeGreaterThanOrEqual(0.8);
    expect(stacked.signatureDieIds.length).toBeGreaterThan(0);
  });

  it('provides hedged, clinical engineering hypotheses with "Check next:" steps and zero horror tropes', () => {
    const forbiddenPattern =
      /\b(corpse|murder|zombie|ghost|vampire|haunted|graveyard|blood|skull|cobweb|pumpkin|spooky|monster|autopsy|cause of death|drop the body)\b/i;

    expect(getPatternRootCauseHypotheses('None')).toEqual([]);
    expect(formatPatternCandidateHypotheses('None')).toEqual([]);

    for (const cls of WM811K_CLASSES) {
      if (cls === 'None') continue;
      const items = getPatternRootCauseHypotheses(cls);
      expect(items.length).toBeGreaterThanOrEqual(2);

      for (const h of items) {
        expect(h.mechanism).toMatch(/^Candidate mechanism:/);
        expect(h.summary).toContain('Check next:');
        expect(h.summary).not.toMatch(forbiddenPattern);
      }
    }

    const donutHyps = getPatternRootCauseHypotheses('Donut');
    expect(
      donutHyps.some((h) => h.summary.includes('recirculation vortex')),
    ).toBe(false);
    expect(
      donutHyps.some((h) => h.summary.includes('showerhead flow non-uniformity')),
    ).toBe(true);

    const siteHyps = getSiteConcentrationHypotheses({ headNum: 1, siteNum: 2 });
    const siteFormatted = formatSiteConcentrationHypotheses({ headNum: 1, siteNum: 2 });
    expect(siteHyps.length).toBeGreaterThanOrEqual(2);
    expect(siteFormatted).toHaveLength(siteHyps.length);
    for (const h of siteHyps) {
      expect(h.domain).toBe('test-hardware');
      expect(h.summary).toContain('Head 1 Site 2 (1:2)');
      expect(h.summary).toContain('Check next:');
      expect(h.summary).not.toMatch(forbiddenPattern);
    }
  });

  it('rejects Random on mildly non-uniform maps (~7% random fails plus a weak edge bias, MAJOR-1)', () => {
    const disc = makeDiscCoords(14.2); // 633 cells
    const rings = computeWaferEdgeRingIndices(disc);

    // Case A: ~7% uniform random baseline fails + weak asymmetric peripheral edge bias
    const rngA = createPrng(0x2026_0701);
    const crescentBiased = disc.map((c, idx) => {
      const baselineRandom = rngA.nextBool(0.07);
      const weakEdgeBias =
        rings[idx]! <= 3 && c.x >= 2 && rngA.nextBool(0.26);
      return { x: c.x, y: c.y, failed: baselineRandom || weakEdgeBias };
    });
    const resA = classifyWaferPattern(buildCircularTestLot([crescentBiased]), 0);
    expect(resA.pattern).not.toBe('Random');

    // Case B: ~7% uniform random baseline fails + weak concentric outer-ring bias
    const rngB = createPrng(0x2026_0702);
    const ringBiased = disc.map((c, idx) => {
      const baselineRandom = rngB.nextBool(0.07);
      const weakOuterBias = rings[idx]! <= 3 && rngB.nextBool(0.2);
      return { x: c.x, y: c.y, failed: baselineRandom || weakOuterBias };
    });
    const resB = classifyWaferPattern(buildCircularTestLot([ringBiased]), 0);
    expect(resB.pattern).not.toBe('Random');
  });

  it('classifies hand-built adversarial maps accurately across all classes and D4 transforms (MINOR-1, MINOR-4, MINOR-6)', () => {
    const disc = makeDiscCoords(14.2); // 633 cells, symmetric about (0, 0)
    const rings = computeWaferEdgeRingIndices(disc);

    const hasPoint = (
      pts: ReadonlyArray<readonly [number, number]>,
      x: number,
      y: number,
    ): boolean => pts.some(([px, py]) => px === x && py === y);

    // 1. Clean Center blob + sparse point noise
    const centerMap = disc.map(({ x, y }) => {
      const r = Math.hypot(x, y);
      const inBlob = r <= 4.4 && (r <= 3.6 || (x + y) % 5 !== 0);
      const noise = hasPoint(
        [
          [-9, 4],
          [8, -7],
          [-3, 11],
          [10, 2],
        ],
        x,
        y,
      );
      return { x, y, failed: inBlob || noise };
    });

    // 2. Donut ring (mid-radius annulus) + sparse point noise
    const donutMap = disc.map(({ x, y }, idx) => {
      const r = Math.hypot(x, y);
      const inRing =
        r >= 6.1 &&
        r <= 9.6 &&
        rings[idx]! > 3 &&
        (((x * 3 + y * 5) & 1) === 0 || (x - y) % 3 === 0);
      const noise = hasPoint(
        [
          [0, 1],
          [-12, 0],
          [0, -13],
        ],
        x,
        y,
      );
      return { x, y, failed: inRing || noise };
    });

    // 3a. Off-center Loc cluster + sparse point noise
    const offCenterLocMap = disc.map(({ x, y }, idx) => {
      const inCluster = Math.hypot(x - 6, y + 4) <= 2.6 && rings[idx]! > 3;
      const noise = hasPoint(
        [
          [-8, 5],
          [-4, -9],
          [2, 10],
        ],
        x,
        y,
      );
      return { x, y, failed: inCluster || noise };
    });

    // 3b. Center-ward compact Loc cluster at rho ≈ 0.14 (MINOR-1: 3x5 block, not a Center disc)
    const centerWardLocMap = disc.map(({ x, y }) => {
      const inBlock = x >= 1 && x <= 3 && y >= -2 && y <= 2;
      const noise = hasPoint(
        [
          [-9, 6],
          [7, -9],
        ],
        x,
        y,
      );
      return { x, y, failed: inBlock || noise };
    });

    // 4. Edge-Loc peripheral arc + sparse interior noise
    const edgeLocMap = disc.map(({ x, y }, idx) => {
      const theta = Math.atan2(y, x);
      const angDiff = Math.abs(theta - 2.35);
      const inArc = rings[idx]! <= 3 && angDiff <= 0.38;
      const noise = hasPoint(
        [
          [2, -3],
          [-4, 1],
          [5, 4],
        ],
        x,
        y,
      );
      return { x, y, failed: inArc || noise };
    });

    // 5. Diagonal Scratch at a non-axis angle (32° from +X, neither 0°/45°/90°, with 1-die gap)
    const thetaScratch = (32 * Math.PI) / 180;
    const tx = Math.cos(thetaScratch);
    const ty = Math.sin(thetaScratch);
    const nx = -ty;
    const ny = tx;
    const diagonalScratchMap = disc.map(({ x, y }) => {
      const along = Math.abs(x * tx + y * ty);
      const perp = Math.abs(x * nx + y * ny - 1.3);
      const dropout = x === 1 && y === 2;
      const onChord = along <= 10.8 && perp <= 0.82 && !dropout;
      const noise = hasPoint(
        [
          [-8, 7],
          [7, -8],
          [-5, -9],
        ],
        x,
        y,
      );
      return { x, y, failed: onChord || noise };
    });

    // 6. Near-full wafer (~85.7% deterministic fail across all zones)
    const nearFullMap = disc.map(({ x, y }) => ({
      x,
      y,
      failed: Math.abs(x * 7 + y * 13) % 7 !== 0,
    }));

    // 7. Clean wafer ('None': 3 isolated point defects on 633 dies)
    const cleanWaferMap = disc.map(({ x, y }) => ({
      x,
      y,
      failed: hasPoint(
        [
          [0, 0],
          [-7, 5],
          [9, -4],
        ],
        x,
        y,
      ),
    }));

    // 8. Blended Edge-Ring + mild Center cluster -> dominant Edge-Ring wins
    const blendedEdgeRingCenterMap = disc.map(({ x, y }, idx) => {
      const strongEdgeRing =
        rings[idx]! <= 3 && ((x * 3 + y * 5) & 1) === 0;
      const mildCenter = Math.hypot(x, y) <= 2.4;
      return { x, y, failed: strongEdgeRing || mildCenter };
    });

    // 9. Short 5-cell collinear streak (< 6-cell Scratch floor) -> falls back to Loc, never Scratch
    const shortStreakDisc = makeDiscCoords(8.8);
    const shortStreakMap = shortStreakDisc.map(({ x, y }) => ({
      x,
      y,
      failed: y === 3 && x >= -2 && x <= 2,
    }));

    const adversarialCases = [
      { name: 'clean Center blob', cells: centerMap, expected: 'Center' },
      { name: 'Donut ring', cells: donutMap, expected: 'Donut' },
      { name: 'off-center Loc cluster', cells: offCenterLocMap, expected: 'Loc' },
      { name: 'center-ward Loc block', cells: centerWardLocMap, expected: 'Loc' },
      { name: 'Edge-Loc arc', cells: edgeLocMap, expected: 'Edge-Loc' },
      { name: 'diagonal non-axis Scratch', cells: diagonalScratchMap, expected: 'Scratch' },
      { name: 'Near-full wafer', cells: nearFullMap, expected: 'Near-full' },
      { name: 'clean wafer (None)', cells: cleanWaferMap, expected: 'None' },
      { name: 'blended Edge-Ring + mild Center', cells: blendedEdgeRingCenterMap, expected: 'Edge-Ring' },
      { name: 'short 5-cell streak (< 6 Scratch floor)', cells: shortStreakMap, expected: 'Loc' },
    ] as const;

    const d4Ops: ReadonlyArray<
      (x: number, y: number) => { readonly x: number; readonly y: number }
    > = [
      (x, y) => ({ x, y }),
      (x, y) => ({ x: -y, y: x }),
      (x, y) => ({ x: -x, y: -y }),
      (x, y) => ({ x: y, y: -x }),
      (x, y) => ({ x: -x, y }),
      (x, y) => ({ x, y: -y }),
      (x, y) => ({ x: y, y: x }),
      (x, y) => ({ x: -y, y: -x }),
    ];

    for (const tc of adversarialCases) {
      const lot = buildCircularTestLot([tc.cells]);
      const base = classifyWaferPattern(lot, 0);
      expect(base.pattern, tc.name).toBe(tc.expected);

      // MINOR-6: Verify single-wafer stacked delegation matches wafer-0 classification
      const explicitSingleWaferCells: StackedPatternCellInput[] = Array.from(
        { length: lot.dies.count },
        (_, dIdx) => ({
          x: lot.dies.x[dIdx]!,
          y: lot.dies.y[dIdx]!,
          testedWaferCount: 1,
          failCount: lot.dies.finalPass[dIdx] === 0 ? 1 : 0,
          failRate: lot.dies.finalPass[dIdx] === 0 ? 1 : 0,
          failingDieIndices:
            lot.dies.finalPass[dIdx] === 0
              ? Uint32Array.of(dIdx)
              : new Uint32Array(0),
        }),
      );
      expect(classifyStackedPattern(lot)).toEqual(base);
      expect(classifyStackedPattern(lot, explicitSingleWaferCells, 1)).toEqual(
        base,
      );

      // Verify exact D4 invariance across all 8 rotations and reflections
      for (const op of d4Ops) {
        const rotatedCells = tc.cells.map((c) => ({
          ...op(c.x, c.y),
          failed: c.failed,
        }));
        const rotRes = classifyWaferPattern(
          buildCircularTestLot([rotatedCells]),
          0,
        );
        expect(rotRes.pattern, `${tc.name} D4`).toBe(tc.expected);
        expect(rotRes.confidence).toBeCloseTo(base.confidence, 2);
      }
    }
  });
});
