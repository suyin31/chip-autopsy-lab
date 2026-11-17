import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbStdfWriteLotSpec } from '../__test-utils__/arbitraries';
import {
  compressGzipBytes,
  decompressGzipStreamWithCeiling,
  hasGzipMagicBytes,
} from './gzip';
import { parseStdfBytes } from './stdf-parser';
import { writeStdfBytes } from './stdf-writer';
import {
  type BinPassFailFlag,
  type BitArrayData,
  type ParsedLotBuildInput,
  type ParsedPartExecution,
  type ParsedWcrRecord,
  PRR_PART_FLG,
  PTR_OPT_FLAG,
  PTR_TEST_FLG,
  type PtrDefaultContext,
  STDF_MISSING_COORD,
  STDF_MISSING_U2,
  type StdfWriteFtrSpec,
  type StdfWriteLotSpec,
  type StdfWriteMprSpec,
  type StdfWritePartSpec,
  type StdfWriteWcrSpec,
} from './types';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);

interface NormalizedPtr {
  readonly testNum: number;
  readonly resultIsNaN: boolean;
  readonly result: number;
  readonly testTxt: string;
  readonly resScal: number;
  readonly llmScal: number;
  readonly hlmScal: number;
  readonly loLimit: number | null;
  readonly hiLimit: number | null;
  readonly units: string;
}

interface NormalizedMpr {
  readonly testNum: number;
  readonly testFlg: number;
  readonly rtnStat: readonly number[];
  readonly rtnRslt: readonly number[];
  readonly rtnIndx: readonly number[];
  readonly testTxt: string;
  readonly resScal: number;
  readonly llmScal: number;
  readonly hlmScal: number;
  readonly loLimit: number | null;
  readonly hiLimit: number | null;
  readonly units: string;
}

interface NormalizedFtr {
  readonly testNum: number;
  readonly testFlg: number;
  readonly cyclCnt?: number;
  readonly numFail?: number;
  readonly xfailAd?: number;
  readonly yfailAd?: number;
  readonly failPin?: BitArrayData;
  readonly testTxt: string;
}

interface NormalizedResolvedDie {
  readonly key: string;
  readonly xCoord: number;
  readonly yCoord: number;
  readonly headNum: number;
  readonly siteNum: number;
  readonly firstPass: boolean;
  readonly finalPass: boolean;
  readonly hardBin: number;
  readonly softBin: number;
  readonly retestCount: number;
  readonly ptrs: readonly NormalizedPtr[];
  readonly mprs: readonly NormalizedMpr[];
  readonly ftrs: readonly NormalizedFtr[];
}

interface NormalizedWafer {
  readonly waferId: string;
  readonly geometry: ParsedWcrRecord | null;
  readonly wrrPartCnt: number;
  readonly dies: readonly NormalizedResolvedDie[];
}

interface NormalizedLot {
  readonly endianness: 'big' | 'little';
  readonly lotId: string;
  readonly partTyp: string;
  readonly jobNam: string;
  readonly mrrDispCod: string;
  readonly siteNums: readonly number[];
  readonly hbins: ReadonlyArray<{
    readonly code: number;
    readonly pf: BinPassFailFlag;
    readonly name: string;
  }>;
  readonly sbins: ReadonlyArray<{
    readonly code: number;
    readonly pf: BinPassFailFlag;
    readonly name: string;
  }>;
  readonly wafers: readonly NormalizedWafer[];
}

function evalPrrPass(
  partFlg: number,
  hardBin: number,
  hbinPfMap: ReadonlyMap<number, BinPassFailFlag>,
): boolean {
  if ((partFlg & PRR_PART_FLG.PF_INVALID) === 0) {
    return (partFlg & PRR_PART_FLG.FAILED) === 0;
  }
  return hbinPfMap.get(hardBin) === 'P';
}

function normalizeWcrFromSpec(spec: StdfWriteWcrSpec | undefined): ParsedWcrRecord | null {
  if (!spec) {
    return null;
  }
  return {
    ...(spec.wafrSiz !== undefined && spec.wafrSiz > 0
      ? { wafrSiz: Math.fround(spec.wafrSiz) }
      : {}),
    ...(spec.dieHt !== undefined && spec.dieHt > 0
      ? { dieHt: Math.fround(spec.dieHt) }
      : {}),
    ...(spec.dieWid !== undefined && spec.dieWid > 0
      ? { dieWid: Math.fround(spec.dieWid) }
      : {}),
    ...(spec.wfUnits !== undefined && spec.wfUnits > 0 ? { wfUnits: spec.wfUnits } : {}),
    wfFlat: spec.wfFlat ?? ' ',
    ...(spec.centerX !== undefined && spec.centerX !== STDF_MISSING_COORD
      ? { centerX: spec.centerX }
      : {}),
    ...(spec.centerY !== undefined && spec.centerY !== STDF_MISSING_COORD
      ? { centerY: spec.centerY }
      : {}),
    posX: spec.posX ?? ' ',
    posY: spec.posY ?? ' ',
  };
}

function normalizeSpecToExpectedLot(spec: StdfWriteLotSpec): NormalizedLot {
  const hbins = (spec.hbrs ?? []).map((h) => ({
    code: h.hbinNum,
    pf: h.omitTrailingFields ? (' ' as const) : (h.hbinPf ?? ' '),
    name: h.omitTrailingFields ? '' : (h.hbinNam ?? ''),
  }));
  const hbinPfMap = new Map<number, BinPassFailFlag>();
  for (const h of hbins) {
    hbinPfMap.set(h.code, h.pf);
  }

  const sbins = (spec.sbrs ?? []).map((s) => ({
    code: s.sbinNum,
    pf: s.omitTrailingFields ? (' ' as const) : (s.sbinPf ?? ' '),
    name: s.omitTrailingFields ? '' : (s.sbinNam ?? ''),
  }));

  const defaultWcr = normalizeWcrFromSpec(spec.wcr);
  const ptrDefaults = new Map<number, PtrDefaultContext>();
  const mprDefaults = new Map<number, PtrDefaultContext>();

  const normalizeSpecMpr = (m: StdfWriteMprSpec): NormalizedMpr => {
    const rtnIcnt = Math.max(m.rtnIndx?.length ?? 0, m.rtnStat?.length ?? 0);
    const rtnStat = Array.from({ length: rtnIcnt }, (_, i) =>
      m.rtnStat !== undefined && i < m.rtnStat.length ? m.rtnStat[i]! & 0x0f : 0,
    );
    const rtnRslt = Array.from({ length: m.rtnRslt.length }, (_, i) =>
      Math.fround(m.rtnRslt[i]!),
    );
    const rtnIndx =
      !m.omitOptionalAfterResults && rtnIcnt > 0
        ? Array.from({ length: rtnIcnt }, (_, i) =>
            m.rtnIndx !== undefined && i < m.rtnIndx.length ? m.rtnIndx[i]! & 0xffff : 0,
          )
        : [];

    const prior = mprDefaults.get(m.testNum);
    if (!prior) {
      if (m.omitOptionalAfterResults) {
        const created: PtrDefaultContext = {
          testNum: m.testNum,
          testTxt: '',
          units: '',
          resScal: 0,
          llmScal: 0,
          hlmScal: 0,
          loLimit: null,
          hiLimit: null,
        };
        mprDefaults.set(m.testNum, created);
        return {
          testNum: m.testNum,
          testFlg: m.testFlg ?? 0,
          rtnStat,
          rtnRslt,
          rtnIndx,
          testTxt: '',
          resScal: 0,
          llmScal: 0,
          hlmScal: 0,
          loLimit: null,
          hiLimit: null,
          units: '',
        };
      }

      let optFlag = m.optFlag ?? 0;
      if (m.optFlag === undefined) {
        if (m.loLimit === undefined || m.loLimit === null) {
          optFlag |= PTR_OPT_FLAG.NO_LO_LIMIT;
        }
        if (m.hiLimit === undefined || m.hiLimit === null) {
          optFlag |= PTR_OPT_FLAG.NO_HI_LIMIT;
        }
      }
      const noLo =
        (optFlag & (PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.LO_LIMIT_INVALID)) !== 0;
      const noHi =
        (optFlag & (PTR_OPT_FLAG.NO_HI_LIMIT | PTR_OPT_FLAG.HI_LIMIT_INVALID)) !== 0;
      const resScal =
        (optFlag & PTR_OPT_FLAG.RES_SCAL_INVALID) === 0 ? (m.resScal ?? 0) : 0;
      const created: PtrDefaultContext = {
        testNum: m.testNum,
        testTxt: m.testTxt ?? '',
        units: m.units ?? '',
        resScal,
        llmScal: noLo ? 0 : (m.llmScal ?? 0),
        hlmScal: noHi ? 0 : (m.hlmScal ?? 0),
        loLimit: noLo ? null : Math.fround(m.loLimit ?? 0),
        hiLimit: noHi ? null : Math.fround(m.hiLimit ?? 0),
      };
      mprDefaults.set(m.testNum, created);
      return {
        testNum: m.testNum,
        testFlg: m.testFlg ?? 0,
        rtnStat,
        rtnRslt,
        rtnIndx,
        testTxt: created.testTxt,
        resScal: created.resScal,
        llmScal: created.llmScal,
        hlmScal: created.hlmScal,
        loLimit: created.loLimit,
        hiLimit: created.hiLimit,
        units: created.units,
      };
    }

    if (m.omitOptionalAfterResults) {
      return {
        testNum: m.testNum,
        testFlg: m.testFlg ?? 0,
        rtnStat,
        rtnRslt,
        rtnIndx,
        testTxt: prior.testTxt,
        resScal: prior.resScal,
        llmScal: prior.llmScal,
        hlmScal: prior.hlmScal,
        loLimit: prior.loLimit,
        hiLimit: prior.hiLimit,
        units: prior.units,
      };
    }

    let optFlag = m.optFlag ?? 0;
    if (m.optFlag === undefined) {
      if (m.loLimit === undefined || m.loLimit === null) {
        optFlag |= PTR_OPT_FLAG.NO_LO_LIMIT;
      }
      if (m.hiLimit === undefined || m.hiLimit === null) {
        optFlag |= PTR_OPT_FLAG.NO_HI_LIMIT;
      }
    }
    const resScal =
      (optFlag & PTR_OPT_FLAG.RES_SCAL_INVALID) !== 0
        ? prior.resScal
        : (m.resScal ?? 0);
    const loLimit =
      (optFlag & PTR_OPT_FLAG.NO_LO_LIMIT) !== 0
        ? null
        : (optFlag & PTR_OPT_FLAG.LO_LIMIT_INVALID) !== 0
          ? prior.loLimit
          : Math.fround(m.loLimit ?? 0);
    const llmScal =
      (optFlag & (PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.LO_LIMIT_INVALID)) !== 0
        ? prior.llmScal
        : (m.llmScal ?? 0);
    const hiLimit =
      (optFlag & PTR_OPT_FLAG.NO_HI_LIMIT) !== 0
        ? null
        : (optFlag & PTR_OPT_FLAG.HI_LIMIT_INVALID) !== 0
          ? prior.hiLimit
          : Math.fround(m.hiLimit ?? 0);
    const hlmScal =
      (optFlag & (PTR_OPT_FLAG.NO_HI_LIMIT | PTR_OPT_FLAG.HI_LIMIT_INVALID)) !== 0
        ? prior.hlmScal
        : (m.hlmScal ?? 0);

    return {
      testNum: m.testNum,
      testFlg: m.testFlg ?? 0,
      rtnStat,
      rtnRslt,
      rtnIndx,
      testTxt: m.testTxt && m.testTxt.length > 0 ? m.testTxt : prior.testTxt,
      resScal,
      llmScal,
      hlmScal,
      loLimit,
      hiLimit,
      units: m.units && m.units.length > 0 ? m.units : prior.units,
    };
  };

  const normalizeSpecFtr = (f: StdfWriteFtrSpec): NormalizedFtr => {
    if (f.omitOptionalAfterTestFlg) {
      return {
        testNum: f.testNum,
        testFlg: f.testFlg ?? 0,
        testTxt: '',
      };
    }
    return {
      testNum: f.testNum,
      testFlg: f.testFlg ?? 0,
      ...(f.cyclCnt !== undefined ? { cyclCnt: f.cyclCnt } : {}),
      ...(f.numFail !== undefined ? { numFail: f.numFail } : {}),
      xfailAd: f.xfailAd ?? 0,
      yfailAd: f.yfailAd ?? 0,
      failPin: f.failPin ?? { bitCount: 0, bytes: new Uint8Array(0) },
      testTxt: f.testTxt ?? '',
    };
  };

  const normalizeSpecPartPtrs = (part: StdfWritePartSpec): NormalizedPtr[] => {
    const out: NormalizedPtr[] = [];
    for (const p of part.ptrs ?? []) {
      const prior = ptrDefaults.get(p.testNum);
      const testFlg = p.testFlg ?? 0;
      const resultInvalid =
        (testFlg & (PTR_TEST_FLG.RESULT_INVALID | PTR_TEST_FLG.NOT_EXECUTED)) !== 0;
      const roundedResult = resultInvalid ? 0 : Math.fround(p.result);

      if (!prior) {
        const optFlag = p.optFlag ?? 0;
        const noLo =
          p.loLimit === null ||
          p.loLimit === undefined ||
          (optFlag & (PTR_OPT_FLAG.NO_LO_LIMIT | PTR_OPT_FLAG.LO_LIMIT_INVALID)) !== 0;
        const noHi =
          p.hiLimit === null ||
          p.hiLimit === undefined ||
          (optFlag & (PTR_OPT_FLAG.NO_HI_LIMIT | PTR_OPT_FLAG.HI_LIMIT_INVALID)) !== 0;
        const resScal =
          (optFlag & PTR_OPT_FLAG.RES_SCAL_INVALID) === 0 ? (p.resScal ?? 0) : 0;
        const created: PtrDefaultContext = {
          testNum: p.testNum,
          testTxt: p.testTxt ?? '',
          units: p.units ?? '',
          resScal,
          llmScal: noLo ? 0 : (p.llmScal ?? 0),
          hlmScal: noHi ? 0 : (p.hlmScal ?? 0),
          loLimit: noLo ? null : Math.fround(p.loLimit!),
          hiLimit: noHi ? null : Math.fround(p.hiLimit!),
        };
        ptrDefaults.set(p.testNum, created);
        out.push({
          testNum: p.testNum,
          resultIsNaN: resultInvalid,
          result: roundedResult,
          testTxt: created.testTxt,
          resScal: created.resScal,
          llmScal: created.llmScal,
          hlmScal: created.hlmScal,
          loLimit: created.loLimit,
          hiLimit: created.hiLimit,
          units: created.units,
        });
        continue;
      }

      if (p.omitOptionalAfterResult) {
        out.push({
          testNum: p.testNum,
          resultIsNaN: resultInvalid,
          result: roundedResult,
          testTxt: prior.testTxt,
          resScal: prior.resScal,
          llmScal: prior.llmScal,
          hlmScal: prior.hlmScal,
          loLimit: prior.loLimit,
          hiLimit: prior.hiLimit,
          units: prior.units,
        });
        continue;
      }

      let optFlag = p.optFlag ?? 0;
      if (p.optFlag === undefined) {
        if (p.loLimit === null) optFlag |= PTR_OPT_FLAG.NO_LO_LIMIT;
        else if (p.loLimit === undefined) optFlag |= PTR_OPT_FLAG.LO_LIMIT_INVALID;
        if (p.hiLimit === null) optFlag |= PTR_OPT_FLAG.NO_HI_LIMIT;
        else if (p.hiLimit === undefined) optFlag |= PTR_OPT_FLAG.HI_LIMIT_INVALID;
        if (p.resScal === undefined) optFlag |= PTR_OPT_FLAG.RES_SCAL_INVALID;
      }

      const resScal =
        (optFlag & PTR_OPT_FLAG.RES_SCAL_INVALID) !== 0
          ? prior.resScal
          : (p.resScal ?? prior.resScal);
      const loLimit =
        (optFlag & PTR_OPT_FLAG.NO_LO_LIMIT) !== 0
          ? null
          : (optFlag & PTR_OPT_FLAG.LO_LIMIT_INVALID) !== 0 || p.loLimit === undefined
            ? prior.loLimit
            : Math.fround(p.loLimit!);
      const llmScal =
        (optFlag & PTR_OPT_FLAG.NO_LO_LIMIT) !== 0 ||
        (optFlag & PTR_OPT_FLAG.LO_LIMIT_INVALID) !== 0
          ? prior.llmScal
          : (p.llmScal ?? prior.llmScal);

      const hiLimit =
        (optFlag & PTR_OPT_FLAG.NO_HI_LIMIT) !== 0
          ? null
          : (optFlag & PTR_OPT_FLAG.HI_LIMIT_INVALID) !== 0 || p.hiLimit === undefined
            ? prior.hiLimit
            : Math.fround(p.hiLimit!);
      const hlmScal =
        (optFlag & PTR_OPT_FLAG.NO_HI_LIMIT) !== 0 ||
        (optFlag & PTR_OPT_FLAG.HI_LIMIT_INVALID) !== 0
          ? prior.hlmScal
          : (p.hlmScal ?? prior.hlmScal);

      out.push({
        testNum: p.testNum,
        resultIsNaN: resultInvalid,
        result: roundedResult,
        testTxt: p.testTxt && p.testTxt.length > 0 ? p.testTxt : prior.testTxt,
        resScal,
        llmScal,
        hlmScal,
        loLimit,
        hiLimit,
        units: p.units && p.units.length > 0 ? p.units : prior.units,
      });
    }
    return out;
  };

  const wafers: NormalizedWafer[] = spec.wafers.map((wf) => {
    const geometry = wf.wcr ? normalizeWcrFromSpec(wf.wcr) : defaultWcr;
    const chronologicalParts: Array<{
      readonly spec: StdfWritePartSpec;
      readonly ptrs: readonly NormalizedPtr[];
      readonly mprs: readonly NormalizedMpr[];
      readonly ftrs: readonly NormalizedFtr[];
    }> = [];

    for (const td of wf.touchdowns ?? []) {
      // In writeTouchdown, PTRs, MPRs, and FTRs are emitted step-by-step across sites before PRRs close
      const perSitePtrs: NormalizedPtr[][] = td.map(() => []);
      const perSiteMprs: NormalizedMpr[][] = td.map(() => []);
      const perSiteFtrs: NormalizedFtr[][] = td.map(() => []);

      const maxSteps = td.reduce((m, part) => Math.max(m, part.ptrs?.length ?? 0), 0);
      for (let step = 0; step < maxSteps; step += 1) {
        for (let s = 0; s < td.length; s += 1) {
          const singlePtr = td[s]!.ptrs?.[step];
          if (singlePtr !== undefined) {
            const [normPtr] = normalizeSpecPartPtrs({
              hardBin: td[s]!.hardBin,
              ptrs: [singlePtr],
            });
            perSitePtrs[s]!.push(normPtr!);
          }
        }
      }

      const maxMprSteps = td.reduce((m, part) => Math.max(m, part.mprs?.length ?? 0), 0);
      for (let step = 0; step < maxMprSteps; step += 1) {
        for (let s = 0; s < td.length; s += 1) {
          const singleMpr = td[s]!.mprs?.[step];
          if (singleMpr !== undefined) {
            perSiteMprs[s]!.push(normalizeSpecMpr(singleMpr));
          }
        }
      }

      const maxFtrSteps = td.reduce((m, part) => Math.max(m, part.ftrs?.length ?? 0), 0);
      for (let step = 0; step < maxFtrSteps; step += 1) {
        for (let s = 0; s < td.length; s += 1) {
          const singleFtr = td[s]!.ftrs?.[step];
          if (singleFtr !== undefined) {
            perSiteFtrs[s]!.push(normalizeSpecFtr(singleFtr));
          }
        }
      }

      for (let s = 0; s < td.length; s += 1) {
        chronologicalParts.push({
          spec: td[s]!,
          ptrs: perSitePtrs[s]!,
          mprs: perSiteMprs[s]!,
          ftrs: perSiteFtrs[s]!,
        });
      }
    }

    for (const p of wf.parts ?? []) {
      chronologicalParts.push({
        spec: p,
        ptrs: normalizeSpecPartPtrs(p),
        mprs: (p.mprs ?? []).map(normalizeSpecMpr),
        ftrs: (p.ftrs ?? []).map(normalizeSpecFtr),
      });
    }

    const dieMap = new Map<string, NormalizedResolvedDie>();
    let missingSeq = 0;

    for (const entry of chronologicalParts) {
      const p = entry.spec;
      const xCoord = p.omitOptionalAfterHardBin
        ? STDF_MISSING_COORD
        : (p.xCoord ?? STDF_MISSING_COORD);
      const yCoord = p.omitOptionalAfterHardBin
        ? STDF_MISSING_COORD
        : (p.yCoord ?? STDF_MISSING_COORD);
      const softBin = p.omitOptionalAfterHardBin
        ? STDF_MISSING_U2
        : (p.softBin ?? STDF_MISSING_U2);
      const passed = evalPrrPass(p.partFlg ?? 0, p.hardBin, hbinPfMap);
      const hasCoords = xCoord !== STDF_MISSING_COORD && yCoord !== STDF_MISSING_COORD;
      const key = hasCoords ? `${xCoord},${yCoord}` : `part-${missingSeq++}`;

      const prev = dieMap.get(key);
      if (!prev) {
        dieMap.set(key, {
          key,
          xCoord,
          yCoord,
          headNum: p.headNum ?? 1,
          siteNum: p.siteNum ?? 1,
          firstPass: passed,
          finalPass: passed,
          hardBin: p.hardBin,
          softBin,
          retestCount: 0,
          ptrs: entry.ptrs,
          mprs: entry.mprs,
          ftrs: entry.ftrs,
        });
      } else {
        dieMap.set(key, {
          key,
          xCoord,
          yCoord,
          headNum: p.headNum ?? 1,
          siteNum: p.siteNum ?? 1,
          firstPass: prev.firstPass,
          finalPass: passed,
          hardBin: p.hardBin,
          softBin,
          retestCount: prev.retestCount + 1,
          ptrs: entry.ptrs,
          mprs: entry.mprs,
          ftrs: entry.ftrs,
        });
      }
    }

    return {
      waferId: wf.wir?.omitWaferId ? '' : (wf.wir?.waferId ?? ''),
      geometry,
      wrrPartCnt: wf.wrr?.partCnt ?? chronologicalParts.length,
      dies: Array.from(dieMap.values()),
    };
  });

  return {
    endianness: spec.endianness,
    lotId: spec.mir?.lotId ?? '',
    partTyp: spec.mir?.partTyp ?? '',
    jobNam: spec.mir?.jobNam ?? '',
    mrrDispCod: spec.mrr?.omitOptionalAfterFinishT ? ' ' : (spec.mrr?.dispCod ?? ' '),
    siteNums: spec.sdrs?.[0]?.siteNums ?? [],
    hbins,
    sbins,
    wafers,
  };
}

function normalizeParsedToLot(parsed: ParsedLotBuildInput): NormalizedLot {
  const hbinPfMap = new Map<number, BinPassFailFlag>();
  for (const h of parsed.hbrs) {
    hbinPfMap.set(h.hbinNum, h.hbinPf);
  }

  const normalizePartPtrs = (part: ParsedPartExecution): NormalizedPtr[] =>
    part.ptrs.map((p) => ({
      testNum: p.testNum,
      resultIsNaN: Number.isNaN(p.result),
      result: Number.isNaN(p.result) ? 0 : p.result,
      testTxt: p.testTxt,
      resScal: p.resScal,
      llmScal: p.llmScal,
      hlmScal: p.hlmScal,
      loLimit: p.loLimit,
      hiLimit: p.hiLimit,
      units: p.units,
    }));

  const normalizePartMprs = (part: ParsedPartExecution): NormalizedMpr[] =>
    part.mprs.map((m) => ({
      testNum: m.testNum,
      testFlg: m.testFlg,
      rtnStat: Array.from(m.rtnStat),
      rtnRslt: Array.from(m.rtnRslt),
      rtnIndx: Array.from(m.rtnIndx),
      testTxt: m.testTxt,
      resScal: m.resScal,
      llmScal: m.llmScal,
      hlmScal: m.hlmScal,
      loLimit: m.loLimit,
      hiLimit: m.hiLimit,
      units: m.units,
    }));

  const normalizePartFtrs = (part: ParsedPartExecution): NormalizedFtr[] =>
    part.ftrs.map((f) => ({
      testNum: f.testNum,
      testFlg: f.testFlg,
      ...(f.cyclCnt !== undefined ? { cyclCnt: f.cyclCnt } : {}),
      ...(f.numFail !== undefined ? { numFail: f.numFail } : {}),
      ...(f.xfailAd !== undefined ? { xfailAd: f.xfailAd } : {}),
      ...(f.yfailAd !== undefined ? { yfailAd: f.yfailAd } : {}),
      ...(f.failPin !== undefined ? { failPin: f.failPin } : {}),
      testTxt: f.testTxt,
    }));

  const wafers: NormalizedWafer[] = parsed.wafers.map((wf) => {
    const dieMap = new Map<string, NormalizedResolvedDie>();
    let missingSeq = 0;

    for (const p of wf.parts) {
      const passed = evalPrrPass(p.partFlg, p.hardBin, hbinPfMap);
      const hasCoords =
        p.xCoord !== STDF_MISSING_COORD && p.yCoord !== STDF_MISSING_COORD;
      const key = hasCoords ? `${p.xCoord},${p.yCoord}` : `part-${missingSeq++}`;
      const ptrs = normalizePartPtrs(p);
      const mprs = normalizePartMprs(p);
      const ftrs = normalizePartFtrs(p);
      const prev = dieMap.get(key);
      if (!prev) {
        dieMap.set(key, {
          key,
          xCoord: p.xCoord,
          yCoord: p.yCoord,
          headNum: p.headNum,
          siteNum: p.siteNum,
          firstPass: passed,
          finalPass: passed,
          hardBin: p.hardBin,
          softBin: p.softBin,
          retestCount: 0,
          ptrs,
          mprs,
          ftrs,
        });
      } else {
        dieMap.set(key, {
          key,
          xCoord: p.xCoord,
          yCoord: p.yCoord,
          headNum: p.headNum,
          siteNum: p.siteNum,
          firstPass: prev.firstPass,
          finalPass: passed,
          hardBin: p.hardBin,
          softBin: p.softBin,
          retestCount: prev.retestCount + 1,
          ptrs,
          mprs,
          ftrs,
        });
      }
    }

    return {
      waferId: wf.wir?.waferId ?? '',
      geometry: wf.wcr,
      wrrPartCnt: wf.wrr?.partCnt ?? 0,
      dies: Array.from(dieMap.values()),
    };
  });

  return {
    endianness: parsed.endianness,
    lotId: parsed.mir?.lotId ?? '',
    partTyp: parsed.mir?.partTyp ?? '',
    jobNam: parsed.mir?.jobNam ?? '',
    mrrDispCod: parsed.mrr?.dispCod ?? ' ',
    siteNums: parsed.sdrs[0]?.siteNums ?? [],
    hbins: parsed.hbrs.map((h) => ({
      code: h.hbinNum,
      pf: h.hbinPf,
      name: h.hbinNam,
    })),
    sbins: parsed.sbrs.map((s) => ({
      code: s.sbinNum,
      pf: s.sbinPf,
      name: s.sbinNam,
    })),
    wafers,
  };
}

describe('Property 1: STDF V4 Write-to-Parse Round-Trip Equivalence (fast-check)', () => {
  it('round-trips metadata, wafer geometry, multi-site interleaved dies, retests, and PTR defaults across big/little endianness', () => {
    fc.assert(
      fc.property(arbStdfWriteLotSpec, (spec) => {
        const bytesA = writeStdfBytes(spec);
        const bytesB = writeStdfBytes(spec);
        // Deterministic binary writer check
        expect(bytesB).toEqual(bytesA);

        const parsed = parseStdfBytes(bytesA, { mode: 'full' });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        expect(parsed.value.warnings).toEqual([]);
        expect(parsed.value.skippedRecordCount).toBe(spec.unknownRecords?.length ?? 0);

        const expected = normalizeSpecToExpectedLot(spec);
        const actual = normalizeParsedToLot(parsed.value);
        expect(actual).toEqual(expected);

        // Bins-only mode preserves identical metadata, wafers, and die bins while skipping PTR/MPR/FTRs
        const binsOnly = parseStdfBytes(bytesA, { mode: 'bins-only' });
        expect(binsOnly.ok).toBe(true);
        if (!binsOnly.ok) return;
        const actualBinsOnly = normalizeParsedToLot(binsOnly.value);
        const strippedExpected: NormalizedLot = {
          ...expected,
          wafers: expected.wafers.map((w) => ({
            ...w,
            dies: w.dies.map((d) => ({ ...d, ptrs: [], mprs: [], ftrs: [] })),
          })),
        };
        expect(actualBinsOnly).toEqual(strippedExpected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round-trips identically when compressed with gzip (0x1F 0x8B magic-byte detection + DecompressionStream)', async () => {
    const gzipRuns = Math.max(40, Math.min(NUM_RUNS, 100));
    await fc.assert(
      fc.asyncProperty(arbStdfWriteLotSpec, fc.boolean(), async (spec, useGzip) => {
        const rawBytes = writeStdfBytes(spec);
        const wireBytes = useGzip ? await compressGzipBytes(rawBytes) : rawBytes;

        expect(hasGzipMagicBytes(wireBytes)).toBe(useGzip);

        let stdfBytes = wireBytes;
        if (hasGzipMagicBytes(wireBytes)) {
          const decompressed = await decompressGzipStreamWithCeiling(wireBytes);
          expect(decompressed.kind).toBe('ok');
          if (decompressed.kind !== 'ok') return;
          stdfBytes = decompressed.bytes;
        }

        const parsed = parseStdfBytes(stdfBytes, { mode: 'full' });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        expect(normalizeParsedToLot(parsed.value)).toEqual(
          normalizeSpecToExpectedLot(spec),
        );
      }),
      { numRuns: gzipRuns },
    );
  });
});
