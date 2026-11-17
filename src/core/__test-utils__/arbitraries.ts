import fc from 'fast-check';
import {
  type BinPassFailFlag,
  type BitArrayData,
  type CpuEndianness,
  PRR_PART_FLG,
  PTR_OPT_FLAG,
  PTR_TEST_FLG,
  STDF_MISSING_COORD,
  type StdfWriteFtrSpec,
  type StdfWriteHbrSpec,
  type StdfWriteLotSpec,
  type StdfWriteMprSpec,
  type StdfWritePartSpec,
  type StdfWritePtrSpec,
  type StdfWriteRawRecordSpec,
  type StdfWriteSbrSpec,
  type StdfWriteTouchdownSpec,
  type StdfWriteWaferSpec,
  type StdfWriteWcrSpec,
  type WaferAxisPosX,
  type WaferAxisPosY,
  type WaferFlatOrientation,
} from '../stdf/types';

const SAFE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.:/';

const arbSafeAscii = (minLength = 0, maxLength = 16): fc.Arbitrary<string> =>
  fc
    .array(fc.integer({ min: 0, max: SAFE_CHARS.length - 1 }), { minLength, maxLength })
    .map((indices) => indices.map((idx) => SAFE_CHARS[idx]!).join(''));

const arbNonEmptySafeAscii = (maxLength = 16): fc.Arbitrary<string> =>
  arbSafeAscii(1, maxLength);

const arbEndianness: fc.Arbitrary<CpuEndianness> = fc.constantFrom('big', 'little');

const arbBinPf: fc.Arbitrary<BinPassFailFlag> = fc.constantFrom('P', 'F', ' ');

const arbFiniteR4: fc.Arbitrary<number> = fc
  .float({ min: -1_000, max: 1_000, noNaN: true, noDefaultInfinity: true })
  .map((v) => (Object.is(v, -0) ? 0 : Math.fround(v)));

const arbPositiveR4: fc.Arbitrary<number> = fc
  .float({ min: Math.fround(0.25), max: 500, noNaN: true, noDefaultInfinity: true })
  .map((v) => Math.fround(v));

interface GeneratedTestTemplate {
  readonly testNum: number;
  readonly testTxt: string;
  readonly units: string;
  readonly resScal: number;
  readonly llmScal: number;
  readonly hlmScal: number;
  readonly loLimit: number | null;
  readonly hiLimit: number | null;
}

const arbTestCatalog: fc.Arbitrary<readonly GeneratedTestTemplate[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 9_999 }), { minLength: 1, maxLength: 4 })
  .chain((testNums) =>
    fc.tuple(
      ...testNums.map((testNum) =>
        fc
          .record({
            testTxt: arbNonEmptySafeAscii(12),
            units: fc.constantFrom('V', 'A', 'Hz', 'Ohm', ''),
            resScal: fc.integer({ min: -9, max: 9 }),
            llmScal: fc.integer({ min: -9, max: 9 }),
            hlmScal: fc.integer({ min: -9, max: 9 }),
            loLimit: fc.option(arbFiniteR4, { nil: null }),
            hiLimit: fc.option(arbFiniteR4, { nil: null }),
          })
          .map(
            (meta): GeneratedTestTemplate => ({
              testNum,
              testTxt: meta.testTxt,
              units: meta.units,
              resScal: meta.resScal,
              llmScal: meta.loLimit !== null ? meta.llmScal : 0,
              hlmScal: meta.hiLimit !== null ? meta.hlmScal : 0,
              loLimit: meta.loLimit,
              hiLimit: meta.hiLimit,
            }),
          ),
      ),
    ),
  );

const arbWcrSpec: fc.Arbitrary<StdfWriteWcrSpec> = fc.record({
  wafrSiz: fc.option(arbPositiveR4, { nil: undefined }),
  dieHt: fc.option(arbPositiveR4, { nil: undefined }),
  dieWid: fc.option(arbPositiveR4, { nil: undefined }),
  wfUnits: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
  wfFlat: fc.constantFrom<WaferFlatOrientation>('U', 'D', 'L', 'R', ' '),
  centerX: fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined }),
  centerY: fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined }),
  posX: fc.constantFrom<WaferAxisPosX>('L', 'R', ' '),
  posY: fc.constantFrom<WaferAxisPosY>('U', 'D', ' '),
});

const UNKNOWN_RECORD_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 20], // ATR
  [1, 60], // PMR
  [1, 90], // PSR (STDF V4-2007)
  [15, 30], // STR (STDF V4-2007)
  [50, 10], // GDR
  [50, 30], // DTR
];

const arbUnknownRecord: fc.Arbitrary<StdfWriteRawRecordSpec> = fc
  .record({
    pair: fc.constantFrom(...UNKNOWN_RECORD_PAIRS),
    payload: fc.uint8Array({ minLength: 0, maxLength: 24 }),
    position: fc.constantFrom<'after-mir' | 'before-mrr'>('after-mir', 'before-mrr'),
  })
  .map(({ pair, payload, position }) => ({
    recTyp: pair[0],
    recSub: pair[1],
    payload,
    position,
  }));

function buildPtrSpecArbitrary(
  tpl: GeneratedTestTemplate,
  isFirstInLot: boolean,
): fc.Arbitrary<StdfWritePtrSpec> {
  if (isFirstInLot) {
    return fc
      .record({
        result: arbFiniteR4,
        failed: fc.boolean(),
        invalidResult: fc.boolean(),
      })
      .map(
        ({ result, failed, invalidResult }): StdfWritePtrSpec => ({
          testNum: tpl.testNum,
          testFlg:
            (failed ? PTR_TEST_FLG.FAILED : 0) |
            (invalidResult ? PTR_TEST_FLG.RESULT_INVALID : 0),
          result,
          testTxt: tpl.testTxt,
          resScal: tpl.resScal,
          llmScal: tpl.llmScal,
          hlmScal: tpl.hlmScal,
          loLimit: tpl.loLimit,
          hiLimit: tpl.hiLimit,
          units: tpl.units,
        }),
      );
  }

  return fc
    .record({
      result: arbFiniteR4,
      failed: fc.boolean(),
      encodingKind: fc.constantFrom<'compact' | 'inherit-flags' | 'no-limits' | 'explicit'>(
        'compact',
        'inherit-flags',
        'no-limits',
        'explicit',
      ),
      overrideLo: arbFiniteR4,
      overrideHi: arbFiniteR4,
    })
    .map(({ result, failed, encodingKind, overrideLo, overrideHi }): StdfWritePtrSpec => {
      const testFlg = failed ? PTR_TEST_FLG.FAILED : 0;
      switch (encodingKind) {
        case 'compact':
          return {
            testNum: tpl.testNum,
            testFlg,
            result,
            omitOptionalAfterResult: true,
          };
        case 'inherit-flags':
          return {
            testNum: tpl.testNum,
            testFlg,
            result,
            optFlag:
              PTR_OPT_FLAG.RES_SCAL_INVALID |
              PTR_OPT_FLAG.LO_LIMIT_INVALID |
              PTR_OPT_FLAG.HI_LIMIT_INVALID,
            resScal: 42,
            llmScal: 42,
            hlmScal: 42,
            loLimit: 777,
            hiLimit: 888,
          };
        case 'no-limits':
          return {
            testNum: tpl.testNum,
            testFlg,
            result,
            optFlag: PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.NO_HI_LIMIT,
            resScal: tpl.resScal,
            loLimit: -123,
            hiLimit: 123,
          };
        case 'explicit':
          return {
            testNum: tpl.testNum,
            testFlg,
            result,
            resScal: tpl.resScal,
            llmScal: tpl.llmScal,
            hlmScal: tpl.hlmScal,
            loLimit: overrideLo,
            hiLimit: overrideHi,
            units: tpl.units,
          };
      }
    });
}

const arbBitArrayData: fc.Arbitrary<BitArrayData> = fc
  .integer({ min: 0, max: 20 })
  .chain((bitCount) => {
    const byteCount = (bitCount + 7) >>> 3;
    return fc
      .uint8Array({ minLength: byteCount, maxLength: byteCount })
      .map((rawBytes): BitArrayData => {
        const bytes = rawBytes.slice();
        if (byteCount > 0) {
          const remBits = bitCount & 7;
          if (remBits !== 0) {
            bytes[byteCount - 1] = bytes[byteCount - 1]! & ((1 << remBits) - 1);
          }
        }
        return { bitCount, bytes };
      });
  });

export const arbMprSpec: fc.Arbitrary<StdfWriteMprSpec> = fc
  .record({
    testNum: fc.integer({ min: 10_000, max: 10_003 }),
    failed: fc.boolean(),
    rtnRslt: fc.array(arbFiniteR4, { minLength: 1, maxLength: 3 }),
    testTxt: arbNonEmptySafeAscii(10),
    resScal: fc.integer({ min: -6, max: 6 }),
    loLimit: fc.option(arbFiniteR4, { nil: null }),
    hiLimit: fc.option(arbFiniteR4, { nil: null }),
    units: fc.constantFrom('V', 'A', 'Ohm', ''),
    omitOptionalAfterResults: fc.boolean(),
  })
  .chain((raw) => {
    const pinCnt = raw.rtnRslt.length;
    return fc
      .record({
        rtnIndx: fc.array(fc.integer({ min: 1, max: 64 }), {
          minLength: pinCnt,
          maxLength: pinCnt,
        }),
        rtnStat: fc.array(fc.integer({ min: 0, max: 15 }), {
          minLength: pinCnt,
          maxLength: pinCnt,
        }),
      })
      .map(
        ({ rtnIndx, rtnStat }): StdfWriteMprSpec => ({
          testNum: raw.testNum,
          testFlg: raw.failed ? PTR_TEST_FLG.FAILED : 0,
          rtnStat,
          rtnRslt: raw.rtnRslt,
          rtnIndx,
          testTxt: raw.testTxt,
          resScal: raw.resScal,
          llmScal: raw.loLimit !== null ? raw.resScal : 0,
          hlmScal: raw.hiLimit !== null ? raw.resScal : 0,
          loLimit: raw.loLimit,
          hiLimit: raw.hiLimit,
          units: raw.units,
          omitOptionalAfterResults: raw.omitOptionalAfterResults,
        }),
      );
  });

export const arbFtrSpec: fc.Arbitrary<StdfWriteFtrSpec> = fc.record({
  testNum: fc.integer({ min: 20_000, max: 20_005 }),
  testFlg: fc.constantFrom(0, PTR_TEST_FLG.FAILED),
  cyclCnt: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
  numFail: fc.option(fc.integer({ min: 0, max: 64 }), { nil: undefined }),
  xfailAd: fc.option(fc.integer({ min: -512, max: 512 }), { nil: undefined }),
  yfailAd: fc.option(fc.integer({ min: -512, max: 512 }), { nil: undefined }),
  failPin: fc.option(arbBitArrayData, { nil: undefined }),
  testTxt: arbSafeAscii(0, 10),
  omitOptionalAfterTestFlg: fc.boolean(),
});

function buildPartArbitrary(
  headNum: number,
  siteNum: number,
  hbinCodes: readonly number[],
  sbinCodes: readonly number[],
  catalog: readonly GeneratedTestTemplate[],
  isFirstTouchdownPart: boolean,
  coordPool: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): fc.Arbitrary<StdfWritePartSpec> {
  const ptrArbs = catalog.map((tpl) => buildPtrSpecArbitrary(tpl, isFirstTouchdownPart));

  return fc
    .record({
      partFlgKind: fc.constantFrom<'pass' | 'fail' | 'pf-invalid'>(
        'pass',
        'fail',
        'pf-invalid',
      ),
      hardBinIdx: fc.integer({ min: 0, max: hbinCodes.length - 1 }),
      softBinIdx: fc.integer({ min: 0, max: sbinCodes.length - 1 }),
      coordChoice: fc.integer({ min: -1, max: coordPool.length - 1 }), // -1 => missing coords (-32768)
      omitMode: fc.constantFrom<'none' | 'after-hardbin' | 'after-coords'>(
        'none',
        'after-hardbin',
        'after-coords',
      ),
      partId: arbSafeAscii(0, 8),
      ptrs: fc.tuple(...ptrArbs),
      mprs: fc.array(arbMprSpec, { minLength: 0, maxLength: 1 }),
      ftrs: fc.array(arbFtrSpec, { minLength: 0, maxLength: 1 }),
    })
    .map((raw): StdfWritePartSpec => {
      const partFlg =
        raw.partFlgKind === 'fail'
          ? PRR_PART_FLG.FAILED
          : raw.partFlgKind === 'pf-invalid'
            ? PRR_PART_FLG.PF_INVALID
            : 0;
      const hardBin = hbinCodes[raw.hardBinIdx]!;
      const softBin = sbinCodes[raw.softBinIdx]!;
      const coord = raw.coordChoice >= 0 ? coordPool[raw.coordChoice]! : null;
      const xCoord = coord !== null ? coord.x : STDF_MISSING_COORD;
      const yCoord = coord !== null ? coord.y : STDF_MISSING_COORD;

      if (raw.omitMode === 'after-hardbin') {
        return {
          headNum,
          siteNum,
          partFlg,
          hardBin,
          omitOptionalAfterHardBin: true,
          ptrs: raw.ptrs,
          mprs: raw.mprs,
          ftrs: raw.ftrs,
        };
      }
      if (raw.omitMode === 'after-coords') {
        return {
          headNum,
          siteNum,
          partFlg,
          hardBin,
          softBin,
          xCoord,
          yCoord,
          omitOptionalAfterCoords: true,
          ptrs: raw.ptrs,
          mprs: raw.mprs,
          ftrs: raw.ftrs,
        };
      }
      return {
        headNum,
        siteNum,
        partFlg,
        hardBin,
        softBin,
        xCoord,
        yCoord,
        partId: raw.partId,
        ptrs: raw.ptrs,
        mprs: raw.mprs,
        ftrs: raw.ftrs,
      };
    });
}

/**
 * Shared composable arbitrary generating valid STDF V4 lot write specifications across:
 * - Big-endian (`CPU_TYPE = 1`) and little-endian (`CPU_TYPE = 2`)
 * - Single and multiple wafers (`1..3` wafers) with WIR/WRR/WCR geometry
 * - Concurrent multi-site interleaved `PIR`/`PTR`/`PRR` touchdowns + repeated `(x, y)` retests
 * - `PTR` default inheritance by `TEST_NUM` (compact trailing truncation + `OPT_FLAG` bits)
 * - Omitted optional trailing fields across record schemas and skipped unknown records
 */
export const arbStdfWriteLotSpec: fc.Arbitrary<StdfWriteLotSpec> = fc
  .record({
    endianness: arbEndianness,
    compactRepeatedPtrs: fc.boolean(),
    siteNums: fc.uniqueArray(fc.integer({ min: 1, max: 8 }), {
      minLength: 1,
      maxLength: 4,
    }),
    hbinCodes: fc.uniqueArray(fc.integer({ min: 1, max: 32 }), {
      minLength: 2,
      maxLength: 4,
    }),
    sbinCodes: fc.uniqueArray(fc.integer({ min: 1, max: 64 }), {
      minLength: 2,
      maxLength: 4,
    }),
    catalog: arbTestCatalog,
    waferCount: fc.integer({ min: 1, max: 3 }),
  })
  .chain(
    ({
      endianness,
      compactRepeatedPtrs,
      siteNums,
      hbinCodes,
      sbinCodes,
      catalog,
      waferCount,
    }) => {
      // Small coordinate pool (4 coords) so multiple touchdowns naturally produce retests!
      const coordPool = [
        { x: -3, y: -2 },
        { x: 0, y: 0 },
        { x: 4, y: -1 },
        { x: 2, y: 5 },
      ];

      const hbrArbs = hbinCodes.map((hbinNum, idx) =>
        fc
          .record({
            hbinCnt: fc.integer({ min: 0, max: 100 }),
            hbinPf: idx === 0 ? fc.constant<BinPassFailFlag>('P') : arbBinPf,
            hbinNam: arbSafeAscii(0, 10),
            omitTrailingFields: idx > 0 ? fc.boolean() : fc.constant(false),
          })
          .map(
            (r): StdfWriteHbrSpec => ({
              hbinNum,
              hbinCnt: r.hbinCnt,
              hbinPf: r.hbinPf,
              hbinNam: r.hbinNam,
              omitTrailingFields: r.omitTrailingFields,
            }),
          ),
      );

      const sbrArbs = sbinCodes.map((sbinNum, idx) =>
        fc
          .record({
            sbinCnt: fc.integer({ min: 0, max: 100 }),
            sbinPf: idx === 0 ? fc.constant<BinPassFailFlag>('P') : arbBinPf,
            sbinNam: arbSafeAscii(0, 10),
            omitTrailingFields: fc.boolean(),
          })
          .map(
            (r): StdfWriteSbrSpec => ({
              sbinNum,
              sbinCnt: r.sbinCnt,
              sbinPf: r.sbinPf,
              sbinNam: r.sbinNam,
              omitTrailingFields: r.omitTrailingFields,
            }),
          ),
      );

      const waferArbs: fc.Arbitrary<StdfWriteWaferSpec>[] = [];
      for (let w = 0; w < waferCount; w += 1) {
        const td0Arb: fc.Arbitrary<StdfWriteTouchdownSpec> = fc.tuple(
          ...siteNums.map((siteNum, sIdx) =>
            buildPartArbitrary(
              1,
              siteNum,
              hbinCodes,
              sbinCodes,
              catalog,
              w === 0 && sIdx === 0,
              coordPool,
            ),
          ),
        );
        const td1Arb: fc.Arbitrary<StdfWriteTouchdownSpec> = fc.tuple(
          ...siteNums.map((siteNum) =>
            buildPartArbitrary(
              1,
              siteNum,
              hbinCodes,
              sbinCodes,
              catalog,
              false,
              coordPool,
            ),
          ),
        );

        waferArbs.push(
          fc
            .record({
              waferId: arbNonEmptySafeAscii(8),
              omitWaferId: fc.boolean(),
              hasCustomWcr: fc.boolean(),
              wcr: arbWcrSpec,
              secondTouchdown: fc.boolean(),
              td0: td0Arb,
              td1: td1Arb,
              omitOptionalAfterPartCnt: fc.boolean(),
            })
            .map((wf): StdfWriteWaferSpec => {
              const touchdowns = wf.secondTouchdown ? [wf.td0, wf.td1] : [wf.td0];
              const totalParts = touchdowns.reduce((acc, td) => acc + td.length, 0);
              return {
                wir: {
                  headNum: 1,
                  siteGrp: 1,
                  startT: 1_700_000_100 + w * 100,
                  waferId: wf.waferId,
                  omitWaferId: wf.omitWaferId,
                },
                ...(wf.hasCustomWcr ? { wcr: wf.wcr } : {}),
                touchdowns,
                wrr: {
                  headNum: 1,
                  siteGrp: 1,
                  finishT: 1_700_000_150 + w * 100,
                  partCnt: totalParts,
                  waferId: wf.waferId,
                  omitOptionalAfterPartCnt: wf.omitOptionalAfterPartCnt,
                },
              };
            }),
        );
      }

      return fc
        .record({
          lotId: arbNonEmptySafeAscii(12),
          partTyp: arbNonEmptySafeAscii(12),
          jobNam: arbNonEmptySafeAscii(12),
          omitOptionalAfterJobNam: fc.boolean(),
          wcr: arbWcrSpec,
          hbrs: fc.tuple(...hbrArbs),
          sbrs: fc.tuple(...sbrArbs),
          wafers: fc.tuple(...waferArbs),
          unknownRecords: fc.array(arbUnknownRecord, { minLength: 0, maxLength: 3 }),
          omitMrrOptional: fc.boolean(),
        })
        .map(
          (built): StdfWriteLotSpec => ({
            endianness,
            compactRepeatedPtrs,
            mir: {
              lotId: built.lotId,
              partTyp: built.partTyp,
              jobNam: built.jobNam,
              omitOptionalAfterJobNam: built.omitOptionalAfterJobNam,
            },
            sdrs: [
              {
                headNum: 1,
                siteGrp: 1,
                siteNums,
                cardId: 'CARD-PROP',
              },
            ],
            hbrs: built.hbrs,
            sbrs: built.sbrs,
            wcr: built.wcr,
            wafers: built.wafers,
            tsrs: catalog.map((tpl) => ({
              testNum: tpl.testNum,
              testNam: tpl.testTxt,
              execCnt: 1,
            })),
            pcrs: [{ partCnt: siteNums.length }],
            unknownRecords: built.unknownRecords,
            mrr: {
              finishT: 1_700_009_999,
              dispCod: '0',
              usrDesc: 'PROP_OK',
              omitOptionalAfterFinishT: built.omitMrrOptional,
            },
          }),
        );
    },
  );
