import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStdfBytes } from '../stdf/stdf-parser';
import { writeStdfBytes } from '../stdf/stdf-writer';
import {
  PRR_PART_FLG,
  STDF_MISSING_COORD,
  STDF_MISSING_U2,
  type StdfWriteLotSpec,
} from '../stdf/types';
import {
  buildLotModel,
  computeWaferEdgeRingIndices,
  resolvePartPassFail,
} from './lot-builder';
import { type BinDefinition, packWaferCoord } from './types';

const fixturesDir = path.resolve(import.meta.dirname, '../../../tests/fixtures');

describe('resolvePartPassFail (Requirement 7.2)', () => {
  const hbins = new Map<number, BinDefinition>([
    [1, { code: 1, name: 'PASS_BIN', passFail: 'P' }],
    [4, { code: 4, name: 'LEAK_FAIL', passFail: 'F' }],
    [8, { code: 8, name: 'UNKNOWN_BIN', passFail: 'U' }],
  ]);

  it('uses PART_FLG bit 3 when bit 4 (PF_INVALID) is clear', () => {
    expect(resolvePartPassFail(0x00, 4, hbins)).toEqual({
      passed: true,
      missingHbinFlagWarning: false,
    });
    expect(resolvePartPassFail(PRR_PART_FLG.FAILED, 1, hbins)).toEqual({
      passed: false,
      missingHbinFlagWarning: false,
    });
    // Retest indicator bits (0x01 / 0x02) do not mark failure when bit 3 is clear
    expect(
      resolvePartPassFail(
        PRR_PART_FLG.SUPERSEDES_COORD | PRR_PART_FLG.SUPERSEDES_PART_ID,
        99,
        hbins,
      ),
    ).toEqual({
      passed: true,
      missingHbinFlagWarning: false,
    });
  });

  it('falls back to HBR.HBIN_PF when PART_FLG bit 4 (0x10) is set, ignoring bit 3', () => {
    expect(
      resolvePartPassFail(
        PRR_PART_FLG.PF_INVALID | PRR_PART_FLG.FAILED,
        1,
        hbins,
      ),
    ).toEqual({
      passed: true,
      missingHbinFlagWarning: false,
    });

    expect(resolvePartPassFail(PRR_PART_FLG.PF_INVALID, 4, hbins)).toEqual({
      passed: false,
      missingHbinFlagWarning: false,
    });
  });

  it('classifies as failing and signals MISSING_HBIN_PF_FLAG when bit 4 is set and HBIN_PF is missing or unknown', () => {
    expect(resolvePartPassFail(PRR_PART_FLG.PF_INVALID, 8, hbins)).toEqual({
      passed: false,
      missingHbinFlagWarning: true,
    });
    expect(resolvePartPassFail(PRR_PART_FLG.PF_INVALID, 404, hbins)).toEqual({
      passed: false,
      missingHbinFlagWarning: true,
    });
  });
});

describe('computeWaferEdgeRingIndices (Glossary & Requirement 12.2)', () => {
  it('assigns ringIndex 1..3 concentric rings on a 5x5 grid and 0 on missing coordinates', () => {
    const coords: Array<{ x: number; y: number }> = [];
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) {
        coords.push({ x, y });
      }
    }
    coords.push({ x: STDF_MISSING_COORD, y: 0 });
    coords.push({ x: 0, y: STDF_MISSING_COORD });

    const rings = computeWaferEdgeRingIndices(coords);
    expect(rings).toHaveLength(27);

    for (let i = 0; i < 25; i += 1) {
      const { x, y } = coords[i]!;
      const chebyshev = Math.max(Math.abs(x), Math.abs(y));
      // On a full square [-2..2]^2, 4-neighbour distance to outside equals 3 - max(|x|, |y|)
      expect(rings[i]).toBe(3 - chebyshev);
    }
    expect(rings[25]).toBe(0);
    expect(rings[26]).toBe(0);
  });

  it('treats untested interior holes and extreme Int16 sparse coordinates accurately', () => {
    // 3x3 square missing center (0, 0) -> every tested die touches an untested 4-neighbour => ring 1
    const donutCoords = [
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(Array.from(computeWaferEdgeRingIndices(donutCoords))).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1,
    ]);

    // Sparse extreme Int16 coordinates (triggers sparse Map fallback path > 512 span)
    const sparse = [
      { x: -32767, y: -32767 },
      { x: 32767, y: 32767 },
      { x: 32766, y: 32767 },
      { x: 32767, y: 32766 },
      { x: 32766, y: 32766 },
      { x: 32765, y: 32766 },
      { x: 32766, y: 32765 },
    ];
    const sparseRings = computeWaferEdgeRingIndices(sparse);
    // (32766, 32766) has all 4 neighbours in `sparse` -> ring 2; all others -> ring 1
    expect(Array.from(sparseRings)).toEqual([1, 1, 1, 1, 2, 1, 1]);
  });
});

describe('buildLotModel (Requirements 4.2, 7.1, 7.2)', () => {
  it('resolves multi-PRR retests without leaking superseded PTR values and handles missing coordinates', () => {
    const spec: StdfWriteLotSpec = {
      endianness: 'little',
      mir: {
        lotId: 'LOT-RT-01',
        partTyp: 'ASIC-X1',
        jobNam: 'WSORT_REV2',
      },
      sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2] }],
      hbrs: [
        { hbinNum: 1, hbinCnt: 2, hbinPf: 'P', hbinNam: 'GOOD' },
        { hbinNum: 4, hbinCnt: 1, hbinPf: 'F', hbinNam: 'IDDQ_FAIL' },
        { hbinNum: 9, hbinCnt: 1, omitTrailingFields: true }, // HBIN_PF omitted (' ')
      ],
      sbrs: [
        { sbinNum: 1, sbinCnt: 2, sbinPf: 'P', sbinNam: 'PASS' },
        { sbinNum: 7, sbinCnt: 1, sbinPf: 'F', sbinNam: 'LEAKAGE' },
      ],
      wcr: {
        wafrSiz: 200,
        dieHt: 5.0,
        dieWid: 5.0,
        wfUnits: 2,
        wfFlat: 'D',
        posX: 'L',
        posY: 'D',
      },
      wafers: [
        {
          wir: { headNum: 1, waferId: 'W01' },
          parts: [
            // Execution 0 at (2, 3) on Site 1: FAILS, executes Test 100 and Test 200
            {
              headNum: 1,
              siteNum: 1,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 4,
              softBin: 7,
              xCoord: 2,
              yCoord: 3,
              ptrs: [
                {
                  testNum: 100,
                  result: 1.05,
                  testTxt: 'VDD_MIN',
                  units: 'V',
                  resScal: 0,
                  loLimit: 0.9,
                  hiLimit: 1.1,
                },
                {
                  testNum: 200,
                  result: 42.5,
                  testTxt: 'IDDQ',
                  units: 'A',
                  resScal: 6,
                  loLimit: 0,
                  hiLimit: 15.0,
                },
              ],
            },
            // Execution 1 with missing X_COORD (-32768) and PART_FLG bit 4 set on HBIN 9 (no HBIN_PF -> warning!)
            {
              headNum: 1,
              siteNum: 1,
              partFlg: PRR_PART_FLG.PF_INVALID,
              hardBin: 9,
              softBin: 7,
              xCoord: STDF_MISSING_COORD,
              yCoord: 5,
            },
            // Execution 2 with missing coords again -> must NOT merge with Execution 1!
            {
              headNum: 1,
              siteNum: 2,
              partFlg: PRR_PART_FLG.PF_INVALID,
              hardBin: 1, // HBR says 'P' -> passes without warning
              omitOptionalAfterHardBin: true,
            },
            // Execution 3: Retest of (2, 3) on Site 2 -> PASSES, executes ONLY Test 100 (Test 200 must become NaN!)
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0,
              hardBin: 1,
              softBin: 1,
              xCoord: 2,
              yCoord: 3,
              ptrs: [
                {
                  testNum: 100,
                  result: 1.01,
                  omitOptionalAfterResult: true,
                },
              ],
            },
          ],
          wrr: { headNum: 1, partCnt: 4, waferId: 'W01' },
        },
      ],
    };

    const bytes = writeStdfBytes(spec);
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const lot = buildLotModel(parsed.value);

    expect(lot.lotId).toBe('LOT-RT-01');
    expect(lot.partTyp).toBe('ASIC-X1');
    expect(lot.jobNam).toBe('WSORT_REV2');
    expect(lot.wafers).toHaveLength(1);
    expect(lot.wafers[0]?.geometry).toEqual({
      wfSize: 200,
      dieHt: 5,
      dieWid: 5,
      wfUnits: 2,
      wfFlat: 'D',
      posX: 'L',
      posY: 'D',
    });

    // 3 resolved dies: W01:2,3, W01:part-0, W01:part-1
    expect(lot.dies.count).toBe(3);
    expect(lot.dieIds).toEqual(['W01:2,3', 'W01:part-0', 'W01:part-1']);
    expect(lot.dieIndexById.get('W01:2,3')).toBe(0);
    expect(lot.dieIndexById.get('W01:part-0')).toBe(1);
    expect(lot.dieIndexById.get('W01:part-1')).toBe(2);

    // Die 0: (2, 3) failed first pass on Site 1, passed final pass on Site 2, retestCount = 1
    expect(lot.dies.hasValidCoords[0]).toBe(1);
    expect(lot.dies.firstPass[0]).toBe(0);
    expect(lot.dies.finalPass[0]).toBe(1);
    expect(lot.dies.hbin[0]).toBe(1);
    expect(lot.dies.sbin[0]).toBe(1);
    expect(lot.dies.retestCount[0]).toBe(1);
    expect(lot.dies.ringIndex[0]).toBe(1);
    expect(lot.dies.firstPrrOrder[0]).toBe(0);
    expect(lot.sites[lot.dies.firstSiteIndex[0]!]?.label).toBe('1:1');
    expect(lot.sites[lot.dies.siteIndex[0]!]?.label).toBe('1:2');

    // Spatial index contains only (2, 3), not missing-coordinate parts
    expect(lot.waferCoordIndex[0]?.size).toBe(1);
    expect(lot.waferCoordIndex[0]?.get(packWaferCoord(2, 3))).toBe(0);

    // Die 1: missing X_COORD + PF_INVALID on HBIN 9 (no HBIN_PF) -> failed + 1 warning
    expect(lot.dies.hasValidCoords[1]).toBe(0);
    expect(lot.dies.ringIndex[1]).toBe(0);
    expect(lot.dies.firstPass[1]).toBe(0);
    expect(lot.dies.finalPass[1]).toBe(0);
    expect(lot.warnings).toHaveLength(1);
    expect(lot.warnings[0]?.code).toBe('MISSING_HBIN_PF_FLAG');

    // Die 2: missing coords + PF_INVALID on HBIN 1 ('P') -> passed, softBin = 65535
    expect(lot.dies.hasValidCoords[2]).toBe(0);
    expect(lot.dies.firstPass[2]).toBe(1);
    expect(lot.dies.finalPass[2]).toBe(1);
    expect(lot.dies.sbin[2]).toBe(STDF_MISSING_U2);

    // Parametric columns: Test 100 updated to 1.01 on Die 0; Test 200 cleared to NaN on Die 0!
    const col100 = lot.tests.get(100)!;
    const col200 = lot.tests.get(200)!;
    expect(col100.values[0]).toBeCloseTo(1.01, 5);
    expect(Number.isNaN(col200.values[0]!)).toBe(true);
    expect(col200.resScal).toBe(6); // Preserved as display exponent only
    expect(col200.hiLimit).toBeCloseTo(15.0, 5);
  });

  it('disambiguates missing or duplicate WIR.WAFER_IDs and builds identical LotModels from big- and little-endian golden fixtures', () => {
    const dupSpec: StdfWriteLotSpec = {
      endianness: 'little',
      wafers: [
        {
          wir: { headNum: 1, omitWaferId: true },
          parts: [{ hardBin: 1, xCoord: 0, yCoord: 0 }],
          wrr: { headNum: 1, partCnt: 1, omitOptionalAfterPartCnt: true },
        },
        {
          wir: { headNum: 1, waferId: 'W01' }, // Collides with Wafer 0's fallback "W01"!
          parts: [{ hardBin: 1, xCoord: 0, yCoord: 0 }],
          wrr: { headNum: 1, partCnt: 1, waferId: 'W01' },
        },
      ],
    };

    const dupParsed = parseStdfBytes(writeStdfBytes(dupSpec), { mode: 'full' });
    expect(dupParsed.ok).toBe(true);
    if (!dupParsed.ok) return;

    const dupLot = buildLotModel(dupParsed.value);
    expect(dupLot.wafers[0]?.waferId).toBe('W01');
    expect(dupLot.wafers[1]?.waferId).toBe('W01#2');
    expect(dupLot.dieIndexById.size).toBe(2);

    // Cross-endian golden fixture verification
    const beBytes = new Uint8Array(
      fs.readFileSync(path.join(fixturesDir, 'golden-big-endian.stdf')),
    );
    const leBytes = new Uint8Array(
      fs.readFileSync(path.join(fixturesDir, 'golden-little-endian.stdf')),
    );
    const beParsed = parseStdfBytes(beBytes, { mode: 'full' });
    const leParsed = parseStdfBytes(leBytes, { mode: 'full' });
    expect(beParsed.ok && leParsed.ok).toBe(true);
    if (!beParsed.ok || !leParsed.ok) return;

    const beLot = buildLotModel(beParsed.value);
    const leLot = buildLotModel(leParsed.value);

    expect({ ...beLot, endianness: 'little' }).toEqual(leLot);
  });
});
