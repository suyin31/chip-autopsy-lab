/**
 * Deterministic synthetic STDF V4 demo lot generator (`src/core/demo/demo-generator.ts`).
 *
 * Generates three storied 25-wafer x 633-die semiconductor sort lots (`15,825` dies/lot)
 * serialized strictly through `writeStdfBytes` (`src/core/stdf/stdf-writer.ts`):
 * - `edge-ring-etch`: RIE plasma focus-ring erosion -> outer 3-ring `IDDQ_LEAK` (`SBIN 7`, `Edge-Ring`)
 * - `handling-scratch`: Robotic transfer-blade chord across `W05–W22` -> `VCCA_SHORT` (`SBIN 9`, `Scratch`)
 * - `site2-probe-contact`: Oxidized `HEAD 1 / SITE 2` probe needles on `2x2` touchdowns -> `VDD_CONT_R`
 *   first-pass drop + overdrive retest recovery (`SBIN 5`, spatial `Random` + `Test Site 1:2` anomaly)
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 3.1, 3.3, 7.1, 7.4, 9.1, 17.7
 */

import { computeWaferEdgeRingIndices } from '../model/lot-builder';
import type { DieId } from '../model/types';
import { writeStdfBytes } from '../stdf/stdf-writer';
import {
  PRR_PART_FLG,
  PTR_TEST_FLG,
  type StdfWriteHbrSpec,
  type StdfWriteLotSpec,
  type StdfWritePartSpec,
  type StdfWritePcrSpec,
  type StdfWritePtrSpec,
  type StdfWriteSbrSpec,
  type StdfWriteTouchdownSpec,
  type StdfWriteTsrSpec,
  type StdfWriteWaferSpec,
} from '../stdf/types';
import { createPrng, mixSeed, normalizeSeed, type SeededPrng } from './prng';

export type DemoPresetId =
  | 'edge-ring-etch'
  | 'handling-scratch'
  | 'site2-probe-contact';

export type DemoSpatialPatternTruth = 'Edge-Ring' | 'Scratch' | 'Random' | 'None';

export interface DemoPresetMeta {
  readonly id: DemoPresetId;
  readonly title: string;
  readonly subtitle: string;
  readonly defaultSeed: number;
  readonly waferCount: number;
  readonly expectedVerdictKind: 'Edge-Ring' | 'Scratch' | 'Site-Anomaly';
}

export interface DemoLotGroundTruth {
  readonly presetId: DemoPresetId;
  readonly seed: number;
  readonly lotId: string;
  readonly waferCount: number;
  readonly diesPerWafer: number;
  readonly totalDies: number;
  /** Expected WM-811K class on the 25-wafer stacked failure heatmap. */
  readonly expectedStackedPattern: 'Edge-Ring' | 'Scratch' | 'Random';
  /** Expected WM-811K class per wafer (`0 .. waferCount - 1`). */
  readonly expectedWaferPatterns: readonly DemoSpatialPatternTruth[];
  /** Wafer indices (`0 .. waferCount - 1`) carrying the injected failure mechanism. */
  readonly injectedWaferIndices: readonly number[];
  /** Injected faulty Test Site (`1:2` for `site2-probe-contact`, `null` when sites are balanced). */
  readonly injectedAnomalousSite: {
    readonly headNum: number;
    readonly siteNum: number;
  } | null;
  /** Primary parametric `TEST_NUM` shifted by the injected failure mode. */
  readonly primaryInjectedTestNum: number;
  /** All parametric `TEST_NUM`s shifted by the injected failure mode. */
  readonly injectedTestNums: readonly number[];
  /** Dominant failing SBIN and HBIN codes produced by the injected mechanism. */
  readonly dominantFailSbin: number;
  readonly dominantFailHbin: number;
  /** Canonical `DieId`s (`<waferId>:<x>,<y>`) failing in final state from the injected mechanism. */
  readonly injectedFinalFailDieIds: readonly DieId[];
  /** Canonical `DieId`s failing on chronologically first PRR from the injected mechanism. */
  readonly injectedFirstPassFailDieIds: readonly DieId[];
  /** Canonical `DieId`s that executed a retest (`2nd PRR`) touchdown. */
  readonly retestedDieIds: readonly DieId[];
  /** Canonical `DieId`s that failed first pass and recovered to pass on retest. */
  readonly recoveredRetestDieIds: readonly DieId[];
}

export interface GeneratedDemoLot {
  readonly preset: DemoPresetMeta;
  readonly seed: number;
  readonly stdfBytes: Uint8Array;
  readonly lotSpec: StdfWriteLotSpec;
  readonly groundTruth: DemoLotGroundTruth;
}

export const DEMO_WAFER_COUNT = 25 as const;
export const DEMO_WAFER_RADIUS = 14.2 as const;
export const DEMO_DIES_PER_WAFER = 633 as const;
export const DEMO_HEAD_NUM = 1 as const;
export const DEMO_SITE_NUMS = [1, 2, 3, 4] as const;

const BASE_SETUP_TIMESTAMP = 1_731_800_000;

export const DEMO_TEST_NUMS = {
  VDD_CONT_R: 101,
  IDDQ_LEAK: 204,
  VCCA_SHORT: 302,
  VTH_CORE: 410,
} as const;

interface DemoParametricSpec {
  readonly testNum: number;
  readonly testTxt: string;
  readonly units: string;
  readonly resScal: number;
  readonly llmScal: number;
  readonly hlmScal: number;
  readonly loLimit: number;
  readonly hiLimit: number;
}

export const DEMO_PARAMETRIC_SPECS: readonly DemoParametricSpec[] = [
  {
    testNum: DEMO_TEST_NUMS.VDD_CONT_R,
    testTxt: 'VDD_CONT_R',
    units: 'Ohm',
    resScal: 0,
    llmScal: 0,
    hlmScal: 0,
    loLimit: 0.1,
    hiLimit: 2.5,
  },
  {
    testNum: DEMO_TEST_NUMS.IDDQ_LEAK,
    testTxt: 'IDDQ_LEAK',
    units: 'A',
    resScal: 6,
    llmScal: 6,
    hlmScal: 6,
    loLimit: 0.2e-6,
    hiLimit: 15.0e-6,
  },
  {
    testNum: DEMO_TEST_NUMS.VCCA_SHORT,
    testTxt: 'VCCA_SHORT',
    units: 'A',
    resScal: 3,
    llmScal: 3,
    hlmScal: 3,
    loLimit: 4.0e-3,
    hiLimit: 25.0e-3,
  },
  {
    testNum: DEMO_TEST_NUMS.VTH_CORE,
    testTxt: 'VTH_CORE',
    units: 'V',
    resScal: 3,
    llmScal: 3,
    hlmScal: 3,
    loLimit: 0.31,
    hiLimit: 0.45,
  },
] as const;

const HBIN_CATALOG: ReadonlyArray<{
  readonly code: number;
  readonly pf: 'P' | 'F';
  readonly name: string;
}> = [
  { code: 1, pf: 'P', name: 'PASS_BIN' },
  { code: 2, pf: 'F', name: 'CONT_BIN' },
  { code: 3, pf: 'F', name: 'SHORT_BIN' },
  { code: 4, pf: 'F', name: 'LEAK_BIN' },
  { code: 5, pf: 'F', name: 'PARAM_BIN' },
];

const SBIN_CATALOG: ReadonlyArray<{
  readonly code: number;
  readonly pf: 'P' | 'F';
  readonly name: string;
}> = [
  { code: 1, pf: 'P', name: 'GOOD_DIE' },
  { code: 5, pf: 'F', name: 'CONT_OPEN' },
  { code: 7, pf: 'F', name: 'IDDQ_EDGE_LEAK' },
  { code: 9, pf: 'F', name: 'VDD_METAL_SHORT' },
  { code: 11, pf: 'F', name: 'VTH_DRIFT' },
];

const DEMO_PRESETS: readonly DemoPresetMeta[] = [
  {
    id: 'edge-ring-etch',
    title: 'Edge-Ring Plasma Etch Lot',
    subtitle: '25 wafers · RIE focus-ring erosion driving outer-ring IDDQ leakage (SBIN 7)',
    defaultSeed: 0x20261201,
    waferCount: DEMO_WAFER_COUNT,
    expectedVerdictKind: 'Edge-Ring',
  },
  {
    id: 'handling-scratch',
    title: 'Robotic Handling Scratch Lot',
    subtitle: '25 wafers · Transfer-blade metal short chord across W05-W22 (SBIN 9)',
    defaultSeed: 0x20261202,
    waferCount: DEMO_WAFER_COUNT,
    expectedVerdictKind: 'Scratch',
  },
  {
    id: 'site2-probe-contact',
    title: 'Site 2 Probe Contact Lot',
    subtitle: '25 wafers · Oxidized Site 2 needles causing contact opens and retest recovery (SBIN 5)',
    defaultSeed: 0x20261203,
    waferCount: DEMO_WAFER_COUNT,
    expectedVerdictKind: 'Site-Anomaly',
  },
] as const;

const PRESET_LOT_CONFIG: Readonly<
  Record<
    DemoPresetId,
    {
      readonly lotId: string;
      readonly partTyp: string;
      readonly jobNam: string;
      readonly salt: number;
    }
  >
> = {
  'edge-ring-etch': {
    lotId: 'CAL-ER-2401',
    partTyp: 'CAL-MCU-28NM',
    jobNam: 'WSORT_ETCH_MON_V4',
    salt: 0x101,
  },
  'handling-scratch': {
    lotId: 'CAL-SC-2402',
    partTyp: 'CAL-MCU-28NM',
    jobNam: 'WSORT_PASSIV_MON_V4',
    salt: 0x202,
  },
  'site2-probe-contact': {
    lotId: 'CAL-S2-2403',
    partTyp: 'CAL-MCU-28NM',
    jobNam: 'WSORT_QUAD_SITE_V4',
    salt: 0x303,
  },
};

type QuadrantIndex = 0 | 1 | 2 | 3;
type RadialBandIndex = 0 | 1 | 2; // 0 = inner (rho <= 0.38), 1 = mid-interior, 2 = edge3 (ringIndex <= 3)

type QuadrantBuckets = readonly [
  readonly number[],
  readonly number[],
  readonly number[],
  readonly number[],
];

interface StaticGridDie {
  readonly gridIndex: number;
  readonly x: number;
  readonly y: number;
  readonly siteNum: 1 | 2 | 3 | 4;
  readonly ringIndex: number;
  readonly quadrant: QuadrantIndex;
  readonly radialBand: RadialBandIndex;
}

export interface SeededScratchChordGeometry {
  /** Signed chord tangent angle in radians (strictly non-axis-aligned). */
  readonly angleRad: number;
  /** Signed chord tangent angle in degrees (`±[22°, 38°]` or `±[52°, 68°]`). */
  readonly angleDeg: number;
  /** Signed perpendicular offset from `(0, 0)` in die pitches (`±[0.9, 2.0]`). */
  readonly lateralOffset: number;
  /** Half-length along the chord tangent in die pitches. */
  readonly halfLength: number;
  /** Perpendicular half-width of the scored band in die pitches. */
  readonly halfWidth: number;
}

interface StaticWaferLayout {
  readonly dies: readonly StaticGridDie[];
  /** Serpentine `2x2` prober touchdown groups of `gridIndex`es. */
  readonly touchdownGroups: ReadonlyArray<readonly number[]>;
  /** Outer rings `1, 2, 3` bucketed by quadrant for angularly uniform plasma-etch sampling. */
  readonly edgeRingByQuadrant: readonly [
    QuadrantBuckets,
    QuadrantBuckets,
    QuadrantBuckets,
  ];
  /** Interior (`ringIndex > 3`) dies bucketed by quadrant. */
  readonly interiorByQuadrant: QuadrantBuckets;
  /** All 633 dies bucketed by quadrant. */
  readonly allByQuadrant: QuadrantBuckets;
  /** `Site 2` dies (`158` total) partitioned by radial band (`inner`, `midInter`, `edge3`) and quadrant. */
  readonly site2ByBandAndQuadrant: readonly [
    QuadrantBuckets,
    QuadrantBuckets,
    QuadrantBuckets,
  ];
  /** Non-`Site 2` dies partitioned by radial band (`inner`, `midInter`, `edge3`) and quadrant. */
  readonly nonSite2ByBandAndQuadrant: readonly [
    QuadrantBuckets,
    QuadrantBuckets,
    QuadrantBuckets,
  ];
}

let cachedLayout: StaticWaferLayout | null = null;

function createMutableQuadrantBuckets(): [number[], number[], number[], number[]] {
  return [[], [], [], []];
}

function resolveQuadrant(x: number, y: number): QuadrantIndex {
  if (x >= 0) {
    return y >= 0 ? 0 : 3;
  }
  return y >= 0 ? 1 : 2;
}

/**
 * Builds and caches the 633-die circular wafer layout (`x^2 + y^2 <= 14.2^2`),
 * 4-neighbour edge-ring indices, radial-band x quadrant strata, and serpentine
 * `2x2` quad-site prober touchdown stepping order:
 * - Site 1: `(even X, even Y)`
 * - Site 2: `(odd X, even Y)`
 * - Site 3: `(even X, odd Y)`
 * - Site 4: `(odd X, odd Y)`
 */
function getStaticWaferLayout(): StaticWaferLayout {
  if (cachedLayout !== null) {
    return cachedLayout;
  }

  const radiusSq = DEMO_WAFER_RADIUS * DEMO_WAFER_RADIUS;
  const rawCoords: Array<{ readonly x: number; readonly y: number }> = [];

  // Step 2x2 touchdown blocks in serpentine prober row order (bottom-to-top Y, alternating X)
  const touchdownGroups: number[][] = [];
  const siteOffsets: ReadonlyArray<{
    readonly dx: 0 | 1;
    readonly dy: 0 | 1;
    readonly siteNum: 1 | 2 | 3 | 4;
  }> = [
    { dx: 0, dy: 0, siteNum: 1 },
    { dx: 1, dy: 0, siteNum: 2 },
    { dx: 0, dy: 1, siteNum: 3 },
    { dx: 1, dy: 1, siteNum: 4 },
  ];

  const siteNumsForIndex: Array<1 | 2 | 3 | 4> = [];

  let rowIdx = 0;
  let maxDist = 1;
  for (let by = -7; by <= 7; by += 1) {
    const leftToRight = (rowIdx & 1) === 0;
    rowIdx += 1;
    for (let step = 0; step < 15; step += 1) {
      const bx = leftToRight ? -7 + step : 7 - step;
      const group: number[] = [];
      for (const off of siteOffsets) {
        const x = 2 * bx + off.dx;
        const y = 2 * by + off.dy;
        const distSq = x * x + y * y;
        if (distSq <= radiusSq) {
          const idx = rawCoords.length;
          rawCoords.push({ x, y });
          siteNumsForIndex.push(off.siteNum);
          group.push(idx);
          const dist = Math.sqrt(distSq);
          if (dist > maxDist) {
            maxDist = dist;
          }
        }
      }
      if (group.length > 0) {
        touchdownGroups.push(group);
      }
    }
  }

  const ringIndices = computeWaferEdgeRingIndices(rawCoords);
  const dies: StaticGridDie[] = new Array<StaticGridDie>(rawCoords.length);

  const edgeRingByQuadrant = [
    createMutableQuadrantBuckets(),
    createMutableQuadrantBuckets(),
    createMutableQuadrantBuckets(),
  ] as const;
  const interiorByQuadrant = createMutableQuadrantBuckets();
  const allByQuadrant = createMutableQuadrantBuckets();
  const site2ByBandAndQuadrant = [
    createMutableQuadrantBuckets(),
    createMutableQuadrantBuckets(),
    createMutableQuadrantBuckets(),
  ] as const;
  const nonSite2ByBandAndQuadrant = [
    createMutableQuadrantBuckets(),
    createMutableQuadrantBuckets(),
    createMutableQuadrantBuckets(),
  ] as const;

  for (let i = 0; i < rawCoords.length; i += 1) {
    const { x, y } = rawCoords[i]!;
    const siteNum = siteNumsForIndex[i]!;
    const ringIndex = ringIndices[i]!;
    const quadrant = resolveQuadrant(x, y);
    const rho = Math.hypot(x, y) / maxDist;
    const radialBand: RadialBandIndex =
      ringIndex <= 3 ? 2 : rho <= 0.38 ? 0 : 1;

    dies[i] = {
      gridIndex: i,
      x,
      y,
      siteNum,
      ringIndex,
      quadrant,
      radialBand,
    };

    allByQuadrant[quadrant].push(i);
    if (ringIndex >= 1 && ringIndex <= 3) {
      edgeRingByQuadrant[ringIndex - 1]![quadrant].push(i);
    } else {
      interiorByQuadrant[quadrant].push(i);
    }

    if (siteNum === 2) {
      site2ByBandAndQuadrant[radialBand][quadrant].push(i);
    } else {
      nonSite2ByBandAndQuadrant[radialBand][quadrant].push(i);
    }
  }

  cachedLayout = {
    dies,
    touchdownGroups,
    edgeRingByQuadrant,
    interiorByQuadrant,
    allByQuadrant,
    site2ByBandAndQuadrant,
    nonSite2ByBandAndQuadrant,
  };
  return cachedLayout;
}

/**
 * Shuffles each quadrant bucket independently with `rng` and interleaves them
 * round-robin from a seeded starting quadrant and coprime step (`1` or `3`) so
 * any slice `[a, b)` has identical per-die marginal probability while remaining
 * balanced within `±1` die across all 4 quadrants.
 */
function interleaveShuffledQuadrants(
  rng: SeededPrng,
  buckets: QuadrantBuckets,
  excludeMask?: Uint8Array | null,
): number[] {
  const shuffledQuads: [number[], number[], number[], number[]] = [
    [],
    [],
    [],
    [],
  ];
  let total = 0;
  for (let q = 0; q < 4; q += 1) {
    const src = buckets[q]!;
    const copy: number[] = [];
    for (let i = 0; i < src.length; i += 1) {
      const idx = src[i]!;
      if (!excludeMask || excludeMask[idx] === 0) {
        copy.push(idx);
      }
    }
    rng.shuffle(copy);
    shuffledQuads[q] = copy;
    total += copy.length;
  }

  const startQ = rng.nextInt(0, 3);
  const stepQ = rng.nextBool(0.5) ? 1 : 3;
  const out: number[] = new Array<number>(total);
  let writePos = 0;
  let round = 0;
  while (writePos < total) {
    for (let k = 0; k < 4; k += 1) {
      const q = (startQ + k * stepQ) & 3;
      const arr = shuffledQuads[q]!;
      if (round < arr.length) {
        out[writePos] = arr[round]!;
        writePos += 1;
      }
    }
    round += 1;
  }
  return out;
}

/**
 * Selects `dropoutCount` non-adjacent interior indices in `1 .. length - 2`
 * (`gap >= 2` between consecutive dropouts) so intermittent 1-die scratch dropouts
 * are always bridged by `BRIDGE_RADIUS_EUCLIDEAN = 2.25` without splitting the chord.
 */
function pickNonAdjacentInteriorIndices(
  rng: SeededPrng,
  length: number,
  dropoutCount: number,
): ReadonlySet<number> {
  const chosen = new Set<number>();
  if (dropoutCount <= 0 || length < 4) {
    return chosen;
  }
  const interiorLen = length - 2; // indices 1 .. length - 2
  const maxValid = Math.floor((interiorLen + 1) / 2);
  const k = Math.min(dropoutCount, maxValid);
  if (k <= 0) {
    return chosen;
  }

  // Stars-and-bars slack distribution: place k items in 1..length-2 with >= 1 unchosen element between items
  const totalSlack = interiorLen - (2 * k - 1);
  const gaps = new Array<number>(k + 1).fill(0);
  for (let s = 0; s < totalSlack; s += 1) {
    const bucket = rng.nextInt(0, k);
    gaps[bucket]! += 1;
  }

  let cursor = 1 + gaps[0]!;
  for (let i = 0; i < k; i += 1) {
    chosen.add(cursor);
    cursor += 2 + gaps[i + 1]!;
  }
  return chosen;
}

const SCRATCH_CHORD_SALT = 0x5c7a7c4;

/**
 * Deterministically derives a seeded, strictly non-axis-aligned (and non-45°)
 * robotic transfer-blade scratch chord for a given 32-bit `seed`.
 */
export function computeSeededScratchChordGeometry(
  seed: number,
): SeededScratchChordGeometry {
  const chordRng = createPrng(mixSeed(normalizeSeed(seed), SCRATCH_CHORD_SALT));
  const steepBand = chordRng.nextBool(0.5);
  const magDeg = steepBand
    ? chordRng.nextRange(52, 68)
    : chordRng.nextRange(22, 38);
  const slopeSign = chordRng.nextBool(0.5) ? 1 : -1;
  const angleDeg = slopeSign * magDeg;
  const angleRad = (angleDeg * Math.PI) / 180;
  const offsetSign = chordRng.nextBool(0.5) ? 1 : -1;
  const lateralOffset = offsetSign * chordRng.nextRange(0.9, 2.0);

  return {
    angleRad,
    angleDeg,
    lateralOffset,
    halfLength: 11.6,
    halfWidth: 0.92,
  };
}

interface SeededScratchChordPlan {
  readonly mask: Uint8Array;
  /** Grid indices on the scratch chord sorted monotonically along the chord tangent. */
  readonly orderedGridIndices: readonly number[];
}

function buildSeededScratchChordPlan(
  seed: number,
  dies: readonly StaticGridDie[],
): SeededScratchChordPlan {
  const geom = computeSeededScratchChordGeometry(seed);
  const tx = Math.cos(geom.angleRad);
  const ty = Math.sin(geom.angleRad);
  const nx = -ty;
  const ny = tx;

  const mask = new Uint8Array(dies.length);
  const scored: Array<{
    readonly idx: number;
    readonly proj: number;
    readonly perp: number;
  }> = [];

  for (let i = 0; i < dies.length; i += 1) {
    const { x, y } = dies[i]!;
    const rawProj = x * tx + y * ty;
    const rawPerp = x * nx + y * ny - geom.lateralOffset;
    if (Math.abs(rawProj) <= geom.halfLength && Math.abs(rawPerp) <= geom.halfWidth) {
      mask[i] = 1;
      scored.push({ idx: i, proj: rawProj, perp: rawPerp });
    }
  }

  scored.sort((a, b) => a.proj - b.proj || a.perp - b.perp || a.idx - b.idx);
  return {
    mask,
    orderedGridIndices: scored.map((s) => s.idx),
  };
}

type FailureMode =
  | 'PASS'
  | 'CONT_OPEN' // SBIN 5, HBIN 2, TEST 101
  | 'IDDQ_EDGE_LEAK' // SBIN 7, HBIN 4, TEST 204
  | 'VDD_METAL_SHORT' // SBIN 9, HBIN 3, TEST 302
  | 'VTH_DRIFT'; // SBIN 11, HBIN 5, TEST 410

interface ExecutionOutcome {
  readonly mode: FailureMode;
  readonly hardBin: number;
  readonly softBin: number;
}

const PASS_OUTCOME: ExecutionOutcome = { mode: 'PASS', hardBin: 1, softBin: 1 };
const CONT_FAIL_OUTCOME: ExecutionOutcome = { mode: 'CONT_OPEN', hardBin: 2, softBin: 5 };
const LEAK_FAIL_OUTCOME: ExecutionOutcome = {
  mode: 'IDDQ_EDGE_LEAK',
  hardBin: 4,
  softBin: 7,
};
const SHORT_FAIL_OUTCOME: ExecutionOutcome = {
  mode: 'VDD_METAL_SHORT',
  hardBin: 3,
  softBin: 9,
};
const VTH_FAIL_OUTCOME: ExecutionOutcome = { mode: 'VTH_DRIFT', hardBin: 5, softBin: 11 };

function clamp(val: number, lo: number, hi: number): number {
  if (val < lo) return lo;
  if (val > hi) return hi;
  return val;
}

function drawBaselineFailureOutcome(
  rng: SeededPrng,
  presetId: DemoPresetId,
): ExecutionOutcome {
  const u = rng.next();
  if (presetId === 'edge-ring-etch') {
    // Secondary minor loss in SBIN 11: VTH_DRIFT plus minor CONT/SHORT point defects
    if (u < 0.66) return VTH_FAIL_OUTCOME;
    if (u < 0.84) return CONT_FAIL_OUTCOME;
    return SHORT_FAIL_OUTCOME;
  }
  if (presetId === 'handling-scratch') {
    if (u < 0.52) return LEAK_FAIL_OUTCOME;
    if (u < 0.88) return VTH_FAIL_OUTCOME;
    return CONT_FAIL_OUTCOME;
  }
  // site2-probe-contact baseline silicon point defects across all 4 sites
  if (u < 0.56) return LEAK_FAIL_OUTCOME;
  return VTH_FAIL_OUTCOME;
}

interface TsrStatAccumulator {
  execCnt: number;
  failCnt: number;
  min: number;
  max: number;
  sum: number;
  sumSq: number;
}

function createTsrAccumulators(): TsrStatAccumulator[] {
  return DEMO_PARAMETRIC_SPECS.map(() => ({
    execCnt: 0,
    failCnt: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    sum: 0,
    sumSq: 0,
  }));
}

function recordTsrSample(
  acc: TsrStatAccumulator,
  rawResult: number,
  failed: boolean,
): void {
  const r4 = Math.fround(rawResult);
  acc.execCnt += 1;
  if (failed) {
    acc.failCnt += 1;
  }
  if (r4 < acc.min) acc.min = r4;
  if (r4 > acc.max) acc.max = r4;
  acc.sum += r4;
  acc.sumSq += r4 * r4;
}

function buildPartPtrs(
  rng: SeededPrng,
  presetId: DemoPresetId,
  die: StaticGridDie,
  outcome: ExecutionOutcome,
  emitFullDefaults: boolean,
  tsrAcc: readonly TsrStatAccumulator[],
): readonly StdfWritePtrSpec[] {
  // 1. TEST 101: VDD_CONT_R (0.10 .. 2.50 Ohm)
  const contFailed = outcome.mode === 'CONT_OPEN';
  let contVal: number;
  if (contFailed) {
    contVal = clamp(2.68 + Math.abs(rng.nextNormal(1.75, 1.15)), 2.65, 9.2);
  } else if (presetId === 'site2-probe-contact' && die.siteNum === 2) {
    // Elevated contact resistance tail on Site 2 even on passing/recovered touchdowns
    contVal = clamp(rng.nextNormal(1.52, 0.36), 0.3, 2.42);
  } else {
    contVal = clamp(rng.nextNormal(0.72, 0.14), 0.18, 2.32);
  }

  // 2. TEST 204: IDDQ_LEAK (0.20 uA .. 15.0 uA in base Amps)
  const leakFailed = outcome.mode === 'IDDQ_EDGE_LEAK';
  let leakVal: number;
  if (leakFailed) {
    const edgeBoost =
      presetId === 'edge-ring-etch' && die.ringIndex <= 3
        ? (4 - die.ringIndex) * 4.2e-6
        : 0;
    leakVal = clamp(
      16.2e-6 + Math.abs(rng.nextNormal(9.5e-6, 5.5e-6)) + edgeBoost,
      16.0e-6,
      72.0e-6,
    );
  } else if (presetId === 'edge-ring-etch' && die.ringIndex <= 3) {
    const edgeShift = (4 - die.ringIndex) * 1.15e-6;
    leakVal = clamp(rng.nextNormal(8.1e-6 + edgeShift, 1.35e-6), 1.8e-6, 14.4e-6);
  } else {
    leakVal = clamp(rng.nextNormal(4.1e-6, 0.8e-6), 0.45e-6, 13.5e-6);
  }

  // 3. TEST 302: VCCA_SHORT (4.0 mA .. 25.0 mA in base Amps)
  const shortFailed = outcome.mode === 'VDD_METAL_SHORT';
  const shortVal = shortFailed
    ? clamp(28.0e-3 + Math.abs(rng.nextNormal(24.0e-3, 11.0e-3)), 27.0e-3, 92.0e-3)
    : clamp(rng.nextNormal(12.4e-3, 1.35e-3), 5.5e-3, 23.4e-3);

  // 4. TEST 410: VTH_CORE (0.310 V .. 0.450 V)
  const vthFailed = outcome.mode === 'VTH_DRIFT';
  let vthVal: number;
  if (vthFailed) {
    vthVal = rng.nextBool(0.5)
      ? clamp(0.462 + Math.abs(rng.nextNormal(0.022, 0.014)), 0.458, 0.54)
      : clamp(0.298 - Math.abs(rng.nextNormal(0.022, 0.014)), 0.23, 0.302);
  } else {
    vthVal = clamp(rng.nextNormal(0.38, 0.011), 0.32, 0.44);
  }

  const values = [contVal, leakVal, shortVal, vthVal] as const;
  const failedFlags = [contFailed, leakFailed, shortFailed, vthFailed] as const;

  const ptrs: StdfWritePtrSpec[] = new Array<StdfWritePtrSpec>(4);
  for (let t = 0; t < 4; t += 1) {
    const result = values[t]!;
    const failed = failedFlags[t]!;
    recordTsrSample(tsrAcc[t]!, result, failed);
    const spec = DEMO_PARAMETRIC_SPECS[t]!;

    if (emitFullDefaults) {
      ptrs[t] = {
        testNum: spec.testNum,
        testFlg: failed ? PTR_TEST_FLG.FAILED : 0,
        result,
        testTxt: spec.testTxt,
        resScal: spec.resScal,
        llmScal: spec.llmScal,
        hlmScal: spec.hlmScal,
        loLimit: spec.loLimit,
        hiLimit: spec.hiLimit,
        units: spec.units,
      };
    } else {
      ptrs[t] = {
        testNum: spec.testNum,
        testFlg: failed ? PTR_TEST_FLG.FAILED : 0,
        result,
        omitOptionalAfterResult: true,
      };
    }
  }

  return ptrs;
}

interface DiePlan {
  readonly die: StaticGridDie;
  readonly firstOutcome: ExecutionOutcome;
  readonly retestOutcome: ExecutionOutcome | null;
  readonly injectedFirstPassFail: boolean;
  readonly injectedFinalFail: boolean;
}

function planWaferDieOutcomes(
  rng: SeededPrng,
  presetId: DemoPresetId,
  waferIndex: number,
  layout: StaticWaferLayout,
  scratchChord: SeededScratchChordPlan | null,
): readonly DiePlan[] {
  const { dies } = layout;
  const dieCount = dies.length;
  const plans: DiePlan[] = new Array<DiePlan>(dieCount);
  const assigned = new Uint8Array(dieCount);

  for (let i = 0; i < dieCount; i += 1) {
    plans[i] = {
      die: dies[i]!,
      firstOutcome: PASS_OUTCOME,
      retestOutcome: null,
      injectedFirstPassFail: false,
      injectedFinalFail: false,
    };
  }

  if (presetId === 'edge-ring-etch') {
    const ringTargetRates = [
      rng.nextRange(0.6, 0.66), // ring 1 (~63%)
      rng.nextRange(0.43, 0.49), // ring 2 (~46%)
      rng.nextRange(0.2, 0.26), // ring 3 (~23%)
    ] as const;

    for (let r = 0; r < 3; r += 1) {
      const ordered = interleaveShuffledQuadrants(
        rng,
        layout.edgeRingByQuadrant[r]!,
      );
      const failCount = Math.round(ordered.length * ringTargetRates[r]!);
      const retestCount = Math.max(1, Math.round(failCount * 0.06));
      for (let k = 0; k < failCount; k += 1) {
        const idx = ordered[k]!;
        assigned[idx] = 1;
        plans[idx] = {
          die: dies[idx]!,
          firstOutcome: LEAK_FAIL_OUTCOME,
          retestOutcome: k < retestCount ? LEAK_FAIL_OUTCOME : null,
          injectedFirstPassFail: true,
          injectedFinalFail: true,
        };
      }
    }

    // Stratified ~1.8% baseline point defects + ~1.5% transient contact blips across remaining dies
    const remaining = interleaveShuffledQuadrants(
      rng,
      layout.allByQuadrant,
      assigned,
    );
    const baseFailCount = Math.min(remaining.length, rng.nextInt(8, 11));
    const transientCount = Math.min(
      remaining.length - baseFailCount,
      rng.nextInt(7, 10),
    );
    for (let k = 0; k < baseFailCount; k += 1) {
      const idx = remaining[k]!;
      const baseOut = drawBaselineFailureOutcome(rng, presetId);
      plans[idx] = {
        die: dies[idx]!,
        firstOutcome: baseOut,
        retestOutcome: k === 0 ? baseOut : null,
        injectedFirstPassFail: false,
        injectedFinalFail: false,
      };
    }
    for (let k = 0; k < transientCount; k += 1) {
      const idx = remaining[baseFailCount + k]!;
      plans[idx] = {
        die: dies[idx]!,
        firstOutcome: CONT_FAIL_OUTCOME,
        retestOutcome: PASS_OUTCOME,
        injectedFirstPassFail: false,
        injectedFinalFail: false,
      };
    }
    return plans;
  }

  if (presetId === 'handling-scratch') {
    const waferHasScratch = waferIndex >= 4 && waferIndex <= 21; // W05..W22
    if (waferHasScratch && scratchChord !== null) {
      const chordIndices = scratchChord.orderedGridIndices;
      const chordLen = chordIndices.length;
      const dropoutCount = Math.max(
        1,
        Math.round(chordLen * rng.nextRange(0.12, 0.18)),
      );
      const dropouts = pickNonAdjacentInteriorIndices(
        rng,
        chordLen,
        dropoutCount,
      );

      let injectedCount = 0;
      for (let c = 0; c < chordLen; c += 1) {
        const idx = chordIndices[c]!;
        if (dropouts.has(c)) {
          continue;
        }
        assigned[idx] = 1;
        injectedCount += 1;
        const doRetest = injectedCount % 16 === 1;
        plans[idx] = {
          die: dies[idx]!,
          firstOutcome: SHORT_FAIL_OUTCOME,
          retestOutcome: doRetest ? SHORT_FAIL_OUTCOME : null,
          injectedFirstPassFail: true,
          injectedFinalFail: true,
        };
      }
    }

    // Keep baseline final fails strictly in [5, 8] (< 9.495 = 0.015 * 633) so clean wafers
    // W01-W04 and W23-W25 (~98.9% yield) deterministically stay below MIN_FAIL_FRACTION -> 'None'
    const remaining = interleaveShuffledQuadrants(
      rng,
      layout.allByQuadrant,
      waferHasScratch && scratchChord !== null ? scratchChord.mask : assigned,
    );
    const baseFailCount = Math.min(remaining.length, rng.nextInt(5, 8));
    const transientCount = Math.min(
      remaining.length - baseFailCount,
      rng.nextInt(5, 7),
    );
    for (let k = 0; k < baseFailCount; k += 1) {
      const idx = remaining[k]!;
      const baseOut = drawBaselineFailureOutcome(rng, presetId);
      plans[idx] = {
        die: dies[idx]!,
        firstOutcome: baseOut,
        retestOutcome: k === 0 && rng.nextBool(0.4) ? baseOut : null,
        injectedFirstPassFail: false,
        injectedFinalFail: false,
      };
    }
    for (let k = 0; k < transientCount; k += 1) {
      const idx = remaining[baseFailCount + k]!;
      plans[idx] = {
        die: dies[idx]!,
        firstOutcome: CONT_FAIL_OUTCOME,
        retestOutcome: PASS_OUTCOME,
        injectedFirstPassFail: false,
        injectedFinalFail: false,
      };
    }
    return plans;
  }

  // Preset: 'site2-probe-contact'
  // Stratified across radial bands (`inner`, `midInter`, `edge3`) x quadrants (`Q0..Q3`)
  // so small-stratum variance (`Z_inner` has only 22 Site-2 dies) never produces radial holes
  // (`r_zone >= 3.8`) or periphery-vs-interior skew (`z_edge >= 3.8`) on any 32-bit seed.
  for (let band = 0 as RadialBandIndex; band < 3; band = (band + 1) as RadialBandIndex) {
    // 1. Oxidized/bent probe needles on HEAD 1 / SITE 2 (~38.5% first-pass fail, ~50% retest, ~40% of retests recover)
    const site2Ordered = interleaveShuffledQuadrants(
      rng,
      layout.site2ByBandAndQuadrant[band]!,
    );
    const s2Len = site2Ordered.length;
    const firstFailFrac = rng.nextRange(0.36, 0.41);
    const kFirstFail = Math.max(2, Math.round(s2Len * firstFailFrac));
    const kRetest = Math.max(
      1,
      Math.min(kFirstFail, Math.round(kFirstFail * rng.nextRange(0.46, 0.54))),
    );
    const kRecovered = Math.max(
      1,
      Math.min(kRetest, Math.round(kRetest * rng.nextRange(0.36, 0.44))),
    );
    const kFinalFail = kFirstFail - kRecovered;
    const kPersistentRetest = kRetest - kRecovered;

    for (let k = 0; k < kFirstFail; k += 1) {
      const idx = site2Ordered[k]!;
      assigned[idx] = 1;
      if (k < kFinalFail) {
        const persistentRetest = k < kPersistentRetest;
        plans[idx] = {
          die: dies[idx]!,
          firstOutcome: CONT_FAIL_OUTCOME,
          retestOutcome: persistentRetest ? CONT_FAIL_OUTCOME : null,
          injectedFirstPassFail: true,
          injectedFinalFail: true,
        };
      } else {
        plans[idx] = {
          die: dies[idx]!,
          firstOutcome: CONT_FAIL_OUTCOME,
          retestOutcome: PASS_OUTCOME,
          injectedFirstPassFail: true,
          injectedFinalFail: false,
        };
      }
    }

    // 2. Baseline silicon point-defect rate ~2.8% across non-injected dies in this radial band
    const nonSite2Ordered = interleaveShuffledQuadrants(
      rng,
      layout.nonSite2ByBandAndQuadrant[band]!,
    );
    const remSite2 = site2Ordered.slice(kFirstFail);
    const pool = [...nonSite2Ordered, ...remSite2];
    rng.shuffle(pool);

    const bandTotal = s2Len + nonSite2Ordered.length;
    const baseFailCount = Math.min(
      pool.length,
      Math.max(1, Math.round(bandTotal * rng.nextRange(0.024, 0.032))),
    );
    for (let k = 0; k < baseFailCount; k += 1) {
      const idx = pool[k]!;
      assigned[idx] = 1;
      const baseOut = drawBaselineFailureOutcome(rng, presetId);
      const retest =
        k === 0 && band === 1
          ? rng.nextBool(0.15)
            ? PASS_OUTCOME
            : baseOut
          : null;
      plans[idx] = {
        die: dies[idx]!,
        firstOutcome: baseOut,
        retestOutcome: retest,
        injectedFirstPassFail: false,
        injectedFinalFail: false,
      };
    }
  }

  return plans;
}

/**
 * Lists metadata for all three built-in deterministic STDF V4 demo lots.
 */
export function listDemoPresets(): readonly DemoPresetMeta[] {
  return DEMO_PRESETS;
}

/**
 * Looks up metadata for a built-in demo preset by ID.
 */
export function getDemoPresetMeta(presetId: DemoPresetId): DemoPresetMeta {
  const found = DEMO_PRESETS.find((p) => p.id === presetId);
  if (found === undefined) {
    throw new RangeError(`Unknown demo preset ID: "${String(presetId)}".`);
  }
  return found;
}

/**
 * Deterministically generates a complete 25-wafer x 633-die STDF V4 demo lot,
 * its `StdfWriteLotSpec`, and its exact ground-truth failure manifest.
 */
export function generateDemoLot(
  presetId: DemoPresetId,
  seed?: number,
): GeneratedDemoLot {
  const preset = getDemoPresetMeta(presetId);
  const config = PRESET_LOT_CONFIG[presetId];
  const resolvedSeed = normalizeSeed(seed ?? preset.defaultSeed);
  const rootRng = createPrng(mixSeed(resolvedSeed, config.salt));
  const layout = getStaticWaferLayout();
  const scratchChord =
    presetId === 'handling-scratch'
      ? buildSeededScratchChordPlan(resolvedSeed, layout.dies)
      : null;

  const tsrAcc = createTsrAccumulators();
  const hbinCounts = new Map<number, number>();
  const sbinCounts = new Map<number, number>();
  for (const h of HBIN_CATALOG) hbinCounts.set(h.code, 0);
  for (const s of SBIN_CATALOG) sbinCounts.set(s.code, 0);

  const sitePartCnt = [0, 0, 0, 0];
  const siteRtstCnt = [0, 0, 0, 0];
  const siteGoodCnt = [0, 0, 0, 0];

  const injectedFinalFailDieIds: DieId[] = [];
  const injectedFirstPassFailDieIds: DieId[] = [];
  const retestedDieIds: DieId[] = [];
  const recoveredRetestDieIds: DieId[] = [];
  const expectedWaferPatterns: DemoSpatialPatternTruth[] = [];
  const injectedWaferIndices: number[] = [];

  const wafers: StdfWriteWaferSpec[] = new Array<StdfWriteWaferSpec>(DEMO_WAFER_COUNT);
  let emittedFirstPtrDefaults = false;

  for (let wIdx = 0; wIdx < DEMO_WAFER_COUNT; wIdx += 1) {
    const waferId = `W${String(wIdx + 1).padStart(2, '0')}`;
    const waferRng = rootRng.fork(wIdx + 1);
    const plans = planWaferDieOutcomes(
      waferRng,
      presetId,
      wIdx,
      layout,
      scratchChord,
    );

    if (presetId === 'edge-ring-etch') {
      expectedWaferPatterns.push('Edge-Ring');
      injectedWaferIndices.push(wIdx);
    } else if (presetId === 'handling-scratch') {
      const hasScratch = wIdx >= 4 && wIdx <= 21;
      expectedWaferPatterns.push(hasScratch ? 'Scratch' : 'None');
      if (hasScratch) {
        injectedWaferIndices.push(wIdx);
      }
    } else {
      expectedWaferPatterns.push('Random');
      injectedWaferIndices.push(wIdx);
    }

    const touchdowns: StdfWriteTouchdownSpec[] = [];
    const retestQueue: DiePlan[] = [];
    let waferPartCount = 0;
    let waferRetestCount = 0;
    let waferGoodCount = 0;

    // Tally unique-die final-state outcomes once per die (last PRR outcome) for HBR/SBR/PCR/WRR
    for (let d = 0; d < plans.length; d += 1) {
      const plan = plans[d]!;
      const finalOutcome = plan.retestOutcome ?? plan.firstOutcome;
      const siteIdx = plan.die.siteNum - 1;
      waferPartCount += 1;
      sitePartCnt[siteIdx]! += 1;
      hbinCounts.set(
        finalOutcome.hardBin,
        (hbinCounts.get(finalOutcome.hardBin) ?? 0) + 1,
      );
      sbinCounts.set(
        finalOutcome.softBin,
        (sbinCounts.get(finalOutcome.softBin) ?? 0) + 1,
      );
      if (finalOutcome.mode === 'PASS') {
        waferGoodCount += 1;
        siteGoodCnt[siteIdx]! += 1;
      }
      if (plan.retestOutcome !== null) {
        waferRetestCount += 1;
        siteRtstCnt[siteIdx]! += 1;
      }
    }

    // 1. Primary 2x2 serpentine multi-site wafer probe pass
    for (let g = 0; g < layout.touchdownGroups.length; g += 1) {
      const group = layout.touchdownGroups[g]!;
      const tdParts: StdfWritePartSpec[] = new Array<StdfWritePartSpec>(group.length);

      for (let m = 0; m < group.length; m += 1) {
        const plan = plans[group[m]!]!;
        const { die, firstOutcome } = plan;
        const firstPassed = firstOutcome.mode === 'PASS';
        const ptrs = buildPartPtrs(
          waferRng,
          presetId,
          die,
          firstOutcome,
          !emittedFirstPtrDefaults,
          tsrAcc,
        );
        emittedFirstPtrDefaults = true;

        tdParts[m] = {
          headNum: DEMO_HEAD_NUM,
          siteNum: die.siteNum,
          partFlg: firstPassed ? 0 : PRR_PART_FLG.FAILED,
          hardBin: firstOutcome.hardBin,
          softBin: firstOutcome.softBin,
          xCoord: die.x,
          yCoord: die.y,
          omitOptionalAfterCoords: true,
          ptrs,
        };

        const dieId: DieId = `${waferId}:${die.x},${die.y}`;
        if (plan.injectedFirstPassFail) {
          injectedFirstPassFailDieIds.push(dieId);
        }
        if (plan.injectedFinalFail) {
          injectedFinalFailDieIds.push(dieId);
        }

        if (plan.retestOutcome !== null) {
          retestQueue.push(plan);
          retestedDieIds.push(dieId);
          if (plan.retestOutcome.mode === 'PASS') {
            recoveredRetestDieIds.push(dieId);
          }
        }
      }

      touchdowns.push(tdParts);
    }

    // 2. End-of-wafer retest pass (grouped into conflict-free multi-site touchdowns when sites differ)
    let rCursor = 0;
    while (rCursor < retestQueue.length) {
      const batch: StdfWritePartSpec[] = [];
      const usedSites = new Set<number>();

      while (rCursor < retestQueue.length && batch.length < 4) {
        const candidate = retestQueue[rCursor]!;
        if (usedSites.has(candidate.die.siteNum)) {
          break;
        }
        usedSites.add(candidate.die.siteNum);
        rCursor += 1;

        const retestOutcome = candidate.retestOutcome!;
        const retestPassed = retestOutcome.mode === 'PASS';
        const ptrs = buildPartPtrs(
          waferRng,
          presetId,
          candidate.die,
          retestOutcome,
          false,
          tsrAcc,
        );

        batch.push({
          headNum: DEMO_HEAD_NUM,
          siteNum: candidate.die.siteNum,
          partFlg: retestPassed
            ? PRR_PART_FLG.SUPERSEDES_COORD
            : PRR_PART_FLG.FAILED | PRR_PART_FLG.SUPERSEDES_COORD,
          hardBin: retestOutcome.hardBin,
          softBin: retestOutcome.softBin,
          xCoord: candidate.die.x,
          yCoord: candidate.die.y,
          omitOptionalAfterCoords: true,
          ptrs,
        });
      }

      touchdowns.push(batch);
    }

    const waferStartT = BASE_SETUP_TIMESTAMP + 60 + wIdx * 180;
    wafers[wIdx] = {
      wir: {
        headNum: DEMO_HEAD_NUM,
        siteGrp: 1,
        startT: waferStartT,
        waferId,
      },
      touchdowns,
      wrr: {
        headNum: DEMO_HEAD_NUM,
        siteGrp: 1,
        finishT: waferStartT + 150,
        partCnt: waferPartCount,
        rtstCnt: waferRetestCount,
        abrtCnt: 0,
        goodCnt: waferGoodCount,
        waferId,
        fabwfId: `FAB-${config.lotId}-${waferId}`,
      },
    };
  }

  const hbrs: StdfWriteHbrSpec[] = HBIN_CATALOG.map((h) => ({
    headNum: 255,
    siteNum: 0,
    hbinNum: h.code,
    hbinCnt: hbinCounts.get(h.code) ?? 0,
    hbinPf: h.pf,
    hbinNam: h.name,
  }));

  const sbrs: StdfWriteSbrSpec[] = SBIN_CATALOG.map((s) => ({
    headNum: 255,
    siteNum: 0,
    sbinNum: s.code,
    sbinCnt: sbinCounts.get(s.code) ?? 0,
    sbinPf: s.pf,
    sbinNam: s.name,
  }));

  const tsrs: StdfWriteTsrSpec[] = DEMO_PARAMETRIC_SPECS.map((spec, idx) => {
    const acc = tsrAcc[idx]!;
    return {
      headNum: 255,
      siteNum: 0,
      testTyp: 'P',
      testNum: spec.testNum,
      execCnt: acc.execCnt,
      failCnt: acc.failCnt,
      alrmCnt: 0,
      testNam: spec.testTxt,
      seqName: 'MAIN_SORT_FLOW',
      testLbl: spec.testTxt,
      optFlag: 0,
      testTim: 0.012,
      testMin: acc.execCnt > 0 ? acc.min : 0,
      testMax: acc.execCnt > 0 ? acc.max : 0,
      tstSums: acc.sum,
      tstSqrs: acc.sumSq,
    };
  });

  const totalPartCnt = sitePartCnt.reduce((a, b) => a + b, 0);
  const totalRtstCnt = siteRtstCnt.reduce((a, b) => a + b, 0);
  const totalGoodCnt = siteGoodCnt.reduce((a, b) => a + b, 0);

  const pcrs: StdfWritePcrSpec[] = [
    ...DEMO_SITE_NUMS.map((siteNum, idx) => ({
      headNum: DEMO_HEAD_NUM,
      siteNum,
      partCnt: sitePartCnt[idx]!,
      rtstCnt: siteRtstCnt[idx]!,
      abrtCnt: 0,
      goodCnt: siteGoodCnt[idx]!,
    })),
    {
      headNum: 255,
      siteNum: 0,
      partCnt: totalPartCnt,
      rtstCnt: totalRtstCnt,
      abrtCnt: 0,
      goodCnt: totalGoodCnt,
    },
  ];

  const lotSpec: StdfWriteLotSpec = {
    endianness: 'little',
    compactRepeatedPtrs: true,
    mir: {
      setupT: BASE_SETUP_TIMESTAMP,
      startT: BASE_SETUP_TIMESTAMP + 30,
      statNum: 1,
      modeCod: 'P',
      rtstCod: 'Y',
      lotId: config.lotId,
      partTyp: config.partTyp,
      nodeNam: 'ATE-SORT-04',
      tstrTyp: 'CAL-V93K-SIM',
      jobNam: config.jobNam,
      jobRev: '4.1',
      sblotId: 'SB01',
      operNam: 'AUTOPSY_SIM',
    },
    sdrs: [
      {
        headNum: DEMO_HEAD_NUM,
        siteGrp: 1,
        siteNums: DEMO_SITE_NUMS,
        handTyp: 'PROBER_200MM',
        handId: 'PRB-TEL-04',
        cardTyp: 'CANTILEVER_4S',
        cardId: 'PC-QUAD-2X2',
      },
    ],
    hbrs,
    sbrs,
    wcr: {
      wafrSiz: 200,
      dieHt: 5.8,
      dieWid: 5.8,
      wfUnits: 3,
      wfFlat: 'D',
      centerX: 0,
      centerY: 0,
      posX: 'R',
      posY: 'U',
    },
    wafers,
    tsrs,
    pcrs,
    mrr: {
      finishT: BASE_SETUP_TIMESTAMP + 60 + DEMO_WAFER_COUNT * 180,
      dispCod: '0',
      usrDesc: `SYNTHETIC_${presetId.toUpperCase().replace(/-/g, '_')}`,
    },
  };

  const stdfBytes = writeStdfBytes(lotSpec);

  const groundTruth: DemoLotGroundTruth =
    presetId === 'edge-ring-etch'
      ? {
          presetId,
          seed: resolvedSeed,
          lotId: config.lotId,
          waferCount: DEMO_WAFER_COUNT,
          diesPerWafer: DEMO_DIES_PER_WAFER,
          totalDies: DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER,
          expectedStackedPattern: 'Edge-Ring',
          expectedWaferPatterns,
          injectedWaferIndices,
          injectedAnomalousSite: null,
          primaryInjectedTestNum: DEMO_TEST_NUMS.IDDQ_LEAK,
          injectedTestNums: [DEMO_TEST_NUMS.IDDQ_LEAK],
          dominantFailSbin: 7,
          dominantFailHbin: 4,
          injectedFinalFailDieIds,
          injectedFirstPassFailDieIds,
          retestedDieIds,
          recoveredRetestDieIds,
        }
      : presetId === 'handling-scratch'
        ? {
            presetId,
            seed: resolvedSeed,
            lotId: config.lotId,
            waferCount: DEMO_WAFER_COUNT,
            diesPerWafer: DEMO_DIES_PER_WAFER,
            totalDies: DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER,
            expectedStackedPattern: 'Scratch',
            expectedWaferPatterns,
            injectedWaferIndices,
            injectedAnomalousSite: null,
            primaryInjectedTestNum: DEMO_TEST_NUMS.VCCA_SHORT,
            injectedTestNums: [DEMO_TEST_NUMS.VCCA_SHORT],
            dominantFailSbin: 9,
            dominantFailHbin: 3,
            injectedFinalFailDieIds,
            injectedFirstPassFailDieIds,
            retestedDieIds,
            recoveredRetestDieIds,
          }
        : {
            presetId,
            seed: resolvedSeed,
            lotId: config.lotId,
            waferCount: DEMO_WAFER_COUNT,
            diesPerWafer: DEMO_DIES_PER_WAFER,
            totalDies: DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER,
            expectedStackedPattern: 'Random',
            expectedWaferPatterns,
            injectedWaferIndices,
            injectedAnomalousSite: { headNum: DEMO_HEAD_NUM, siteNum: 2 },
            primaryInjectedTestNum: DEMO_TEST_NUMS.VDD_CONT_R,
            injectedTestNums: [DEMO_TEST_NUMS.VDD_CONT_R],
            dominantFailSbin: 5,
            dominantFailHbin: 2,
            injectedFinalFailDieIds,
            injectedFirstPassFailDieIds,
            retestedDieIds,
            recoveredRetestDieIds,
          };

  return {
    preset,
    seed: resolvedSeed,
    stdfBytes,
    lotSpec,
    groundTruth,
  };
}

/**
 * Generates deterministic STDF V4 binary bytes for one of the three built-in demo lots.
 */
export function generateDemoStdfBytes(
  presetId: DemoPresetId,
  seed?: number,
): Uint8Array {
  return generateDemoLot(presetId, seed).stdfBytes;
}
