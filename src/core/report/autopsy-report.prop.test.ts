/**
 * Property 10: Autopsy Report Verdict Structure and Claim-to-Die Referential Integrity
 * (`src/core/report/autopsy-report.prop.test.ts`).
 *
 * Verifies:
 * 1. Property 10 (`fast-check`) across arbitrary `LotModel`s (`arbLotModel`) and targeted
 *    multi-tier synthetic STDF lots covering all 6 precedence tiers (`Tiers 0–5`):
 *    - `causeOfDeathHeadline` strictly matches Requirement 10.1 template (omitting the
 *      bin clause when `totalFailDies === 0`, citing the true dominant `SBIN`/`HBIN` otherwise).
 *    - `bodyClaims` has `2–4` concise clinical claims, each citing `>= 1` valid `factId`.
 *    - Every `EngineFact` and every `ReportClaim` resolves to a non-empty, sorted,
 *      in-bounds `Uint32Array` of `LotModel.dies` indices and valid `DieId`s in `lot.dieIndexById`.
 *    - Every `citedBins`, `citedTestNums`, `citedSites`, and formatted numeric metric
 *      matches its cited `EngineFact`s.
 *    - Repeated invocations are 100% deterministic.
 * 2. Unit tests covering all 3 built-in demo presets (`edge-ring-etch`, `handling-scratch`,
 *    `site2-probe-contact`), zero-failure lots (`"No failure pattern detected"`), all 6
 *    verdict precedence tiers, Tier 1 vs. Tier 2 `excessFailShare` threshold arbitration,
 *    `HBIN` fallback when `SBIN === 65535`, lowest-code tie-breaking, and SI unit scaling.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.5, 17.4
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbLotModel } from '../__test-utils__/arbitraries';
import { computeYieldSummary } from '../analytics/yield-summary';
import { type DemoPresetId, generateDemoStdfBytes } from '../demo/demo-generator';
import { buildLotModel } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import { classifyWaferPattern } from '../patterns/wm811k-classifier';
import { parseStdfBytes } from '../stdf/stdf-parser';
import { writeStdfBytes } from '../stdf/stdf-writer';
import {
  PRR_PART_FLG,
  STDF_MISSING_U2,
  type StdfWriteLotSpec,
  type StdfWritePartSpec,
  type StdfWriteWaferSpec,
} from '../stdf/types';
import {
  analyzeLotForReport,
  buildEngineFacts,
  type EngineFact,
  formatScaledParametricValue,
  sanitizeReportProseText,
} from './engine-facts';
import {
  type AutopsyReport,
  buildTemplateAutopsyReport,
  generateOfflineAutopsyReport,
  type ReportClaim,
} from './template-report';
import { selectPrimaryVerdict, type VerdictTier } from './verdict-precedence';

const PROP_NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);
const TIER_PROP_NUM_RUNS = Number(process.env.FC_TIER_NUM_RUNS ?? 90);
const PROP_SEED =
  process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : undefined;

const HEADLINE_ZERO_FAIL_REGEX =
  /^Cause of death: No failure pattern detected\. All [\d,]+ tested dies? passed final sort across [\d,]+ wafers?\.$/;

const HEADLINE_FAIL_REGEX =
  /^Cause of death: (.+?)\. (.+), most loss in (SBIN|HBIN) (\d+)(?: \((.+)\))?\.$/;

const FORBIDDEN_HORROR_TERMS_REGEX =
  /\b(corpse|morgue|zombie|vampire|ghost|skull|cobweb|blood|gore|spooky|pumpkin|skeleton|graveyard)\b/i;

function parseSpecToLotModel(spec: StdfWriteLotSpec): LotModel {
  const bytes = writeStdfBytes(spec);
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error(`Unexpected STDF parse failure: ${parsed.error.message}`);
  }
  return buildLotModel(parsed.value);
}

function buildDiskCoords(radius: number): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const coords: Array<{ readonly x: number; readonly y: number }> = [];
  const rSq = radius * radius;
  const bound = Math.ceil(radius);
  for (let y = -bound; y <= bound; y += 1) {
    for (let x = -bound; x <= bound; x += 1) {
      if (x * x + y * y <= rSq) {
        coords.push({ x, y });
      }
    }
  }
  return coords;
}

const DISK_R8_COORDS = buildDiskCoords(8.2);

type SyntheticTierScenario =
  | 'tier0-zero-fail'
  | 'tier1-site-anomaly'
  | 'tier2-edge-ring'
  | 'tier3-wafer-excursion'
  | 'tier4-random'
  | 'tier5-single-fail';

function buildSyntheticScenarioLot(
  scenario: SyntheticTierScenario,
  sbinOmitted: boolean,
  seedBits: number,
): LotModel {
  const waferCount =
    scenario === 'tier3-wafer-excursion'
      ? 4
      : (seedBits & 1) === 1
        ? 2
        : 1;

  const wafers: StdfWriteWaferSpec[] = [];
  for (let w = 0; w < waferCount; w += 1) {
    const parts: StdfWritePartSpec[] = DISK_R8_COORDS.map((c, idx) => {
      const siteNum = ((idx & 1) === 0 ? 1 : 2);
      const dist = Math.hypot(c.x, c.y);

      let fail = false;
      let hardBin = 1;
      let softBin = 1;

      if (scenario === 'tier0-zero-fail') {
        fail = false;
      } else if (scenario === 'tier1-site-anomaly') {
        // Site 2 fails ~45% uniformly; Site 1 fails ~1%
        fail = siteNum === 2 ? idx % 9 < 4 : idx === 0;
        if (fail) {
          hardBin = 2;
          softBin = 5;
        }
      } else if (scenario === 'tier2-edge-ring') {
        fail = dist >= 6.4 && (idx + w) % 5 !== 0;
        if (fail) {
          hardBin = 4;
          softBin = 7;
        }
      } else if (scenario === 'tier3-wafer-excursion') {
        // Only Wafer 1 has a dense Center excursion (>= 25% of lot fails); other 3 wafers have 1 isolated fail
        if (w === 1) {
          fail = dist <= 2.9;
        } else {
          fail = c.x === w - 1 && c.y === 5;
        }
        if (fail) {
          hardBin = 3;
          softBin = 9;
        }
      } else if (scenario === 'tier4-random') {
        // Uniform deterministic pseudo-random ~45% loss balanced across sites (coprime stride).
        // Real WM-811K 'Random' wafers fail ~42-55% of dies; a ~10% uniform scatter is what
        // expert-labeled 'None' wafers look like, so the WM-811K-fit classifier calls it 'None'.
        fail = ((idx * 37 + w * 13 + (seedBits & 7)) % 11) < 5;
        if (fail) {
          hardBin = 5;
          softBin = 11;
        }
      } else {
        // tier5-single-fail: 1–2 isolated fails -> WM-811K 'None'
        fail = w === 0 && idx === (seedBits % 10);
        if (fail) {
          hardBin = 4;
          softBin = 7;
        }
      }

      if (sbinOmitted) {
        return {
          headNum: 1,
          siteNum,
          partFlg: fail ? PRR_PART_FLG.FAILED : 0,
          hardBin,
          softBin: STDF_MISSING_U2,
          xCoord: c.x,
          yCoord: c.y,
        };
      }

      return {
        headNum: 1,
        siteNum,
        partFlg: fail ? PRR_PART_FLG.FAILED : 0,
        hardBin,
        softBin,
        xCoord: c.x,
        yCoord: c.y,
      };
    });

    wafers.push({
      wir: {
        headNum: 1,
        siteGrp: 1,
        startT: 1_700_000_000 + w * 60,
        waferId: `W0${w + 1}`,
      },
      touchdowns: [parts],
      wrr: {
        headNum: 1,
        siteGrp: 1,
        finishT: 1_700_000_030 + w * 60,
        partCnt: parts.length,
        waferId: `W0${w + 1}`,
      },
    });
  }

  return parseSpecToLotModel({
    endianness: (seedBits & 2) === 0 ? 'little' : 'big',
    mir: {
      lotId: `SYN-${scenario}`,
      partTyp: 'CAL-PROP-IC',
      jobNam: 'PROP10_SORT',
    },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2], cardId: 'CARD-P10' }],
    hbrs: [
      { hbinNum: 1, hbinCnt: 1, hbinPf: 'P', hbinNam: 'PASS_BIN' },
      { hbinNum: 2, hbinCnt: 1, hbinPf: 'F', hbinNam: 'CONT_BIN' },
      { hbinNum: 3, hbinCnt: 1, hbinPf: 'F', hbinNam: 'SHORT_BIN' },
      { hbinNum: 4, hbinCnt: 1, hbinPf: 'F', hbinNam: 'LEAK_BIN' },
      { hbinNum: 5, hbinCnt: 1, hbinPf: 'F', hbinNam: 'RAND_BIN' },
    ],
    sbrs: [
      { sbinNum: 1, sbinCnt: 1, sbinPf: 'P', sbinNam: 'GOOD' },
      { sbinNum: 5, sbinCnt: 1, sbinPf: 'F', sbinNam: 'CONT_OPEN' },
      { sbinNum: 7, sbinCnt: 1, sbinPf: 'F', sbinNam: 'IDDQ_LEAK' },
      { sbinNum: 9, sbinCnt: 1, sbinPf: 'F', sbinNam: 'VDD_SHORT' },
      { sbinNum: 11, sbinCnt: 1, sbinPf: 'F', sbinNam: 'VTH_MARGIN' },
    ],
    wafers,
    mrr: { finishT: 1_700_009_000, dispCod: '0' },
  });
}

function maskIdentifiersAndExtractNumbers(
  text: string,
  citedFacts: readonly EngineFact[] = [],
): readonly number[] {
  let preMasked = text;
  for (const fact of citedFacts) {
    if (fact.testRef) {
      const label =
        fact.testRef.testName.length > 0
          ? `Test ${fact.testRef.testNum} (${fact.testRef.testName})`
          : `Test ${fact.testRef.testNum}`;
      preMasked = preMasked.split(label).join('TEST_ID');
    }
    if (fact.binRef) {
      const label =
        fact.binRef.name.length > 0
          ? `${fact.binRef.mode} ${fact.binRef.code} (${fact.binRef.name})`
          : `${fact.binRef.mode} ${fact.binRef.code}`;
      preMasked = preMasked.split(label).join('BIN_ID');
    }
    if (fact.waferRef) {
      const cleanWf =
        sanitizeReportProseText(fact.waferRef.waferId) ||
        `W${String(fact.waferRef.waferIndex + 1).padStart(2, '0')}`;
      preMasked = preMasked.split(`Wafer ${cleanWf}`).join('WAFER_ID');
    }
  }

  const masked = preMasked
    .replace(/\b(?:SBIN|HBIN)\s+\d+(?:\s*\([^)]*\))?/g, 'BIN_ID')
    .replace(/\bTest\s+\d+(?:\s*\([^)]*\))?/g, 'TEST_ID')
    .replace(/\bHead\s+\d+\s+Site\s+\d+\s*\(\d+:\d+\)/g, 'SITE_ID')
    .replace(/\bSite\s+\d+:\d+/g, 'SITE_ID')
    .replace(/\bWafer\s+\S+/g, 'WAFER_ID');

  const matches = masked.match(/-?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  if (!matches) {
    return [];
  }

  const extracted: number[] = [];
  for (const token of matches) {
    const num = Number(token.replace(/,/g, ''));
    if (Number.isFinite(num)) {
      extracted.push(num);
    }
  }
  return extracted;
}

function computeExpectedDominantBinFromLot(
  lot: LotModel,
): { readonly mode: 'SBIN' | 'HBIN'; readonly code: number } | null {
  const { dies } = lot;
  let totalFails = 0;
  let anyValidSbin = false;

  for (let i = 0; i < dies.count; i += 1) {
    if (dies.finalPass[i] === 0) {
      totalFails += 1;
      if (dies.sbin[i]! !== STDF_MISSING_U2) {
        anyValidSbin = true;
      }
    }
  }

  if (totalFails === 0) {
    return null;
  }

  const mode: 'SBIN' | 'HBIN' = anyValidSbin ? 'SBIN' : 'HBIN';
  const counts = new Map<number, number>();
  for (let i = 0; i < dies.count; i += 1) {
    if (dies.finalPass[i] !== 0) {
      continue;
    }
    const code = mode === 'SBIN' ? dies.sbin[i]! : dies.hbin[i]!;
    if (mode === 'SBIN' && code === STDF_MISSING_U2) {
      continue;
    }
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  let bestCode = -1;
  let bestCount = -1;
  for (const [code, cnt] of counts.entries()) {
    if (cnt > bestCount || (cnt === bestCount && code < bestCode)) {
      bestCode = code;
      bestCount = cnt;
    }
  }

  return { mode, code: bestCode };
}

function assertProperty10ReportInvariants(
  lot: LotModel,
  facts: readonly EngineFact[],
  report: AutopsyReport,
): void {
  expect(lot.dies.count).toBeGreaterThanOrEqual(1);
  expect(facts.length).toBeGreaterThanOrEqual(1);
  expect(report.source).toBe('deterministic-template');

  // 1. Validate EngineFact uniqueness & non-empty valid die sets
  const factsById = new Map<string, EngineFact>();
  for (const fact of facts) {
    expect(fact.factId.length).toBeGreaterThan(0);
    expect(factsById.has(fact.factId)).toBe(false);
    factsById.set(fact.factId, fact);

    expect(fact.dieIndices.length).toBeGreaterThanOrEqual(1);
    expect(fact.dieIds).toHaveLength(fact.dieIndices.length);
    expect(fact.summary).not.toMatch(/[<>]/);
    expect(fact.summary).not.toMatch(FORBIDDEN_HORROR_TERMS_REGEX);

    for (let i = 0; i < fact.dieIndices.length; i += 1) {
      const dieIdx = fact.dieIndices[i]!;
      expect(dieIdx).toBeGreaterThanOrEqual(0);
      expect(dieIdx).toBeLessThan(lot.dies.count);
      if (i > 0) {
        expect(dieIdx).toBeGreaterThan(fact.dieIndices[i - 1]!);
      }
      const dieId = fact.dieIds[i]!;
      expect(dieId).toBe(lot.dieIds[dieIdx]);
      expect(lot.dieIndexById.get(dieId)).toBe(dieIdx);
    }
  }

  // 2. Validate Cause-of-Death Headline against Requirement 10.1
  const yieldSummary = computeYieldSummary(lot);
  const totalFailDies = yieldSummary.overall.finalFailDies;
  const expectedDomBin = computeExpectedDominantBinFromLot(lot);

  expect(report.causeOfDeathHeadline.isHeadline).toBe(true);
  expect(report.causeOfDeathHeadline.text).not.toContain('(confidence');
  expect(report.causeOfDeathHeadline.text).not.toContain('Yield ');

  if (totalFailDies === 0) {
    expect(expectedDomBin).toBeNull();
    expect(report.causeOfDeathHeadline.text).toMatch(HEADLINE_ZERO_FAIL_REGEX);
    expect(report.causeOfDeathHeadline.citedFactIds).toEqual(['fact:lot-yield']);
  } else {
    expect(expectedDomBin).not.toBeNull();
    const match = HEADLINE_FAIL_REGEX.exec(report.causeOfDeathHeadline.text);
    expect(match).not.toBeNull();
    if (match && expectedDomBin) {
      const [, verdictStr, whereStr, binModeStr, binCodeStr] = match;
      expect(verdictStr!.length).toBeGreaterThan(0);
      expect(whereStr!.length).toBeGreaterThan(0);
      expect(binModeStr).toBe(expectedDomBin.mode);
      expect(Number(binCodeStr)).toBe(expectedDomBin.code);
    }
  }

  for (const fact of facts) {
    for (const metric of fact.metrics) {
      if (metric.key === 'confidence') {
        expect(metric.numericValue).toBeGreaterThanOrEqual(0);
        expect(metric.numericValue).toBeLessThanOrEqual(0.95);
      }
    }
  }

  // 3. Validate bodyClaims count (2–4) and referential integrity across all claims
  expect(report.bodyClaims.length).toBeGreaterThanOrEqual(2);
  expect(report.bodyClaims.length).toBeLessThanOrEqual(4);

  const allClaims: readonly ReportClaim[] = [
    report.causeOfDeathHeadline,
    ...report.bodyClaims,
  ];
  const seenClaimIds = new Set<string>();

  for (let cIdx = 0; cIdx < allClaims.length; cIdx += 1) {
    const claim = allClaims[cIdx]!;
    expect(seenClaimIds.has(claim.claimId)).toBe(false);
    seenClaimIds.add(claim.claimId);
    expect(claim.isHeadline).toBe(cIdx === 0);
    expect(claim.text.length).toBeGreaterThan(0);
    expect(claim.text).not.toMatch(/[<>]/);
    expect(claim.text).not.toMatch(FORBIDDEN_HORROR_TERMS_REGEX);

    expect(claim.citedFactIds.length).toBeGreaterThanOrEqual(1);

    const expectedDieSet = new Set<number>();
    const expectedBinKeys = new Set<string>();
    const expectedTestNums = new Set<number>();
    const expectedSiteKeys = new Set<string>();
    const availableMetrics = [];

    const citedFactObjects: EngineFact[] = [];

    for (const factId of claim.citedFactIds) {
      const fact = factsById.get(factId);
      expect(fact).toBeDefined();
      citedFactObjects.push(fact!);
      for (let i = 0; i < fact!.dieIndices.length; i += 1) {
        expectedDieSet.add(fact!.dieIndices[i]!);
      }
      if (fact!.binRef) {
        expectedBinKeys.add(`${fact!.binRef.mode}:${fact!.binRef.code}`);
      }
      if (fact!.testRef) {
        expectedTestNums.add(fact!.testRef.testNum);
      }
      if (fact!.siteRef) {
        expectedSiteKeys.add(`${fact!.siteRef.headNum}:${fact!.siteRef.siteNum}`);
      }
      availableMetrics.push(...fact!.metrics);
    }

    // Referential integrity of resolvedDieIndices & resolvedDieIds
    const expectedSortedIndices = Array.from(expectedDieSet).sort((a, b) => a - b);
    expect(claim.resolvedDieIndices.length).toBeGreaterThanOrEqual(1);
    expect(Array.from(claim.resolvedDieIndices)).toEqual(expectedSortedIndices);
    expect(claim.resolvedDieIds).toHaveLength(claim.resolvedDieIndices.length);

    for (let i = 0; i < claim.resolvedDieIndices.length; i += 1) {
      const idx = claim.resolvedDieIndices[i]!;
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(lot.dies.count);
      const dieId = claim.resolvedDieIds[i]!;
      expect(dieId).toBe(lot.dieIds[idx]);
      expect(lot.dieIndexById.has(dieId)).toBe(true);
    }

    // Referential integrity of citedBins, citedTestNums, and citedSites
    expect(
      new Set(claim.citedBins.map((b) => `${b.mode}:${b.code}`)),
    ).toEqual(expectedBinKeys);

    expect(new Set(claim.citedTestNums)).toEqual(expectedTestNums);
    for (const testNum of claim.citedTestNums) {
      expect(lot.tests.has(testNum)).toBe(true);
    }

    expect(
      new Set(claim.citedSites.map((s) => `${s.headNum}:${s.siteNum}`)),
    ).toEqual(expectedSiteKeys);
    for (const site of claim.citedSites) {
      expect(
        lot.sites.some(
          (s) => s.headNum === site.headNum && s.siteNum === site.siteNum,
        ),
      ).toBe(true);
    }

    // Metric consistency on quantitative claims (headline & non-hypothesis metric claims)
    const isQualitativeHypothesisClaim =
      claim.claimId === 'claim:root-cause-hypothesis' ||
      (claim.claimId === 'claim:disposition-guidance' &&
        claim.text.includes('Candidate mechanism:'));

    if (!isQualitativeHypothesisClaim) {
      const numbersInProse = maskIdentifiersAndExtractNumbers(
        claim.text,
        citedFactObjects,
      );
      for (const num of numbersInProse) {
        const matchesMetric = availableMetrics.some(
          (m) => Math.abs(num - m.numericValue) <= m.tolerance + 1e-9,
        );
        expect(matchesMetric).toBe(true);
      }
    }
  }

  // 4. Failing lots always include hedged root-cause hypothesis + Check next step
  if (totalFailDies > 0) {
    const rootCauseClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:root-cause-hypothesis',
    );
    expect(rootCauseClaim).toBeDefined();
    expect(rootCauseClaim!.text).toContain('Candidate mechanism:');
    expect(rootCauseClaim!.text).toContain('Check next:');
  }
}

describe('Property 10: Autopsy Report Verdict Structure & Claim-to-Die Referential Integrity (fast-check)', () => {
  it('enforces headline template, non-empty claim-to-die resolution, metric grounding, and determinism across arbitrary LotModels', () => {
    fc.assert(
      fc.property(arbLotModel, (lot) => {
        const runA = generateOfflineAutopsyReport(lot);
        const runB = generateOfflineAutopsyReport(lot);

        expect(runA.verdict).toEqual(runB.verdict);
        expect(runA.facts).toEqual(runB.facts);
        expect(runA.report).toEqual(runB.report);

        assertProperty10ReportInvariants(lot, runA.facts, runA.report);
      }),
      {
        numRuns: PROP_NUM_RUNS,
        ...(PROP_SEED !== undefined ? { seed: PROP_SEED } : {}),
      },
    );
  });

  it('enforces Property 10 invariants across targeted multi-tier scenarios (Tiers 0–5, SBIN vs HBIN fallback)', () => {
    const arbScenario = fc.record({
      scenario: fc.constantFrom<SyntheticTierScenario>(
        'tier0-zero-fail',
        'tier1-site-anomaly',
        'tier2-edge-ring',
        'tier3-wafer-excursion',
        'tier4-random',
        'tier5-single-fail',
      ),
      sbinOmitted: fc.boolean(),
      seedBits: fc.integer({ min: 0, max: 63 }),
    });

    const observedTiers = new Set<VerdictTier>();

    fc.assert(
      fc.property(arbScenario, ({ scenario, sbinOmitted, seedBits }) => {
        const lot = buildSyntheticScenarioLot(scenario, sbinOmitted, seedBits);
        const { facts, verdict, report } = generateOfflineAutopsyReport(lot);

        observedTiers.add(verdict.tier);
        assertProperty10ReportInvariants(lot, facts, report);

        if (scenario !== 'tier0-zero-fail' && sbinOmitted) {
          expect(verdict.dominantBin?.mode).toBe('HBIN');
          expect(report.causeOfDeathHeadline.text).toContain('most loss in HBIN ');
        }
      }),
      { numRuns: TIER_PROP_NUM_RUNS },
    );

    expect(observedTiers).toEqual(new Set<VerdictTier>([0, 1, 2, 3, 4, 5]));
  });
});

describe('Autopsy Report & 6-Tier Verdict Precedence Unit Suite', () => {
  function runDemoPresetAutopsy(presetId: DemoPresetId) {
    const bytes = generateDemoStdfBytes(presetId);
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    const lot = buildLotModel(parsed.value);
    return { lot, ...generateOfflineAutopsyReport(lot) };
  }

  it('diagnoses edge-ring-etch as Edge-Ring failure in SBIN 7 with outer-ring die evidence and plasma-etch hypothesis', () => {
    const { lot, facts, verdict, report } = runDemoPresetAutopsy('edge-ring-etch');

    expect(verdict.tier).toBe(2);
    expect(verdict.kind).toBe('spatial-pattern');
    expect(verdict.verdict).toBe('Edge-Ring failure');
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.75);
    expect(verdict.confidence).toBeLessThanOrEqual(0.95);
    expect(verdict.dominantBin?.mode).toBe('SBIN');
    expect(verdict.dominantBin?.code).toBe(7);

    expect(report.causeOfDeathHeadline.text).toMatch(
      /^Cause of death: Edge-Ring failure\. 9\d\.\d% of final fails \([\d,]+ of [\d,]+\) sit in the outer 3-die band, most loss in SBIN 7 \(IDDQ_EDGE_LEAK\)\.$/,
    );
    expect(report.causeOfDeathHeadline.citedFactIds).toEqual([
      'fact:spatial:primary',
      'fact:bin:sbin-7',
    ]);
    expect(report.causeOfDeathHeadline.citedBins).toEqual([{ mode: 'SBIN', code: 7 }]);

    // Every die highlighted by clicking the Edge-Ring headline lies in the outer 3 rings,
    // and Claim 1 reconciles exact edge-band + interior final fail counts without a false 0.0%/100.0%.
    expect(report.causeOfDeathHeadline.resolvedDieIndices.length).toBeGreaterThan(500);
    for (const dieIdx of report.causeOfDeathHeadline.resolvedDieIndices) {
      expect(lot.dies.ringIndex[dieIdx]).toBeLessThanOrEqual(3);
      expect(lot.dies.finalPass[dieIdx]).toBe(0);
    }
    const primaryClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:primary-evidence',
    );
    expect(primaryClaim).toBeDefined();
    expect(primaryClaim!.resolvedDieIndices.length).toBe(
      report.causeOfDeathHeadline.resolvedDieIndices.length,
    );
    expect(primaryClaim!.text).not.toContain('0.0%');
    expect(primaryClaim!.text).not.toContain('100.0%');
    expect(primaryClaim!.text).toContain('interior final fails');

    // Parametric test 204 (IDDQ_LEAK in uA) & plasma etch hypothesis
    const paramClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:supporting-evidence',
    );
    expect(paramClaim?.citedTestNums).toEqual([204]);
    expect(paramClaim?.text).toContain('uA');

    const rootCauseClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:root-cause-hypothesis',
    );
    expect(rootCauseClaim?.text).toContain('plasma etch');
    expect(rootCauseClaim?.text).toContain('Check next:');

    assertProperty10ReportInvariants(lot, facts, report);
  });

  it('diagnoses handling-scratch as Scratch failure in SBIN 9 with VCCA_SHORT mA evidence and handling hypothesis', () => {
    const { lot, facts, verdict, report } = runDemoPresetAutopsy('handling-scratch');

    expect(verdict.tier).toBe(2);
    expect(verdict.kind).toBe('spatial-pattern');
    expect(verdict.verdict).toBe('Scratch failure');
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.75);
    expect(verdict.confidence).toBeLessThanOrEqual(0.95);
    expect(verdict.dominantBin?.mode).toBe('SBIN');
    expect(verdict.dominantBin?.code).toBe(9);

    expect(report.causeOfDeathHeadline.text).toMatch(
      /^Cause of death: Scratch failure\. \d+\.\d% of final fails \([\d,]+ of [\d,]+\) align along a scratch track across \d+ of 25 wafers, most loss in SBIN 9 \(VDD_METAL_SHORT\)\.$/,
    );
    expect(report.causeOfDeathHeadline.citedFactIds).toEqual([
      'fact:spatial:primary',
      'fact:bin:sbin-9',
    ]);

    const paramClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:supporting-evidence',
    );
    expect(paramClaim?.citedTestNums).toEqual([302]);
    expect(paramClaim?.text).toContain('mA');

    const rootCauseClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:root-cause-hypothesis',
    );
    expect(rootCauseClaim?.text).toContain('wafer-handling robot blade');
    expect(rootCauseClaim?.text).toContain('Check next:');

    assertProperty10ReportInvariants(lot, facts, report);
  });

  it('diagnoses site2-probe-contact as Test Site 1:2 concentration anomaly (Tier 1 overriding spatial Random) in SBIN 5', () => {
    const { lot, analysis, facts, verdict, report } =
      runDemoPresetAutopsy('site2-probe-contact');

    expect(analysis.primarySpatial.pattern).toBe('Random');
    expect(verdict.tier).toBe(1);
    expect(verdict.kind).toBe('site-anomaly');
    expect(verdict.verdict).toBe('Test Site 1:2 concentration anomaly');
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.75);
    expect(verdict.confidence).toBeLessThanOrEqual(0.95);
    expect(verdict.dominantBin?.mode).toBe('SBIN');
    expect(verdict.dominantBin?.code).toBe(5);

    expect(report.causeOfDeathHeadline.text).toMatch(
      /^Cause of death: Test Site 1:2 concentration anomaly\. \d+\.\d% of first-pass fails \([\d,]+ of [\d,]+\) occurred on Site 1:2, most loss in SBIN 5 \(CONT_OPEN\)\.$/,
    );
    expect(report.causeOfDeathHeadline.citedFactIds).toEqual([
      'fact:site:1-2',
      'fact:bin:sbin-5',
    ]);
    expect(report.causeOfDeathHeadline.citedSites).toEqual([
      { headNum: 1, siteNum: 2 },
    ]);

    const rootCauseClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:root-cause-hypothesis',
    );
    expect(rootCauseClaim?.text).toContain('Head 1 Site 2 (1:2)');
    expect(rootCauseClaim?.text).toContain('probe-card');
    expect(rootCauseClaim?.text).toContain('Check next:');

    assertProperty10ReportInvariants(lot, facts, report);
  });

  it('diagnoses a zero-failure lot as "No failure pattern detected" (Tier 0) omitting the bin clause', () => {
    const zeroFailLot = buildSyntheticScenarioLot('tier0-zero-fail', false, 0);
    const { facts, verdict, report } = generateOfflineAutopsyReport(zeroFailLot);

    expect(verdict.tier).toBe(0);
    expect(verdict.kind).toBe('no-failure');
    expect(verdict.verdict).toBe('No failure pattern detected');
    expect(verdict.confidence).toBe(1.0);
    expect(verdict.dominantBin).toBeNull();
    expect(report.causeOfDeathHeadline.text).toBe(
      `Cause of death: No failure pattern detected. All ${zeroFailLot.dies.count} tested dies passed final sort across ${zeroFailLot.wafers.length} wafer.`,
    );
    expect(report.causeOfDeathHeadline.resolvedDieIndices.length).toBe(
      zeroFailLot.dies.count,
    );

    assertProperty10ReportInvariants(zeroFailLot, facts, report);
  });

  it('arbitrates Tier 1 vs. Tier 2 at the 50% excessFailShare threshold and exercises Tiers 3, 4, and 5', () => {
    // 1. Tier 1 vs Tier 2 threshold arbitration on a structured Edge-Ring lot
    const edgeLot = buildSyntheticScenarioLot('tier2-edge-ring', false, 0);
    const edgeAnalysis = analyzeLotForReport(edgeLot);
    expect(edgeAnalysis.primarySpatial.pattern).toBe('Edge-Ring');

    const baseSiteAnomaly = {
      site: edgeLot.sites[1]!,
      siteMetrics: edgeAnalysis.yieldSummary.bySite[1]!,
      otherSitesFirstPassYield: 0.96,
      yieldDeltaPp: -18.0,
      twoProportionZ: 4.5,
      excessFailCount: 25,
      confidence: 0.84,
      failingDieIndices: Uint32Array.from([1, 3, 5]),
    };

    // excessFailShare < 0.50 with structured Edge-Ring -> Tier 2 wins
    const tier2Wins = selectPrimaryVerdict(
      edgeLot,
      edgeAnalysis.primarySpatial,
      edgeAnalysis.perWaferPatterns,
      [{ ...baseSiteAnomaly, excessFailShare: 0.49 }],
      edgeAnalysis.yieldSummary,
    );
    expect(tier2Wins.tier).toBe(2);
    expect(tier2Wins.verdict).toBe('Edge-Ring failure');

    // excessFailShare >= 0.50 with structured Edge-Ring -> Tier 1 overrides Tier 2
    const tier1Overrides = selectPrimaryVerdict(
      edgeLot,
      edgeAnalysis.primarySpatial,
      edgeAnalysis.perWaferPatterns,
      [{ ...baseSiteAnomaly, excessFailShare: 0.5 }],
      edgeAnalysis.yieldSummary,
    );
    expect(tier1Overrides.tier).toBe(1);
    expect(tier1Overrides.verdict).toBe('Test Site 1:2 concentration anomaly');

    // 2. Tier 3: Diluted single-wafer excursion on Wafer W02
    const excLot = buildSyntheticScenarioLot('tier3-wafer-excursion', false, 0);
    const excRes = generateOfflineAutopsyReport(excLot);
    expect(excRes.verdict.tier).toBe(3);
    expect(excRes.verdict.verdict).toBe('Center excursion on Wafer W02');
    expect(excRes.report.causeOfDeathHeadline.citedFactIds).toEqual([
      'fact:wafer-excursion:1',
      'fact:bin:sbin-9',
    ]);

    // 3. Tier 4: Unclustered spatial Random defect failure
    const randLot = buildSyntheticScenarioLot('tier4-random', false, 0);
    const randRes = generateOfflineAutopsyReport(randLot);
    expect(randRes.verdict.tier).toBe(4);
    expect(randRes.verdict.verdict).toBe('Random defect failure');

    // 4. Tier 5: Sub-threshold baseline low-density loss (1 failing die -> 'None')
    const baseLot = buildSyntheticScenarioLot('tier5-single-fail', false, 0);
    expect(classifyWaferPattern(baseLot, 0).pattern).toBe('None');
    const baseRes = generateOfflineAutopsyReport(baseLot);
    expect(baseRes.verdict.tier).toBe(5);
    expect(baseRes.verdict.verdict).toBe('Baseline low-density loss');
    expect(baseRes.report.causeOfDeathHeadline.citedFactIds).toEqual([
      'fact:lot-yield',
      'fact:bin:sbin-7',
    ]);
  });

  it('breaks dominant bin ties by lowest numeric code and formats SI unit prefixes from RES_SCAL', () => {
    const tieLot = parseSpecToLotModel({
      endianness: 'little',
      mir: { lotId: 'TIE-LOT', partTyp: 'IC', jobNam: 'SORT' },
      hbrs: [
        { hbinNum: 1, hbinCnt: 2, hbinPf: 'P', hbinNam: 'PASS' },
        { hbinNum: 3, hbinCnt: 2, hbinPf: 'F', hbinNam: 'SHORT' },
        { hbinNum: 4, hbinCnt: 2, hbinPf: 'F', hbinNam: 'LEAK' },
      ],
      sbrs: [
        { sbinNum: 1, sbinCnt: 2, sbinPf: 'P', sbinNam: 'GOOD' },
        { sbinNum: 7, sbinCnt: 2, sbinPf: 'F', sbinNam: 'LEAK_A' },
        { sbinNum: 9, sbinCnt: 2, sbinPf: 'F', sbinNam: 'SHORT_B' },
      ],
      wafers: [
        {
          wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
          touchdowns: [
            [
              { headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 0 },
              { headNum: 1, siteNum: 2, partFlg: PRR_PART_FLG.FAILED, hardBin: 3, softBin: 9, xCoord: 1, yCoord: 0 },
              { headNum: 1, siteNum: 1, partFlg: PRR_PART_FLG.FAILED, hardBin: 3, softBin: 9, xCoord: 0, yCoord: 1 },
              { headNum: 1, siteNum: 2, partFlg: PRR_PART_FLG.FAILED, hardBin: 4, softBin: 7, xCoord: 1, yCoord: 1 },
              { headNum: 1, siteNum: 1, partFlg: PRR_PART_FLG.FAILED, hardBin: 4, softBin: 7, xCoord: 2, yCoord: 0 },
              { headNum: 1, siteNum: 2, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 2, yCoord: 1 },
            ],
          ],
          wrr: { headNum: 1, siteGrp: 1, finishT: 1_700_000_010, partCnt: 6, waferId: 'W01' },
        },
      ],
      mrr: { finishT: 1_700_000_020, dispCod: '0' },
    });

    const analysis = analyzeLotForReport(tieLot);
    const facts = buildEngineFacts(tieLot, analysis);
    const verdict = selectPrimaryVerdict(
      tieLot,
      analysis.primarySpatial,
      analysis.perWaferPatterns,
      analysis.siteAnomalies,
      analysis.yieldSummary,
    );
    const report = buildTemplateAutopsyReport(tieLot, facts, verdict);

    // SBIN 7 and SBIN 9 both have 2 fails -> lowest numeric code SBIN 7 wins
    expect(verdict.dominantBin?.mode).toBe('SBIN');
    expect(verdict.dominantBin?.code).toBe(7);
    expect(report.causeOfDeathHeadline.text).toContain(
      'most loss in SBIN 7 (LEAK_A).',
    );

    // SI display exponent checks (Req 1.8 & Req 17.4)
    expect(formatScaledParametricValue(8.5e-9, 'A', 9).displayValue).toBe('8.50 nA');
    expect(formatScaledParametricValue(15.0e-6, 'A', 6).displayValue).toBe('15.00 uA');
    expect(formatScaledParametricValue(0.0035, 'V', 3).displayValue).toBe('3.50 mV');
    expect(formatScaledParametricValue(2.4e9, 'Hz', -9).displayValue).toBe('2.40 GHz');
    expect(formatScaledParametricValue(2.5, 'Ohm', 0).displayValue).toBe('2.50 Ohm');
  });

  it('handles degenerate 4-die lots (missing coords -32768, failing die with SBIN marked P) and extreme scaled PTR limits (B-2)', () => {
    const degenLot = parseSpecToLotModel({
      endianness: 'big',
      mir: { lotId: 'DEGEN-4', partTyp: 'IC', jobNam: 'SORT' },
      hbrs: [
        { hbinNum: 1, hbinCnt: 3, hbinPf: 'P', hbinNam: 'PASS' },
        { hbinNum: 2, hbinCnt: 1, hbinPf: 'F', hbinNam: 'FAIL' },
      ],
      sbrs: [
        { sbinNum: 1, sbinCnt: 4, sbinPf: 'P', sbinNam: 'MISFLAGGED_PASS' },
      ],
      wafers: [
        {
          wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
          touchdowns: [
            [
              {
                headNum: 1,
                siteNum: 1,
                partFlg: PRR_PART_FLG.FAILED,
                hardBin: 2,
                softBin: 1,
                xCoord: -32768,
                yCoord: -32768,
                ptrs: [
                  {
                    testNum: 1,
                    testFlg: 0,
                    result: 1.4e-45,
                    testTxt: 'SUBNORM',
                    resScal: 9,
                    llmScal: 9,
                    hlmScal: 9,
                    loLimit: -999.9999,
                    hiLimit: 0,
                    units: 'A',
                  },
                ],
              },
              { headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 0 },
              { headNum: 1, siteNum: 2, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 1, yCoord: 0 },
              { headNum: 1, siteNum: 2, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 1 },
            ],
          ],
          wrr: { headNum: 1, siteGrp: 1, finishT: 1_700_000_010, partCnt: 4, waferId: 'W01' },
        },
      ],
      mrr: { finishT: 1_700_000_020, dispCod: '0' },
    });

    const degenRes = generateOfflineAutopsyReport(degenLot);
    expect(degenRes.verdict.dominantBin?.mode).toBe('SBIN');
    expect(degenRes.verdict.dominantBin?.code).toBe(1);
    assertProperty10ReportInvariants(degenLot, degenRes.facts, degenRes.report);
  });
});
