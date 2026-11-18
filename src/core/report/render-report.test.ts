import { describe, expect, it } from 'vitest';
import { generateDemoStdfBytes } from '../demo/demo-generator';
import { en, SUPPORTED_LOCALES } from '../i18n';
import { buildLotModel, type LotModel } from '../model';
import { parseStdfBytes, PRR_PART_FLG, writeStdfBytes } from '../stdf';
import { renderReport, resolveConfidenceLevel } from './render-report';
import { generateOfflineAutopsyReport } from './template-report';

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

function buildZeroFailLot(): LotModel {
  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'CLEAN-LOT', partTyp: 'CAL-CLEAN', jobNam: 'SORT' },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2], cardId: 'C1' }],
    hbrs: [{ hbinNum: 1, hbinCnt: 4, hbinPf: 'P', hbinNam: 'PASS' }],
    sbrs: [{ sbinNum: 1, sbinCnt: 4, sbinPf: 'P', sbinNam: 'GOOD' }],
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
        touchdowns: [
          [
            { headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 0 },
            { headNum: 1, siteNum: 2, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 1, yCoord: 0 },
            { headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 1 },
            { headNum: 1, siteNum: 2, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 1, yCoord: 1 },
          ],
        ],
        wrr: {
          headNum: 1,
          siteGrp: 1,
          finishT: 1_700_000_020,
          partCnt: 4,
          waferId: 'W01',
        },
      },
    ],
    mrr: { finishT: 1_700_000_050, dispCod: '0' },
  });
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

function buildExcursionLot(): LotModel {
  const coords: Array<{ readonly x: number; readonly y: number }> = [];
  for (let y = -8; y <= 8; y += 1) {
    for (let x = -8; x <= 8; x += 1) {
      if (x * x + y * y <= 67) coords.push({ x, y });
    }
  }
  const wafers = [0, 1, 2, 3].map((w) => {
    const parts = coords.map((c, idx) => {
      const fail = w === 1 ? Math.hypot(c.x, c.y) <= 2.9 : c.x === w - 1 && c.y === 5;
      return {
        headNum: 1,
        siteNum: (idx & 1) === 0 ? 1 : 2,
        partFlg: fail ? PRR_PART_FLG.FAILED : 0,
        hardBin: fail ? 3 : 1,
        softBin: fail ? 9 : 1,
        xCoord: c.x,
        yCoord: c.y,
      };
    });
    return {
      wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000 + w * 60, waferId: `W0${w + 1}` },
      touchdowns: [parts],
      wrr: {
        headNum: 1,
        siteGrp: 1,
        finishT: 1_700_000_030 + w * 60,
        partCnt: parts.length,
        waferId: `W0${w + 1}`,
      },
    };
  });
  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'EXC-LOT', partTyp: 'CAL-EXC', jobNam: 'SORT' },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2], cardId: 'C1' }],
    hbrs: [
      { hbinNum: 1, hbinCnt: 1, hbinPf: 'P', hbinNam: 'PASS' },
      { hbinNum: 3, hbinCnt: 1, hbinPf: 'F', hbinNam: 'SHORT' },
    ],
    sbrs: [
      { sbinNum: 1, sbinCnt: 1, sbinPf: 'P', sbinNam: 'GOOD' },
      { sbinNum: 9, sbinCnt: 1, sbinPf: 'F', sbinNam: 'CENTER_SHORT' },
    ],
    wafers,
    mrr: { finishT: 1_700_009_000, dispCod: '0' },
  });
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return buildLotModel(parsed.value);
}

describe('ReportClaim messageKey/params & renderReport per-locale determinism (redesign §3.4, §4.3, §4.4, §4.6, §6.9)', () => {
  it('attaches valid messageKey and raw params to every claim and renders exact §3.4 English copy on edge-ring-etch', () => {
    const lot = buildDemoLot('edge-ring-etch');
    const { report } = generateOfflineAutopsyReport(lot);

    const allClaims = [report.causeOfDeathHeadline, ...report.bodyClaims];
    for (const claim of allClaims) {
      expect(claim.messageKey in en).toBe(true);
      expect(claim.params).toBeDefined();
      expect(typeof claim.params).toBe('object');
      // Existing English text remains intact for Property 10 & LLM narrator
      expect(claim.text.length).toBeGreaterThan(0);
    }

    expect(report.causeOfDeathHeadline.messageKey).toBe('verdict.pattern');
    expect(report.causeOfDeathHeadline.params).toEqual({
      pattern: 'Edge-Ring',
    });

    const rendered = renderReport(report, 'en');

    // §3.4 & §4.3 Verdict hero
    expect(rendered.verdict.isHealthy).toBe(false);
    expect(rendered.verdict.prefix).toBe('Cause of death:');
    expect(rendered.verdict.cause).toBe('Edge-Ring failure.');
    expect(rendered.verdict.fullHeadline).toBe(
      'Cause of death: Edge-Ring failure.',
    );
    // Premium §9.3 takeaway: plain words, no bin codes or test names
    expect(rendered.verdict.subline).toBe(
      'Most failing dies sit in the outer 3 rings of every wafer. Final yield is 82.8%.',
    );

    // Premium §7.4 confidence chip and popover
    expect(rendered.confidence.label).toMatch(/^High confidence, 0\.\d{2}$/);
    expect(rendered.confidence.level).toBe('high');
    expect(rendered.confidence.matchLabel).toBe('Match with Edge-Ring');
    expect(rendered.confidence.matchPattern).toBe('Edge-Ring');
    expect(rendered.confidence.valueText).toMatch(/^0\.\d{2}$/);
    expect(rendered.confidence.definition).toBe(en['glossary.confidence']);
    expect(rendered.confidence.confidenceValue).toBeLessThanOrEqual(0.95);
    expect(rendered.confidence.methodTitle).toBe('How this verdict was made');
    expect(rendered.confidence.methodBody).toBe(
      'Every number comes from the on-device analysis engine. The text is the built-in template.',
    );

    // §3.4 & §4.6 Findings rows (3 quantitative rows + 3 Possible causes hypotheses)
    expect(rendered.findingsHeading).toBe('Findings');
    expect(rendered.clearLabel).toBe('Clear');
    expect(rendered.possibleCausesHeading).toBe('Possible causes');
    expect(rendered.findings).toHaveLength(3);

    expect(rendered.findings[0]?.headline).toBe(
      '93.8% of fails are in the edge band',
    );
    expect(rendered.findings[0]?.subline).toMatch(
      /^\d+\.\d% edge fail rate vs \d+\.\d% interior, on 25 of 25 wafers$/,
    );
    expect(rendered.findings[0]?.dieCountLabel).toBe('2,552 dies');

    expect(rendered.findings[1]?.headline).toBe(
      'SBIN 7 IDDQ_EDGE_LEAK leads the loss',
    );
    expect(rendered.findings[1]?.subline).toMatch(
      /^[\d,]+ dies, 9\d\.\d% of fails$/,
    );

    expect(rendered.findings[2]?.headline).toMatch(
      /^Test 204 IDDQ_LEAK has Cpk 0\.\d{2}$/,
    );
    expect(rendered.findings[2]?.subline).toMatch(
      /^Mean \d+\.\d{2} uA against limits 0\.20 to 15\.00 uA$/,
    );

    expect(rendered.hypotheses).toHaveLength(3);
    expect(rendered.hypotheses[0]?.headline).toBe(
      'Deposition or etch uniformity',
    );
    expect(rendered.hypotheses[0]?.checkText).toBe(
      'Compare chamber logs for the edge zone and check focus-ring hours.',
    );
  });

  it('is 100% deterministic across all 3 demo presets and all 5 locales and preserves untranslated technical tokens (§6.6, §6.9)', () => {
    const presets = [
      'edge-ring-etch',
      'handling-scratch',
      'site2-probe-contact',
    ] as const;

    for (const presetId of presets) {
      const lot = buildDemoLot(presetId);
      const { report } = generateOfflineAutopsyReport(lot);

      for (const locale of SUPPORTED_LOCALES) {
        const passA = renderReport(report, locale);
        const passB = renderReport(report, locale);
        expect(passA).toEqual(passB);

        // No unreplaced {placeholder} tokens in any rendered string
        expect(passA.verdict.fullHeadline).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        expect(passA.verdict.subline).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        expect(passA.confidence.label).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        for (const f of passA.findings) {
          expect(f.headline).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
          expect(f.subline).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
          expect(f.dieCountLabel).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        }
        for (const h of passA.hypotheses) {
          expect(h.headline).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
          expect(h.checkText).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
          expect(h.checkNextLine).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        }

        // Untranslated tokens preserved in every locale (§6.6)
        // Premium A26: the takeaway never names bin codes, test names, or STDF fields
        expect(passA.verdict.subline).not.toMatch(/[HS]BIN|IDDQ|VDD_|CONT_OPEN|PRR|PTR|!/);
        expect(passA.confidence.matchLabel ?? '').not.toMatch(/\{[a-zA-Z0-9_]+\}/);
        if (presetId === 'edge-ring-etch') {
          expect(passA.verdict.cause).toContain('Edge-Ring');
          expect(passA.confidence.matchLabel).toContain('Edge-Ring');
          expect(passA.findings[2]?.headline).toContain('204 IDDQ_LEAK');
        } else if (presetId === 'handling-scratch') {
          expect(passA.verdict.cause).toContain('Scratch');
          expect(passA.confidence.matchLabel).toContain('Scratch');
        } else {
          expect(passA.verdict.untranslatedTokens.site).toBe('2');
          expect(passA.confidence.matchLabel).toBeNull();
          expect(passA.hypotheses[0]?.checkText).toContain('2');
        }
      }
    }
  });

  it('renders healthy zero-failure lots without a cause-of-death prefix and handles excursion + LLM provenance rules (§4.3, §4.4, §6.9)', () => {
    const cleanLot = buildZeroFailLot();
    const { report: cleanReport } = generateOfflineAutopsyReport(cleanLot);
    const cleanEn = renderReport(cleanReport, 'en');
    expect(cleanEn.verdict.isHealthy).toBe(true);
    expect(cleanEn.verdict.prefix).toBe('');
    expect(cleanEn.verdict.cause).toBe('');
    expect(cleanEn.verdict.fullHeadline).toBe(
      'No cause of death.',
    );
    expect(cleanEn.verdict.subline).toMatch(/^([\d,]+) of \1 dies passed every test\.$/);
    expect(cleanEn.confidence.matchLabel).toBeNull();

    const excLot = buildExcursionLot();
    const { report: excReport } = generateOfflineAutopsyReport(excLot);
    const excEn = renderReport(excReport, 'en');
    expect(excEn.verdict.fullHeadline).toBe(
      'Cause of death: Center failure.',
    );
    expect(excEn.verdict.subline).toBe(
      'Most failing dies sit in the centre of the wafer. Final yield is ' +
        excEn.verdict.subline.split('Final yield is ')[1],
    );
    expect(excEn.confidence.matchLabel).toBe('Match with Center');
    expect(excEn.findings[0]?.headline).toMatch(/^Wafer W02 dropped to \d+\.\d%$/);
    expect(excEn.findings[0]?.subline).toMatch(/^\d+\.\d% below the lot median$/);

    // §6.9: LLM narrator method description applies to `en`, while non-`en` locales state built-in template
    const llmReport = { ...excReport, source: 'llm-verified' as const };
    expect(renderReport(llmReport, 'en').confidence.methodBody).toContain(
      'An AI model rephrased the text',
    );
    expect(renderReport(llmReport, 'ja').confidence.methodBody).toBe(
      renderReport(excReport, 'ja').confidence.methodBody,
    );
  });

  it('maps confidence to level words on the shown 2-decimal value (premium §7.4)', () => {
    expect(resolveConfidenceLevel(0.95)).toBe('high');
    expect(resolveConfidenceLevel(0.85)).toBe('high');
    expect(resolveConfidenceLevel(0.849)).toBe('high');
    expect(resolveConfidenceLevel(0.84)).toBe('moderate');
    expect(resolveConfidenceLevel(0.6)).toBe('moderate');
    expect(resolveConfidenceLevel(0.594)).toBe('low');
    expect(resolveConfidenceLevel(0.2)).toBe('low');
  });

  it('renders the scratch and site takeaways from engine numbers (premium §9.3)', () => {
    const scratch = renderReport(
      generateOfflineAutopsyReport(buildDemoLot('handling-scratch')).report,
      'en',
    );
    expect(scratch.verdict.subline).toMatch(
      /^Failing dies line up along a scratch on \d+ of 25 wafers\. Final yield is \d+\.\d%\.$/,
    );
    const site = renderReport(
      generateOfflineAutopsyReport(buildDemoLot('site2-probe-contact')).report,
      'en',
    );
    expect(site.verdict.subline).toMatch(
      /^Test site 2 fails \d+\.\d% of its dies, the other sites fail \d+\.\d%\. Final yield is \d+\.\d%\.$/,
    );
  });
});
