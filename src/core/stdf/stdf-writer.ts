/**
 * Deterministic STDF V4 binary stream serializer (`writeStdfBytes`).
 *
 * Shares exact record codes, bitfield masks, and binary layout rules with `stdf-parser.ts`
 * so generated synthetic demo lots and `fast-check` round-trip specs serialize to
 * Teradyne STDF V4 compliant byte streams in both big- and little-endian formats.
 *
 * Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9, 3.1
 */

import { BinaryRecordBuilder } from './binary-cursor';
import {
  PTR_OPT_FLAG,
  type PtrDefaultContext,
  STDF_CPU_TYPE,
  STDF_MISSING_COORD,
  STDF_MISSING_U1,
  STDF_MISSING_U2,
  STDF_MISSING_U4,
  STDF_RECORD_CODES,
  STDF_V4_VERSION,
  type StdfWriteFtrSpec,
  type StdfWriteHbrSpec,
  type StdfWriteLotSpec,
  type StdfWriteMirSpec,
  type StdfWriteMprSpec,
  type StdfWriteMrrSpec,
  type StdfWritePartSpec,
  type StdfWritePcrSpec,
  type StdfWritePtrSpec,
  type StdfWriteRawRecordSpec,
  type StdfWriteSbrSpec,
  type StdfWriteSdrSpec,
  type StdfWriteTouchdownSpec,
  type StdfWriteTsrSpec,
  type StdfWriteWcrSpec,
  type StdfWriteWirSpec,
  type StdfWriteWrrSpec,
} from './types';

function writeFarRecord(builder: BinaryRecordBuilder, endianness: 'big' | 'little'): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.FAR.recTyp,
    STDF_RECORD_CODES.FAR.recSub,
  );
  builder.writeU1(
    endianness === 'big' ? STDF_CPU_TYPE.BIG_ENDIAN : STDF_CPU_TYPE.LITTLE_ENDIAN,
  );
  builder.writeU1(STDF_V4_VERSION);
  builder.endRecord(hdr);
}

function writeRawRecord(builder: BinaryRecordBuilder, raw: StdfWriteRawRecordSpec): void {
  const hdr = builder.beginRecord(raw.recTyp, raw.recSub);
  builder.writeRawBytes(raw.payload);
  builder.endRecord(hdr);
}

function writeMirRecord(builder: BinaryRecordBuilder, spec: StdfWriteMirSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.MIR.recTyp,
    STDF_RECORD_CODES.MIR.recSub,
  );
  builder.writeU4(spec.setupT ?? 1_700_000_000);
  builder.writeU4(spec.startT ?? 1_700_000_010);
  builder.writeU1(spec.statNum ?? 1);
  builder.writeC1(spec.modeCod ?? 'P');
  builder.writeC1(spec.rtstCod ?? ' ');
  builder.writeC1(spec.protCod ?? ' ');
  builder.writeU2(spec.burnTim ?? STDF_MISSING_U2);
  builder.writeC1(spec.cmodCod ?? ' ');
  builder.writeCn(spec.lotId);
  builder.writeCn(spec.partTyp);
  builder.writeCn(spec.nodeNam ?? 'ATE-01');
  builder.writeCn(spec.tstrTyp ?? 'CAL-V4');
  builder.writeCn(spec.jobNam);
  if (!spec.omitOptionalAfterJobNam) {
    builder.writeCn(spec.jobRev ?? '1.0');
    builder.writeCn(spec.sblotId ?? '');
    builder.writeCn(spec.operNam ?? 'AUTO');
  }
  builder.endRecord(hdr);
}

function writeSdrRecord(builder: BinaryRecordBuilder, spec: StdfWriteSdrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.SDR.recTyp,
    STDF_RECORD_CODES.SDR.recSub,
  );
  builder.writeU1(spec.headNum ?? 1);
  builder.writeU1(spec.siteGrp ?? 1);
  const siteCnt = Math.min(255, spec.siteNums.length);
  builder.writeU1(siteCnt);
  builder.writeKxU1(spec.siteNums.slice(0, siteCnt));
  builder.writeCn(spec.handTyp ?? 'PROBER');
  builder.writeCn(spec.handId ?? 'PRB-01');
  builder.writeCn(spec.cardTyp ?? 'CANTILEVER');
  builder.writeCn(spec.cardId ?? 'PC-01');
  if (!spec.omitOptionalAfterCardId) {
    builder.writeCn(''); // LOAD_TYP
    builder.writeCn(''); // LOAD_ID
  }
  builder.endRecord(hdr);
}

function writeHbrRecord(builder: BinaryRecordBuilder, spec: StdfWriteHbrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.HBR.recTyp,
    STDF_RECORD_CODES.HBR.recSub,
  );
  builder.writeU1(spec.headNum ?? STDF_MISSING_U1);
  builder.writeU1(spec.siteNum ?? 0);
  builder.writeU2(spec.hbinNum);
  builder.writeU4(spec.hbinCnt);
  if (!spec.omitTrailingFields) {
    builder.writeC1(spec.hbinPf ?? ' ');
    builder.writeCn(spec.hbinNam ?? '');
  }
  builder.endRecord(hdr);
}

function writeSbrRecord(builder: BinaryRecordBuilder, spec: StdfWriteSbrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.SBR.recTyp,
    STDF_RECORD_CODES.SBR.recSub,
  );
  builder.writeU1(spec.headNum ?? STDF_MISSING_U1);
  builder.writeU1(spec.siteNum ?? 0);
  builder.writeU2(spec.sbinNum);
  builder.writeU4(spec.sbinCnt);
  if (!spec.omitTrailingFields) {
    builder.writeC1(spec.sbinPf ?? ' ');
    builder.writeCn(spec.sbinNam ?? '');
  }
  builder.endRecord(hdr);
}

function writeWcrRecord(builder: BinaryRecordBuilder, spec: StdfWriteWcrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.WCR.recTyp,
    STDF_RECORD_CODES.WCR.recSub,
  );
  builder.writeR4(spec.wafrSiz ?? 0);
  builder.writeR4(spec.dieHt ?? 0);
  builder.writeR4(spec.dieWid ?? 0);
  builder.writeU1(spec.wfUnits ?? 0);
  builder.writeC1(spec.wfFlat ?? ' ');
  builder.writeI2(spec.centerX ?? STDF_MISSING_COORD);
  builder.writeI2(spec.centerY ?? STDF_MISSING_COORD);
  builder.writeC1(spec.posX ?? ' ');
  builder.writeC1(spec.posY ?? ' ');
  builder.endRecord(hdr);
}

function writeWirRecord(builder: BinaryRecordBuilder, spec: StdfWriteWirSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.WIR.recTyp,
    STDF_RECORD_CODES.WIR.recSub,
  );
  builder.writeU1(spec.headNum ?? 1);
  builder.writeU1(spec.siteGrp ?? STDF_MISSING_U1);
  builder.writeU4(spec.startT ?? 1_700_000_100);
  if (!spec.omitWaferId) {
    builder.writeCn(spec.waferId ?? '');
  }
  builder.endRecord(hdr);
}

function writeWrrRecord(builder: BinaryRecordBuilder, spec: StdfWriteWrrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.WRR.recTyp,
    STDF_RECORD_CODES.WRR.recSub,
  );
  builder.writeU1(spec.headNum ?? 1);
  builder.writeU1(spec.siteGrp ?? STDF_MISSING_U1);
  builder.writeU4(spec.finishT ?? 1_700_000_200);
  builder.writeU4(spec.partCnt);
  if (!spec.omitOptionalAfterPartCnt) {
    builder.writeU4(spec.rtstCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.abrtCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.goodCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.funcCnt ?? STDF_MISSING_U4);
    builder.writeCn(spec.waferId ?? '');
    builder.writeCn(spec.fabwfId ?? '');
    builder.writeCn(spec.frameId ?? '');
    builder.writeCn(spec.maskId ?? '');
    builder.writeCn(spec.usrDesc ?? '');
    builder.writeCn(spec.excDesc ?? '');
  }
  builder.endRecord(hdr);
}

function writePirRecord(
  builder: BinaryRecordBuilder,
  headNum: number,
  siteNum: number,
): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.PIR.recTyp,
    STDF_RECORD_CODES.PIR.recSub,
  );
  builder.writeU1(headNum);
  builder.writeU1(siteNum);
  builder.endRecord(hdr);
}

function writePtrRecord(
  builder: BinaryRecordBuilder,
  headNum: number,
  siteNum: number,
  spec: StdfWritePtrSpec,
  firstPtrMap: Map<number, PtrDefaultContext>,
  autoCompact: boolean,
): void {
  if (!Number.isFinite(spec.result)) {
    throw new RangeError(
      `STDF writer expected finite PTR RESULT for TEST_NUM ${spec.testNum}, got ${spec.result}.`,
    );
  }
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.PTR.recTyp,
    STDF_RECORD_CODES.PTR.recSub,
  );
  builder.writeU4(spec.testNum);
  builder.writeU1(headNum);
  builder.writeU1(siteNum);
  builder.writeB1(spec.testFlg ?? 0);
  builder.writeB1(spec.parmFlg ?? 0);
  builder.writeR4(spec.result);

  const prior = firstPtrMap.get(spec.testNum);

  const canAutoCompact =
    prior !== undefined &&
    autoCompact &&
    spec.optFlag === undefined &&
    spec.alarmId === undefined &&
    (spec.testTxt === undefined || spec.testTxt === '' || spec.testTxt === prior.testTxt) &&
    (spec.units === undefined || spec.units === '' || spec.units === prior.units) &&
    (spec.resScal === undefined || spec.resScal === prior.resScal) &&
    (spec.llmScal === undefined || spec.llmScal === prior.llmScal) &&
    (spec.hlmScal === undefined || spec.hlmScal === prior.hlmScal) &&
    (spec.loLimit === undefined ||
      (spec.loLimit === null
        ? prior.loLimit === null
        : prior.loLimit === Math.fround(spec.loLimit))) &&
    (spec.hiLimit === undefined ||
      (spec.hiLimit === null
        ? prior.hiLimit === null
        : prior.hiLimit === Math.fround(spec.hiLimit)));

  if (prior !== undefined && (spec.omitOptionalAfterResult || canAutoCompact)) {
    builder.endRecord(hdr);
    return;
  }

  let optFlag = spec.optFlag ?? 0;
  if (spec.optFlag === undefined) {
    if (spec.loLimit === null || (prior === undefined && spec.loLimit === undefined)) {
      optFlag |= PTR_OPT_FLAG.NO_LO_LIMIT;
    } else if (prior !== undefined && spec.loLimit === undefined) {
      optFlag |= PTR_OPT_FLAG.LO_LIMIT_INVALID;
    }

    if (spec.hiLimit === null || (prior === undefined && spec.hiLimit === undefined)) {
      optFlag |= PTR_OPT_FLAG.NO_HI_LIMIT;
    } else if (prior !== undefined && spec.hiLimit === undefined) {
      optFlag |= PTR_OPT_FLAG.HI_LIMIT_INVALID;
    }

    if (prior !== undefined && spec.resScal === undefined) {
      optFlag |= PTR_OPT_FLAG.RES_SCAL_INVALID;
    }
  }

  const resScal = spec.resScal ?? prior?.resScal ?? 0;
  const llmScal = spec.llmScal ?? prior?.llmScal ?? 0;
  const hlmScal = spec.hlmScal ?? prior?.hlmScal ?? 0;
  const loVal =
    spec.loLimit !== undefined && spec.loLimit !== null ? spec.loLimit : 0;
  const hiVal =
    spec.hiLimit !== undefined && spec.hiLimit !== null ? spec.hiLimit : 0;

  builder.writeCn(spec.testTxt ?? '');
  builder.writeCn(spec.alarmId ?? '');
  builder.writeB1(optFlag);
  builder.writeI1(resScal);
  builder.writeI1(llmScal);
  builder.writeI1(hlmScal);
  builder.writeR4(loVal);
  builder.writeR4(hiVal);
  builder.writeCn(spec.units ?? '');

  if (prior === undefined) {
    firstPtrMap.set(spec.testNum, {
      testNum: spec.testNum,
      testTxt: spec.testTxt ?? '',
      units: spec.units ?? '',
      resScal: (optFlag & PTR_OPT_FLAG.RES_SCAL_INVALID) === 0 ? resScal : 0,
      llmScal:
        (optFlag & (PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.LO_LIMIT_INVALID)) === 0
          ? llmScal
          : 0,
      hlmScal:
        (optFlag & (PTR_OPT_FLAG.NO_HI_LIMIT | PTR_OPT_FLAG.HI_LIMIT_INVALID)) === 0
          ? hlmScal
          : 0,
      loLimit:
        (optFlag & (PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.LO_LIMIT_INVALID)) === 0 &&
        spec.loLimit !== undefined &&
        spec.loLimit !== null
          ? Math.fround(spec.loLimit)
          : null,
      hiLimit:
        (optFlag & (PTR_OPT_FLAG.NO_HI_LIMIT | PTR_OPT_FLAG.HI_LIMIT_INVALID)) === 0 &&
        spec.hiLimit !== undefined &&
        spec.hiLimit !== null
          ? Math.fround(spec.hiLimit)
          : null,
    });
  }

  builder.endRecord(hdr);
}

function normalizeArrayLength(
  source: ArrayLike<number> | undefined,
  length: number,
): number[] {
  const out = new Array<number>(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = source !== undefined && i < source.length ? source[i]! : 0;
  }
  return out;
}

function writeMprRecord(
  builder: BinaryRecordBuilder,
  headNum: number,
  siteNum: number,
  spec: StdfWriteMprSpec,
): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.MPR.recTyp,
    STDF_RECORD_CODES.MPR.recSub,
  );
  const rsltCnt = spec.rtnRslt.length;
  for (let i = 0; i < rsltCnt; i += 1) {
    const val = spec.rtnRslt[i]!;
    if (!Number.isFinite(val)) {
      throw new RangeError(
        `STDF writer expected finite MPR RTN_RSLT[${i}] for TEST_NUM ${spec.testNum}, got ${val}.`,
      );
    }
  }
  const rtnIcnt = Math.max(spec.rtnIndx?.length ?? 0, spec.rtnStat?.length ?? 0);

  builder.writeU4(spec.testNum);
  builder.writeU1(headNum);
  builder.writeU1(siteNum);
  builder.writeB1(spec.testFlg ?? 0);
  builder.writeB1(spec.parmFlg ?? 0);
  builder.writeU2(rtnIcnt);
  builder.writeU2(rsltCnt);
  if (rtnIcnt > 0) {
    builder.writeKxN1(normalizeArrayLength(spec.rtnStat, rtnIcnt));
  }
  if (rsltCnt > 0) {
    builder.writeKxR4(spec.rtnRslt);
  }

  if (!spec.omitOptionalAfterResults) {
    let optFlag = spec.optFlag ?? 0;
    if (spec.optFlag === undefined) {
      if (spec.loLimit === undefined || spec.loLimit === null) {
        optFlag |= PTR_OPT_FLAG.NO_LO_LIMIT;
      }
      if (spec.hiLimit === undefined || spec.hiLimit === null) {
        optFlag |= PTR_OPT_FLAG.NO_HI_LIMIT;
      }
    }
    builder.writeCn(spec.testTxt ?? '');
    builder.writeCn(spec.alarmId ?? '');
    builder.writeB1(optFlag);
    builder.writeI1(spec.resScal ?? 0);
    builder.writeI1(spec.llmScal ?? 0);
    builder.writeI1(spec.hlmScal ?? 0);
    builder.writeR4(spec.loLimit ?? 0);
    builder.writeR4(spec.hiLimit ?? 0);
    builder.writeR4(spec.startIn ?? 0);
    builder.writeR4(spec.incrIn ?? 0);
    if (rtnIcnt > 0) {
      builder.writeKxU2(normalizeArrayLength(spec.rtnIndx, rtnIcnt));
    }
    builder.writeCn(spec.units ?? '');
    builder.writeCn(spec.unitsIn ?? '');
  }

  builder.endRecord(hdr);
}

function writeFtrRecord(
  builder: BinaryRecordBuilder,
  headNum: number,
  siteNum: number,
  spec: StdfWriteFtrSpec,
): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.FTR.recTyp,
    STDF_RECORD_CODES.FTR.recSub,
  );
  builder.writeU4(spec.testNum);
  builder.writeU1(headNum);
  builder.writeU1(siteNum);
  builder.writeB1(spec.testFlg ?? 0);

  if (!spec.omitOptionalAfterTestFlg) {
    const rtnIcnt = Math.max(spec.rtnIndx?.length ?? 0, spec.rtnStat?.length ?? 0);
    const pgmIcnt = Math.max(spec.pgmIndx?.length ?? 0, spec.pgmStat?.length ?? 0);
    builder.writeB1(spec.optFlag ?? 0);
    builder.writeU4(spec.cyclCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.relVadr ?? STDF_MISSING_U4);
    builder.writeU4(spec.reptCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.numFail ?? STDF_MISSING_U4);
    builder.writeI4(spec.xfailAd ?? 0);
    builder.writeI4(spec.yfailAd ?? 0);
    builder.writeI2(spec.vectOff ?? 0);
    builder.writeU2(rtnIcnt);
    builder.writeU2(pgmIcnt);
    if (rtnIcnt > 0) {
      builder.writeKxU2(normalizeArrayLength(spec.rtnIndx, rtnIcnt));
      builder.writeKxN1(normalizeArrayLength(spec.rtnStat, rtnIcnt));
    }
    if (pgmIcnt > 0) {
      builder.writeKxU2(normalizeArrayLength(spec.pgmIndx, pgmIcnt));
      builder.writeKxN1(normalizeArrayLength(spec.pgmStat, pgmIcnt));
    }
    builder.writeDn(spec.failPin ?? { bitCount: 0, bytes: new Uint8Array(0) });
    builder.writeCn(''); // VECT_NAM
    builder.writeCn(''); // TIME_SET
    builder.writeCn(''); // OP_CODE
    builder.writeCn(spec.testTxt ?? '');
    if (spec.spinMap !== undefined) {
      builder.writeCn(''); // ALARM_ID
      builder.writeCn(''); // PROG_TXT
      builder.writeCn(''); // RSLT_TXT
      builder.writeU1(STDF_MISSING_U1); // PATG_NUM
      builder.writeDn(spec.spinMap);
    }
  }

  builder.endRecord(hdr);
}

function writePrrRecord(builder: BinaryRecordBuilder, part: StdfWritePartSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.PRR.recTyp,
    STDF_RECORD_CODES.PRR.recSub,
  );
  const headNum = part.headNum ?? 1;
  const siteNum = part.siteNum ?? 1;
  const totalTests =
    part.numTest ??
    (part.ptrs?.length ?? 0) + (part.mprs?.length ?? 0) + (part.ftrs?.length ?? 0);

  builder.writeU1(headNum);
  builder.writeU1(siteNum);
  builder.writeB1(part.partFlg ?? 0);
  builder.writeU2(totalTests);
  builder.writeU2(part.hardBin);

  if (part.omitOptionalAfterHardBin) {
    builder.endRecord(hdr);
    return;
  }

  builder.writeU2(part.softBin ?? STDF_MISSING_U2);
  builder.writeI2(part.xCoord ?? STDF_MISSING_COORD);
  builder.writeI2(part.yCoord ?? STDF_MISSING_COORD);

  if (part.omitOptionalAfterCoords) {
    builder.endRecord(hdr);
    return;
  }

  builder.writeU4(part.testT ?? 0);
  builder.writeCn(part.partId ?? '');
  builder.writeCn(part.partTxt ?? '');
  if (part.partFix !== undefined) {
    builder.writeBn(part.partFix);
  }
  builder.endRecord(hdr);
}

function writeTouchdown(
  builder: BinaryRecordBuilder,
  touchdown: StdfWriteTouchdownSpec,
  firstPtrMap: Map<number, PtrDefaultContext>,
  autoCompact: boolean,
): void {
  if (touchdown.length === 0) {
    return;
  }

  // 1. Open all concurrent sites with PIR records
  for (let s = 0; s < touchdown.length; s += 1) {
    const part = touchdown[s]!;
    writePirRecord(builder, part.headNum ?? 1, part.siteNum ?? 1);
  }

  // 2. Interleave PTR records step-by-step across open sites
  let maxPtrSteps = 0;
  let maxMprSteps = 0;
  let maxFtrSteps = 0;
  for (let s = 0; s < touchdown.length; s += 1) {
    const part = touchdown[s]!;
    maxPtrSteps = Math.max(maxPtrSteps, part.ptrs?.length ?? 0);
    maxMprSteps = Math.max(maxMprSteps, part.mprs?.length ?? 0);
    maxFtrSteps = Math.max(maxFtrSteps, part.ftrs?.length ?? 0);
  }

  for (let step = 0; step < maxPtrSteps; step += 1) {
    for (let s = 0; s < touchdown.length; s += 1) {
      const part = touchdown[s]!;
      const ptr = part.ptrs?.[step];
      if (ptr !== undefined) {
        writePtrRecord(
          builder,
          part.headNum ?? 1,
          part.siteNum ?? 1,
          ptr,
          firstPtrMap,
          autoCompact,
        );
      }
    }
  }

  for (let step = 0; step < maxMprSteps; step += 1) {
    for (let s = 0; s < touchdown.length; s += 1) {
      const part = touchdown[s]!;
      const mpr = part.mprs?.[step];
      if (mpr !== undefined) {
        writeMprRecord(builder, part.headNum ?? 1, part.siteNum ?? 1, mpr);
      }
    }
  }

  for (let step = 0; step < maxFtrSteps; step += 1) {
    for (let s = 0; s < touchdown.length; s += 1) {
      const part = touchdown[s]!;
      const ftr = part.ftrs?.[step];
      if (ftr !== undefined) {
        writeFtrRecord(builder, part.headNum ?? 1, part.siteNum ?? 1, ftr);
      }
    }
  }

  // 3. Close all concurrent sites with PRR records
  for (let s = 0; s < touchdown.length; s += 1) {
    writePrrRecord(builder, touchdown[s]!);
  }
}

function writeTsrRecord(builder: BinaryRecordBuilder, spec: StdfWriteTsrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.TSR.recTyp,
    STDF_RECORD_CODES.TSR.recSub,
  );
  builder.writeU1(spec.headNum ?? STDF_MISSING_U1);
  builder.writeU1(spec.siteNum ?? 0);
  builder.writeC1(spec.testTyp ?? 'P');
  builder.writeU4(spec.testNum);
  builder.writeU4(spec.execCnt ?? STDF_MISSING_U4);
  builder.writeU4(spec.failCnt ?? STDF_MISSING_U4);
  builder.writeU4(spec.alrmCnt ?? STDF_MISSING_U4);
  builder.writeCn(spec.testNam ?? '');
  if (!spec.omitOptionalAfterTestNam) {
    builder.writeCn(spec.seqName ?? '');
    builder.writeCn(spec.testLbl ?? '');
    builder.writeB1(spec.optFlag ?? 0xff);
    builder.writeR4(spec.testTim ?? 0);
    builder.writeR4(spec.testMin ?? 0);
    builder.writeR4(spec.testMax ?? 0);
    builder.writeR4(spec.tstSums ?? 0);
    builder.writeR4(spec.tstSqrs ?? 0);
  }
  builder.endRecord(hdr);
}

function writePcrRecord(builder: BinaryRecordBuilder, spec: StdfWritePcrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.PCR.recTyp,
    STDF_RECORD_CODES.PCR.recSub,
  );
  builder.writeU1(spec.headNum ?? STDF_MISSING_U1);
  builder.writeU1(spec.siteNum ?? 0);
  builder.writeU4(spec.partCnt);
  if (!spec.omitOptionalCounts) {
    builder.writeU4(spec.rtstCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.abrtCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.goodCnt ?? STDF_MISSING_U4);
    builder.writeU4(spec.funcCnt ?? STDF_MISSING_U4);
  }
  builder.endRecord(hdr);
}

function writeMrrRecord(builder: BinaryRecordBuilder, spec: StdfWriteMrrSpec): void {
  const hdr = builder.beginRecord(
    STDF_RECORD_CODES.MRR.recTyp,
    STDF_RECORD_CODES.MRR.recSub,
  );
  builder.writeU4(spec.finishT ?? 1_700_000_500);
  if (!spec.omitOptionalAfterFinishT) {
    builder.writeC1(spec.dispCod ?? ' ');
    builder.writeCn(spec.usrDesc ?? '');
    builder.writeCn(spec.excDesc ?? '');
  }
  builder.endRecord(hdr);
}

/**
 * Serializes a `StdfWriteLotSpec` into a deterministic STDF V4 `Uint8Array`.
 */
export function writeStdfBytes(spec: StdfWriteLotSpec): Uint8Array {
  let estimatedParts = 0;
  for (let w = 0; w < spec.wafers.length; w += 1) {
    const wafer = spec.wafers[w]!;
    estimatedParts += wafer.parts?.length ?? 0;
    if (wafer.touchdowns) {
      for (let t = 0; t < wafer.touchdowns.length; t += 1) {
        estimatedParts += wafer.touchdowns[t]!.length;
      }
    }
  }
  const initialCapacity = Math.max(1024, estimatedParts * 96 + 512);
  const builder = new BinaryRecordBuilder(spec.endianness, initialCapacity);
  const firstPtrMap = new Map<number, PtrDefaultContext>();
  const autoCompact = spec.compactRepeatedPtrs ?? false;

  writeFarRecord(builder, spec.endianness);

  if (spec.mir !== undefined) {
    writeMirRecord(builder, spec.mir);
  }

  if (spec.unknownRecords) {
    for (const raw of spec.unknownRecords) {
      if ((raw.position ?? 'after-mir') === 'after-mir') {
        writeRawRecord(builder, raw);
      }
    }
  }

  if (spec.sdrs) {
    for (const sdr of spec.sdrs) {
      writeSdrRecord(builder, sdr);
    }
  }

  if (spec.hbrs) {
    for (const hbr of spec.hbrs) {
      writeHbrRecord(builder, hbr);
    }
  }

  if (spec.sbrs) {
    for (const sbr of spec.sbrs) {
      writeSbrRecord(builder, sbr);
    }
  }

  if (spec.wcr !== undefined) {
    writeWcrRecord(builder, spec.wcr);
  }

  for (let w = 0; w < spec.wafers.length; w += 1) {
    const wafer = spec.wafers[w]!;
    if (wafer.wir !== undefined) {
      writeWirRecord(builder, wafer.wir);
    }
    if (wafer.wcr !== undefined) {
      writeWcrRecord(builder, wafer.wcr);
    }

    let waferPartCount = 0;
    if (wafer.touchdowns) {
      for (let t = 0; t < wafer.touchdowns.length; t += 1) {
        const td = wafer.touchdowns[t]!;
        waferPartCount += td.length;
        writeTouchdown(builder, td, firstPtrMap, autoCompact);
      }
    }
    if (wafer.parts) {
      for (let p = 0; p < wafer.parts.length; p += 1) {
        waferPartCount += 1;
        writeTouchdown(builder, [wafer.parts[p]!], firstPtrMap, autoCompact);
      }
    }

    if (!wafer.omitWrr && (wafer.wrr !== undefined || wafer.wir !== undefined)) {
      writeWrrRecord(
        builder,
        wafer.wrr ?? {
          headNum: wafer.wir?.headNum ?? 1,
          siteGrp: wafer.wir?.siteGrp ?? STDF_MISSING_U1,
          partCnt: waferPartCount,
          waferId: wafer.wir?.waferId ?? '',
        },
      );
    }
  }

  if (spec.tsrs) {
    for (const tsr of spec.tsrs) {
      writeTsrRecord(builder, tsr);
    }
  }

  if (spec.pcrs) {
    for (const pcr of spec.pcrs) {
      writePcrRecord(builder, pcr);
    }
  }

  if (spec.unknownRecords) {
    for (const raw of spec.unknownRecords) {
      if (raw.position === 'before-mrr') {
        writeRawRecord(builder, raw);
      }
    }
  }

  if (spec.mrr !== undefined) {
    writeMrrRecord(builder, spec.mrr);
  }

  return builder.toUint8Array();
}
