/**
 * Columnar Lot, Wafer, Test Site, Bin, and Die domain models (`src/core/model/`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Uses flat transferable TypedArrays (`ColumnarDies`, `Float32Array` test columns)
 * to sustain sub-100 ms interactive cross-filtering up to 250,000 dies.
 *
 * Validates: Requirements 1.8, 1.9, 4.2, 7.1, 7.2, 15.5, 17.7
 */

import {
  type CpuEndianness,
  type ParseMode,
  type ParseWarning,
  STDF_MISSING_COORD,
} from '../stdf/types';

export { STDF_MISSING_COORD };

/**
 * Canonical string identifier uniquely addressing a resolved Die within a Lot:
 * - `<waferId>:<x>,<y>` when both coordinates are valid (`!== -32768`)
 * - `<waferId>:part-<seq>` when either X or Y equals the missing sentinel `-32768`
 */
export type DieId = string;

/** Packed 16-bit `(HEAD_NUM << 8) | SITE_NUM` test-site lookup key. */
export type SiteKey = number;

export type BinMode = 'SBIN' | 'HBIN';

export interface BinDefinition {
  readonly code: number;
  readonly name: string;
  readonly passFail: 'P' | 'F' | 'U';
}

export interface TestSiteMeta {
  /** Dense `0 .. S - 1` index stored in `ColumnarDies.firstSiteIndex` and `ColumnarDies.siteIndex`. */
  readonly siteIndex: number;
  readonly headNum: number;
  readonly siteNum: number;
  /** Human-readable clinical site label `<headNum>:<siteNum>`, e.g. `"1:2"`. */
  readonly label: string;
}

export interface WaferGeometry {
  readonly wfSize?: number;
  readonly dieHt?: number;
  readonly dieWid?: number;
  readonly wfUnits?: number;
  readonly wfFlat: 'U' | 'D' | 'L' | 'R' | ' ';
  readonly centerX?: number;
  readonly centerY?: number;
  /** Positive X axis direction from `WCR.POS_X` (defaults to `'R'`). */
  readonly posX: 'L' | 'R';
  /** Positive Y axis direction from `WCR.POS_Y` (defaults to `'U'`). */
  readonly posY: 'U' | 'D';
}

export interface WaferSummaryMeta {
  readonly waferIndex: number;
  /** Sanitized plain text from `WIR.WAFER_ID` (or `WRR.WAFER_ID`), falling back to `"W01"`. */
  readonly waferId: string;
  readonly dieStartIndex: number;
  /** Exclusive upper bound into `LotModel.dies` (`[dieStartIndex, dieEndIndex)`). */
  readonly dieEndIndex: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly maxRingIndex: number;
  readonly geometry: WaferGeometry;
}

/** Alias matching `WaferModel` terminology in `tasks.md` and architecture notes. */
export type WaferModel = WaferSummaryMeta;

export interface ParametricTestColumn {
  readonly testNum: number;
  readonly testName: string;
  readonly units: string;
  /** Power-of-10 display exponent ONLY (`displayed = baseValue * 10^resScal`). */
  readonly resScal: number;
  /** Power-of-10 display exponent ONLY for `loLimit`. */
  readonly llmScal: number;
  /** Power-of-10 display exponent ONLY for `hiLimit`. */
  readonly hlmScal: number;
  /** Base-unit low specification limit, or `null` when absent/disabled. */
  readonly loLimit: number | null;
  /** Base-unit high specification limit, or `null` when absent/disabled. */
  readonly hiLimit: number | null;
  /** Length === `lot.dies.count`; `NaN` indicates the die's final PRR did not execute this test. */
  readonly values: Float32Array;
}

/**
 * Flat columnar die attributes (23 bytes/die across TypedArrays).
 */
export interface ColumnarDies {
  readonly count: number;
  readonly waferIndex: Uint16Array;
  readonly x: Int16Array;
  readonly y: Int16Array;
  /** `1` when `x !== -32768 && y !== -32768`, else `0`. */
  readonly hasValidCoords: Uint8Array;
  /** Dense index into `LotModel.sites` from the die's chronologically first `PRR`. */
  readonly firstSiteIndex: Uint8Array;
  /** Dense index into `LotModel.sites` from the die's chronologically last `PRR`. */
  readonly siteIndex: Uint8Array;
  /** `1` = passed chronologically first `PRR`, `0` = failed. */
  readonly firstPass: Uint8Array;
  /** `1` = passed chronologically last `PRR`, `0` = failed. */
  readonly finalPass: Uint8Array;
  /** Chronologically last `PRR.HARD_BIN`. */
  readonly hbin: Uint16Array;
  /** Chronologically last `PRR.SOFT_BIN` (`65535` if omitted). */
  readonly sbin: Uint16Array;
  /** `totalPRRsAtDie - 1` (`0` when tested once). */
  readonly retestCount: Uint16Array;
  /** Minimum 4-neighbour steps to outside the wafer's tested coordinate set (`0` if no valid coords). */
  readonly ringIndex: Uint16Array;
  /** Chronological `PRR` index of the die's first touchdown (drives probe-sweep reveal). */
  readonly firstPrrOrder: Uint32Array;
}

export interface LotModel {
  readonly lotId: string;
  readonly partTyp: string;
  readonly jobNam: string;
  readonly parseMode: ParseMode;
  readonly endianness: CpuEndianness;
  readonly wafers: readonly WaferSummaryMeta[];
  readonly sites: readonly TestSiteMeta[];
  readonly hbins: ReadonlyMap<number, BinDefinition>;
  readonly sbins: ReadonlyMap<number, BinDefinition>;
  readonly dies: ColumnarDies;
  /** Canonical IDs indexed `0 .. dies.count - 1`. */
  readonly dieIds: readonly DieId[];
  readonly dieIndexById: ReadonlyMap<DieId, number>;
  /** Spatial `O(1)` lookup per wafer: `key = ((x + 32768) * 65536) + (y + 32768)`. */
  readonly waferCoordIndex: readonly ReadonlyMap<number, number>[];
  readonly tests: ReadonlyMap<number, ParametricTestColumn>;
  readonly warnings: readonly ParseWarning[];
}

/**
 * Packs signed 16-bit STDF `(x, y)` die coordinates into a collision-free
 * unsigned 32-bit safe integer key `((x + 32768) * 65536) + (y + 32768)`.
 */
export function packWaferCoord(x: number, y: number): number {
  return (x + 32768) * 65536 + (y + 32768);
}

export const packCoord = packWaferCoord;
