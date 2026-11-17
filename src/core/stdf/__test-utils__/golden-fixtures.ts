import { writeStdfBytes } from '../stdf-writer';
import {
  type CpuEndianness,
  PRR_PART_FLG,
  PTR_TEST_FLG,
  STDF_RECORD_CODES,
  type StdfWriteLotSpec,
} from '../types';

export type GoldenFixtureFileName =
  | 'golden-big-endian.stdf'
  | 'golden-little-endian.stdf'
  | 'golden-truncated.stdf'
  | 'golden-malformed.stdf';

export const GOLDEN_FIXTURE_NAMES: readonly GoldenFixtureFileName[] = [
  'golden-big-endian.stdf',
  'golden-little-endian.stdf',
  'golden-truncated.stdf',
  'golden-malformed.stdf',
] as const;

export function createCanonicalFixtureLotSpec(
  endianness: CpuEndianness,
): StdfWriteLotSpec {
  return {
    endianness,
    compactRepeatedPtrs: true,
    mir: {
      setupT: 1_730_000_000,
      startT: 1_730_000_015,
      statNum: 1,
      modeCod: 'P',
      lotId: 'CAL-GOLDEN-LOT',
      partTyp: 'CAL-DIE-REV2',
      nodeNam: 'ATE-LAB-01',
      tstrTyp: 'CAL-SIM',
      jobNam: 'GOLDEN_SORT_V4',
    },
    unknownRecords: [
      {
        // DTR (50, 30) skipped cleanly by REC_LEN
        recTyp: 50,
        recSub: 30,
        payload: new Uint8Array([0x04, 0x4e, 0x4f, 0x54, 0x45]),
        position: 'after-mir',
      },
    ],
    sdrs: [
      {
        headNum: 1,
        siteGrp: 1,
        siteNums: [1, 2],
        handTyp: 'PROBER_200MM',
        cardId: 'PC-QUAD-01',
      },
    ],
    hbrs: [
      { hbinNum: 1, hbinCnt: 2, hbinPf: 'P', hbinNam: 'PASS_BIN' },
      { hbinNum: 4, hbinCnt: 1, hbinPf: 'F', hbinNam: 'LEAK_BIN' },
    ],
    sbrs: [
      { sbinNum: 1, sbinCnt: 2, sbinPf: 'P', sbinNam: 'GOOD_DIE' },
      { sbinNum: 7, sbinCnt: 1, sbinPf: 'F', sbinNam: 'IDDQ_EDGE_LEAK' },
    ],
    wcr: {
      wafrSiz: 200,
      dieHt: 2.0,
      dieWid: 2.0,
      wfUnits: 3,
      wfFlat: 'D',
      centerX: 0,
      centerY: 0,
      posX: 'R',
      posY: 'U',
    },
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_730_000_100, waferId: 'W01' },
        touchdowns: [
          [
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              softBin: 1,
              xCoord: -2,
              yCoord: 3,
              partId: '1',
              ptrs: [
                {
                  testNum: 101,
                  result: 1.002,
                  testTxt: 'VDD_CORE',
                  resScal: 0,
                  llmScal: 0,
                  hlmScal: 0,
                  loLimit: 0.95,
                  hiLimit: 1.05,
                  units: 'V',
                },
                {
                  testNum: 204,
                  result: 0.0000038,
                  testTxt: 'IDDQ_LEAK',
                  resScal: 6,
                  llmScal: 6,
                  hlmScal: 6,
                  loLimit: null,
                  hiLimit: 0.000015,
                  units: 'A',
                },
              ],
            },
            {
              headNum: 1,
              siteNum: 2,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 4,
              softBin: 7,
              xCoord: -1,
              yCoord: 3,
              partId: '2',
              ptrs: [
                {
                  testNum: 101,
                  result: 0.998,
                  loLimit: 0.95,
                  hiLimit: 1.05,
                },
                {
                  testNum: 204,
                  testFlg: PTR_TEST_FLG.FAILED,
                  result: 0.0000285,
                  loLimit: null,
                  hiLimit: 0.000015,
                },
              ],
            },
          ],
        ],
        parts: [
          {
            // Retest on (-1, 3) recovering on second touchdown
            headNum: 1,
            siteNum: 1,
            partFlg: PRR_PART_FLG.SUPERSEDES_COORD,
            hardBin: 1,
            softBin: 1,
            xCoord: -1,
            yCoord: 3,
            partId: '3',
            ptrs: [
              { testNum: 101, result: 1.001, loLimit: 0.95, hiLimit: 1.05 },
              { testNum: 204, result: 0.0000049, loLimit: null, hiLimit: 0.000015 },
            ],
          },
        ],
        wrr: {
          headNum: 1,
          siteGrp: 1,
          finishT: 1_730_000_250,
          partCnt: 3,
          rtstCnt: 1,
          goodCnt: 2,
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
        execCnt: 3,
        failCnt: 1,
        testNam: 'IDDQ_LEAK',
      },
    ],
    pcrs: [
      {
        headNum: 255,
        siteNum: 0,
        partCnt: 3,
        rtstCnt: 1,
        goodCnt: 2,
      },
    ],
    mrr: {
      finishT: 1_730_000_300,
      dispCod: '0',
      usrDesc: 'GOLDEN_FIXTURE_COMPLETE',
    },
  };
}

/**
 * Deterministically builds all four golden STDF V4 binary fixtures via `writeStdfBytes`.
 */
export function buildGoldenStdfFixtures(): Readonly<
  Record<GoldenFixtureFileName, Uint8Array>
> {
  const bigEndian = writeStdfBytes(createCanonicalFixtureLotSpec('big'));
  const littleEndian = writeStdfBytes(createCanonicalFixtureLotSpec('little'));

  // Truncated fixture: valid little-endian lot with 3 PRRs, cut mid-body inside trailing MRR
  // so all 3 PRRs are preserved and TRUNCATED_TAIL_RECORD is emitted on MRR (1, 20).
  const truncated = littleEndian.slice(0, littleEndian.byteLength - 6);

  // Malformed fixture: deterministic little-endian stream containing a mid-stream SBR (1, 50)
  // whose REC_LEN fits inside the buffer (11 bytes) while its SBIN_NAM C*n length prefix (99)
  // overflows recordEnd; parser emits MALFORMED_RECORD_FIELD, skips by REC_LEN, and decodes W01.
  const malformedSbrPayload = new Uint8Array([
    255, // HEAD_NUM
    0, // SITE_NUM
    99,
    0, // SBIN_NUM = 99
    1,
    0,
    0,
    0, // SBIN_CNT = 1
    0x46, // SBIN_PF = 'F'
    99, // C*n length = 99, overflows 11-byte REC_LEN!
    0x58,
  ]);
  const baseSpec = createCanonicalFixtureLotSpec('little');
  const malformed = writeStdfBytes({
    ...baseSpec,
    unknownRecords: [
      ...(baseSpec.unknownRecords ?? []),
      {
        recTyp: STDF_RECORD_CODES.SBR.recTyp,
        recSub: STDF_RECORD_CODES.SBR.recSub,
        payload: malformedSbrPayload,
        position: 'after-mir',
      },
    ],
  });

  return {
    'golden-big-endian.stdf': bigEndian,
    'golden-little-endian.stdf': littleEndian,
    'golden-truncated.stdf': truncated,
    'golden-malformed.stdf': malformed,
  };
}
