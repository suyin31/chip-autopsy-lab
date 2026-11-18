/**
 * Columnar LotModel builder, deterministic PRR retest resolver, HBIN_PF fallback,
 * and multi-source 4-neighbour wafer edge-ring BFS (`src/core/model/lot-builder.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 1.8, 1.9, 2.4, 4.2, 7.1, 7.2, 15.5, 17.7
 */

import {
  type BinPassFailFlag,
  type ParsedHbrRecord,
  type ParsedLotBuildInput,
  type ParsedPartExecution,
  type ParsedPtrExecution,
  type ParsedSbrRecord,
  type ParsedWcrRecord,
  type ParseWarning,
  PRR_PART_FLG,
  type PtrDefaultContext,
  packSiteKey,
  STDF_MISSING_COORD,
  STDF_RECORD_CODES,
} from '../stdf/types';
import {
  type BinDefinition,
  type ColumnarDies,
  type DieId,
  type LotModel,
  type ParametricTestColumn,
  packWaferCoord,
  type SiteKey,
  type TestSiteMeta,
  type WaferGeometry,
  type WaferSummaryMeta,
} from './types';

const MIN_VALID_I2_COORD = -32767;
const MAX_VALID_I2_COORD = 32767;
const DENSE_GRID_MAX_SPAN = 512;
const MAX_UINT8_SITES = 256;
const MAX_UINT16 = 0xffff;

interface ResolvedDieDraft {
  readonly waferIndex: number;
  readonly dieId: DieId;
  readonly x: number;
  readonly y: number;
  readonly hasValidCoords: boolean;
  readonly firstPrrOrder: number;
  readonly firstPass: boolean;
  readonly firstSiteKey: SiteKey;
  siteKey: SiteKey;
  finalPass: boolean;
  hbin: number;
  sbin: number;
  retestCount: number;
  ringIndex: number;
  finalPart: ParsedPartExecution;
}

function sanitizePlainText(raw: string): string {
  let clean = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      clean += raw[i]!;
    }
  }
  return clean;
}

function toBinPassFail(pf: BinPassFailFlag): 'P' | 'F' | 'U' {
  if (pf === 'P' || pf === 'F') {
    return pf;
  }
  return 'U';
}

function buildHbinMap(hbrs: readonly ParsedHbrRecord[]): ReadonlyMap<number, BinDefinition> {
  const accum = new Map<number, BinDefinition>();
  for (const h of hbrs) {
    const pf = toBinPassFail(h.hbinPf);
    const name = sanitizePlainText(h.hbinNam);
    const prev = accum.get(h.hbinNum);
    if (!prev) {
      accum.set(h.hbinNum, { code: h.hbinNum, name, passFail: pf });
      continue;
    }
    const isAllSiteSummary = h.headNum === 255;
    const nextName =
      isAllSiteSummary && name.length > 0
        ? name
        : prev.name.length > 0
          ? prev.name
          : name;
    const nextPf =
      isAllSiteSummary && pf !== 'U' ? pf : prev.passFail !== 'U' ? prev.passFail : pf;
    accum.set(h.hbinNum, {
      code: h.hbinNum,
      name: nextName,
      passFail: nextPf,
    });
  }

  const sortedCodes = Array.from(accum.keys()).sort((a, b) => a - b);
  const ordered = new Map<number, BinDefinition>();
  for (const code of sortedCodes) {
    ordered.set(code, accum.get(code)!);
  }
  return ordered;
}

function buildSbinMap(sbrs: readonly ParsedSbrRecord[]): ReadonlyMap<number, BinDefinition> {
  const accum = new Map<number, BinDefinition>();
  for (const s of sbrs) {
    const pf = toBinPassFail(s.sbinPf);
    const name = sanitizePlainText(s.sbinNam);
    const prev = accum.get(s.sbinNum);
    if (!prev) {
      accum.set(s.sbinNum, { code: s.sbinNum, name, passFail: pf });
      continue;
    }
    const isAllSiteSummary = s.headNum === 255;
    const nextName =
      isAllSiteSummary && name.length > 0
        ? name
        : prev.name.length > 0
          ? prev.name
          : name;
    const nextPf =
      isAllSiteSummary && pf !== 'U' ? pf : prev.passFail !== 'U' ? prev.passFail : pf;
    accum.set(s.sbinNum, {
      code: s.sbinNum,
      name: nextName,
      passFail: nextPf,
    });
  }

  const sortedCodes = Array.from(accum.keys()).sort((a, b) => a - b);
  const ordered = new Map<number, BinDefinition>();
  for (const code of sortedCodes) {
    ordered.set(code, accum.get(code)!);
  }
  return ordered;
}

function resolveWaferGeometry(wcr: ParsedWcrRecord | null): WaferGeometry {
  return {
    ...(wcr?.wafrSiz !== undefined ? { wfSize: wcr.wafrSiz } : {}),
    ...(wcr?.dieHt !== undefined ? { dieHt: wcr.dieHt } : {}),
    ...(wcr?.dieWid !== undefined ? { dieWid: wcr.dieWid } : {}),
    ...(wcr?.wfUnits !== undefined ? { wfUnits: wcr.wfUnits } : {}),
    wfFlat: wcr?.wfFlat ?? ' ',
    ...(wcr?.centerX !== undefined ? { centerX: wcr.centerX } : {}),
    ...(wcr?.centerY !== undefined ? { centerY: wcr.centerY } : {}),
    posX: wcr?.posX === 'L' ? 'L' : 'R',
    posY: wcr?.posY === 'D' ? 'D' : 'U',
  };
}

function resolveUniqueWaferId(
  wirWaferId: string | undefined,
  wrrWaferId: string | undefined,
  waferIndex: number,
  usedWaferIds: Set<string>,
): string {
  const cleanWir = wirWaferId !== undefined ? sanitizePlainText(wirWaferId).trim() : '';
  const cleanWrr = wrrWaferId !== undefined ? sanitizePlainText(wrrWaferId).trim() : '';
  const fallback = `W${String(waferIndex + 1).padStart(2, '0')}`;
  const baseId =
    cleanWir.length > 0 ? cleanWir : cleanWrr.length > 0 ? cleanWrr : fallback;

  if (!usedWaferIds.has(baseId)) {
    usedWaferIds.add(baseId);
    return baseId;
  }

  let suffix = waferIndex + 1;
  let candidate = `${baseId}#${suffix}`;
  while (usedWaferIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}#${suffix}`;
  }
  usedWaferIds.add(candidate);
  return candidate;
}

function isValidCoordPair(x: number, y: number): boolean {
  return (
    x !== STDF_MISSING_COORD &&
    y !== STDF_MISSING_COORD &&
    x >= MIN_VALID_I2_COORD &&
    x <= MAX_VALID_I2_COORD &&
    y >= MIN_VALID_I2_COORD &&
    y <= MAX_VALID_I2_COORD
  );
}

/**
 * Evaluates a single `PRR` execution's pass/fail status per Requirement 7.2:
 * - When `PART_FLG` bit 4 (`0x10`) is clear: fails iff bit 3 (`0x08`) is set.
 * - When `PART_FLG` bit 4 (`0x10`) is set: uses `HBR.HBIN_PF` for `hardBin`
 *   (`'P'` -> pass, `'F'` -> fail), falling back to fail + `missingHbinFlagWarning: true`
 *   when `HBR` lacks a `'P'`/`'F'` flag.
 */
export function resolvePartPassFail(
  partFlg: number,
  hardBin: number,
  hbins: ReadonlyMap<number, BinDefinition>,
): { readonly passed: boolean; readonly missingHbinFlagWarning: boolean } {
  if ((partFlg & PRR_PART_FLG.PF_INVALID) === 0) {
    return {
      passed: (partFlg & PRR_PART_FLG.FAILED) === 0,
      missingHbinFlagWarning: false,
    };
  }

  const pf = hbins.get(hardBin)?.passFail;
  if (pf === 'P') {
    return { passed: true, missingHbinFlagWarning: false };
  }
  if (pf === 'F') {
    return { passed: false, missingHbinFlagWarning: false };
  }
  return { passed: false, missingHbinFlagWarning: true };
}

/**
 * Computes the minimum 4-neighbour grid step count from each coordinate-bearing die
 * to a grid position outside the wafer's tested coordinate set (`ringIndex = 1` on
 * outermost dies, `0` when coordinates equal the missing sentinel `-32768`).
 */
export function computeWaferEdgeRingIndices(
  coords: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): Uint16Array {
  const n = coords.length;
  const out = new Uint16Array(n);
  if (n === 0) {
    return out;
  }

  const nodeIndexOfInput = new Int32Array(n).fill(-1);
  const coordToNode = new Map<number, number>();
  const uniqueX: number[] = [];
  const uniqueY: number[] = [];

  let minX = MAX_VALID_I2_COORD + 1;
  let maxX = MIN_VALID_I2_COORD - 1;
  let minY = MAX_VALID_I2_COORD + 1;
  let maxY = MIN_VALID_I2_COORD - 1;

  for (let i = 0; i < n; i += 1) {
    const c = coords[i]!;
    const x = c.x | 0;
    const y = c.y | 0;
    if (!isValidCoordPair(x, y)) {
      continue;
    }
    const packed = packWaferCoord(x, y);
    let nodeIdx = coordToNode.get(packed);
    if (nodeIdx === undefined) {
      nodeIdx = uniqueX.length;
      coordToNode.set(packed, nodeIdx);
      uniqueX.push(x);
      uniqueY.push(y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    nodeIndexOfInput[i] = nodeIdx;
  }

  const uniqueCount = uniqueX.length;
  if (uniqueCount === 0) {
    return out;
  }

  const dist = new Uint16Array(uniqueCount);
  const neighbours = new Int32Array(uniqueCount * 4);
  const queue = new Uint32Array(uniqueCount);
  let tail = 0;

  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;

  if (spanX <= DENSE_GRID_MAX_SPAN && spanY <= DENSE_GRID_MAX_SPAN) {
    const grid = new Int32Array(spanX * spanY).fill(-1);
    for (let u = 0; u < uniqueCount; u += 1) {
      grid[(uniqueX[u]! - minX) * spanY + (uniqueY[u]! - minY)] = u;
    }

    for (let u = 0; u < uniqueCount; u += 1) {
      const x = uniqueX[u]!;
      const y = uniqueY[u]!;
      const base = u * 4;
      const rowOffset = (x - minX) * spanY + (y - minY);

      const left = x > minX ? grid[rowOffset - spanY]! : -1;
      const right = x < maxX ? grid[rowOffset + spanY]! : -1;
      const down = y > minY ? grid[rowOffset - 1]! : -1;
      const up = y < maxY ? grid[rowOffset + 1]! : -1;

      neighbours[base] = left;
      neighbours[base + 1] = right;
      neighbours[base + 2] = down;
      neighbours[base + 3] = up;

      if (left < 0 || right < 0 || down < 0 || up < 0) {
        dist[u] = 1;
        queue[tail] = u;
        tail += 1;
      }
    }
  } else {
    const lookupNode = (nx: number, ny: number): number => {
      if (
        nx < MIN_VALID_I2_COORD ||
        nx > MAX_VALID_I2_COORD ||
        ny < MIN_VALID_I2_COORD ||
        ny > MAX_VALID_I2_COORD
      ) {
        return -1;
      }
      return coordToNode.get(packWaferCoord(nx, ny)) ?? -1;
    };

    for (let u = 0; u < uniqueCount; u += 1) {
      const x = uniqueX[u]!;
      const y = uniqueY[u]!;
      const base = u * 4;

      const left = lookupNode(x - 1, y);
      const right = lookupNode(x + 1, y);
      const down = lookupNode(x, y - 1);
      const up = lookupNode(x, y + 1);

      neighbours[base] = left;
      neighbours[base + 1] = right;
      neighbours[base + 2] = down;
      neighbours[base + 3] = up;

      if (left < 0 || right < 0 || down < 0 || up < 0) {
        dist[u] = 1;
        queue[tail] = u;
        tail += 1;
      }
    }
  }

  let head = 0;
  while (head < tail) {
    const u = queue[head]!;
    head += 1;
    const nextDist = dist[u]! < MAX_UINT16 ? dist[u]! + 1 : MAX_UINT16;
    const base = u * 4;
    for (let dir = 0; dir < 4; dir += 1) {
      const v = neighbours[base + dir]!;
      if (v >= 0 && dist[v] === 0) {
        dist[v] = nextDist;
        queue[tail] = v;
        tail += 1;
      }
    }
  }

  for (let i = 0; i < n; i += 1) {
    const nodeIdx = nodeIndexOfInput[i]!;
    if (nodeIdx >= 0) {
      out[i] = dist[nodeIdx]!;
    }
  }

  return out;
}

function buildTestSiteRegistry(
  input: ParsedLotBuildInput,
  prrSiteKeys: ReadonlySet<SiteKey>,
): {
  readonly sites: readonly TestSiteMeta[];
  readonly siteIndexByKey: ReadonlyMap<SiteKey, number>;
} {
  const orderedKeys = new Set<SiteKey>(prrSiteKeys);
  for (const sdr of input.sdrs) {
    const head = sdr.headNum & 0xff;
    for (const siteNum of sdr.siteNums) {
      if (orderedKeys.size >= MAX_UINT8_SITES) {
        break;
      }
      orderedKeys.add(packSiteKey(head, siteNum & 0xff));
    }
  }

  const sortedKeys = Array.from(orderedKeys).sort((a, b) => a - b);
  const cappedKeys =
    sortedKeys.length <= MAX_UINT8_SITES
      ? sortedKeys
      : sortedKeys.slice(0, MAX_UINT8_SITES);

  const sites: TestSiteMeta[] = [];
  const siteIndexByKey = new Map<SiteKey, number>();

  for (let idx = 0; idx < cappedKeys.length; idx += 1) {
    const key = cappedKeys[idx]!;
    const headNum = (key >>> 8) & 0xff;
    const siteNum = key & 0xff;
    sites.push({
      siteIndex: idx,
      headNum,
      siteNum,
      label: `${headNum}:${siteNum}`,
    });
    siteIndexByKey.set(key, idx);
  }

  if (sortedKeys.length > MAX_UINT8_SITES) {
    for (let i = MAX_UINT8_SITES; i < sortedKeys.length; i += 1) {
      siteIndexByKey.set(sortedKeys[i]!, MAX_UINT8_SITES - 1);
    }
  }

  return { sites, siteIndexByKey };
}

function buildParametricColumns(
  input: ParsedLotBuildInput,
  resolvedDies: readonly ResolvedDieDraft[],
): ReadonlyMap<number, ParametricTestColumn> {
  if (input.parseMode === 'bins-only') {
    return new Map<number, ParametricTestColumn>();
  }

  const metaByTestNum = new Map<number, PtrDefaultContext>();
  for (const [testNum, ctx] of input.ptrDefaults.entries()) {
    metaByTestNum.set(testNum, ctx);
  }

  // Fallback registration in case a caller constructed ParsedLotBuildInput directly without ptrDefaults
  for (const wf of input.wafers) {
    for (const part of wf.parts) {
      for (const ptr of part.ptrs) {
        if (!metaByTestNum.has(ptr.testNum)) {
          metaByTestNum.set(ptr.testNum, {
            testNum: ptr.testNum,
            testTxt: ptr.testTxt,
            units: ptr.units,
            resScal: ptr.resScal,
            llmScal: ptr.llmScal,
            hlmScal: ptr.hlmScal,
            loLimit: ptr.loLimit,
            hiLimit: ptr.hiLimit,
          });
        }
      }
    }
  }

  if (metaByTestNum.size === 0) {
    return new Map<number, ParametricTestColumn>();
  }

  const tsrNameFallback = new Map<number, string>();
  for (const tsr of input.tsrs) {
    if (tsr.testNam.length > 0 && !tsrNameFallback.has(tsr.testNum)) {
      const clean = sanitizePlainText(tsr.testNam);
      if (clean.length > 0) {
        tsrNameFallback.set(tsr.testNum, clean);
      }
    }
  }

  const dieCount = resolvedDies.length;
  const sortedTestNums = Array.from(metaByTestNum.keys()).sort((a, b) => a - b);
  const columns = new Map<number, ParametricTestColumn>();

  for (const testNum of sortedTestNums) {
    const meta = metaByTestNum.get(testNum)!;
    const cleanPtrName = sanitizePlainText(meta.testTxt);
    const testName =
      cleanPtrName.length > 0
        ? cleanPtrName
        : (tsrNameFallback.get(testNum) ?? '');
    const values = new Float32Array(dieCount);
    values.fill(Number.NaN);

    columns.set(testNum, {
      testNum,
      testName,
      units: sanitizePlainText(meta.units),
      resScal: meta.resScal,
      llmScal: meta.llmScal,
      hlmScal: meta.hlmScal,
      loLimit: meta.loLimit,
      hiLimit: meta.hiLimit,
      values,
    });
  }

  for (let dieIdx = 0; dieIdx < dieCount; dieIdx += 1) {
    const ptrs: readonly ParsedPtrExecution[] = resolvedDies[dieIdx]!.finalPart.ptrs;
    for (let p = 0; p < ptrs.length; p += 1) {
      const ptr = ptrs[p]!;
      const col = columns.get(ptr.testNum);
      if (col !== undefined) {
        col.values[dieIdx] = Number.isFinite(ptr.result) ? ptr.result : Number.NaN;
      }
    }
  }

  return columns;
}

/**
 * Resolves `ParsedLotBuildInput` into a flat columnar `LotModel`:
 * - Resolves repeated `(X_COORD, Y_COORD)` touchdowns within each wafer (first PRR ->
 *   `firstPass`/`firstSiteIndex`, last PRR -> `finalPass`/`hbin`/`sbin`/`siteIndex`/active `PTR`s,
 *   `retestCount = k - 1`)
 * - Preserves missing-coordinate parts (`-32768`) as distinct `<waferId>:part-<seq>` dies
 *   excluded from spatial grids (`hasValidCoords = 0`, `ringIndex = 0`)
 * - Applies `PART_FLG` bit 4 `HBR.HBIN_PF` fallback with `MISSING_HBIN_PF_FLAG` warnings
 * - Computes 4-neighbour wafer edge ring indices via multi-source BFS
 */
export function buildLotModel(input: ParsedLotBuildInput): LotModel {
  const warnings: ParseWarning[] = [...input.warnings];
  const hbins = buildHbinMap(input.hbrs);
  const sbins = buildSbinMap(input.sbrs);

  const prrSiteKeys = new Set<SiteKey>();
  const resolvedDies: ResolvedDieDraft[] = [];
  const waferSummaries: WaferSummaryMeta[] = [];
  const waferCoordIndex: ReadonlyMap<number, number>[] = [];
  const usedWaferIds = new Set<string>();

  for (let wIdx = 0; wIdx < input.wafers.length; wIdx += 1) {
    const wf = input.wafers[wIdx]!;
    const waferId = resolveUniqueWaferId(
      wf.wir?.waferId,
      wf.wrr?.waferId,
      wIdx,
      usedWaferIds,
    );
    const geometry = resolveWaferGeometry(wf.wcr ?? input.defaultWaferConfig);

    const dieStartIndex = resolvedDies.length;
    const coordToDieIndex = new Map<number, number>();
    let missingCoordSeq = 0;

    for (let pIdx = 0; pIdx < wf.parts.length; pIdx += 1) {
      const part = wf.parts[pIdx]!;
      const siteKey = packSiteKey(part.headNum & 0xff, part.siteNum & 0xff);
      prrSiteKeys.add(siteKey);

      const { passed, missingHbinFlagWarning } = resolvePartPassFail(
        part.partFlg,
        part.hardBin,
        hbins,
      );

      if (missingHbinFlagWarning) {
        warnings.push({
          code: 'MISSING_HBIN_PF_FLAG',
          byteOffset: part.byteOffset,
          recTyp: STDF_RECORD_CODES.PRR.recTyp,
          recSub: STDF_RECORD_CODES.PRR.recSub,
          detail: `PRR at byte ${part.byteOffset} sets PART_FLG bit 4 (pass/fail invalid), but HBR for HARD_BIN ${part.hardBin} lacks a valid 'P'/'F' HBIN_PF flag; classified as failing.`,
        });
      }

      const validCoords = isValidCoordPair(part.xCoord, part.yCoord);
      if (validCoords) {
        const packedCoord = packWaferCoord(part.xCoord, part.yCoord);
        const existingDieIdx = coordToDieIndex.get(packedCoord);
        if (existingDieIdx !== undefined) {
          const prev = resolvedDies[existingDieIdx]!;
          prev.siteKey = siteKey;
          prev.finalPass = passed;
          prev.hbin = part.hardBin & MAX_UINT16;
          prev.sbin = part.softBin & MAX_UINT16;
          prev.retestCount =
            prev.retestCount < MAX_UINT16 ? prev.retestCount + 1 : MAX_UINT16;
          prev.finalPart = part;
          continue;
        }

        const newDieIdx = resolvedDies.length;
        coordToDieIndex.set(packedCoord, newDieIdx);
        resolvedDies.push({
          waferIndex: wIdx,
          dieId: `${waferId}:${part.xCoord},${part.yCoord}`,
          x: part.xCoord,
          y: part.yCoord,
          hasValidCoords: true,
          firstPrrOrder: part.prrIndex >>> 0,
          firstPass: passed,
          firstSiteKey: siteKey,
          siteKey,
          finalPass: passed,
          hbin: part.hardBin & MAX_UINT16,
          sbin: part.softBin & MAX_UINT16,
          retestCount: 0,
          ringIndex: 0,
          finalPart: part,
        });
      } else {
        const seq = missingCoordSeq;
        missingCoordSeq += 1;
        resolvedDies.push({
          waferIndex: wIdx,
          dieId: `${waferId}:part-${seq}`,
          x: part.xCoord,
          y: part.yCoord,
          hasValidCoords: false,
          firstPrrOrder: part.prrIndex >>> 0,
          firstPass: passed,
          firstSiteKey: siteKey,
          siteKey,
          finalPass: passed,
          hbin: part.hardBin & MAX_UINT16,
          sbin: part.softBin & MAX_UINT16,
          retestCount: 0,
          ringIndex: 0,
          finalPart: part,
        });
      }
    }

    const dieEndIndex = resolvedDies.length;
    const validDieIndices: number[] = [];
    const validCoordsList: Array<{ readonly x: number; readonly y: number }> = [];

    let minX = MAX_VALID_I2_COORD + 1;
    let maxX = MIN_VALID_I2_COORD - 1;
    let minY = MAX_VALID_I2_COORD + 1;
    let maxY = MIN_VALID_I2_COORD - 1;

    for (let dIdx = dieStartIndex; dIdx < dieEndIndex; dIdx += 1) {
      const die = resolvedDies[dIdx]!;
      if (die.hasValidCoords) {
        validDieIndices.push(dIdx);
        validCoordsList.push({ x: die.x, y: die.y });
        if (die.x < minX) minX = die.x;
        if (die.x > maxX) maxX = die.x;
        if (die.y < minY) minY = die.y;
        if (die.y > maxY) maxY = die.y;
      }
    }

    let maxRingIndex = 0;
    if (validCoordsList.length > 0) {
      const rings = computeWaferEdgeRingIndices(validCoordsList);
      for (let i = 0; i < validDieIndices.length; i += 1) {
        const r = rings[i]!;
        resolvedDies[validDieIndices[i]!]!.ringIndex = r;
        if (r > maxRingIndex) {
          maxRingIndex = r;
        }
      }
    } else {
      minX = 0;
      maxX = 0;
      minY = 0;
      maxY = 0;
    }

    waferSummaries.push({
      waferIndex: wIdx,
      waferId,
      dieStartIndex,
      dieEndIndex,
      minX,
      maxX,
      minY,
      maxY,
      maxRingIndex,
      geometry,
    });
    waferCoordIndex.push(coordToDieIndex);
  }

  const { sites, siteIndexByKey } = buildTestSiteRegistry(input, prrSiteKeys);

  const count = resolvedDies.length;
  const colWaferIndex = new Uint16Array(count);
  const colX = new Int16Array(count);
  const colY = new Int16Array(count);
  const colHasValidCoords = new Uint8Array(count);
  const colFirstSiteIndex = new Uint8Array(count);
  const colSiteIndex = new Uint8Array(count);
  const colFirstPass = new Uint8Array(count);
  const colFinalPass = new Uint8Array(count);
  const colHbin = new Uint16Array(count);
  const colSbin = new Uint16Array(count);
  const colRetestCount = new Uint16Array(count);
  const colRingIndex = new Uint16Array(count);
  const colFirstPrrOrder = new Uint32Array(count);

  const dieIds: DieId[] = new Array<DieId>(count);
  const dieIndexById = new Map<DieId, number>();

  for (let i = 0; i < count; i += 1) {
    const d = resolvedDies[i]!;
    colWaferIndex[i] = d.waferIndex <= MAX_UINT16 ? d.waferIndex : MAX_UINT16;
    colX[i] = d.x;
    colY[i] = d.y;
    colHasValidCoords[i] = d.hasValidCoords ? 1 : 0;
    colFirstSiteIndex[i] = siteIndexByKey.get(d.firstSiteKey) ?? 0;
    colSiteIndex[i] = siteIndexByKey.get(d.siteKey) ?? 0;
    colFirstPass[i] = d.firstPass ? 1 : 0;
    colFinalPass[i] = d.finalPass ? 1 : 0;
    colHbin[i] = d.hbin;
    colSbin[i] = d.sbin;
    colRetestCount[i] = d.retestCount;
    colRingIndex[i] = d.ringIndex;
    colFirstPrrOrder[i] = d.firstPrrOrder;

    dieIds[i] = d.dieId;
    dieIndexById.set(d.dieId, i);
  }

  const dies: ColumnarDies = {
    count,
    waferIndex: colWaferIndex,
    x: colX,
    y: colY,
    hasValidCoords: colHasValidCoords,
    firstSiteIndex: colFirstSiteIndex,
    siteIndex: colSiteIndex,
    firstPass: colFirstPass,
    finalPass: colFinalPass,
    hbin: colHbin,
    sbin: colSbin,
    retestCount: colRetestCount,
    ringIndex: colRingIndex,
    firstPrrOrder: colFirstPrrOrder,
  };

  const tests = buildParametricColumns(input, resolvedDies);

  return {
    lotId: input.mir ? sanitizePlainText(input.mir.lotId) : '',
    partTyp: input.mir ? sanitizePlainText(input.mir.partTyp) : '',
    jobNam: input.mir ? sanitizePlainText(input.mir.jobNam) : '',
    parseMode: input.parseMode,
    endianness: input.endianness,
    wafers: waferSummaries,
    sites,
    hbins,
    sbins,
    dies,
    dieIds,
    dieIndexById,
    waferCoordIndex,
    tests,
    warnings,
  };
}

/**
 * Returns coordinate-bearing die indices on `waferIndex` pre-sorted in chronological
 * `PRR` touchdown order (`firstPrrOrder`) as a transferable `Uint32Array` (`redesign.md` §5.1).
 */
export function buildWaferProbeOrder(
  lot: LotModel,
  waferIndex: number,
): Uint32Array {
  const wafer = lot.wafers[waferIndex];
  if (!wafer) {
    return new Uint32Array(0);
  }
  const { hasValidCoords, firstPrrOrder } = lot.dies;
  const indices: number[] = [];
  for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
    if (hasValidCoords[i] !== 0) {
      indices.push(i);
    }
  }
  indices.sort((a, b) => {
    const diff = firstPrrOrder[a]! - firstPrrOrder[b]!;
    return diff !== 0 ? diff : a - b;
  });
  return Uint32Array.from(indices);
}
