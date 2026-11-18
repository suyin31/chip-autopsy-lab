/**
 * Deterministic, bounds-checked STDF V4 binary stream parser.
 *
 * Implements:
 * - FAR header validation & endianness resolution (`CPU_TYPE` 1 = big, 2 = little, 0 = VAX error)
 * - Decoding of the 16 used STDF V4 record types (`FAR`, `MIR`, `MRR`, `PCR`, `HBR`, `SBR`,
 *   `SDR`, `WIR`, `WRR`, `WCR`, `PIR`, `PRR`, `TSR`, `PTR`, `MPR`, `FTR`)
 * - Clean `REC_LEN` skipping for all other record types (and `PTR`/`MPR`/`FTR` in `'bins-only'` mode)
 * - Graceful omission of optional trailing record fields (`recordEnd` boundary)
 * - `PTR`/`MPR` `TEST_NUM` default inheritance + `OPT_FLAG` bits 0, 4, 5, 6, 7 handling
 * - Base-unit preservation for `RESULT`, `LO_LIMIT`, and `HI_LIMIT` (`*_SCAL` kept as display exponents)
 * - Multi-site concurrent `PIR` -> `PTR`/`MPR`/`FTR` -> `PRR` open-part state machine
 * - Truncated-tail and mid-stream malformed-record recovery with structured `ParseWarning`s
 *
 * Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { BinaryCursor, RecordBoundsError } from './binary-cursor';
import {
  type BinPassFailFlag,
  type CpuEndianness,
  type ParsedFtrExecution,
  type ParsedHbrRecord,
  type ParsedLotBuildInput,
  type ParsedMirRecord,
  type ParsedMprExecution,
  type ParsedMrrRecord,
  type ParsedPartExecution,
  type ParsedPcrRecord,
  type ParsedPtrExecution,
  type ParsedSbrRecord,
  type ParsedSdrRecord,
  type ParsedTsrRecord,
  type ParsedWaferChunk,
  type ParsedWcrRecord,
  type ParsedWirRecord,
  type ParsedWrrRecord,
  formatHexBytes,
  type ParseFatalError,
  type ParseOptions,
  type ParseWarning,
  PRR_PART_FLG,
  PTR_OPT_FLAG,
  PTR_TEST_FLG,
  type PtrDefaultContext,
  packRecordTypeKey,
  packSiteKey,
  type Result,
  STDF_CPU_TYPE,
  STDF_MISSING_COORD,
  STDF_MISSING_U1,
  STDF_MISSING_U2,
  STDF_MISSING_U4,
  STDF_RECORD_CODES,
  STDF_RECORD_HEADER_BYTES,
  STDF_V4_VERSION,
  type TruncatedRecordDiagnostic,
  type WaferAxisPosX,
  type WaferAxisPosY,
  type WaferFlatOrientation,
} from './types';

const PROGRESS_BYTE_INTERVAL = 64 * 1024;
const PROGRESS_RECORD_INTERVAL = 4_096;

const REC_KEY_FAR = packRecordTypeKey(
  STDF_RECORD_CODES.FAR.recTyp,
  STDF_RECORD_CODES.FAR.recSub,
);
const REC_KEY_MIR = packRecordTypeKey(
  STDF_RECORD_CODES.MIR.recTyp,
  STDF_RECORD_CODES.MIR.recSub,
);
const REC_KEY_MRR = packRecordTypeKey(
  STDF_RECORD_CODES.MRR.recTyp,
  STDF_RECORD_CODES.MRR.recSub,
);
const REC_KEY_PCR = packRecordTypeKey(
  STDF_RECORD_CODES.PCR.recTyp,
  STDF_RECORD_CODES.PCR.recSub,
);
const REC_KEY_HBR = packRecordTypeKey(
  STDF_RECORD_CODES.HBR.recTyp,
  STDF_RECORD_CODES.HBR.recSub,
);
const REC_KEY_SBR = packRecordTypeKey(
  STDF_RECORD_CODES.SBR.recTyp,
  STDF_RECORD_CODES.SBR.recSub,
);
const REC_KEY_SDR = packRecordTypeKey(
  STDF_RECORD_CODES.SDR.recTyp,
  STDF_RECORD_CODES.SDR.recSub,
);
const REC_KEY_WIR = packRecordTypeKey(
  STDF_RECORD_CODES.WIR.recTyp,
  STDF_RECORD_CODES.WIR.recSub,
);
const REC_KEY_WRR = packRecordTypeKey(
  STDF_RECORD_CODES.WRR.recTyp,
  STDF_RECORD_CODES.WRR.recSub,
);
const REC_KEY_WCR = packRecordTypeKey(
  STDF_RECORD_CODES.WCR.recTyp,
  STDF_RECORD_CODES.WCR.recSub,
);
const REC_KEY_PIR = packRecordTypeKey(
  STDF_RECORD_CODES.PIR.recTyp,
  STDF_RECORD_CODES.PIR.recSub,
);
const REC_KEY_PRR = packRecordTypeKey(
  STDF_RECORD_CODES.PRR.recTyp,
  STDF_RECORD_CODES.PRR.recSub,
);
const REC_KEY_TSR = packRecordTypeKey(
  STDF_RECORD_CODES.TSR.recTyp,
  STDF_RECORD_CODES.TSR.recSub,
);
const REC_KEY_PTR = packRecordTypeKey(
  STDF_RECORD_CODES.PTR.recTyp,
  STDF_RECORD_CODES.PTR.recSub,
);
const REC_KEY_MPR = packRecordTypeKey(
  STDF_RECORD_CODES.MPR.recTyp,
  STDF_RECORD_CODES.MPR.recSub,
);
const REC_KEY_FTR = packRecordTypeKey(
  STDF_RECORD_CODES.FTR.recTyp,
  STDF_RECORD_CODES.FTR.recSub,
);

interface OpenPartContext {
  readonly headNum: number;
  readonly siteNum: number;
  readonly pirByteOffset: number;
  readonly ptrs: ParsedPtrExecution[];
  readonly mprs: ParsedMprExecution[];
  readonly ftrs: ParsedFtrExecution[];
}

interface MutableWaferAccumulator {
  readonly waferIndex: number;
  readonly implicit: boolean;
  wir: ParsedWirRecord | null;
  wrr: ParsedWrrRecord | null;
  wcr: ParsedWcrRecord | null;
  readonly parts: ParsedPartExecution[];
  readonly seenCoords: Set<number>;
}

function normalizeOptionalCount(raw: number | undefined): number | undefined {
  if (raw === undefined || raw === STDF_MISSING_U4) {
    return undefined;
  }
  return raw;
}

function normalizeBinPf(raw: string | undefined): BinPassFailFlag {
  if (raw === 'P' || raw === 'F') {
    return raw;
  }
  return ' ';
}

function normalizeWfFlat(raw: string | undefined): WaferFlatOrientation {
  if (raw === 'U' || raw === 'D' || raw === 'L' || raw === 'R') {
    return raw;
  }
  return ' ';
}

function normalizePosX(raw: string | undefined): WaferAxisPosX {
  if (raw === 'L' || raw === 'R') {
    return raw;
  }
  return ' ';
}

function normalizePosY(raw: string | undefined): WaferAxisPosY {
  if (raw === 'U' || raw === 'D') {
    return raw;
  }
  return ' ';
}

function packWaferCoordKey(x: number, y: number): number {
  return (x + 32768) * 65536 + (y + 32768);
}

function decodeMir(cursor: BinaryCursor): ParsedMirRecord {
  const setupT = cursor.readU4();
  const startT = cursor.readU4();
  const statNum = cursor.readU1();
  const modeCod = cursor.readOptC1() ?? ' ';
  const rtstCod = cursor.readOptC1() ?? ' ';
  const protCod = cursor.readOptC1() ?? ' ';
  const burnTim = cursor.readOptU2() ?? STDF_MISSING_U2;
  const cmodCod = cursor.readOptC1() ?? ' ';
  const lotId = cursor.readOptCn() ?? '';
  const partTyp = cursor.readOptCn() ?? '';
  const nodeNam = cursor.readOptCn() ?? '';
  const tstrTyp = cursor.readOptCn() ?? '';
  const jobNam = cursor.readOptCn() ?? '';
  const jobRev = cursor.readOptCn() ?? '';
  const sblotId = cursor.readOptCn() ?? '';
  const operNam = cursor.readOptCn() ?? '';
  const execTyp = cursor.readOptCn() ?? '';
  const execVer = cursor.readOptCn() ?? '';
  const testCod = cursor.readOptCn() ?? '';
  const tstTemp = cursor.readOptCn() ?? '';
  const userTxt = cursor.readOptCn() ?? '';
  const auxFile = cursor.readOptCn() ?? '';
  const pkgTyp = cursor.readOptCn() ?? '';
  const famlyId = cursor.readOptCn() ?? '';
  const dateCod = cursor.readOptCn() ?? '';
  const facilId = cursor.readOptCn() ?? '';
  const floorId = cursor.readOptCn() ?? '';
  const procId = cursor.readOptCn() ?? '';
  const operFrq = cursor.readOptCn() ?? '';
  const specNam = cursor.readOptCn() ?? '';
  const specVer = cursor.readOptCn() ?? '';
  const flowId = cursor.readOptCn() ?? '';
  const setupId = cursor.readOptCn() ?? '';
  const dsgnRev = cursor.readOptCn() ?? '';
  const engId = cursor.readOptCn() ?? '';
  const romCod = cursor.readOptCn() ?? '';
  const serlNum = cursor.readOptCn() ?? '';
  const suprNam = cursor.readOptCn() ?? '';

  return {
    setupT,
    startT,
    statNum,
    modeCod,
    rtstCod,
    protCod,
    burnTim,
    cmodCod,
    lotId,
    partTyp,
    nodeNam,
    tstrTyp,
    jobNam,
    jobRev,
    sblotId,
    operNam,
    execTyp,
    execVer,
    testCod,
    tstTemp,
    userTxt,
    auxFile,
    pkgTyp,
    famlyId,
    dateCod,
    facilId,
    floorId,
    procId,
    operFrq,
    specNam,
    specVer,
    flowId,
    setupId,
    dsgnRev,
    engId,
    romCod,
    serlNum,
    suprNam,
  };
}

function decodeMrr(cursor: BinaryCursor): ParsedMrrRecord {
  const finishT = cursor.readU4();
  const dispCod = cursor.readOptC1() ?? ' ';
  const usrDesc = cursor.readOptCn() ?? '';
  const excDesc = cursor.readOptCn() ?? '';
  return { finishT, dispCod, usrDesc, excDesc };
}

function decodePcr(cursor: BinaryCursor): ParsedPcrRecord {
  const headNum = cursor.readU1();
  const siteNum = cursor.readU1();
  const partCnt = cursor.readU4();
  const rtstCnt = normalizeOptionalCount(cursor.readOptU4());
  const abrtCnt = normalizeOptionalCount(cursor.readOptU4());
  const goodCnt = normalizeOptionalCount(cursor.readOptU4());
  const funcCnt = normalizeOptionalCount(cursor.readOptU4());
  return {
    headNum,
    siteNum,
    partCnt,
    ...(rtstCnt !== undefined ? { rtstCnt } : {}),
    ...(abrtCnt !== undefined ? { abrtCnt } : {}),
    ...(goodCnt !== undefined ? { goodCnt } : {}),
    ...(funcCnt !== undefined ? { funcCnt } : {}),
  };
}

function decodeHbr(cursor: BinaryCursor): ParsedHbrRecord {
  const headNum = cursor.readU1();
  const siteNum = cursor.readU1();
  const hbinNum = cursor.readU2();
  const hbinCnt = cursor.readU4();
  const hbinPf = normalizeBinPf(cursor.readOptC1());
  const hbinNam = cursor.readOptCn() ?? '';
  return { headNum, siteNum, hbinNum, hbinCnt, hbinPf, hbinNam };
}

function decodeSbr(cursor: BinaryCursor): ParsedSbrRecord {
  const headNum = cursor.readU1();
  const siteNum = cursor.readU1();
  const sbinNum = cursor.readU2();
  const sbinCnt = cursor.readU4();
  const sbinPf = normalizeBinPf(cursor.readOptC1());
  const sbinNam = cursor.readOptCn() ?? '';
  return { headNum, siteNum, sbinNum, sbinCnt, sbinPf, sbinNam };
}

function decodeSdr(cursor: BinaryCursor): ParsedSdrRecord {
  const headNum = cursor.readU1();
  const siteGrp = cursor.readU1();
  const siteCnt = cursor.readU1();
  const siteNumsBuf = cursor.readKxU1(siteCnt);
  const siteNums = Array.from(siteNumsBuf);
  const handTyp = cursor.readOptCn() ?? '';
  const handId = cursor.readOptCn() ?? '';
  const cardTyp = cursor.readOptCn() ?? '';
  const cardId = cursor.readOptCn() ?? '';
  const loadTyp = cursor.readOptCn() ?? '';
  const loadId = cursor.readOptCn() ?? '';
  const dibTyp = cursor.readOptCn() ?? '';
  const dibId = cursor.readOptCn() ?? '';
  const cablTyp = cursor.readOptCn() ?? '';
  const cablId = cursor.readOptCn() ?? '';
  const contTyp = cursor.readOptCn() ?? '';
  const contId = cursor.readOptCn() ?? '';
  const lasrTyp = cursor.readOptCn() ?? '';
  const lasrId = cursor.readOptCn() ?? '';
  const extrTyp = cursor.readOptCn() ?? '';
  const extrId = cursor.readOptCn() ?? '';

  return {
    headNum,
    siteGrp,
    siteNums,
    handTyp,
    handId,
    cardTyp,
    cardId,
    loadTyp,
    loadId,
    dibTyp,
    dibId,
    cablTyp,
    cablId,
    contTyp,
    contId,
    lasrTyp,
    lasrId,
    extrTyp,
    extrId,
  };
}

function decodeWir(cursor: BinaryCursor): ParsedWirRecord {
  const headNum = cursor.readU1();
  const siteGrp = cursor.readOptU1() ?? STDF_MISSING_U1;
  const startT = cursor.readOptU4() ?? 0;
  const waferId = cursor.readOptCn() ?? '';
  return { headNum, siteGrp, startT, waferId };
}

function decodeWrr(cursor: BinaryCursor): ParsedWrrRecord {
  const headNum = cursor.readU1();
  const siteGrp = cursor.readOptU1() ?? STDF_MISSING_U1;
  const finishT = cursor.readOptU4() ?? 0;
  const partCnt = cursor.readOptU4() ?? 0;
  const rtstCnt = normalizeOptionalCount(cursor.readOptU4());
  const abrtCnt = normalizeOptionalCount(cursor.readOptU4());
  const goodCnt = normalizeOptionalCount(cursor.readOptU4());
  const funcCnt = normalizeOptionalCount(cursor.readOptU4());
  const waferId = cursor.readOptCn() ?? '';
  const fabwfId = cursor.readOptCn() ?? '';
  const frameId = cursor.readOptCn() ?? '';
  const maskId = cursor.readOptCn() ?? '';
  const usrDesc = cursor.readOptCn() ?? '';
  const excDesc = cursor.readOptCn() ?? '';

  return {
    headNum,
    siteGrp,
    finishT,
    partCnt,
    ...(rtstCnt !== undefined ? { rtstCnt } : {}),
    ...(abrtCnt !== undefined ? { abrtCnt } : {}),
    ...(goodCnt !== undefined ? { goodCnt } : {}),
    ...(funcCnt !== undefined ? { funcCnt } : {}),
    waferId,
    fabwfId,
    frameId,
    maskId,
    usrDesc,
    excDesc,
  };
}

function decodeWcr(cursor: BinaryCursor): ParsedWcrRecord {
  const rawWafrSiz = cursor.readOptR4();
  const rawDieHt = cursor.readOptR4();
  const rawDieWid = cursor.readOptR4();
  const rawWfUnits = cursor.readOptU1();
  const wfFlat = normalizeWfFlat(cursor.readOptC1());
  const rawCenterX = cursor.readOptI2();
  const rawCenterY = cursor.readOptI2();
  const posX = normalizePosX(cursor.readOptC1());
  const posY = normalizePosY(cursor.readOptC1());

  return {
    ...(rawWafrSiz !== undefined && Number.isFinite(rawWafrSiz) && rawWafrSiz > 0
      ? { wafrSiz: rawWafrSiz }
      : {}),
    ...(rawDieHt !== undefined && Number.isFinite(rawDieHt) && rawDieHt > 0
      ? { dieHt: rawDieHt }
      : {}),
    ...(rawDieWid !== undefined && Number.isFinite(rawDieWid) && rawDieWid > 0
      ? { dieWid: rawDieWid }
      : {}),
    ...(rawWfUnits !== undefined && rawWfUnits > 0 ? { wfUnits: rawWfUnits } : {}),
    wfFlat,
    ...(rawCenterX !== undefined && rawCenterX !== STDF_MISSING_COORD
      ? { centerX: rawCenterX }
      : {}),
    ...(rawCenterY !== undefined && rawCenterY !== STDF_MISSING_COORD
      ? { centerY: rawCenterY }
      : {}),
    posX,
    posY,
  };
}

function decodeTsr(
  cursor: BinaryCursor,
  warnings: ParseWarning[],
  byteOffset: number,
): ParsedTsrRecord {
  const headNum = cursor.readU1();
  const siteNum = cursor.readU1();
  const testTyp = cursor.readC1();
  const testNum = cursor.readU4();
  const execCnt = normalizeOptionalCount(cursor.readOptU4());
  const failCnt = normalizeOptionalCount(cursor.readOptU4());
  const alrmCnt = normalizeOptionalCount(cursor.readOptU4());
  const testNam = cursor.readOptCn() ?? '';
  const seqName = cursor.readOptCn() ?? '';
  const testLbl = cursor.readOptCn() ?? '';
  const optFlag = cursor.readOptB1();
  const testTim = cursor.readOptR4();
  const testMin = cursor.readOptR4();
  const testMax = cursor.readOptR4();
  const tstSums = cursor.readOptR4();
  const tstSqrs = cursor.readOptR4();

  const checkFiniteStat = (
    val: number | undefined,
    fieldName: string,
  ): number | undefined => {
    if (val === undefined) {
      return undefined;
    }
    if (!Number.isFinite(val)) {
      warnings.push({
        code: 'NON_FINITE_MEASUREMENT',
        byteOffset,
        recTyp: STDF_RECORD_CODES.TSR.recTyp,
        recSub: STDF_RECORD_CODES.TSR.recSub,
        detail: `Non-finite TSR ${fieldName} on TEST_NUM ${testNum}; omitted.`,
      });
      return undefined;
    }
    return val;
  };

  const validTim = checkFiniteStat(testTim, 'TEST_TIM');
  const validMin = checkFiniteStat(testMin, 'TEST_MIN');
  const validMax = checkFiniteStat(testMax, 'TEST_MAX');
  const validSums = checkFiniteStat(tstSums, 'TST_SUMS');
  const validSqrs = checkFiniteStat(tstSqrs, 'TST_SQRS');

  return {
    headNum,
    siteNum,
    testTyp,
    testNum,
    ...(execCnt !== undefined ? { execCnt } : {}),
    ...(failCnt !== undefined ? { failCnt } : {}),
    ...(alrmCnt !== undefined ? { alrmCnt } : {}),
    testNam,
    seqName,
    testLbl,
    ...(optFlag !== undefined ? { optFlag } : {}),
    ...(validTim !== undefined ? { testTim: validTim } : {}),
    ...(validMin !== undefined ? { testMin: validMin } : {}),
    ...(validMax !== undefined ? { testMax: validMax } : {}),
    ...(validSums !== undefined ? { tstSums: validSums } : {}),
    ...(validSqrs !== undefined ? { tstSqrs: validSqrs } : {}),
  };
}

function resolveParametricFields(
  testNum: number,
  rawTestTxt: string | undefined,
  rawOptFlag: number | undefined,
  rawResScal: number | undefined,
  rawLlmScal: number | undefined,
  rawHlmScal: number | undefined,
  rawLoLimit: number | undefined,
  rawHiLimit: number | undefined,
  rawUnits: string | undefined,
  defaultsMap: Map<number, PtrDefaultContext>,
  warnings: ParseWarning[],
  byteOffset: number,
  recTyp: number,
  recSub: number,
): PtrDefaultContext {
  const existing = defaultsMap.get(testNum);

  if (!existing) {
    const optFlag = rawOptFlag ?? 0;
    const resScal =
      rawResScal !== undefined && (optFlag & PTR_OPT_FLAG.RES_SCAL_INVALID) === 0
        ? rawResScal
        : 0;

    let loLimit: number | null = null;
    let llmScal = 0;
    if (
      (optFlag & (PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.LO_LIMIT_INVALID)) === 0 &&
      rawLoLimit !== undefined
    ) {
      if (Number.isFinite(rawLoLimit)) {
        loLimit = rawLoLimit;
        llmScal = rawLlmScal ?? 0;
      } else {
        warnings.push({
          code: 'NON_FINITE_MEASUREMENT',
          byteOffset,
          recTyp,
          recSub,
          detail: `Non-finite LO_LIMIT on TEST_NUM ${testNum}; treated as absent.`,
        });
      }
    }

    let hiLimit: number | null = null;
    let hlmScal = 0;
    if (
      (optFlag & (PTR_OPT_FLAG.NO_HI_LIMIT | PTR_OPT_FLAG.HI_LIMIT_INVALID)) === 0 &&
      rawHiLimit !== undefined
    ) {
      if (Number.isFinite(rawHiLimit)) {
        hiLimit = rawHiLimit;
        hlmScal = rawHlmScal ?? 0;
      } else {
        warnings.push({
          code: 'NON_FINITE_MEASUREMENT',
          byteOffset,
          recTyp,
          recSub,
          detail: `Non-finite HI_LIMIT on TEST_NUM ${testNum}; treated as absent.`,
        });
      }
    }

    const created: PtrDefaultContext = {
      testNum,
      testTxt: rawTestTxt ?? '',
      units: rawUnits ?? '',
      resScal,
      llmScal,
      hlmScal,
      loLimit,
      hiLimit,
    };
    defaultsMap.set(testNum, created);
    return created;
  }

  // Subsequent record for `testNum`: inherit omitted or default-flagged fields from `existing`
  const testTxt =
    rawTestTxt !== undefined && rawTestTxt.length > 0 ? rawTestTxt : existing.testTxt;

  if (rawOptFlag === undefined) {
    const units =
      rawUnits !== undefined && rawUnits.length > 0 ? rawUnits : existing.units;
    return {
      testNum,
      testTxt,
      units,
      resScal: existing.resScal,
      llmScal: existing.llmScal,
      hlmScal: existing.hlmScal,
      loLimit: existing.loLimit,
      hiLimit: existing.hiLimit,
    };
  }

  const resScal =
    rawResScal === undefined || (rawOptFlag & PTR_OPT_FLAG.RES_SCAL_INVALID) !== 0
      ? existing.resScal
      : rawResScal;

  let loLimit: number | null;
  let llmScal: number;
  if ((rawOptFlag & PTR_OPT_FLAG.NO_LO_LIMIT) !== 0) {
    loLimit = null;
    llmScal = existing.llmScal;
  } else if (
    (rawOptFlag & PTR_OPT_FLAG.LO_LIMIT_INVALID) !== 0 ||
    rawLoLimit === undefined
  ) {
    loLimit = existing.loLimit;
    llmScal =
      rawLlmScal !== undefined && (rawOptFlag & PTR_OPT_FLAG.LO_LIMIT_INVALID) === 0
        ? rawLlmScal
        : existing.llmScal;
  } else if (!Number.isFinite(rawLoLimit)) {
    warnings.push({
      code: 'NON_FINITE_MEASUREMENT',
      byteOffset,
      recTyp,
      recSub,
      detail: `Non-finite LO_LIMIT on TEST_NUM ${testNum}; treated as absent.`,
    });
    loLimit = null;
    llmScal = rawLlmScal ?? existing.llmScal;
  } else {
    loLimit = rawLoLimit;
    llmScal = rawLlmScal ?? existing.llmScal;
  }

  let hiLimit: number | null;
  let hlmScal: number;
  if ((rawOptFlag & PTR_OPT_FLAG.NO_HI_LIMIT) !== 0) {
    hiLimit = null;
    hlmScal = existing.hlmScal;
  } else if (
    (rawOptFlag & PTR_OPT_FLAG.HI_LIMIT_INVALID) !== 0 ||
    rawHiLimit === undefined
  ) {
    hiLimit = existing.hiLimit;
    hlmScal =
      rawHlmScal !== undefined && (rawOptFlag & PTR_OPT_FLAG.HI_LIMIT_INVALID) === 0
        ? rawHlmScal
        : existing.hlmScal;
  } else if (!Number.isFinite(rawHiLimit)) {
    warnings.push({
      code: 'NON_FINITE_MEASUREMENT',
      byteOffset,
      recTyp,
      recSub,
      detail: `Non-finite HI_LIMIT on TEST_NUM ${testNum}; treated as absent.`,
    });
    hiLimit = null;
    hlmScal = rawHlmScal ?? existing.hlmScal;
  } else {
    hiLimit = rawHiLimit;
    hlmScal = rawHlmScal ?? existing.hlmScal;
  }

  const units =
    rawUnits !== undefined && rawUnits.length > 0 ? rawUnits : existing.units;

  return {
    testNum,
    testTxt,
    units,
    resScal,
    llmScal,
    hlmScal,
    loLimit,
    hiLimit,
  };
}

function decodePtr(
  cursor: BinaryCursor,
  ptrDefaults: Map<number, PtrDefaultContext>,
  warnings: ParseWarning[],
  byteOffset: number,
): ParsedPtrExecution {
  const testNum = cursor.readU4();
  const headNum = cursor.readU1();
  const siteNum = cursor.readU1();
  const testFlg = cursor.readB1();
  const parmFlg = cursor.readB1();
  const rawResult = cursor.readOptR4();
  const rawTestTxt = cursor.readOptCn();
  const alarmId = cursor.readOptCn() ?? '';
  const rawOptFlag = cursor.readOptB1();
  const rawResScal = cursor.readOptI1();
  const rawLlmScal = cursor.readOptI1();
  const rawHlmScal = cursor.readOptI1();
  const rawLoLimit = cursor.readOptR4();
  const rawHiLimit = cursor.readOptR4();
  const rawUnits = cursor.readOptCn();
  // Consume remaining optional format/spec fields if present so bounds inside recordEnd are verified
  cursor.readOptCn(); // C_RESFMT
  cursor.readOptCn(); // C_LLMFMT
  cursor.readOptCn(); // C_HLMFMT
  cursor.readOptR4(); // LO_SPEC
  cursor.readOptR4(); // HI_SPEC

  const resolved = resolveParametricFields(
    testNum,
    rawTestTxt,
    rawOptFlag,
    rawResScal,
    rawLlmScal,
    rawHlmScal,
    rawLoLimit,
    rawHiLimit,
    rawUnits,
    ptrDefaults,
    warnings,
    byteOffset,
    STDF_RECORD_CODES.PTR.recTyp,
    STDF_RECORD_CODES.PTR.recSub,
  );

  let result: number;
  if (
    rawResult === undefined ||
    (testFlg & (PTR_TEST_FLG.RESULT_INVALID | PTR_TEST_FLG.NOT_EXECUTED)) !== 0
  ) {
    result = Number.NaN;
  } else if (!Number.isFinite(rawResult)) {
    warnings.push({
      code: 'NON_FINITE_MEASUREMENT',
      byteOffset,
      recTyp: STDF_RECORD_CODES.PTR.recTyp,
      recSub: STDF_RECORD_CODES.PTR.recSub,
      detail: `Non-finite PTR RESULT on TEST_NUM ${testNum} at (${headNum}, ${siteNum}).`,
    });
    result = Number.NaN;
  } else {
    result = rawResult;
  }

  return {
    testNum,
    headNum,
    siteNum,
    testFlg,
    parmFlg,
    result,
    testTxt: resolved.testTxt,
    alarmId,
    optFlag: rawOptFlag ?? 0,
    resScal: resolved.resScal,
    llmScal: resolved.llmScal,
    hlmScal: resolved.hlmScal,
    loLimit: resolved.loLimit,
    hiLimit: resolved.hiLimit,
    units: resolved.units,
  };
}

function decodeMpr(
  cursor: BinaryCursor,
  mprDefaults: Map<number, PtrDefaultContext>,
  warnings: ParseWarning[],
  byteOffset: number,
): ParsedMprExecution {
  const testNum = cursor.readU4();
  const headNum = cursor.readU1();
  const siteNum = cursor.readU1();
  const testFlg = cursor.readB1();
  const parmFlg = cursor.readB1();
  const rtnIcnt = cursor.readU2();
  const rsltCnt = cursor.readU2();
  const rtnStat = cursor.readOptKxN1(rtnIcnt) ?? new Uint8Array(0);
  const rtnRslt = cursor.readOptKxR4(rsltCnt) ?? new Float32Array(0);
  const rawTestTxt = cursor.readOptCn();
  const alarmId = cursor.readOptCn() ?? '';
  const rawOptFlag = cursor.readOptB1();
  const rawResScal = cursor.readOptI1();
  const rawLlmScal = cursor.readOptI1();
  const rawHlmScal = cursor.readOptI1();
  const rawLoLimit = cursor.readOptR4();
  const rawHiLimit = cursor.readOptR4();
  const startIn = cursor.readOptR4();
  const incrIn = cursor.readOptR4();
  const rtnIndx = cursor.readOptKxU2(rtnIcnt) ?? new Uint16Array(0);
  const rawUnits = cursor.readOptCn();
  const unitsIn = cursor.readOptCn() ?? '';
  cursor.readOptCn(); // C_RESFMT
  cursor.readOptCn(); // C_LLMFMT
  cursor.readOptCn(); // C_HLMFMT
  cursor.readOptR4(); // LO_SPEC
  cursor.readOptR4(); // HI_SPEC

  const resolved = resolveParametricFields(
    testNum,
    rawTestTxt,
    rawOptFlag,
    rawResScal,
    rawLlmScal,
    rawHlmScal,
    rawLoLimit,
    rawHiLimit,
    rawUnits,
    mprDefaults,
    warnings,
    byteOffset,
    STDF_RECORD_CODES.MPR.recTyp,
    STDF_RECORD_CODES.MPR.recSub,
  );

  for (let i = 0; i < rtnRslt.length; i += 1) {
    if (!Number.isFinite(rtnRslt[i]!)) {
      warnings.push({
        code: 'NON_FINITE_MEASUREMENT',
        byteOffset,
        recTyp: STDF_RECORD_CODES.MPR.recTyp,
        recSub: STDF_RECORD_CODES.MPR.recSub,
        detail: `Non-finite MPR RTN_RSLT[${i}] on TEST_NUM ${testNum}.`,
      });
      rtnRslt[i] = Number.NaN;
    }
  }

  return {
    testNum,
    headNum,
    siteNum,
    testFlg,
    parmFlg,
    rtnStat,
    rtnRslt,
    rtnIndx,
    testTxt: resolved.testTxt,
    alarmId,
    optFlag: rawOptFlag ?? 0,
    resScal: resolved.resScal,
    llmScal: resolved.llmScal,
    hlmScal: resolved.hlmScal,
    loLimit: resolved.loLimit,
    hiLimit: resolved.hiLimit,
    ...(startIn !== undefined && Number.isFinite(startIn) ? { startIn } : {}),
    ...(incrIn !== undefined && Number.isFinite(incrIn) ? { incrIn } : {}),
    units: resolved.units,
    unitsIn,
  };
}

function decodeFtr(cursor: BinaryCursor): ParsedFtrExecution {
  const testNum = cursor.readU4();
  const headNum = cursor.readU1();
  const siteNum = cursor.readU1();
  const testFlg = cursor.readB1();
  const optFlag = cursor.readOptB1();
  const cyclCnt = normalizeOptionalCount(cursor.readOptU4());
  const relVadr = normalizeOptionalCount(cursor.readOptU4());
  const reptCnt = normalizeOptionalCount(cursor.readOptU4());
  const numFail = normalizeOptionalCount(cursor.readOptU4());
  const xfailAd = cursor.readOptI4();
  const yfailAd = cursor.readOptI4();
  const vectOff = cursor.readOptI2();
  const rtnIcnt = cursor.readOptU2() ?? 0;
  const pgmIcnt = cursor.readOptU2() ?? 0;
  const rtnIndx =
    rtnIcnt > 0 ? (cursor.readOptKxU2(rtnIcnt) ?? new Uint16Array(0)) : new Uint16Array(0);
  const rtnStat =
    rtnIcnt > 0 ? (cursor.readOptKxN1(rtnIcnt) ?? new Uint8Array(0)) : new Uint8Array(0);
  const pgmIndx =
    pgmIcnt > 0 ? (cursor.readOptKxU2(pgmIcnt) ?? new Uint16Array(0)) : new Uint16Array(0);
  const pgmStat =
    pgmIcnt > 0 ? (cursor.readOptKxN1(pgmIcnt) ?? new Uint8Array(0)) : new Uint8Array(0);
  const failPin = cursor.readOptDn();
  cursor.readOptCn(); // VECT_NAM
  cursor.readOptCn(); // TIME_SET
  cursor.readOptCn(); // OP_CODE
  const testTxt = cursor.readOptCn() ?? '';
  cursor.readOptCn(); // ALARM_ID
  cursor.readOptCn(); // PROG_TXT
  cursor.readOptCn(); // RSLT_TXT
  cursor.readOptU1(); // PATG_NUM
  const spinMap = cursor.readOptDn();

  return {
    testNum,
    headNum,
    siteNum,
    testFlg,
    ...(optFlag !== undefined ? { optFlag } : {}),
    ...(cyclCnt !== undefined ? { cyclCnt } : {}),
    ...(relVadr !== undefined ? { relVadr } : {}),
    ...(reptCnt !== undefined ? { reptCnt } : {}),
    ...(numFail !== undefined ? { numFail } : {}),
    ...(xfailAd !== undefined ? { xfailAd } : {}),
    ...(yfailAd !== undefined ? { yfailAd } : {}),
    ...(vectOff !== undefined ? { vectOff } : {}),
    rtnIndx,
    rtnStat,
    pgmIndx,
    pgmStat,
    ...(failPin !== undefined ? { failPin } : {}),
    ...(spinMap !== undefined ? { spinMap } : {}),
    testTxt,
  };
}

/**
 * Decodes an uncompressed STDF V4 byte buffer into `ParsedLotBuildInput`.
 * Never throws uncaught exceptions on arbitrary or truncated byte sequences.
 */
export function parseStdfBytes(
  rawOrDecompressed: Uint8Array,
  options: ParseOptions,
): Result<ParsedLotBuildInput, ParseFatalError> {
  const totalBytes = rawOrDecompressed.byteLength;
  if (totalBytes === 0) {
    return {
      ok: false,
      error: {
        code: 'EMPTY_INPUT',
        message: 'STDF input buffer is empty (0 bytes).',
        byteOffset: 0,
      },
    };
  }

  const firstBytesHex = formatHexBytes(rawOrDecompressed, 16);

  if (totalBytes < 6) {
    return {
      ok: false,
      error: {
        code: 'MISSING_FAR_HEADER',
        message: `Input buffer (${totalBytes} bytes) is shorter than the 6-byte STDF V4 FAR header.`,
        byteOffset: 0,
        firstBytesHex,
      },
    };
  }

  const initialTyp = rawOrDecompressed[2]!;
  const initialSub = rawOrDecompressed[3]!;
  if (
    initialTyp !== STDF_RECORD_CODES.FAR.recTyp ||
    initialSub !== STDF_RECORD_CODES.FAR.recSub
  ) {
    return {
      ok: false,
      error: {
        code: 'MISSING_FAR_HEADER',
        message: `Expected initial FAR (0, 10) record at byte 0, found (${initialTyp}, ${initialSub}).`,
        byteOffset: 0,
        firstBytesHex,
      },
    };
  }

  if (rawOrDecompressed[0] === 0 && rawOrDecompressed[1] === 0) {
    return {
      ok: false,
      error: {
        code: 'MISSING_FAR_HEADER',
        message: 'Malformed FAR REC_LEN (0) at byte 0.',
        byteOffset: 0,
        firstBytesHex,
      },
    };
  }

  const cpuType = rawOrDecompressed[4]!;
  const stdfVer = rawOrDecompressed[5]!;

  if (cpuType === STDF_CPU_TYPE.DEC_VAX) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_CPU_TYPE_VAX',
        message:
          'DEC VAX byte order (FAR.CPU_TYPE = 0) is unsupported; expected big-endian (1) or little-endian (2).',
        byteOffset: 4,
        firstBytesHex,
      },
    };
  }

  // Unknown CPU_TYPE values (3..255) map to MISSING_FAR_HEADER per design.md ParseFatalCode
  if (cpuType !== STDF_CPU_TYPE.BIG_ENDIAN && cpuType !== STDF_CPU_TYPE.LITTLE_ENDIAN) {
    return {
      ok: false,
      error: {
        code: 'MISSING_FAR_HEADER',
        message: `Unsupported FAR.CPU_TYPE (${cpuType}) at byte 4; expected 1 (big-endian) or 2 (little-endian).`,
        byteOffset: 4,
        firstBytesHex,
      },
    };
  }

  const endianness: CpuEndianness =
    cpuType === STDF_CPU_TYPE.LITTLE_ENDIAN ? 'little' : 'big';
  const littleEndian = endianness === 'little';
  const headerView = new DataView(
    rawOrDecompressed.buffer,
    rawOrDecompressed.byteOffset,
    rawOrDecompressed.byteLength,
  );

  const farRecLen = headerView.getUint16(0, littleEndian);
  if (farRecLen < 2 || STDF_RECORD_HEADER_BYTES + farRecLen > totalBytes) {
    return {
      ok: false,
      error: {
        code: 'MISSING_FAR_HEADER',
        message: `Malformed FAR REC_LEN (${farRecLen}) at byte 0.`,
        byteOffset: 0,
        firstBytesHex,
      },
    };
  }

  if (stdfVer !== STDF_V4_VERSION) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_STDF_VERSION',
        message: `Unsupported STDF version ${stdfVer} at byte 5; only STDF V4 is supported.`,
        byteOffset: 5,
        stdfVersion: stdfVer,
        firstBytesHex,
      },
    };
  }

  const cursor = new BinaryCursor(rawOrDecompressed, endianness);
  const warnings: ParseWarning[] = [];
  const pcrs: ParsedPcrRecord[] = [];
  const hbrs: ParsedHbrRecord[] = [];
  const sbrs: ParsedSbrRecord[] = [];
  const sdrs: ParsedSdrRecord[] = [];
  const tsrs: ParsedTsrRecord[] = [];
  const ptrDefaults = new Map<number, PtrDefaultContext>();
  const mprDefaults = new Map<number, PtrDefaultContext>();
  const openParts = new Map<number, OpenPartContext>();
  const wafers: MutableWaferAccumulator[] = [];

  let mir: ParsedMirRecord | null = null;
  let mrr: ParsedMrrRecord | null = null;
  let defaultWaferConfig: ParsedWcrRecord | null = null;
  let activeWafer: MutableWaferAccumulator | null = null;

  let offset = STDF_RECORD_HEADER_BYTES + farRecLen;
  let recordsDecoded = 1;
  let skippedRecordCount = 0;
  let validPrrCount = 0;
  let totalResolvedDies = 0;

  const onProgress = options.onProgress;
  let lastProgressBytes = offset;
  let lastProgressRecords = recordsDecoded;
  let sweepBuffer: number[] = [];

  const flushProgress = (force: boolean): void => {
    if (!onProgress) {
      return;
    }
    if (
      !force &&
      offset - lastProgressBytes < PROGRESS_BYTE_INTERVAL &&
      recordsDecoded - lastProgressRecords < PROGRESS_RECORD_INTERVAL
    ) {
      return;
    }
    const sweepBatch =
      sweepBuffer.length > 0 ? Int16Array.from(sweepBuffer) : undefined;
    sweepBuffer = [];
    lastProgressBytes = offset;
    lastProgressRecords = recordsDecoded;
    onProgress({
      bytesProcessed: offset,
      totalBytes,
      recordsDecoded,
      diesResolved: totalResolvedDies,
      ...(sweepBatch !== undefined ? { sweepBatch } : {}),
    });
  };

  const closeOpenPartsAtBoundary = (boundaryOffset: number): void => {
    if (openParts.size === 0) {
      return;
    }
    for (const part of openParts.values()) {
      warnings.push({
        code: 'UNCLOSED_PIR_AT_WRR',
        byteOffset: boundaryOffset,
        recTyp: STDF_RECORD_CODES.WRR.recTyp,
        recSub: STDF_RECORD_CODES.WRR.recSub,
        detail: `Unclosed PIR opened at byte ${part.pirByteOffset} for site (${part.headNum}, ${part.siteNum}) when wafer closed.`,
      });
    }
    openParts.clear();
  };

  const ensureActiveWafer = (
    triggerOffset: number,
    triggerTyp: number,
    triggerSub: number,
  ): MutableWaferAccumulator => {
    if (activeWafer !== null) {
      return activeWafer;
    }
    const created: MutableWaferAccumulator = {
      waferIndex: wafers.length,
      implicit: true,
      wir: null,
      wrr: null,
      wcr: defaultWaferConfig,
      parts: [],
      seenCoords: new Set<number>(),
    };
    wafers.push(created);
    activeWafer = created;
    warnings.push({
      code: 'MISSING_WIR_RECORD',
      byteOffset: triggerOffset,
      recTyp: triggerTyp,
      recSub: triggerSub,
      detail: `Part record encountered without an open WIR (2, 10); synthesized implicit wafer W${String(created.waferIndex + 1).padStart(2, '0')}.`,
    });
    return created;
  };

  const binsOnly = options.mode === 'bins-only';

  const formatRecDisplayName = (typ: number, sub: number): string => {
    for (const [name, code] of Object.entries(STDF_RECORD_CODES)) {
      if (code.recTyp === typ && code.recSub === sub) {
        return `${name} (${typ}, ${sub})`;
      }
    }
    return `(${typ}, ${sub})`;
  };

  let lastTruncatedRecord: TruncatedRecordDiagnostic | undefined;

  while (offset < totalBytes) {
    if (offset + STDF_RECORD_HEADER_BYTES > totalBytes) {
      const recTyp = offset + 2 < totalBytes ? rawOrDecompressed[offset + 2]! : 0;
      const recSub = offset + 3 < totalBytes ? rawOrDecompressed[offset + 3]! : 0;
      const truncatedRecord: TruncatedRecordDiagnostic = {
        recName:
          offset + 3 < totalBytes
            ? formatRecDisplayName(recTyp, recSub)
            : 'HEADER',
        recTyp,
        recSub,
        byteOffset: offset,
        needBytes: STDF_RECORD_HEADER_BYTES,
        haveBytes: totalBytes - offset,
      };
      lastTruncatedRecord = truncatedRecord;
      warnings.push({
        code: 'TRUNCATED_TAIL_RECORD',
        byteOffset: offset,
        recTyp,
        recSub,
        detail: `Truncated 4-byte STDF record header at byte offset ${offset} (${totalBytes - offset} trailing bytes).`,
        firstBytesHex,
        truncatedRecord,
      });
      break;
    }

    const recLen = headerView.getUint16(offset, littleEndian);
    const recTyp = rawOrDecompressed[offset + 2]!;
    const recSub = rawOrDecompressed[offset + 3]!;
    const recordStart = offset + STDF_RECORD_HEADER_BYTES;
    const recordEnd = recordStart + recLen;

    if (recordEnd > totalBytes) {
      const truncatedRecord: TruncatedRecordDiagnostic = {
        recName: formatRecDisplayName(recTyp, recSub),
        recTyp,
        recSub,
        byteOffset: offset,
        needBytes: STDF_RECORD_HEADER_BYTES + recLen,
        haveBytes: totalBytes - offset,
      };
      lastTruncatedRecord = truncatedRecord;
      warnings.push({
        code: 'TRUNCATED_TAIL_RECORD',
        byteOffset: offset,
        recTyp,
        recSub,
        detail: `Truncated record (${recTyp}, ${recSub}) at byte offset ${offset}: REC_LEN=${recLen} extends past buffer length ${totalBytes}.`,
        firstBytesHex,
        truncatedRecord,
      });
      break;
    }

    const recKey = packRecordTypeKey(recTyp, recSub);

    try {
      switch (recKey) {
        case REC_KEY_FAR: {
          // Redundant mid-stream FAR: validate bounds only
          cursor.setWindow(recordStart, recordEnd);
          cursor.readU1();
          cursor.readU1();
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_MIR: {
          cursor.setWindow(recordStart, recordEnd);
          const decoded = decodeMir(cursor);
          if (mir === null) {
            mir = decoded;
          }
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_MRR: {
          cursor.setWindow(recordStart, recordEnd);
          mrr = decodeMrr(cursor);
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_PCR: {
          cursor.setWindow(recordStart, recordEnd);
          pcrs.push(decodePcr(cursor));
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_HBR: {
          cursor.setWindow(recordStart, recordEnd);
          hbrs.push(decodeHbr(cursor));
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_SBR: {
          cursor.setWindow(recordStart, recordEnd);
          sbrs.push(decodeSbr(cursor));
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_SDR: {
          cursor.setWindow(recordStart, recordEnd);
          sdrs.push(decodeSdr(cursor));
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_WIR: {
          cursor.setWindow(recordStart, recordEnd);
          const wir = decodeWir(cursor);
          if (activeWafer !== null) {
            closeOpenPartsAtBoundary(offset);
          }
          const nextWafer: MutableWaferAccumulator = {
            waferIndex: wafers.length,
            implicit: false,
            wir,
            wrr: null,
            wcr: defaultWaferConfig,
            parts: [],
            seenCoords: new Set<number>(),
          };
          wafers.push(nextWafer);
          activeWafer = nextWafer;
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_WRR: {
          cursor.setWindow(recordStart, recordEnd);
          const wrr = decodeWrr(cursor);
          closeOpenPartsAtBoundary(offset);
          if (activeWafer !== null) {
            activeWafer.wrr = wrr;
            activeWafer = null;
          }
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_WCR: {
          cursor.setWindow(recordStart, recordEnd);
          const wcr = decodeWcr(cursor);
          if (defaultWaferConfig === null || activeWafer === null) {
            defaultWaferConfig = wcr;
          }
          if (activeWafer !== null) {
            activeWafer.wcr = wcr;
          } else {
            for (let i = 0; i < wafers.length; i += 1) {
              if (wafers[i]!.wcr === null) {
                wafers[i]!.wcr = wcr;
              }
            }
          }
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_PIR: {
          cursor.setWindow(recordStart, recordEnd);
          const headNum = cursor.readU1();
          const siteNum = cursor.readU1();
          ensureActiveWafer(offset, recTyp, recSub);
          openParts.set(packSiteKey(headNum, siteNum), {
            headNum,
            siteNum,
            pirByteOffset: offset,
            ptrs: [],
            mprs: [],
            ftrs: [],
          });
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_PRR: {
          cursor.setWindow(recordStart, recordEnd);
          const headNum = cursor.readU1();
          const siteNum = cursor.readU1();
          const partFlg = cursor.readB1();
          const numTest = cursor.readU2();
          const hardBin = cursor.readU2();
          const softBin = cursor.readOptU2() ?? STDF_MISSING_U2;
          const xCoord = cursor.readOptI2() ?? STDF_MISSING_COORD;
          const yCoord = cursor.readOptI2() ?? STDF_MISSING_COORD;
          const testT = cursor.readOptU4() ?? 0;
          const partId = cursor.readOptCn() ?? '';
          const partTxt = cursor.readOptCn() ?? '';
          const partFix = cursor.readOptBn();

          const wafer = ensureActiveWafer(offset, recTyp, recSub);
          const siteKey = packSiteKey(headNum, siteNum);
          const openPart = openParts.get(siteKey);
          if (openPart !== undefined) {
            openParts.delete(siteKey);
          } else {
            warnings.push({
              code: 'MISSING_PIR_RECORD',
              byteOffset: offset,
              recTyp,
              recSub,
              detail: `PRR at site (${headNum}, ${siteNum}) has no preceding PIR (5, 10).`,
            });
          }

          const execution: ParsedPartExecution = {
            prrIndex: validPrrCount,
            byteOffset: offset,
            headNum,
            siteNum,
            partFlg,
            numTest,
            hardBin,
            softBin,
            xCoord,
            yCoord,
            testT,
            partId,
            partTxt,
            ...(partFix !== undefined ? { partFix } : {}),
            ptrs: openPart ? openPart.ptrs : [],
            mprs: openPart ? openPart.mprs : [],
            ftrs: openPart ? openPart.ftrs : [],
          };

          wafer.parts.push(execution);
          validPrrCount += 1;
          recordsDecoded += 1;

          if (xCoord !== STDF_MISSING_COORD && yCoord !== STDF_MISSING_COORD) {
            const coordKey = packWaferCoordKey(xCoord, yCoord);
            if (!wafer.seenCoords.has(coordKey)) {
              wafer.seenCoords.add(coordKey);
              totalResolvedDies += 1;
            }
          } else {
            totalResolvedDies += 1;
          }

          if (onProgress) {
            const passHint = (partFlg & PRR_PART_FLG.FAILED) === 0 ? 1 : 0;
            sweepBuffer.push(xCoord, yCoord, passHint);
          }
          break;
        }
        case REC_KEY_TSR: {
          cursor.setWindow(recordStart, recordEnd);
          tsrs.push(decodeTsr(cursor, warnings, offset));
          recordsDecoded += 1;
          break;
        }
        case REC_KEY_PTR: {
          if (binsOnly) {
            skippedRecordCount += 1;
          } else {
            cursor.setWindow(recordStart, recordEnd);
            const ptr = decodePtr(cursor, ptrDefaults, warnings, offset);
            const openPart = openParts.get(packSiteKey(ptr.headNum, ptr.siteNum));
            if (openPart !== undefined) {
              openPart.ptrs.push(ptr);
            } else {
              warnings.push({
                code: 'ORPHAN_TEST_RECORD',
                byteOffset: offset,
                recTyp,
                recSub,
                detail: `PTR for TEST_NUM ${ptr.testNum} at site (${ptr.headNum}, ${ptr.siteNum}) has no open PIR.`,
              });
            }
            recordsDecoded += 1;
          }
          break;
        }
        case REC_KEY_MPR: {
          if (binsOnly) {
            skippedRecordCount += 1;
          } else {
            cursor.setWindow(recordStart, recordEnd);
            const mpr = decodeMpr(cursor, mprDefaults, warnings, offset);
            const openPart = openParts.get(packSiteKey(mpr.headNum, mpr.siteNum));
            if (openPart !== undefined) {
              openPart.mprs.push(mpr);
            } else {
              warnings.push({
                code: 'ORPHAN_TEST_RECORD',
                byteOffset: offset,
                recTyp,
                recSub,
                detail: `MPR for TEST_NUM ${mpr.testNum} at site (${mpr.headNum}, ${mpr.siteNum}) has no open PIR.`,
              });
            }
            recordsDecoded += 1;
          }
          break;
        }
        case REC_KEY_FTR: {
          if (binsOnly) {
            skippedRecordCount += 1;
          } else {
            cursor.setWindow(recordStart, recordEnd);
            const ftr = decodeFtr(cursor);
            const openPart = openParts.get(packSiteKey(ftr.headNum, ftr.siteNum));
            if (openPart !== undefined) {
              openPart.ftrs.push(ftr);
            } else {
              warnings.push({
                code: 'ORPHAN_TEST_RECORD',
                byteOffset: offset,
                recTyp,
                recSub,
                detail: `FTR for TEST_NUM ${ftr.testNum} at site (${ftr.headNum}, ${ftr.siteNum}) has no open PIR.`,
              });
            }
            recordsDecoded += 1;
          }
          break;
        }
        default: {
          // All other STDF record types (ATR, PMR, PGR, PLR, RDR, BPS, EPS, GDR, DTR, STR, PSR, ...)
          skippedRecordCount += 1;
          break;
        }
      }
    } catch (err) {
      if (err instanceof RecordBoundsError) {
        warnings.push({
          code: 'MALFORMED_RECORD_FIELD',
          byteOffset: offset,
          recTyp,
          recSub,
          detail: err.message,
        });
      } else {
        // Defensive fallback so an unexpected error inside a single record cannot crash the worker
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push({
          code: 'MALFORMED_RECORD_FIELD',
          byteOffset: offset,
          recTyp,
          recSub,
          detail: msg,
        });
      }
    }

    offset = recordEnd;
    flushProgress(false);
  }

  if (validPrrCount === 0) {
    return {
      ok: false,
      error: {
        code: 'ZERO_VALID_PRR',
        message: 'STDF V4 stream contains zero valid PRR part result records.',
        byteOffset: lastTruncatedRecord?.byteOffset ?? offset,
        firstBytesHex,
        ...(lastTruncatedRecord !== undefined
          ? { truncatedRecord: lastTruncatedRecord }
          : {}),
      },
    };
  }

  flushProgress(true);

  const finalizedWafers: ParsedWaferChunk[] = wafers
    .filter((w) => w.parts.length > 0 || !w.implicit)
    .map((w, idx) => ({
      waferIndex: idx,
      implicit: w.implicit,
      wir: w.wir,
      wrr: w.wrr,
      wcr: w.wcr ?? defaultWaferConfig,
      parts: w.parts,
    }));

  return {
    ok: true,
    value: {
      parseMode: options.mode,
      endianness,
      stdfVersion: STDF_V4_VERSION,
      mir,
      mrr,
      pcrs,
      hbrs,
      sbrs,
      sdrs,
      tsrs,
      defaultWaferConfig,
      ptrDefaults,
      wafers: finalizedWafers,
      recordsDecoded,
      validPrrCount,
      skippedRecordCount,
      warnings,
    },
  };
}
