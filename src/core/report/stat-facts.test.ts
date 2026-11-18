import { describe, expect, it } from 'vitest';
import { generateDemoStdfBytes } from '../demo/demo-generator';
import { SUPPORTED_LOCALES } from '../i18n';
import { buildLotModel, type LotModel } from '../model';
import { parseStdfBytes, PRR_PART_FLG, writeStdfBytes } from '../stdf';
import { generateOfflineAutopsyReport } from './template-report';
import {
  buildStatFacts,
  renderStatFacts,
  type StatFact,
} from './stat-facts';

function buildDemoLot(
  presetId: 'edge-ring-etch' | 'handling-scratch' | 'site2-probe-contact',
): LotModel {
  const bytes = generateDemoStdfBytes(presetId);
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

function buildCustomDiskLot(
  mode: 'zero-fail' | 'random' | 'single-fail',
  siteNums: readonly number[] = [1, 2],
): LotModel {
  const coords: Array<{ readonly x: number; readonly y: number }> = [];
  for (let y = -8; y <= 8; y += 1) {
    for (let x = -8; x <= 8; x += 1) {
      if (x * x + y * y <= 67) {
        coords.push({ x, y });
      }
    }
  }

  const parts = coords.map((c, idx) => {
    const siteNum = siteNums[idx % siteNums.length]!;
    let fail = false;
    if (mode === 'random') {
      fail = (idx * 37 + 3) % 10 === 0;
    } else if (mode === 'single-fail') {
      fail = idx === 0;
    }
    return {
      headNum: 1,
      siteNum,
      partFlg: fail ? PRR_PART_FLG.FAILED : 0,
      hardBin: fail ? 5 : 1,
      softBin: fail ? 11 : 1,
      xCoord: c.x,
      yCoord: c.y,
    };
  });

  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: `LOT-${mode}`, partTyp: 'CAL-STAT', jobNam: 'SORT' },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [...siteNums], cardId: 'C1' }],
    hbrs: [
      { hbinNum: 1, hbinCnt: 1, hbinPf: 'P', hbinNam: 'PASS' },
      { hbinNum: 5, hbinCnt: 1, hbinPf: 'F', hbinNam: 'FAIL' },
    ],
    sbrs: [
      { sbinNum: 1, sbinCnt: 1, sbinPf: 'P', sbinNam: 'GOOD' },
      { sbinNum: 11, sbinCnt: 1, sbinPf: 'F', sbinNam: 'DEFECT' },
    ],
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
        touchdowns: [parts],
        wrr: {
          headNum: 1,
          siteGrp: 1,
          finishT: 1_700_000_030,
          partCnt: parts.length,
          waferId: 'W01',
        },
      },
    ],
    mrr: { finishT: 1_700_000_100, dispCod: '0' },
  });

  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

function assertStatTupleInvariants(stats: readonly StatFact[]): void {
  expect(stats).toHaveLength(3);
  const emphasizedCount = stats.filter((s) => s.emphasis).length;
  expect(emphasizedCount).toBeLessThanOrEqual(1);
  for (const stat of stats) {
    expect(Number.isFinite(stat.value)).toBe(true);
    expect(['percent', 'integer']).toContain(stat.format);
    expect(stat.captionKey.startsWith('stats.')).toBe(true);
  }
}

describe('stat-facts core selector and localized formatter (redesign §3.4, §3.6, §4.5)', () => {
  it('builds the exact 3 Edge-Ring stats matching redesign §3.4 with only the lead stat emphasized', () => {
    const lot = buildDemoLot('edge-ring-etch');
    const { analysis, verdict } = generateOfflineAutopsyReport(lot);
    const stats = buildStatFacts({
      lot,
      verdict,
      analysis,
    });

    assertStatTupleInvariants(stats);
    expect(stats[0]?.captionKey).toBe('stats.edgeShare');
    expect(stats[0]?.format).toBe('percent');
    expect(stats[0]?.params).toEqual({ rings: 3 });
    expect(stats[0]?.emphasis).toBe(true);

    expect(stats[1]?.captionKey).toBe('stats.finalYield');
    expect(stats[1]?.format).toBe('percent');
    expect(stats[1]?.emphasis).toBe(false);

    expect(stats[2]?.captionKey).toBe('stats.failingDies');
    expect(stats[2]?.format).toBe('integer');
    expect(stats[2]?.emphasis).toBe(false);

    const renderedEn = renderStatFacts(stats, 'en');
    expect(renderedEn).toHaveLength(3);
    expect(renderedEn[0]).toEqual({
      valueText: '93.8%',
      captionText: 'of fails sit in the outer 3 rings',
      emphasis: true,
      numericValue: stats[0]!.value,
      format: 'percent',
    });
    expect(renderedEn[1]?.valueText).toBe('82.8%');
    expect(renderedEn[1]?.captionText).toMatch(
      /^final yield, 8\d\.\d% first pass$/,
    );
    expect(renderedEn[1]?.emphasis).toBe(false);
    expect(renderedEn[2]?.valueText).toBe('2,721');
    expect(renderedEn[2]?.captionText).toBe('failing dies of 15,825 tested');
    expect(renderedEn[2]?.emphasis).toBe(false);
  });

  it('selects scratch-path share on handling-scratch and site fail rate on site2-probe-contact', () => {
    const scratchLot = buildDemoLot('handling-scratch');
    const scratchRes = generateOfflineAutopsyReport(scratchLot);
    const scratchStats = buildStatFacts({
      lot: scratchLot,
      verdict: scratchRes.verdict,
      analysis: scratchRes.analysis,
    });
    assertStatTupleInvariants(scratchStats);
    expect(scratchStats[0]?.captionKey).toBe('stats.scratchShare');
    expect(scratchStats[0]?.emphasis).toBe(true);
    const scratchEn = renderStatFacts(scratchStats, 'en');
    expect(scratchEn[0]?.captionText).toBe('of fails on the scratch path');

    const siteLot = buildDemoLot('site2-probe-contact');
    const siteRes = generateOfflineAutopsyReport(siteLot);
    const siteStats = buildStatFacts({
      lot: siteLot,
      verdict: siteRes.verdict,
      analysis: siteRes.analysis,
    });
    assertStatTupleInvariants(siteStats);
    expect(siteStats[0]?.captionKey).toBe('stats.siteRate');
    expect(siteStats[0]?.emphasis).toBe(true);
    expect(siteStats[0]?.params.site).toBe(2);
    const siteEn = renderStatFacts(siteStats, 'en');
    expect(siteEn[0]?.captionText).toMatch(
      /^fail rate on site 2 vs \d+\.\d% elsewhere$/,
    );
  });

  it('produces zero orange emphasis on healthy (>= 99% yield or zero-fail) lots and 3 valid stats on random lots', () => {
    const zeroFailLot = buildCustomDiskLot('zero-fail');
    const zeroRes = generateOfflineAutopsyReport(zeroFailLot);
    const zeroStats = buildStatFacts({
      lot: zeroFailLot,
      verdict: zeroRes.verdict,
      analysis: zeroRes.analysis,
    });
    assertStatTupleInvariants(zeroStats);
    expect(zeroStats.every((s) => s.emphasis === false)).toBe(true);

    const singleFailLot = buildCustomDiskLot('single-fail');
    const singleRes = generateOfflineAutopsyReport(singleFailLot);
    expect(singleRes.verdict.finalYield).toBeGreaterThanOrEqual(0.99);
    const singleStats = buildStatFacts({
      lot: singleFailLot,
      verdict: singleRes.verdict,
      analysis: singleRes.analysis,
    });
    assertStatTupleInvariants(singleStats);
    expect(singleStats.every((s) => s.emphasis === false)).toBe(true);

    const randLot = buildCustomDiskLot('random', [1, 2]);
    const randRes = generateOfflineAutopsyReport(randLot);
    const randStats = buildStatFacts({
      lot: randLot,
      verdict: randRes.verdict,
      analysis: randRes.analysis,
    });
    assertStatTupleInvariants(randStats);
    expect(randStats.filter((s) => s.emphasis).length).toBe(1);
  });

  it('scopes stat values and appends localized "in selection" captions when a selection mask is active (§3.6)', () => {
    const lot = buildDemoLot('edge-ring-etch');
    const { analysis, verdict } = generateOfflineAutopsyReport(lot);

    // Select only wafer 0 dies
    const mask = new Uint8Array(lot.dies.count);
    const w0 = lot.wafers[0]!;
    for (let i = w0.dieStartIndex; i < w0.dieEndIndex; i += 1) {
      mask[i] = 1;
    }

    const selStats = buildStatFacts({
      lot,
      verdict,
      analysis,
      selectionMask: mask,
    });
    assertStatTupleInvariants(selStats);
    expect(selStats.every((s) => s.inSelection === true)).toBe(true);

    for (const locale of SUPPORTED_LOCALES) {
      const renderedA = renderStatFacts(selStats, locale);
      const renderedB = renderStatFacts(selStats, locale);
      expect(renderedA).toEqual(renderedB);
      if (locale === 'en') {
        expect(renderedA[2]?.captionText).toBe(
          'failing dies of 633 tested in selection',
        );
      }
    }
  });
});
