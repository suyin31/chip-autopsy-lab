/**
 * Property 8: WM-811K Classifier Determinism and 90-Degree Rotation / Mirror Robustness
 * (`src/core/patterns/wm811k-classifier.prop.test.ts`).
 *
 * Verifies with `fast-check`:
 * 1. Repeated calls to `classifyWaferPattern` and `classifyStackedPattern` on arbitrary
 *    `LotModel` instances return identical WM-811K labels, confidence scores in `[0, 1]`,
 *    per-class scores, feature vectors, and supporting Die ID sets.
 * 2. Rotating any wafer grid with an integer or half-integer center by 0°, 90°, 180°, or
 *    270° or reflecting across X, Y, or diagonal axes (all 8 elements of D4) preserves
 *    the predicted top class and confidence within `±0.05` across all radially symmetric
 *    classes (`Edge-Ring`, `Center`, `Donut`, `Random`, `Near-full`, `None`) as well as
 *    directional classes (`Scratch`, `Edge-Loc`, `Loc`).
 *
 * Validates: Requirements 9.1, 9.2, 9.4
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbLotModel } from '../__test-utils__/arbitraries';
import { createPrng } from '../demo/prng';
import { buildLotModel, computeWaferEdgeRingIndices } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import {
  type ParsedLotBuildInput,
  type ParsedPartExecution,
  PRR_PART_FLG,
  STDF_MISSING_U1,
  STDF_MISSING_U2,
  STDF_V4_VERSION,
} from '../stdf/types';
import {
  classifyStackedPattern,
  classifyWaferPattern,
  WM811K_CLASSES,
  type Wm811kClass,
} from './wm811k-classifier';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);
const D4_NUM_RUNS = Number(process.env.FC_D4_NUM_RUNS ?? 80);

interface GridCell {
  readonly x: number;
  readonly y: number;
  readonly failed: boolean;
}

type D4TransformName =
  | 'id'
  | 'rot90'
  | 'rot180'
  | 'rot270'
  | 'mirrorX'
  | 'mirrorY'
  | 'mirrorDiagMain'
  | 'mirrorDiagAnti';

const ALL_D4_TRANSFORMS: readonly D4TransformName[] = [
  'id',
  'rot90',
  'rot180',
  'rot270',
  'mirrorX',
  'mirrorY',
  'mirrorDiagMain',
  'mirrorDiagAnti',
] as const;

function applyD4Point(
  x: number,
  y: number,
  cx: number,
  cy: number,
  op: D4TransformName,
): { readonly x: number; readonly y: number } {
  const dx = x - cx;
  const dy = y - cy;
  switch (op) {
    case 'id':
      return { x: Math.round(cx + dx), y: Math.round(cy + dy) };
    case 'rot90':
      return { x: Math.round(cx - dy), y: Math.round(cy + dx) };
    case 'rot180':
      return { x: Math.round(cx - dx), y: Math.round(cy - dy) };
    case 'rot270':
      return { x: Math.round(cx + dy), y: Math.round(cy - dx) };
    case 'mirrorX':
      return { x: Math.round(cx - dx), y: Math.round(cy + dy) };
    case 'mirrorY':
      return { x: Math.round(cx + dx), y: Math.round(cy - dy) };
    case 'mirrorDiagMain':
      return { x: Math.round(cx + dy), y: Math.round(cy + dx) };
    case 'mirrorDiagAnti':
      return { x: Math.round(cx - dy), y: Math.round(cy - dx) };
  }
}

function buildSingleWaferLotFromGrid(cells: readonly GridCell[]): LotModel {
  const parts: ParsedPartExecution[] = cells.map((cell, idx) => ({
    prrIndex: idx,
    byteOffset: 64 + idx * 16,
    headNum: 1,
    siteNum: 1,
    partFlg: cell.failed ? PRR_PART_FLG.FAILED : 0,
    numTest: 0,
    hardBin: cell.failed ? 4 : 1,
    softBin: cell.failed ? 7 : 1,
    xCoord: cell.x,
    yCoord: cell.y,
    testT: 1,
    partId: `${idx}`,
    partTxt: '',
    ptrs: [],
    mprs: [],
    ftrs: [],
  }));

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
    sbrs: [
      { headNum: 255, siteNum: 0, sbinNum: 1, sbinCnt: 0, sbinPf: 'P', sbinNam: 'GOOD' },
      { headNum: 255, siteNum: 0, sbinNum: 7, sbinCnt: 0, sbinPf: 'F', sbinNam: 'DEFECT' },
    ],
    sdrs: [],
    tsrs: [],
    defaultWaferConfig: null,
    ptrDefaults: new Map(),
    wafers: [
      {
        waferIndex: 0,
        implicit: false,
        wir: { headNum: 1, siteGrp: STDF_MISSING_U1, startT: 1, waferId: 'W01' },
        wrr: {
          headNum: 1,
          siteGrp: STDF_MISSING_U1,
          finishT: 2,
          partCnt: parts.length,
          rtstCnt: STDF_MISSING_U2,
          abrtCnt: STDF_MISSING_U2,
          goodCnt: STDF_MISSING_U2,
          funcCnt: STDF_MISSING_U2,
          waferId: 'W01',
          fabwfId: '',
          frameId: '',
          maskId: '',
          usrDesc: '',
          excDesc: '',
        },
        wcr: null,
        parts,
      },
    ],
    recordsDecoded: parts.length + 4,
    validPrrCount: parts.length,
    skippedRecordCount: 0,
    warnings: [],
  };

  return buildLotModel(input);
}

function generateArchetypeWaferGrid(params: {
  readonly archetype: Wm811kClass;
  readonly halfIntegerCenter: boolean;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly radius: number;
  readonly seed: number;
}): {
  readonly cx: number;
  readonly cy: number;
  readonly cells: readonly GridCell[];
} {
  const { archetype, halfIntegerCenter, offsetX, offsetY, radius, seed } = params;
  const rng = createPrng(seed);
  const cx = halfIntegerCenter ? offsetX + 0.5 : offsetX;
  const cy = halfIntegerCenter ? offsetY + 0.5 : offsetY;
  const maxCoordRadius = halfIntegerCenter ? radius + 0.35 : radius + 0.25;
  const minI = Math.floor(cx - maxCoordRadius) - 1;
  const maxI = Math.ceil(cx + maxCoordRadius) + 1;
  const minJ = Math.floor(cy - maxCoordRadius) - 1;
  const maxJ = Math.ceil(cy + maxCoordRadius) + 1;

  const coords: Array<{ readonly x: number; readonly y: number }> = [];
  for (let x = minI; x <= maxI; x += 1) {
    for (let y = minJ; y <= maxJ; y += 1) {
      if (Math.hypot(x - cx, y - cy) <= maxCoordRadius) {
        coords.push({ x, y });
      }
    }
  }

  const rings = computeWaferEdgeRingIndices(coords);
  let rMax = 1;
  for (const c of coords) {
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d > rMax) rMax = d;
  }

  const angleOffset = rng.next() * Math.PI * 2;
  const cells: GridCell[] = new Array<GridCell>(coords.length);

  for (let i = 0; i < coords.length; i += 1) {
    const { x, y } = coords[i]!;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const rho = dist / rMax;
    const ring = rings[i]!;
    let failed = false;

    switch (archetype) {
      case 'None': {
        failed = rng.nextBool(0.005);
        break;
      }
      case 'Near-full': {
        failed = rng.nextBool(0.86);
        break;
      }
      case 'Edge-Ring': {
        failed = ring <= 3 ? rng.nextBool(0.58) : rng.nextBool(0.012);
        break;
      }
      case 'Center': {
        failed = rho <= 0.34 ? rng.nextBool(0.76) : rng.nextBool(0.01);
        break;
      }
      case 'Donut': {
        failed =
          rho > 0.42 && rho <= 0.7 && ring > 3
            ? rng.nextBool(0.68)
            : rng.nextBool(0.01);
        break;
      }
      case 'Random': {
        // Spatially uniform 2x2 sublattice + mild Bernoulli noise avoids clumped clusters
        const onSubgrid = ((x & 1) === 0 && (y & 1) === 0) || rng.nextBool(0.03);
        failed = onSubgrid && rng.nextBool(0.42);
        break;
      }
      case 'Edge-Loc': {
        const ux = Math.cos(angleOffset);
        const uy = Math.sin(angleOffset);
        const cosSim = dist > 1e-6 ? (dx * ux + dy * uy) / dist : -1;
        failed =
          ring <= 3 && cosSim >= 0.88 ? rng.nextBool(0.88) : rng.nextBool(0.006);
        break;
      }
      case 'Loc': {
        const blobDist = 0.46 * rMax;
        const bx = cx + blobDist * Math.cos(angleOffset);
        const by = cy + blobDist * Math.sin(angleOffset);
        const inBlob = Math.hypot(x - bx, y - by) <= 2.9 && ring >= 3;
        failed = inBlob ? rng.nextBool(0.9) : rng.nextBool(0.005);
        break;
      }
      case 'Scratch': {
        const nx = -Math.sin(angleOffset);
        const ny = Math.cos(angleOffset);
        const tx = Math.cos(angleOffset);
        const ty = Math.sin(angleOffset);
        const perp = Math.abs(dx * nx + dy * ny - 1.2);
        const along = Math.abs(dx * tx + dy * ty);
        const onLine = perp <= 0.85 && along <= 0.72 * rMax && ring >= 2;
        failed = onLine ? rng.nextBool(0.92) : rng.nextBool(0.005);
        break;
      }
    }

    cells[i] = { x, y, failed };
  }

  return { cx, cy, cells };
}

describe('Property 8: WM-811K Classifier Determinism & D4 Symmetry Robustness (fast-check)', () => {
  it('returns deterministic class labels, [0, 1] confidences, and valid signature Die IDs across arbitrary LotModels', () => {
    fc.assert(
      fc.property(arbLotModel, (lot) => {
        const stackedA = classifyStackedPattern(lot);
        const stackedB = classifyStackedPattern(lot);

        expect(WM811K_CLASSES).toContain(stackedA.pattern);
        expect(stackedA.confidence).toBeGreaterThanOrEqual(0);
        expect(stackedA.confidence).toBeLessThanOrEqual(1);
        expect(stackedA).toEqual(stackedB);

        for (let w = 0; w < lot.wafers.length; w += 1) {
          const resA = classifyWaferPattern(lot, w);
          const resB = classifyWaferPattern(lot, w);

          expect(WM811K_CLASSES).toContain(resA.pattern);
          expect(resA.confidence).toBeGreaterThanOrEqual(0);
          expect(resA.confidence).toBeLessThanOrEqual(1);
          expect(Math.round(resA.confidence * 100)).toBeCloseTo(
            resA.confidence * 100,
            9,
          );
          expect(resA).toEqual(resB);

          if (resA.pattern === 'None') {
            expect(resA.signatureDieIndices).toHaveLength(0);
            expect(resA.signatureDieIds).toEqual([]);
            expect(resA.candidateHypotheses).toEqual([]);
          } else {
            expect(resA.signatureDieIndices.length).toBeGreaterThan(0);
            expect(resA.signatureDieIds).toHaveLength(resA.signatureDieIndices.length);
            expect(resA.candidateHypotheses.length).toBeGreaterThan(0);

            for (let k = 0; k < resA.signatureDieIndices.length; k += 1) {
              const dieIdx = resA.signatureDieIndices[k]!;
              expect(dieIdx).toBeGreaterThanOrEqual(0);
              expect(dieIdx).toBeLessThan(lot.dies.count);
              expect(lot.dies.finalPass[dieIdx]).toBe(0);
              expect(lot.dies.hasValidCoords[dieIdx]).toBe(1);
              expect(resA.signatureDieIds[k]).toBe(lot.dieIds[dieIdx]);
              if (k > 0) {
                expect(dieIdx).toBeGreaterThan(resA.signatureDieIndices[k - 1]!);
              }
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves predicted top class, confidence (within ±0.05), and mapped signature dies across all 8 D4 rotations and reflections', () => {
    const arbSymmetricScenario = fc.record({
      archetype: fc.constantFrom<Wm811kClass>(
        'Edge-Ring',
        'Center',
        'Donut',
        'Random',
        'Near-full',
        'None',
        'Scratch',
        'Edge-Loc',
        'Loc',
      ),
      halfIntegerCenter: fc.boolean(),
      offsetX: fc.integer({ min: -20, max: 20 }),
      offsetY: fc.integer({ min: -20, max: 20 }),
      radius: fc.integer({ min: 13, max: 16 }),
      seed: fc.integer(),
    });

    fc.assert(
      fc.property(arbSymmetricScenario, (scenario) => {
        const { cx, cy, cells } = generateArchetypeWaferGrid(scenario);
        const baseLot = buildSingleWaferLotFromGrid(cells);
        const baseClass = classifyWaferPattern(baseLot, 0);

        expect(baseClass.pattern).toBe(scenario.archetype);

        for (const op of ALL_D4_TRANSFORMS) {
          // Reverse input order on odd transforms to also verify order-independence
          const mappedCells = cells.map((cell) => {
            const pt = applyD4Point(cell.x, cell.y, cx, cy, op);
            return { x: pt.x, y: pt.y, failed: cell.failed };
          });
          if (op === 'rot90' || op === 'mirrorX' || op === 'mirrorDiagAnti') {
            mappedCells.reverse();
          }

          const transformedLot = buildSingleWaferLotFromGrid(mappedCells);
          const transformedClass = classifyWaferPattern(transformedLot, 0);

          expect(transformedClass.pattern).toBe(baseClass.pattern);
          expect(
            Math.abs(transformedClass.confidence - baseClass.confidence),
          ).toBeLessThanOrEqual(0.05);

          // Verify signature Die IDs transform equivariantly under D4
          const expectedMappedSigIds = baseClass.signatureDieIndices
            .reduce<string[]>((acc, dieIdx) => {
              const pt = applyD4Point(
                baseLot.dies.x[dieIdx]!,
                baseLot.dies.y[dieIdx]!,
                cx,
                cy,
                op,
              );
              acc.push(`W01:${pt.x},${pt.y}`);
              return acc;
            }, [])
            .sort();

          const actualSigIds = [...transformedClass.signatureDieIds].sort();
          expect(actualSigIds).toEqual(expectedMappedSigIds);
        }
      }),
      { numRuns: D4_NUM_RUNS },
    );
  });
});
