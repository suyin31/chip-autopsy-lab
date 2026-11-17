import { describe, expect, it } from 'vitest';
import { BinaryRecordBuilder } from './binary-cursor';
import {
  compressGzipBytes,
  decompressGzipStreamWithCeiling,
  hasGzipMagicBytes,
} from './gzip';
import { parseStdfBytes } from './stdf-parser';
import { writeStdfBytes } from './stdf-writer';
import {
  type CpuEndianness,
  PRR_PART_FLG,
  PTR_OPT_FLAG,
  PTR_TEST_FLG,
  STDF_MISSING_COORD,
  STDF_MISSING_U2,
  STDF_RECORD_CODES,
  type StdfWriteLotSpec,
} from './types';

function makeMinimalLotSpec(endianness: CpuEndianness = 'little'): StdfWriteLotSpec {
  return {
    endianness,
    mir: {
      lotId: 'LOT-MIN-01',
      partTyp: 'ASIC-A1',
      jobNam: 'SORT_V1',
    },
    wafers: [
      {
        wir: { waferId: 'W01' },
        parts: [
          {
            headNum: 1,
            siteNum: 1,
            partFlg: 0,
            hardBin: 1,
            softBin: 1,
            xCoord: 3,
            yCoord: -2,
          },
        ],
      },
    ],
    mrr: { dispCod: ' ' },
  };
}

describe('parseStdfBytes & gzip helpers (Requirements 1.3, 1.5-1.10, 2.1-2.5)', () => {
  it.each<CpuEndianness>(['big', 'little'])(
    'decodes all 16 STDF V4 record types identically across %s-endian FAR.CPU_TYPE',
    (endianness) => {
      const spec: StdfWriteLotSpec = {
        endianness,
        mir: {
          setupT: 1_700_000_000,
          startT: 1_700_000_010,
          statNum: 2,
          modeCod: 'P',
          lotId: 'CAL-END-01',
          partTyp: 'MCU-X9',
          jobNam: 'WAFER_SORT',
        },
        sdrs: [
          {
            headNum: 1,
            siteGrp: 1,
            siteNums: [1, 2],
            cardId: 'PROBE-CARD-7',
          },
        ],
        hbrs: [
          { hbinNum: 1, hbinCnt: 1, hbinPf: 'P', hbinNam: 'PASS' },
          { hbinNum: 4, hbinCnt: 1, hbinPf: 'F', hbinNam: 'IDDQ_FAIL' },
        ],
        sbrs: [
          { sbinNum: 1, sbinCnt: 1, sbinPf: 'P', sbinNam: 'GOOD' },
          { sbinNum: 7, sbinCnt: 1, sbinPf: 'F', sbinNam: 'IDDQ_LEAK' },
        ],
        wcr: {
          wafrSiz: 200,
          dieHt: 2.5,
          dieWid: 3.25,
          wfUnits: 3,
          wfFlat: 'D',
          centerX: 0,
          centerY: 0,
          posX: 'R',
          posY: 'U',
        },
        wafers: [
          {
            wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_100, waferId: 'W01' },
            touchdowns: [
              [
                {
                  headNum: 1,
                  siteNum: 1,
                  partFlg: 0,
                  hardBin: 1,
                  softBin: 1,
                  xCoord: -5,
                  yCoord: 8,
                  partId: 'D1',
                  ptrs: [
                    {
                      testNum: 204,
                      result: 0.0000042,
                      testTxt: 'IDDQ_LEAK',
                      resScal: 6,
                      llmScal: 6,
                      hlmScal: 6,
                      loLimit: 0,
                      hiLimit: 0.000015,
                      units: 'A',
                    },
                  ],
                  mprs: [
                    {
                      testNum: 501,
                      rtnIndx: [10, 11],
                      rtnStat: [0x01, 0x02],
                      rtnRslt: [1.1, 1.2],
                      testTxt: 'PIN_CONTINUITY',
                      loLimit: 0.2,
                      hiLimit: 1.8,
                      units: 'V',
                    },
                  ],
                  ftrs: [
                    {
                      testNum: 601,
                      testFlg: 0,
                      cyclCnt: 1024,
                      numFail: 0,
                      failPin: { bitCount: 5, bytes: new Uint8Array([0b0001_0101]) },
                      testTxt: 'BIST_SCAN',
                    },
                  ],
                },
                {
                  headNum: 1,
                  siteNum: 2,
                  partFlg: PRR_PART_FLG.FAILED,
                  hardBin: 4,
                  softBin: 7,
                  xCoord: -4,
                  yCoord: 8,
                  partId: 'D2',
                  ptrs: [
                    {
                      testNum: 204,
                      testFlg: PTR_TEST_FLG.FAILED,
                      result: 0.000031,
                      omitOptionalAfterResult: true,
                    },
                  ],
                },
              ],
            ],
            wrr: {
              headNum: 1,
              siteGrp: 1,
              finishT: 1_700_000_200,
              partCnt: 2,
              goodCnt: 1,
              waferId: 'W01',
            },
          },
        ],
        tsrs: [
          {
            headNum: 255,
            siteNum: 0,
            testTyp: 'P',
            testNum: 204,
            execCnt: 2,
            failCnt: 1,
            testNam: 'IDDQ_LEAK',
          },
        ],
        pcrs: [
          {
            headNum: 255,
            siteNum: 0,
            partCnt: 2,
            goodCnt: 1,
            rtstCnt: 0,
          },
        ],
        mrr: {
          finishT: 1_700_000_500,
          dispCod: '0',
          usrDesc: 'CLEAN_FINISH',
        },
      };

      const bytes = writeStdfBytes(spec);
      expect(bytes[4]).toBe(endianness === 'big' ? 1 : 2);

      const parsed = parseStdfBytes(bytes, { mode: 'full' });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const lot = parsed.value;
      expect(lot.endianness).toBe(endianness);
      expect(lot.warnings).toEqual([]);
      expect(lot.mir?.lotId).toBe('CAL-END-01');
      expect(lot.mir?.partTyp).toBe('MCU-X9');
      expect(lot.mir?.jobNam).toBe('WAFER_SORT');
      expect(lot.sdrs[0]?.siteNums).toEqual([1, 2]);
      expect(lot.sdrs[0]?.cardId).toBe('PROBE-CARD-7');
      expect(lot.hbrs).toHaveLength(2);
      expect(lot.sbrs).toHaveLength(2);
      expect(lot.defaultWaferConfig?.wafrSiz).toBe(200);
      expect(lot.defaultWaferConfig?.dieWid).toBe(3.25);
      expect(lot.defaultWaferConfig?.wfFlat).toBe('D');
      expect(lot.defaultWaferConfig?.posX).toBe('R');
      expect(lot.defaultWaferConfig?.posY).toBe('U');
      expect(lot.tsrs[0]?.testNum).toBe(204);
      expect(lot.tsrs[0]?.failCnt).toBe(1);
      expect(lot.pcrs[0]?.partCnt).toBe(2);
      expect(lot.mrr?.dispCod).toBe('0');

      expect(lot.wafers).toHaveLength(1);
      const parts = lot.wafers[0]!.parts;
      expect(parts).toHaveLength(2);
      expect(parts[0]?.xCoord).toBe(-5);
      expect(parts[0]?.yCoord).toBe(8);
      expect(parts[0]?.mprs[0]?.rtnRslt).toEqual(new Float32Array([1.1, 1.2]));
      expect(parts[0]?.ftrs[0]?.cyclCnt).toBe(1024);
      expect(parts[0]?.ftrs[0]?.failPin?.bitCount).toBe(5);
      expect(parts[1]?.xCoord).toBe(-4);
      expect(parts[1]?.hardBin).toBe(4);
      expect(parts[1]?.softBin).toBe(7);
      expect(parts[1]?.ptrs[0]?.result).toBe(Math.fround(0.000031));
      expect(parts[1]?.ptrs[0]?.hiLimit).toBe(Math.fround(0.000015));
    },
  );

  it('rejects invalid FAR headers, VAX CPU_TYPE=0, wrong STDF_VER, and zero-PRR streams (Requirement 2.2)', () => {
    // 1. Empty buffer
    const emptyRes = parseStdfBytes(new Uint8Array(0), { mode: 'full' });
    expect(emptyRes).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EMPTY_INPUT', byteOffset: 0 }),
    });

    // 2. Shorter than 6-byte FAR
    const tinyRes = parseStdfBytes(new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x02]), {
      mode: 'full',
    });
    expect(tinyRes).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'MISSING_FAR_HEADER', byteOffset: 0 }),
    });

    // 3. First record is MIR (1, 10) instead of FAR (0, 10)
    const nonFarRes = parseStdfBytes(
      new Uint8Array([0x02, 0x00, 0x01, 0x0a, 0x02, 0x04]),
      { mode: 'full' },
    );
    expect(nonFarRes).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'MISSING_FAR_HEADER', byteOffset: 0 }),
    });

    // 4. Malformed FAR REC_LEN = 0
    const zeroFarLenRes = parseStdfBytes(
      new Uint8Array([0x00, 0x00, 0x00, 0x0a, 0x00, 0x04]),
      { mode: 'full' },
    );
    expect(zeroFarLenRes).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'MISSING_FAR_HEADER', byteOffset: 0 }),
    });

    // 5. DEC VAX byte order (CPU_TYPE = 0)
    const vaxRes = parseStdfBytes(new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x00, 0x04]), {
      mode: 'full',
    });
    expect(vaxRes).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'UNSUPPORTED_CPU_TYPE_VAX', byteOffset: 4 }),
    });

    // 6. STDF V3 instead of V4
    const v3Res = parseStdfBytes(new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x02, 0x03]), {
      mode: 'full',
    });
    expect(v3Res).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'UNSUPPORTED_STDF_VERSION', byteOffset: 5 }),
    });

    // 7. Valid FAR + MIR + MRR with zero PRR records
    const zeroPrrBytes = writeStdfBytes({
      endianness: 'little',
      mir: { lotId: 'EMPTY', partTyp: 'P', jobNam: 'J' },
      wafers: [],
      mrr: { dispCod: ' ' },
    });
    const zeroPrrRes = parseStdfBytes(zeroPrrBytes, { mode: 'full' });
    expect(zeroPrrRes.ok).toBe(false);
    if (!zeroPrrRes.ok) {
      expect(zeroPrrRes.error.code).toBe('ZERO_VALID_PRR');
    }
  });

  it('decodes omitted optional trailing fields across record schemas without warnings (Requirement 1.7)', () => {
    const bytes = writeStdfBytes({
      endianness: 'little',
      mir: {
        lotId: 'OMIT-LOT',
        partTyp: 'CHIP-1',
        jobNam: 'JOB-1',
        omitOptionalAfterJobNam: true,
      },
      sdrs: [{ siteNums: [1], omitOptionalAfterCardId: true }],
      hbrs: [{ hbinNum: 1, hbinCnt: 2, omitTrailingFields: true }],
      sbrs: [{ sbinNum: 1, sbinCnt: 2, omitTrailingFields: true }],
      wafers: [
        {
          wir: { headNum: 1, omitWaferId: true },
          parts: [
            {
              headNum: 1,
              siteNum: 1,
              hardBin: 1,
              omitOptionalAfterHardBin: true,
              ptrs: [
                {
                  testNum: 10,
                  result: 1.25,
                  testTxt: 'VREF',
                  resScal: 3,
                  llmScal: 3,
                  hlmScal: 3,
                  loLimit: 1.1,
                  hiLimit: 1.4,
                  units: 'V',
                },
              ],
              mprs: [
                {
                  testNum: 20,
                  rtnRslt: [0.5, 0.6],
                  omitOptionalAfterResults: true,
                },
              ],
              ftrs: [{ testNum: 30, omitOptionalAfterTestFlg: true }],
            },
            {
              headNum: 1,
              siteNum: 1,
              hardBin: 1,
              softBin: 1,
              xCoord: 2,
              yCoord: 4,
              omitOptionalAfterCoords: true,
              ptrs: [{ testNum: 10, result: 1.28, omitOptionalAfterResult: true }],
            },
          ],
          wrr: { partCnt: 2, omitOptionalAfterPartCnt: true },
        },
      ],
      tsrs: [{ testNum: 10, testNam: 'VREF', omitOptionalAfterTestNam: true }],
      pcrs: [{ partCnt: 2, omitOptionalCounts: true }],
      mrr: { omitOptionalAfterFinishT: true },
    });

    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const lot = parsed.value;
    expect(lot.warnings).toEqual([]);
    expect(lot.mir?.jobRev).toBe('');
    expect(lot.mir?.operNam).toBe('');
    expect(lot.hbrs[0]?.hbinPf).toBe(' ');
    expect(lot.hbrs[0]?.hbinNam).toBe('');
    expect(lot.sbrs[0]?.sbinPf).toBe(' ');
    expect(lot.wafers[0]?.wir?.waferId).toBe('');
    expect(lot.wafers[0]?.wrr?.goodCnt).toBeUndefined();
    expect(lot.wafers[0]?.wrr?.waferId).toBe('');

    const p0 = lot.wafers[0]!.parts[0]!;
    expect(p0.softBin).toBe(STDF_MISSING_U2);
    expect(p0.xCoord).toBe(STDF_MISSING_COORD);
    expect(p0.yCoord).toBe(STDF_MISSING_COORD);
    expect(p0.partId).toBe('');

    const p1 = lot.wafers[0]!.parts[1]!;
    expect(p1.xCoord).toBe(2);
    expect(p1.yCoord).toBe(4);
    expect(p1.partId).toBe('');
    expect(p1.ptrs[0]?.units).toBe('V');
    expect(p1.ptrs[0]?.loLimit).toBe(Math.fround(1.1));
    expect(p1.ptrs[0]?.hiLimit).toBe(Math.fround(1.4));
    expect(lot.pcrs[0]?.goodCnt).toBeUndefined();
    expect(lot.mrr?.dispCod).toBe(' ');
  });

  it('inherits PTR defaults per TEST_NUM, honors OPT_FLAG bits 0/4/5/6/7, and keeps base units (Requirement 1.8)', () => {
    const bytes = writeStdfBytes({
      endianness: 'little',
      wafers: [
        {
          wir: { waferId: 'W01' },
          parts: [
            {
              // Die 1: establishes defaults for TEST_NUM 100 and single-sided TEST_NUM 200
              hardBin: 1,
              xCoord: 0,
              yCoord: 0,
              ptrs: [
                {
                  testNum: 100,
                  result: 0.0035, // 3.5 mV in base units (V)
                  testTxt: 'V_OFFSET',
                  optFlag: 0,
                  resScal: 3,
                  llmScal: 3,
                  hlmScal: 3,
                  loLimit: -0.005,
                  hiLimit: 0.005,
                  units: 'V',
                },
                {
                  testNum: 200,
                  result: 0.0000012,
                  testTxt: 'IDDQ',
                  optFlag: PTR_OPT_FLAG.NO_LO_LIMIT, // bit 6: no low limit
                  resScal: 6,
                  llmScal: 6,
                  hlmScal: 6,
                  loLimit: -999,
                  hiLimit: 0.000015,
                  units: 'A',
                },
              ],
            },
            {
              // Die 2: OPT_FLAG bits 0, 4, 5 set -> must inherit scales and limits from Die 1 despite garbage payload values
              hardBin: 1,
              xCoord: 1,
              yCoord: 0,
              ptrs: [
                {
                  testNum: 100,
                  result: 0.0041,
                  optFlag:
                    PTR_OPT_FLAG.RES_SCAL_INVALID |
                    PTR_OPT_FLAG.LO_LIMIT_INVALID |
                    PTR_OPT_FLAG.HI_LIMIT_INVALID,
                  resScal: 99,
                  llmScal: 99,
                  hlmScal: 99,
                  loLimit: -999,
                  hiLimit: 999,
                },
                {
                  // Compact 12-byte PTR inherits NO_LO_LIMIT (null) and hiLimit from TEST_NUM 200
                  testNum: 200,
                  result: 0.0000024,
                  omitOptionalAfterResult: true,
                },
              ],
            },
            {
              // Die 3: OPT_FLAG bits 6 & 7 override TEST_NUM 100 to have no low/high limits on this execution
              hardBin: 1,
              xCoord: 2,
              yCoord: 0,
              ptrs: [
                {
                  testNum: 100,
                  result: 0.002,
                  optFlag: PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.NO_HI_LIMIT,
                  loLimit: -1,
                  hiLimit: 1,
                },
                {
                  testNum: 200,
                  testFlg: PTR_TEST_FLG.NOT_EXECUTED,
                  result: 123.45,
                  omitOptionalAfterResult: true,
                },
              ],
            },
          ],
        },
      ],
    });

    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const [d1, d2, d3] = parsed.value.wafers[0]!.parts;

    // Base units strictly preserved (not multiplied by 10^3 = 3.5)
    expect(d1!.ptrs[0]!.result).toBe(Math.fround(0.0035));
    expect(d1!.ptrs[0]!.loLimit).toBe(Math.fround(-0.005));
    expect(d1!.ptrs[0]!.hiLimit).toBe(Math.fround(0.005));
    expect(d1!.ptrs[0]!.resScal).toBe(3);

    expect(d1!.ptrs[1]!.loLimit).toBeNull();
    expect(d1!.ptrs[1]!.hiLimit).toBe(Math.fround(0.000015));

    // Die 2 inherited defaults via OPT_FLAG bits 0, 4, 5 and compact omission
    expect(d2!.ptrs[0]!.testTxt).toBe('V_OFFSET');
    expect(d2!.ptrs[0]!.units).toBe('V');
    expect(d2!.ptrs[0]!.resScal).toBe(3);
    expect(d2!.ptrs[0]!.llmScal).toBe(3);
    expect(d2!.ptrs[0]!.hlmScal).toBe(3);
    expect(d2!.ptrs[0]!.loLimit).toBe(Math.fround(-0.005));
    expect(d2!.ptrs[0]!.hiLimit).toBe(Math.fround(0.005));

    expect(d2!.ptrs[1]!.testTxt).toBe('IDDQ');
    expect(d2!.ptrs[1]!.units).toBe('A');
    expect(d2!.ptrs[1]!.resScal).toBe(6);
    expect(d2!.ptrs[1]!.loLimit).toBeNull();
    expect(d2!.ptrs[1]!.hiLimit).toBe(Math.fround(0.000015));

    // Die 3 OPT_FLAG bits 6 & 7 clear limits; NOT_EXECUTED yields NaN without warning
    expect(d3!.ptrs[0]!.loLimit).toBeNull();
    expect(d3!.ptrs[0]!.hiLimit).toBeNull();
    expect(Number.isNaN(d3!.ptrs[1]!.result)).toBe(true);
    expect(parsed.value.warnings).toEqual([]);
  });

  it('routes interleaved multi-site PIR/PTR/PRR streams by (HEAD_NUM, SITE_NUM) and flags orphan/unclosed parts (Requirement 1.9)', () => {
    const baseBytes = writeStdfBytes({
      endianness: 'little',
      wafers: [
        {
          wir: { waferId: 'W01' },
          touchdowns: [
            [
              {
                headNum: 1,
                siteNum: 1,
                hardBin: 1,
                xCoord: 0,
                yCoord: 0,
                ptrs: [
                  { testNum: 1, result: 11.0, loLimit: 0, hiLimit: 20, units: 'mA' },
                  { testNum: 2, result: 21.0, loLimit: 0, hiLimit: 30, units: 'mA' },
                ],
              },
              {
                headNum: 1,
                siteNum: 2,
                hardBin: 1,
                xCoord: 1,
                yCoord: 0,
                ptrs: [
                  { testNum: 1, result: 12.0, omitOptionalAfterResult: true },
                  { testNum: 2, result: 22.0, omitOptionalAfterResult: true },
                ],
              },
              {
                headNum: 2,
                siteNum: 1, // Distinct HEAD_NUM with same SITE_NUM
                hardBin: 4,
                partFlg: PRR_PART_FLG.FAILED,
                xCoord: 0,
                yCoord: 1,
                ptrs: [
                  { testNum: 1, result: 99.0, omitOptionalAfterResult: true },
                  { testNum: 2, result: 23.0, omitOptionalAfterResult: true },
                ],
              },
            ],
          ],
          omitWrr: true,
        },
      ],
    });

    // Append an orphan PTR on (1, 9) + an unclosed PIR on (1, 4) before WRR
    const tail = new BinaryRecordBuilder('little');
    const orphanPtrHdr = tail.beginRecord(
      STDF_RECORD_CODES.PTR.recTyp,
      STDF_RECORD_CODES.PTR.recSub,
    );
    tail.writeU4(1);
    tail.writeU1(1);
    tail.writeU1(9);
    tail.writeB1(0);
    tail.writeB1(0);
    tail.writeR4(5.0);
    tail.endRecord(orphanPtrHdr);

    const unclosedPirHdr = tail.beginRecord(
      STDF_RECORD_CODES.PIR.recTyp,
      STDF_RECORD_CODES.PIR.recSub,
    );
    tail.writeU1(1);
    tail.writeU1(4);
    tail.endRecord(unclosedPirHdr);

    const wrrHdr = tail.beginRecord(
      STDF_RECORD_CODES.WRR.recTyp,
      STDF_RECORD_CODES.WRR.recSub,
    );
    tail.writeU1(1);
    tail.writeU1(255);
    tail.writeU4(100);
    tail.writeU4(3);
    tail.endRecord(wrrHdr);

    const tailBytes = tail.toUint8Array();
    const combined = new Uint8Array(baseBytes.byteLength + tailBytes.byteLength);
    combined.set(baseBytes, 0);
    combined.set(tailBytes, baseBytes.byteLength);

    const parsed = parseStdfBytes(combined, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const parts = parsed.value.wafers[0]!.parts;
    expect(parts).toHaveLength(3);
    expect(parts[0]!.headNum).toBe(1);
    expect(parts[0]!.siteNum).toBe(1);
    expect(parts[0]!.ptrs.map((p) => p.result)).toEqual([11, 21]);

    expect(parts[1]!.headNum).toBe(1);
    expect(parts[1]!.siteNum).toBe(2);
    expect(parts[1]!.ptrs.map((p) => p.result)).toEqual([12, 22]);

    expect(parts[2]!.headNum).toBe(2);
    expect(parts[2]!.siteNum).toBe(1);
    expect(parts[2]!.ptrs.map((p) => p.result)).toEqual([99, 23]);

    expect(parsed.value.warnings.map((w) => w.code)).toEqual([
      'ORPHAN_TEST_RECORD',
      'UNCLOSED_PIR_AT_WRR',
    ]);
  });

  it('skips unknown record types (including V4-2007 STR/PSR) by REC_LEN and skips PTR/MPR/FTR in bins-only mode (Requirements 1.6, 1.10, 2.5)', () => {
    const bytes = writeStdfBytes({
      endianness: 'big',
      mir: { lotId: 'SKIP-LOT', partTyp: 'P', jobNam: 'J' },
      unknownRecords: [
        { recTyp: 0, recSub: 20, payload: new Uint8Array([1, 2, 3, 4, 5]), position: 'after-mir' }, // ATR
        { recTyp: 50, recSub: 10, payload: new Uint8Array(33).fill(0xff), position: 'after-mir' }, // GDR
        { recTyp: 1, recSub: 90, payload: new Uint8Array([9, 8, 7]), position: 'before-mrr' }, // PSR (V4-2007)
        { recTyp: 15, recSub: 30, payload: new Uint8Array(19).fill(0xa5), position: 'before-mrr' }, // STR (V4-2007)
      ],
      wafers: [
        {
          wir: { waferId: 'W01' },
          parts: [
            {
              hardBin: 1,
              softBin: 1,
              xCoord: 5,
              yCoord: 5,
              ptrs: [{ testNum: 1, result: 1.0, loLimit: 0, hiLimit: 2, units: 'V' }],
              mprs: [{ testNum: 2, rtnRslt: [1.0] }],
              ftrs: [{ testNum: 3 }],
            },
            {
              // Retest of same coordinate (5, 5): should not double-count resolved dies in progress
              hardBin: 1,
              softBin: 1,
              xCoord: 5,
              yCoord: 5,
            },
          ],
        },
      ],
      mrr: { dispCod: ' ' },
    });

    const progressUpdates: Array<{ diesResolved: number; sweepLen: number }> = [];
    const fullRes = parseStdfBytes(bytes, {
      mode: 'full',
      onProgress: (p) => {
        progressUpdates.push({
          diesResolved: p.diesResolved,
          sweepLen: p.sweepBatch?.length ?? 0,
        });
      },
    });
    expect(fullRes.ok).toBe(true);
    if (!fullRes.ok) return;
    expect(fullRes.value.skippedRecordCount).toBe(4);
    expect(fullRes.value.warnings).toEqual([]);
    expect(fullRes.value.wafers[0]!.parts[0]!.ptrs).toHaveLength(1);
    expect(progressUpdates.at(-1)?.diesResolved).toBe(1);
    expect(progressUpdates.reduce((acc, u) => acc + u.sweepLen, 0)).toBe(6); // 2 PRRs * 3 ints

    const binsOnlyRes = parseStdfBytes(bytes, { mode: 'bins-only' });
    expect(binsOnlyRes.ok).toBe(true);
    if (!binsOnlyRes.ok) return;
    // 4 unknown records + 1 PTR + 1 MPR + 1 FTR = 7 skipped records
    expect(binsOnlyRes.value.skippedRecordCount).toBe(7);
    expect(binsOnlyRes.value.wafers[0]!.parts[0]!.ptrs).toEqual([]);
    expect(binsOnlyRes.value.wafers[0]!.parts[0]!.mprs).toEqual([]);
    expect(binsOnlyRes.value.wafers[0]!.parts[0]!.ftrs).toEqual([]);
  });

  it('recovers prior dies on truncated tail records and skips mid-stream malformed records by REC_LEN (Requirements 2.1, 2.3)', () => {
    const validBytes = writeStdfBytes({
      endianness: 'little',
      mir: { lotId: 'REC-LOT', partTyp: 'P', jobNam: 'J' },
      wafers: [
        {
          wir: { waferId: 'W01' },
          parts: [
            { hardBin: 1, softBin: 1, xCoord: 0, yCoord: 0 },
            { hardBin: 4, softBin: 7, partFlg: PRR_PART_FLG.FAILED, xCoord: 1, yCoord: 0 },
          ],
        },
      ],
      mrr: { dispCod: ' ' },
    });

    // 1. Truncated mid-body on the trailing MRR record
    const cutMidBody = validBytes.subarray(0, validBytes.byteLength - 2);
    const truncBodyRes = parseStdfBytes(cutMidBody, { mode: 'full' });
    expect(truncBodyRes.ok).toBe(true);
    if (truncBodyRes.ok) {
      expect(truncBodyRes.value.validPrrCount).toBe(2);
      expect(truncBodyRes.value.warnings).toHaveLength(1);
      expect(truncBodyRes.value.warnings[0]?.code).toBe('TRUNCATED_TAIL_RECORD');
      expect(truncBodyRes.value.warnings[0]?.recTyp).toBe(STDF_RECORD_CODES.MRR.recTyp);
      expect(truncBodyRes.value.warnings[0]?.recSub).toBe(STDF_RECORD_CODES.MRR.recSub);
    }

    // 2. Truncated 2-byte partial record header at EOF
    const withPartialHeader = new Uint8Array(validBytes.byteLength + 2);
    withPartialHeader.set(validBytes, 0);
    withPartialHeader[validBytes.byteLength] = 0x10;
    withPartialHeader[validBytes.byteLength + 1] = 0x00;
    const truncHdrRes = parseStdfBytes(withPartialHeader, { mode: 'full' });
    expect(truncHdrRes.ok).toBe(true);
    if (truncHdrRes.ok) {
      expect(truncHdrRes.value.validPrrCount).toBe(2);
      expect(truncHdrRes.value.warnings[0]?.code).toBe('TRUNCATED_TAIL_RECORD');
      expect(truncHdrRes.value.warnings[0]?.byteOffset).toBe(validBytes.byteLength);
    }

    // 3. Mid-stream malformed HBR whose C*n HBIN_NAM length byte (0x80) overflows REC_LEN
    const corruptHbrPayload = new Uint8Array([
      1, // HEAD_NUM
      1, // SITE_NUM
      1,
      0, // HBIN_NUM = 1
      10,
      0,
      0,
      0, // HBIN_CNT = 10
      0x50, // HBIN_PF = 'P'
      0x80, // HBIN_NAM C*n length = 128, but only 2 bytes follow inside REC_LEN!
      0x41,
      0x42,
    ]);
    const malformedStream = writeStdfBytes({
      endianness: 'little',
      mir: { lotId: 'MAL-LOT', partTyp: 'P', jobNam: 'J' },
      unknownRecords: [
        {
          recTyp: STDF_RECORD_CODES.HBR.recTyp,
          recSub: STDF_RECORD_CODES.HBR.recSub,
          payload: corruptHbrPayload,
          position: 'after-mir',
        },
      ],
      wafers: [
        {
          wir: { waferId: 'W01' },
          parts: [
            { hardBin: 1, softBin: 1, xCoord: 4, yCoord: 2 },
            { hardBin: 1, softBin: 1, xCoord: 5, yCoord: 2 },
          ],
        },
      ],
      mrr: { dispCod: ' ' },
    });

    const malRes = parseStdfBytes(malformedStream, { mode: 'full' });
    expect(malRes.ok).toBe(true);
    if (malRes.ok) {
      expect(malRes.value.validPrrCount).toBe(2);
      expect(malRes.value.wafers[0]!.parts.map((p) => p.xCoord)).toEqual([4, 5]);
      expect(malRes.value.warnings).toHaveLength(1);
      expect(malRes.value.warnings[0]?.code).toBe('MALFORMED_RECORD_FIELD');
      expect(malRes.value.warnings[0]?.recTyp).toBe(STDF_RECORD_CODES.HBR.recTyp);
      expect(malRes.value.warnings[0]?.recSub).toBe(STDF_RECORD_CODES.HBR.recSub);
    }
  });

  it('detects 0x1F 0x8B gzip magic bytes, round-trips compressed STDF, and enforces byte ceiling (Requirements 1.3, 2.2, 2.5)', async () => {
    const raw = writeStdfBytes(makeMinimalLotSpec('big'));
    expect(hasGzipMagicBytes(raw)).toBe(false);

    const gz = await compressGzipBytes(raw);
    expect(hasGzipMagicBytes(gz)).toBe(true);

    const okDecomp = await decompressGzipStreamWithCeiling(gz, 1024 * 1024);
    expect(okDecomp.kind).toBe('ok');
    if (okDecomp.kind === 'ok') {
      expect(okDecomp.bytes).toEqual(raw);
    }

    // Ceiling lower than uncompressed length halts immediately
    const capped = await decompressGzipStreamWithCeiling(gz, 10);
    expect(capped.kind).toBe('ceiling_exceeded');

    // Non-gzip buffer returns GZIP_DECOMPRESS_FAILED error
    const notGz = await decompressGzipStreamWithCeiling(raw, 1024);
    expect(notGz).toEqual({
      kind: 'error',
      error: expect.objectContaining({ code: 'GZIP_DECOMPRESS_FAILED' }),
    });

    // Corrupted gzip payload after magic bytes returns structured error without throwing
    const badGz = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff]);
    const badRes = await decompressGzipStreamWithCeiling(badGz, 1024);
    expect(badRes.kind).toBe('error');
    if (badRes.kind === 'error') {
      expect(badRes.error.code).toBe('GZIP_DECOMPRESS_FAILED');
    }
  });
});
