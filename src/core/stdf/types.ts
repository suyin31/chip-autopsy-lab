/**
 * STDF V4 shared binary record schemas, field types, parser outputs, and writer specs.
 *
 * Pure deterministic TypeScript (`src/core/stdf/`) with zero React, Next.js, or DOM imports.
 * Validates: Requirements 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 3.1
 */

export const STDF_V4_VERSION = 4 as const;
export const STDF_RECORD_HEADER_BYTES = 4 as const;
export const STDF_MAX_RECORD_BODY_BYTES = 0xffff as const;
export const STDF_MISSING_COORD = -32768 as const;
export const STDF_MISSING_U1 = 0xff as const;
export const STDF_MISSING_U2 = 0xffff as const;
export const STDF_MISSING_U4 = 0xffffffff as const;
export const DEFAULT_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB

export const STDF_CPU_TYPE = {
  DEC_VAX: 0,
  BIG_ENDIAN: 1,
  LITTLE_ENDIAN: 2,
} as const;

export const PRR_PART_FLG = {
  SUPERSEDES_PART_ID: 0x01,
  SUPERSEDES_COORD: 0x02,
  ABNORMAL_END: 0x04,
  FAILED: 0x08,
  PF_INVALID: 0x10,
} as const;

export const PTR_TEST_FLG = {
  ALARM: 0x01,
  RESULT_INVALID: 0x02,
  UNRELIABLE: 0x04,
  TIMEOUT: 0x08,
  NOT_EXECUTED: 0x10,
  ABORTED: 0x20,
  PF_INVALID: 0x40,
  FAILED: 0x80,
} as const;

export const PTR_OPT_FLAG = {
  RES_SCAL_INVALID: 0x01,
  RESERVED_BIT_1: 0x02,
  NO_LO_SPEC: 0x04,
  NO_HI_SPEC: 0x08,
  LO_LIMIT_INVALID: 0x10,
  HI_LIMIT_INVALID: 0x20,
  NO_LO_LIMIT: 0x40,
  NO_HI_LIMIT: 0x80,
} as const;

export type CpuEndianness = 'big' | 'little';
export type ParseMode = 'full' | 'bins-only';
export type WaferFlatOrientation = 'U' | 'D' | 'L' | 'R' | ' ';
export type WaferAxisPosX = 'L' | 'R' | ' ';
export type WaferAxisPosY = 'U' | 'D' | ' ';
export type BinPassFailFlag = 'P' | 'F' | ' ';

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface StdfRecordHeader {
  readonly recLen: number;
  readonly recTyp: number;
  readonly recSub: number;
  readonly byteOffset: number;
}

export interface BitArrayData {
  readonly bitCount: number;
  readonly bytes: Uint8Array;
}

export type ParseFatalCode =
  | 'EMPTY_INPUT'
  | 'GZIP_DECOMPRESS_FAILED'
  /** Covers missing/short FAR (0, 10), malformed FAR.REC_LEN, and unknown FAR.CPU_TYPE (3..255). */
  | 'MISSING_FAR_HEADER'
  | 'UNSUPPORTED_STDF_VERSION'
  | 'UNSUPPORTED_CPU_TYPE_VAX'
  | 'ZERO_VALID_PRR';

export interface TruncatedRecordDiagnostic {
  readonly recName: string;
  readonly recTyp: number;
  readonly recSub: number;
  readonly byteOffset: number;
  readonly needBytes: number;
  readonly haveBytes: number;
}

export interface ParseFatalError {
  readonly code: ParseFatalCode;
  readonly message: string;
  readonly byteOffset?: number;
  readonly firstBytesHex?: string;
  readonly stdfVersion?: number;
  readonly truncatedRecord?: TruncatedRecordDiagnostic;
}

export type ParseWarningCode =
  | 'TRUNCATED_TAIL_RECORD'
  | 'MALFORMED_RECORD_FIELD'
  | 'ORPHAN_TEST_RECORD'
  | 'UNCLOSED_PIR_AT_WRR'
  | 'MISSING_WIR_RECORD'
  | 'MISSING_PIR_RECORD'
  | 'MISSING_HBIN_PF_FLAG'
  | 'NON_FINITE_MEASUREMENT';

export interface ParseWarning {
  readonly code: ParseWarningCode;
  readonly byteOffset: number;
  readonly recTyp: number;
  readonly recSub: number;
  readonly detail: string;
  readonly firstBytesHex?: string;
  readonly truncatedRecord?: TruncatedRecordDiagnostic;
}

/**
 * Formats the first `maxBytes` of `bytes` as uppercase 2-digit hex pairs separated by spaces.
 */
export function formatHexBytes(bytes: Uint8Array, maxBytes = 16): string {
  const count = Math.min(bytes.byteLength, Math.max(0, maxBytes));
  if (count === 0) {
    return '';
  }
  const parts: string[] = new Array<string>(count);
  for (let i = 0; i < count; i += 1) {
    parts[i] = bytes[i]!.toString(16).toUpperCase().padStart(2, '0');
  }
  return parts.join(' ');
}

export interface PtrDefaultContext {
  readonly testNum: number;
  readonly testTxt: string;
  readonly units: string;
  readonly resScal: number;
  readonly llmScal: number;
  readonly hlmScal: number;
  readonly loLimit: number | null;
  readonly hiLimit: number | null;
}

export interface ParseProgress {
  readonly bytesProcessed: number;
  readonly totalBytes: number | null;
  readonly recordsDecoded: number;
  readonly diesResolved: number;
  readonly sweepBatch?: Int16Array;
}

export interface ParseOptions {
  readonly mode: ParseMode;
  readonly maxUncompressedBytes?: number;
  readonly onProgress?: (progress: ParseProgress) => void;
}

/**
 * Canonical STDF V4 data-type codes used across shared reader and writer schemas.
 */
export type StdfFieldDataType =
  | 'U*1'
  | 'U*2'
  | 'U*4'
  | 'U*8'
  | 'I*1'
  | 'I*2'
  | 'I*4'
  | 'I*8'
  | 'R*4'
  | 'R*8'
  | 'C*1'
  | 'C*n'
  | 'B*1'
  | 'B*n'
  | 'D*n'
  | 'kxU*1'
  | 'kxU*2'
  | 'kxN*1'
  | 'kxR*4';

export interface StdfFieldSchema {
  readonly name: string;
  readonly dataType: StdfFieldDataType;
  readonly optional: boolean;
  readonly countField?: string;
}

export type StdfDecodedRecordName =
  | 'FAR'
  | 'MIR'
  | 'MRR'
  | 'PCR'
  | 'HBR'
  | 'SBR'
  | 'SDR'
  | 'WIR'
  | 'WRR'
  | 'WCR'
  | 'PIR'
  | 'PRR'
  | 'TSR'
  | 'PTR'
  | 'MPR'
  | 'FTR';

export interface StdfRecordSchema {
  readonly name: StdfDecodedRecordName;
  readonly recTyp: number;
  readonly recSub: number;
  readonly skipInBinsOnly: boolean;
  readonly fields: readonly StdfFieldSchema[];
}

export function packRecordTypeKey(recTyp: number, recSub: number): number {
  return ((recTyp & 0xff) << 8) | (recSub & 0xff);
}

export function packSiteKey(headNum: number, siteNum: number): number {
  return ((headNum & 0xff) << 8) | (siteNum & 0xff);
}

export const STDF_RECORD_CODES: Readonly<
  Record<StdfDecodedRecordName, { readonly recTyp: number; readonly recSub: number }>
> = {
  FAR: { recTyp: 0, recSub: 10 },
  MIR: { recTyp: 1, recSub: 10 },
  MRR: { recTyp: 1, recSub: 20 },
  PCR: { recTyp: 1, recSub: 30 },
  HBR: { recTyp: 1, recSub: 40 },
  SBR: { recTyp: 1, recSub: 50 },
  SDR: { recTyp: 1, recSub: 80 },
  WIR: { recTyp: 2, recSub: 10 },
  WRR: { recTyp: 2, recSub: 20 },
  WCR: { recTyp: 2, recSub: 30 },
  PIR: { recTyp: 5, recSub: 10 },
  PRR: { recTyp: 5, recSub: 20 },
  TSR: { recTyp: 10, recSub: 30 },
  PTR: { recTyp: 15, recSub: 10 },
  MPR: { recTyp: 15, recSub: 15 },
  FTR: { recTyp: 15, recSub: 20 },
} as const;

const reqField = (name: string, dataType: StdfFieldDataType): StdfFieldSchema => ({
  name,
  dataType,
  optional: false,
});

const optField = (
  name: string,
  dataType: StdfFieldDataType,
  countField?: string,
): StdfFieldSchema => ({
  name,
  dataType,
  optional: true,
  ...(countField !== undefined ? { countField } : {}),
});

const reqArrayField = (
  name: string,
  dataType: StdfFieldDataType,
  countField: string,
): StdfFieldSchema => ({
  name,
  dataType,
  optional: false,
  countField,
});

/**
 * Shared Teradyne STDF V4 declarative record schemas for all 16 decoded record types.
 */
export const STDF_V4_RECORD_SCHEMAS: Readonly<
  Record<StdfDecodedRecordName, StdfRecordSchema>
> = {
  FAR: {
    name: 'FAR',
    recTyp: 0,
    recSub: 10,
    skipInBinsOnly: false,
    fields: [reqField('CPU_TYPE', 'U*1'), reqField('STDF_VER', 'U*1')],
  },
  MIR: {
    name: 'MIR',
    recTyp: 1,
    recSub: 10,
    skipInBinsOnly: false,
    fields: [
      reqField('SETUP_T', 'U*4'),
      reqField('START_T', 'U*4'),
      reqField('STAT_NUM', 'U*1'),
      optField('MODE_COD', 'C*1'),
      optField('RTST_COD', 'C*1'),
      optField('PROT_COD', 'C*1'),
      optField('BURN_TIM', 'U*2'),
      optField('CMOD_COD', 'C*1'),
      optField('LOT_ID', 'C*n'),
      optField('PART_TYP', 'C*n'),
      optField('NODE_NAM', 'C*n'),
      optField('TSTR_TYP', 'C*n'),
      optField('JOB_NAM', 'C*n'),
      optField('JOB_REV', 'C*n'),
      optField('SBLOT_ID', 'C*n'),
      optField('OPER_NAM', 'C*n'),
      optField('EXEC_TYP', 'C*n'),
      optField('EXEC_VER', 'C*n'),
      optField('TEST_COD', 'C*n'),
      optField('TST_TEMP', 'C*n'),
      optField('USER_TXT', 'C*n'),
      optField('AUX_FILE', 'C*n'),
      optField('PKG_TYP', 'C*n'),
      optField('FAMLY_ID', 'C*n'),
      optField('DATE_COD', 'C*n'),
      optField('FACIL_ID', 'C*n'),
      optField('FLOOR_ID', 'C*n'),
      optField('PROC_ID', 'C*n'),
      optField('OPER_FRQ', 'C*n'),
      optField('SPEC_NAM', 'C*n'),
      optField('SPEC_VER', 'C*n'),
      optField('FLOW_ID', 'C*n'),
      optField('SETUP_ID', 'C*n'),
      optField('DSGN_REV', 'C*n'),
      optField('ENG_ID', 'C*n'),
      optField('ROM_COD', 'C*n'),
      optField('SERL_NUM', 'C*n'),
      optField('SUPR_NAM', 'C*n'),
    ],
  },
  MRR: {
    name: 'MRR',
    recTyp: 1,
    recSub: 20,
    skipInBinsOnly: false,
    fields: [
      reqField('FINISH_T', 'U*4'),
      optField('DISP_COD', 'C*1'),
      optField('USR_DESC', 'C*n'),
      optField('EXC_DESC', 'C*n'),
    ],
  },
  PCR: {
    name: 'PCR',
    recTyp: 1,
    recSub: 30,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('PART_CNT', 'U*4'),
      optField('RTST_CNT', 'U*4'),
      optField('ABRT_CNT', 'U*4'),
      optField('GOOD_CNT', 'U*4'),
      optField('FUNC_CNT', 'U*4'),
    ],
  },
  HBR: {
    name: 'HBR',
    recTyp: 1,
    recSub: 40,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('HBIN_NUM', 'U*2'),
      reqField('HBIN_CNT', 'U*4'),
      optField('HBIN_PF', 'C*1'),
      optField('HBIN_NAM', 'C*n'),
    ],
  },
  SBR: {
    name: 'SBR',
    recTyp: 1,
    recSub: 50,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('SBIN_NUM', 'U*2'),
      reqField('SBIN_CNT', 'U*4'),
      optField('SBIN_PF', 'C*1'),
      optField('SBIN_NAM', 'C*n'),
    ],
  },
  SDR: {
    name: 'SDR',
    recTyp: 1,
    recSub: 80,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_GRP', 'U*1'),
      reqField('SITE_CNT', 'U*1'),
      reqArrayField('SITE_NUM', 'kxU*1', 'SITE_CNT'),
      optField('HAND_TYP', 'C*n'),
      optField('HAND_ID', 'C*n'),
      optField('CARD_TYP', 'C*n'),
      optField('CARD_ID', 'C*n'),
      optField('LOAD_TYP', 'C*n'),
      optField('LOAD_ID', 'C*n'),
      optField('DIB_TYP', 'C*n'),
      optField('DIB_ID', 'C*n'),
      optField('CABL_TYP', 'C*n'),
      optField('CABL_ID', 'C*n'),
      optField('CONT_TYP', 'C*n'),
      optField('CONT_ID', 'C*n'),
      optField('LASR_TYP', 'C*n'),
      optField('LASR_ID', 'C*n'),
      optField('EXTR_TYP', 'C*n'),
      optField('EXTR_ID', 'C*n'),
    ],
  },
  WIR: {
    name: 'WIR',
    recTyp: 2,
    recSub: 10,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      optField('SITE_GRP', 'U*1'),
      optField('START_T', 'U*4'),
      optField('WAFER_ID', 'C*n'),
    ],
  },
  WRR: {
    name: 'WRR',
    recTyp: 2,
    recSub: 20,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      optField('SITE_GRP', 'U*1'),
      optField('FINISH_T', 'U*4'),
      optField('PART_CNT', 'U*4'),
      optField('RTST_CNT', 'U*4'),
      optField('ABRT_CNT', 'U*4'),
      optField('GOOD_CNT', 'U*4'),
      optField('FUNC_CNT', 'U*4'),
      optField('WAFER_ID', 'C*n'),
      optField('FABWF_ID', 'C*n'),
      optField('FRAME_ID', 'C*n'),
      optField('MASK_ID', 'C*n'),
      optField('USR_DESC', 'C*n'),
      optField('EXC_DESC', 'C*n'),
    ],
  },
  WCR: {
    name: 'WCR',
    recTyp: 2,
    recSub: 30,
    skipInBinsOnly: false,
    fields: [
      optField('WAFR_SIZ', 'R*4'),
      optField('DIE_HT', 'R*4'),
      optField('DIE_WID', 'R*4'),
      optField('WF_UNITS', 'U*1'),
      optField('WF_FLAT', 'C*1'),
      optField('CENTER_X', 'I*2'),
      optField('CENTER_Y', 'I*2'),
      optField('POS_X', 'C*1'),
      optField('POS_Y', 'C*1'),
    ],
  },
  PIR: {
    name: 'PIR',
    recTyp: 5,
    recSub: 10,
    skipInBinsOnly: false,
    fields: [reqField('HEAD_NUM', 'U*1'), reqField('SITE_NUM', 'U*1')],
  },
  PRR: {
    name: 'PRR',
    recTyp: 5,
    recSub: 20,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('PART_FLG', 'B*1'),
      reqField('NUM_TEST', 'U*2'),
      reqField('HARD_BIN', 'U*2'),
      optField('SOFT_BIN', 'U*2'),
      optField('X_COORD', 'I*2'),
      optField('Y_COORD', 'I*2'),
      optField('TEST_T', 'U*4'),
      optField('PART_ID', 'C*n'),
      optField('PART_TXT', 'C*n'),
      optField('PART_FIX', 'B*n'),
    ],
  },
  TSR: {
    name: 'TSR',
    recTyp: 10,
    recSub: 30,
    skipInBinsOnly: false,
    fields: [
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('TEST_TYP', 'C*1'),
      reqField('TEST_NUM', 'U*4'),
      optField('EXEC_CNT', 'U*4'),
      optField('FAIL_CNT', 'U*4'),
      optField('ALRM_CNT', 'U*4'),
      optField('TEST_NAM', 'C*n'),
      optField('SEQ_NAME', 'C*n'),
      optField('TEST_LBL', 'C*n'),
      optField('OPT_FLAG', 'B*1'),
      optField('TEST_TIM', 'R*4'),
      optField('TEST_MIN', 'R*4'),
      optField('TEST_MAX', 'R*4'),
      optField('TST_SUMS', 'R*4'),
      optField('TST_SQRS', 'R*4'),
    ],
  },
  PTR: {
    name: 'PTR',
    recTyp: 15,
    recSub: 10,
    skipInBinsOnly: true,
    fields: [
      reqField('TEST_NUM', 'U*4'),
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('TEST_FLG', 'B*1'),
      reqField('PARM_FLG', 'B*1'),
      optField('RESULT', 'R*4'),
      optField('TEST_TXT', 'C*n'),
      optField('ALARM_ID', 'C*n'),
      optField('OPT_FLAG', 'B*1'),
      optField('RES_SCAL', 'I*1'),
      optField('LLM_SCAL', 'I*1'),
      optField('HLM_SCAL', 'I*1'),
      optField('LO_LIMIT', 'R*4'),
      optField('HI_LIMIT', 'R*4'),
      optField('UNITS', 'C*n'),
      optField('C_RESFMT', 'C*n'),
      optField('C_LLMFMT', 'C*n'),
      optField('C_HLMFMT', 'C*n'),
      optField('LO_SPEC', 'R*4'),
      optField('HI_SPEC', 'R*4'),
    ],
  },
  MPR: {
    name: 'MPR',
    recTyp: 15,
    recSub: 15,
    skipInBinsOnly: true,
    fields: [
      reqField('TEST_NUM', 'U*4'),
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('TEST_FLG', 'B*1'),
      reqField('PARM_FLG', 'B*1'),
      reqField('RTN_ICNT', 'U*2'),
      reqField('RSLT_CNT', 'U*2'),
      optField('RTN_STAT', 'kxN*1', 'RTN_ICNT'),
      optField('RTN_RSLT', 'kxR*4', 'RSLT_CNT'),
      optField('TEST_TXT', 'C*n'),
      optField('ALARM_ID', 'C*n'),
      optField('OPT_FLAG', 'B*1'),
      optField('RES_SCAL', 'I*1'),
      optField('LLM_SCAL', 'I*1'),
      optField('HLM_SCAL', 'I*1'),
      optField('LO_LIMIT', 'R*4'),
      optField('HI_LIMIT', 'R*4'),
      optField('START_IN', 'R*4'),
      optField('INCR_IN', 'R*4'),
      optField('RTN_INDX', 'kxU*2', 'RTN_ICNT'),
      optField('UNITS', 'C*n'),
      optField('UNITS_IN', 'C*n'),
      optField('C_RESFMT', 'C*n'),
      optField('C_LLMFMT', 'C*n'),
      optField('C_HLMFMT', 'C*n'),
      optField('LO_SPEC', 'R*4'),
      optField('HI_SPEC', 'R*4'),
    ],
  },
  FTR: {
    name: 'FTR',
    recTyp: 15,
    recSub: 20,
    skipInBinsOnly: true,
    fields: [
      reqField('TEST_NUM', 'U*4'),
      reqField('HEAD_NUM', 'U*1'),
      reqField('SITE_NUM', 'U*1'),
      reqField('TEST_FLG', 'B*1'),
      optField('OPT_FLAG', 'B*1'),
      optField('CYCL_CNT', 'U*4'),
      optField('REL_VADR', 'U*4'),
      optField('REPT_CNT', 'U*4'),
      optField('NUM_FAIL', 'U*4'),
      optField('XFAIL_AD', 'I*4'),
      optField('YFAIL_AD', 'I*4'),
      optField('VECT_OFF', 'I*2'),
      optField('RTN_ICNT', 'U*2'),
      optField('PGM_ICNT', 'U*2'),
      optField('RTN_INDX', 'kxU*2', 'RTN_ICNT'),
      optField('RTN_STAT', 'kxN*1', 'RTN_ICNT'),
      optField('PGM_INDX', 'kxU*2', 'PGM_ICNT'),
      optField('PGM_STAT', 'kxN*1', 'PGM_ICNT'),
      optField('FAIL_PIN', 'D*n'),
      optField('VECT_NAM', 'C*n'),
      optField('TIME_SET', 'C*n'),
      optField('OP_CODE', 'C*n'),
      optField('TEST_TXT', 'C*n'),
      optField('ALARM_ID', 'C*n'),
      optField('PROG_TXT', 'C*n'),
      optField('RSLT_TXT', 'C*n'),
      optField('PATG_NUM', 'U*1'),
      optField('SPIN_MAP', 'D*n'),
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// Decoded Record Output Models (`parseStdfBytes` -> `ParsedLotBuildInput`)
// ---------------------------------------------------------------------------

export interface ParsedMirRecord {
  readonly setupT: number;
  readonly startT: number;
  readonly statNum: number;
  readonly modeCod: string;
  readonly rtstCod: string;
  readonly protCod: string;
  readonly burnTim: number;
  readonly cmodCod: string;
  readonly lotId: string;
  readonly partTyp: string;
  readonly nodeNam: string;
  readonly tstrTyp: string;
  readonly jobNam: string;
  readonly jobRev: string;
  readonly sblotId: string;
  readonly operNam: string;
  readonly execTyp: string;
  readonly execVer: string;
  readonly testCod: string;
  readonly tstTemp: string;
  readonly userTxt: string;
  readonly auxFile: string;
  readonly pkgTyp: string;
  readonly famlyId: string;
  readonly dateCod: string;
  readonly facilId: string;
  readonly floorId: string;
  readonly procId: string;
  readonly operFrq: string;
  readonly specNam: string;
  readonly specVer: string;
  readonly flowId: string;
  readonly setupId: string;
  readonly dsgnRev: string;
  readonly engId: string;
  readonly romCod: string;
  readonly serlNum: string;
  readonly suprNam: string;
}

export interface ParsedMrrRecord {
  readonly finishT: number;
  readonly dispCod: string;
  readonly usrDesc: string;
  readonly excDesc: string;
}

export interface ParsedPcrRecord {
  readonly headNum: number;
  readonly siteNum: number;
  readonly partCnt: number;
  readonly rtstCnt?: number;
  readonly abrtCnt?: number;
  readonly goodCnt?: number;
  readonly funcCnt?: number;
}

export interface ParsedHbrRecord {
  readonly headNum: number;
  readonly siteNum: number;
  readonly hbinNum: number;
  readonly hbinCnt: number;
  readonly hbinPf: BinPassFailFlag;
  readonly hbinNam: string;
}

export interface ParsedSbrRecord {
  readonly headNum: number;
  readonly siteNum: number;
  readonly sbinNum: number;
  readonly sbinCnt: number;
  readonly sbinPf: BinPassFailFlag;
  readonly sbinNam: string;
}

export interface ParsedSdrRecord {
  readonly headNum: number;
  readonly siteGrp: number;
  readonly siteNums: readonly number[];
  readonly handTyp: string;
  readonly handId: string;
  readonly cardTyp: string;
  readonly cardId: string;
  readonly loadTyp: string;
  readonly loadId: string;
  readonly dibTyp: string;
  readonly dibId: string;
  readonly cablTyp: string;
  readonly cablId: string;
  readonly contTyp: string;
  readonly contId: string;
  readonly lasrTyp: string;
  readonly lasrId: string;
  readonly extrTyp: string;
  readonly extrId: string;
}

export interface ParsedWirRecord {
  readonly headNum: number;
  readonly siteGrp: number;
  readonly startT: number;
  readonly waferId: string;
}

export interface ParsedWrrRecord {
  readonly headNum: number;
  readonly siteGrp: number;
  readonly finishT: number;
  readonly partCnt: number;
  readonly rtstCnt?: number;
  readonly abrtCnt?: number;
  readonly goodCnt?: number;
  readonly funcCnt?: number;
  readonly waferId: string;
  readonly fabwfId: string;
  readonly frameId: string;
  readonly maskId: string;
  readonly usrDesc: string;
  readonly excDesc: string;
}

export interface ParsedWcrRecord {
  readonly wafrSiz?: number;
  readonly dieHt?: number;
  readonly dieWid?: number;
  readonly wfUnits?: number;
  readonly wfFlat: WaferFlatOrientation;
  readonly centerX?: number;
  readonly centerY?: number;
  readonly posX: WaferAxisPosX;
  readonly posY: WaferAxisPosY;
}

export interface ParsedTsrRecord {
  readonly headNum: number;
  readonly siteNum: number;
  readonly testTyp: string;
  readonly testNum: number;
  readonly execCnt?: number;
  readonly failCnt?: number;
  readonly alrmCnt?: number;
  readonly testNam: string;
  readonly seqName: string;
  readonly testLbl: string;
  readonly optFlag?: number;
  readonly testTim?: number;
  readonly testMin?: number;
  readonly testMax?: number;
  readonly tstSums?: number;
  readonly tstSqrs?: number;
}

export interface ParsedPtrExecution {
  readonly testNum: number;
  readonly headNum: number;
  readonly siteNum: number;
  readonly testFlg: number;
  readonly parmFlg: number;
  /** Base-unit measurement (NaN when TEST_FLG marks result invalid/not executed or non-finite). */
  readonly result: number;
  readonly testTxt: string;
  readonly alarmId: string;
  readonly optFlag: number;
  /** Power-of-10 display exponent ONLY; never applied to `result`. */
  readonly resScal: number;
  /** Power-of-10 display exponent ONLY; never applied to `loLimit`. */
  readonly llmScal: number;
  /** Power-of-10 display exponent ONLY; never applied to `hiLimit`. */
  readonly hlmScal: number;
  /** Base-unit low specification limit, or null when absent/invalid. */
  readonly loLimit: number | null;
  /** Base-unit high specification limit, or null when absent/invalid. */
  readonly hiLimit: number | null;
  readonly units: string;
}

export interface ParsedMprExecution {
  readonly testNum: number;
  readonly headNum: number;
  readonly siteNum: number;
  readonly testFlg: number;
  readonly parmFlg: number;
  readonly rtnStat: Uint8Array;
  readonly rtnRslt: Float32Array;
  readonly rtnIndx: Uint16Array;
  readonly testTxt: string;
  readonly alarmId: string;
  readonly optFlag: number;
  readonly resScal: number;
  readonly llmScal: number;
  readonly hlmScal: number;
  readonly loLimit: number | null;
  readonly hiLimit: number | null;
  readonly startIn?: number;
  readonly incrIn?: number;
  readonly units: string;
  readonly unitsIn: string;
}

export interface ParsedFtrExecution {
  readonly testNum: number;
  readonly headNum: number;
  readonly siteNum: number;
  readonly testFlg: number;
  readonly optFlag?: number;
  readonly cyclCnt?: number;
  readonly relVadr?: number;
  readonly reptCnt?: number;
  readonly numFail?: number;
  readonly xfailAd?: number;
  readonly yfailAd?: number;
  readonly vectOff?: number;
  readonly rtnIndx: Uint16Array;
  readonly rtnStat: Uint8Array;
  readonly pgmIndx: Uint16Array;
  readonly pgmStat: Uint8Array;
  readonly failPin?: BitArrayData;
  readonly spinMap?: BitArrayData;
  readonly testTxt: string;
}

export interface ParsedPartExecution {
  readonly prrIndex: number;
  readonly byteOffset: number;
  readonly headNum: number;
  readonly siteNum: number;
  readonly partFlg: number;
  readonly numTest: number;
  readonly hardBin: number;
  readonly softBin: number;
  readonly xCoord: number;
  readonly yCoord: number;
  readonly testT: number;
  readonly partId: string;
  readonly partTxt: string;
  readonly partFix?: Uint8Array;
  readonly ptrs: readonly ParsedPtrExecution[];
  readonly mprs: readonly ParsedMprExecution[];
  readonly ftrs: readonly ParsedFtrExecution[];
}

export interface ParsedWaferChunk {
  readonly waferIndex: number;
  readonly implicit: boolean;
  readonly wir: ParsedWirRecord | null;
  readonly wrr: ParsedWrrRecord | null;
  readonly wcr: ParsedWcrRecord | null;
  readonly parts: readonly ParsedPartExecution[];
}

export interface ParsedLotBuildInput {
  readonly parseMode: ParseMode;
  readonly endianness: CpuEndianness;
  readonly stdfVersion: typeof STDF_V4_VERSION;
  readonly mir: ParsedMirRecord | null;
  readonly mrr: ParsedMrrRecord | null;
  readonly pcrs: readonly ParsedPcrRecord[];
  readonly hbrs: readonly ParsedHbrRecord[];
  readonly sbrs: readonly ParsedSbrRecord[];
  readonly sdrs: readonly ParsedSdrRecord[];
  readonly tsrs: readonly ParsedTsrRecord[];
  readonly defaultWaferConfig: ParsedWcrRecord | null;
  readonly ptrDefaults: ReadonlyMap<number, PtrDefaultContext>;
  readonly wafers: readonly ParsedWaferChunk[];
  readonly recordsDecoded: number;
  readonly validPrrCount: number;
  readonly skippedRecordCount: number;
  readonly warnings: readonly ParseWarning[];
}

// ---------------------------------------------------------------------------
// Writer Input Specifications (`StdfWriteLotSpec` -> `writeStdfBytes`)
// ---------------------------------------------------------------------------

export interface StdfWriteMirSpec {
  readonly setupT?: number;
  readonly startT?: number;
  readonly statNum?: number;
  readonly modeCod?: string;
  readonly rtstCod?: string;
  readonly protCod?: string;
  readonly burnTim?: number;
  readonly cmodCod?: string;
  readonly lotId: string;
  readonly partTyp: string;
  readonly nodeNam?: string;
  readonly tstrTyp?: string;
  readonly jobNam: string;
  readonly jobRev?: string;
  readonly sblotId?: string;
  readonly operNam?: string;
  /** When true, omits optional trailing MIR fields after JOB_NAM (exercises Req 1.7). */
  readonly omitOptionalAfterJobNam?: boolean;
}

export interface StdfWriteMrrSpec {
  readonly finishT?: number;
  readonly dispCod?: string;
  readonly usrDesc?: string;
  readonly excDesc?: string;
  readonly omitOptionalAfterFinishT?: boolean;
}

export interface StdfWritePcrSpec {
  readonly headNum?: number;
  readonly siteNum?: number;
  readonly partCnt: number;
  readonly rtstCnt?: number;
  readonly abrtCnt?: number;
  readonly goodCnt?: number;
  readonly funcCnt?: number;
  readonly omitOptionalCounts?: boolean;
}

export interface StdfWriteHbrSpec {
  readonly headNum?: number;
  readonly siteNum?: number;
  readonly hbinNum: number;
  readonly hbinCnt: number;
  readonly hbinPf?: BinPassFailFlag;
  readonly hbinNam?: string;
  readonly omitTrailingFields?: boolean;
}

export interface StdfWriteSbrSpec {
  readonly headNum?: number;
  readonly siteNum?: number;
  readonly sbinNum: number;
  readonly sbinCnt: number;
  readonly sbinPf?: BinPassFailFlag;
  readonly sbinNam?: string;
  readonly omitTrailingFields?: boolean;
}

export interface StdfWriteSdrSpec {
  readonly headNum?: number;
  readonly siteGrp?: number;
  readonly siteNums: readonly number[];
  readonly handTyp?: string;
  readonly handId?: string;
  readonly cardTyp?: string;
  readonly cardId?: string;
  readonly omitOptionalAfterCardId?: boolean;
}

export interface StdfWriteWirSpec {
  readonly headNum?: number;
  readonly siteGrp?: number;
  readonly startT?: number;
  readonly waferId?: string;
  readonly omitWaferId?: boolean;
}

export interface StdfWriteWrrSpec {
  readonly headNum?: number;
  readonly siteGrp?: number;
  readonly finishT?: number;
  readonly partCnt: number;
  readonly rtstCnt?: number;
  readonly abrtCnt?: number;
  readonly goodCnt?: number;
  readonly funcCnt?: number;
  readonly waferId?: string;
  readonly fabwfId?: string;
  readonly frameId?: string;
  readonly maskId?: string;
  readonly usrDesc?: string;
  readonly excDesc?: string;
  readonly omitOptionalAfterPartCnt?: boolean;
}

export interface StdfWriteWcrSpec {
  readonly wafrSiz?: number;
  readonly dieHt?: number;
  readonly dieWid?: number;
  readonly wfUnits?: number;
  readonly wfFlat?: WaferFlatOrientation;
  readonly centerX?: number;
  readonly centerY?: number;
  readonly posX?: WaferAxisPosX;
  readonly posY?: WaferAxisPosY;
}

export interface StdfWriteTsrSpec {
  readonly headNum?: number;
  readonly siteNum?: number;
  readonly testTyp?: string;
  readonly testNum: number;
  readonly execCnt?: number;
  readonly failCnt?: number;
  readonly alrmCnt?: number;
  readonly testNam?: string;
  readonly seqName?: string;
  readonly testLbl?: string;
  readonly optFlag?: number;
  readonly testTim?: number;
  readonly testMin?: number;
  readonly testMax?: number;
  readonly tstSums?: number;
  readonly tstSqrs?: number;
  readonly omitOptionalAfterTestNam?: boolean;
}

export interface StdfWritePtrSpec {
  readonly testNum: number;
  readonly testFlg?: number;
  readonly parmFlg?: number;
  readonly result: number;
  readonly testTxt?: string;
  readonly alarmId?: string;
  readonly optFlag?: number;
  readonly resScal?: number;
  readonly llmScal?: number;
  readonly hlmScal?: number;
  readonly loLimit?: number | null;
  readonly hiLimit?: number | null;
  readonly units?: string;
  /**
   * When true, omits trailing optional fields after RESULT (12-byte compact PTR),
   * causing the parser to inherit defaults from the first PTR with the same TEST_NUM.
   */
  readonly omitOptionalAfterResult?: boolean;
}

export interface StdfWriteMprSpec {
  readonly testNum: number;
  readonly testFlg?: number;
  readonly parmFlg?: number;
  readonly rtnStat?: ArrayLike<number>;
  readonly rtnRslt: ArrayLike<number>;
  readonly rtnIndx?: ArrayLike<number>;
  readonly testTxt?: string;
  readonly alarmId?: string;
  readonly optFlag?: number;
  readonly resScal?: number;
  readonly llmScal?: number;
  readonly hlmScal?: number;
  readonly loLimit?: number | null;
  readonly hiLimit?: number | null;
  readonly startIn?: number;
  readonly incrIn?: number;
  readonly units?: string;
  readonly unitsIn?: string;
  readonly omitOptionalAfterResults?: boolean;
}

export interface StdfWriteFtrSpec {
  readonly testNum: number;
  readonly testFlg?: number;
  readonly optFlag?: number;
  readonly cyclCnt?: number;
  readonly relVadr?: number;
  readonly reptCnt?: number;
  readonly numFail?: number;
  readonly xfailAd?: number;
  readonly yfailAd?: number;
  readonly vectOff?: number;
  readonly rtnIndx?: ArrayLike<number>;
  readonly rtnStat?: ArrayLike<number>;
  readonly pgmIndx?: ArrayLike<number>;
  readonly pgmStat?: ArrayLike<number>;
  readonly failPin?: BitArrayData;
  readonly spinMap?: BitArrayData;
  readonly testTxt?: string;
  readonly omitOptionalAfterTestFlg?: boolean;
}

export interface StdfWritePartSpec {
  readonly headNum?: number;
  readonly siteNum?: number;
  readonly partFlg?: number;
  readonly numTest?: number;
  readonly hardBin: number;
  readonly softBin?: number;
  readonly xCoord?: number;
  readonly yCoord?: number;
  readonly testT?: number;
  readonly partId?: string;
  readonly partTxt?: string;
  readonly partFix?: Uint8Array;
  readonly ptrs?: readonly StdfWritePtrSpec[];
  readonly mprs?: readonly StdfWriteMprSpec[];
  readonly ftrs?: readonly StdfWriteFtrSpec[];
  /** When true, omits optional trailing PRR fields after HARD_BIN or Y_COORD. */
  readonly omitOptionalAfterHardBin?: boolean;
  readonly omitOptionalAfterCoords?: boolean;
}

/**
 * Multi-site concurrent touchdown: emits PIRs for all parts, then interleaved
 * PTR/MPR/FTR test records across sites, then PRRs closing each site.
 */
export type StdfWriteTouchdownSpec = readonly StdfWritePartSpec[];

export interface StdfWriteWaferSpec {
  readonly wir?: StdfWriteWirSpec;
  readonly wcr?: StdfWriteWcrSpec;
  /** Sequential single-site part executions (convenience alternative to `touchdowns`). */
  readonly parts?: readonly StdfWritePartSpec[];
  /** Concurrent multi-site touchdowns serialized with interleaved PIR/PTR/PRR records. */
  readonly touchdowns?: readonly StdfWriteTouchdownSpec[];
  readonly wrr?: StdfWriteWrrSpec;
  /** When true, omits WRR so wafer remains open until next WIR or EOF. */
  readonly omitWrr?: boolean;
}

export interface StdfWriteRawRecordSpec {
  readonly recTyp: number;
  readonly recSub: number;
  readonly payload: Uint8Array;
  readonly position?: 'after-mir' | 'before-mrr';
}

export interface StdfWriteLotSpec {
  readonly endianness: CpuEndianness;
  readonly mir?: StdfWriteMirSpec;
  readonly sdrs?: readonly StdfWriteSdrSpec[];
  readonly hbrs?: readonly StdfWriteHbrSpec[];
  readonly sbrs?: readonly StdfWriteSbrSpec[];
  readonly wcr?: StdfWriteWcrSpec;
  readonly wafers: readonly StdfWriteWaferSpec[];
  readonly tsrs?: readonly StdfWriteTsrSpec[];
  readonly pcrs?: readonly StdfWritePcrSpec[];
  readonly mrr?: StdfWriteMrrSpec;
  /**
   * Automatically emits 12-byte compact PTR records on subsequent executions of a
   * TEST_NUM whose scales/limits/units match the first PTR for that TEST_NUM.
   */
  readonly compactRepeatedPtrs?: boolean;
  /** Optional non-decoded/custom records injected to exercise REC_LEN skipping (Req 1.6). */
  readonly unknownRecords?: readonly StdfWriteRawRecordSpec[];
}
