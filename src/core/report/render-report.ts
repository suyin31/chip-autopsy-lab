/**
 * Deterministic per-locale `AutopsyReport` renderer (`src/core/report/render-report.ts`).
 *
 * Implements `redesign.md` §3.4, §4.3, §4.4, §4.6, §6.5, §6.6, and §6.9:
 * - Translates `ReportClaim.messageKey`, `subMessageKey`, and `params` into localized
 *   strings via `t`, `tPlural`, and cached `Intl` formatters in `format.ts`.
 * - Preserves untranslated technical tokens (`pattern`, `bin`, `test`, `wafer`) verbatim.
 * - Uses the LLM method description only for `en` (`redesign.md` §6.9); non-English
 *   locales render the deterministic template and report template provenance.
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 */

import {
  formatDecimal2,
  formatInteger,
  formatLocalizedParametricValue,
  formatPercent,
  type Locale,
  type MessageKey,
  t,
  tPlural,
} from '../i18n';
import { capDisplayedConfidence } from './engine-facts';
import type {
  AutopsyReport,
  ClaimParams,
  HypothesisTemplateId,
  ReportClaim,
  ReportHypothesisSpec,
} from './template-report';

export interface RenderedVerdictHero {
  readonly isHealthy: boolean;
  /** `"Cause of death:"` (`""` when `isHealthy === true`). */
  readonly prefix: string;
  /** `"Edge-Ring failure."` (`""` when `isHealthy === true`). */
  readonly cause: string;
  /** Combined full headline (`"Cause of death: Edge-Ring failure."` or `"No cause of death."`). */
  readonly fullHeadline: string;
  /** Plain-language takeaway (`"Most failing dies sit in the outer 3 rings of every wafer. Final yield is 82.8%."`, premium §9.3). */
  readonly subline: string;
  /** Untranslated tokens embedded in `cause` and `subline` for `<bdi translate="no">` wrapping in UI (§6.6). */
  readonly untranslatedTokens: Readonly<Record<string, string>>;
}

export interface RenderedConfidenceInfo {
  readonly confidenceValue: number;
  readonly level: 'high' | 'moderate' | 'low';
  /** `"High confidence, 0.95"` (premium §7.4). */
  readonly label: string;
  /** `"How this verdict was made"` */
  readonly methodTitle: string;
  /** `glossary.confidence` definition shown under the popover title. */
  readonly definition: string;
  /** `"Match with Edge-Ring"`; `null` when no WM-811K class backs the score (site and baseline verdicts). */
  readonly matchLabel: string | null;
  /** The untranslated class name inside `matchLabel` for `<bdi translate="no">` wrapping. */
  readonly matchPattern: string | null;
  /** Formatted 2-decimal confidence (`"0.95"`). */
  readonly valueText: string;
  /** Method explanation (`verdict.methodLlm` for `en` when `source === 'llm-verified'`, else `verdict.methodTemplate`). */
  readonly methodBody: string;
}

/** Kind of evidence behind a finding row; picks the row's kind icon (premium §7.6.2). */
export type FindingKind = 'pattern' | 'scratch' | 'site' | 'test' | 'bin';

export interface RenderedFindingRow {
  readonly claimId: string;
  readonly kind: FindingKind;
  readonly claim: ReportClaim;
  readonly headline: string;
  readonly subline: string;
  readonly dieCount: number;
  readonly dieCountLabel: string;
  /** Full detail sentence shown when the row is expanded (§3.5, §4.6). */
  readonly detailText: string;
  /** Up to 3 localized "Check next" steps when the claim's fact carries hypotheses (premium §7.6.4). */
  readonly checkNextSteps: readonly string[];
  /** Untranslated tokens (`bin`, `test`, `wafer`) for `<bdi translate="no">` wrapping in UI (§6.6). */
  readonly untranslatedTokens: Readonly<Record<string, string>>;
}

export interface RenderedHypothesisItem {
  readonly id: HypothesisTemplateId;
  readonly headline: string;
  readonly checkText: string;
}

export interface RenderedAutopsyReport {
  readonly locale: Locale;
  readonly verdict: RenderedVerdictHero;
  readonly confidence: RenderedConfidenceInfo;
  readonly findingsHeading: string;
  readonly clearLabel: string;
  readonly possibleCausesHeading: string;
  /** `"Check next"` label above the steps in an expanded finding (premium §7.6.4). */
  readonly checkNextLabel: string;
  /** First line of the open Possible causes disclosure (premium §7.6.5). */
  readonly causesNote: string;
  readonly findings: readonly RenderedFindingRow[];
  readonly hypotheses: readonly RenderedHypothesisItem[];
}

const decimal1Cache = new Map<Locale, Intl.NumberFormat>();

function formatDecimal1(locale: Locale, value: number): string {
  let fmt = decimal1Cache.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    decimal1Cache.set(locale, fmt);
  }
  if (!Number.isFinite(value)) {
    return fmt.format(0);
  }
  return fmt.format(Math.abs(value) < 1e-12 ? 0 : value);
}

function normalizeDisplayScalExp(units: string, scalExp: number): number {
  if (units.trim().length === 0 || !Number.isFinite(scalExp)) {
    return 0;
  }
  return Math.max(-12, Math.min(15, Math.round(scalExp / 3) * 3));
}

function formatSiteToken(locale: Locale, raw: string | number | undefined): string {
  if (raw === undefined) {
    return formatInteger(locale, 1);
  }
  return typeof raw === 'number' ? formatInteger(locale, raw) : String(raw);
}

function renderHeadlineAndSubline(
  report: AutopsyReport,
  locale: Locale,
): RenderedVerdictHero {
  const claim = report.causeOfDeathHeadline;
  const params = claim.params ?? {};
  const untranslated: Record<string, string> = {};

  let isHealthy = false;
  let prefix = '';
  let cause = '';
  let fullHeadline = '';

  switch (claim.messageKey) {
    case 'verdict.healthy': {
      isHealthy = true;
      fullHeadline = t(locale, 'verdict.healthy');
      break;
    }
    case 'verdict.pattern': {
      const pattern = String(params.pattern ?? 'Random');
      untranslated.pattern = pattern;
      prefix = t(locale, 'verdict.prefix');
      cause = t(locale, 'verdict.pattern', { pattern });
      break;
    }
    case 'verdict.site': {
      const siteStr = formatSiteToken(locale, params.site);
      untranslated.site = siteStr;
      prefix = t(locale, 'verdict.prefix');
      cause = t(locale, 'verdict.site', { site: siteStr });
      break;
    }
    default: {
      prefix = t(locale, 'verdict.prefix');
      cause = t(locale, 'verdict.random');
      break;
    }
  }

  if (!isHealthy) {
    const joiner = prefix.endsWith('：') ? '' : ' ';
    fullHeadline = `${prefix}${joiner}${cause}`;
  }

  const subline = renderTakeaway(report, locale, untranslated);

  return {
    isHealthy,
    prefix,
    cause,
    fullHeadline,
    subline,
    untranslatedTokens: untranslated,
  };
}

/**
 * Renders the plain-language takeaway under the verdict (premium §7.3, §9.3). It never
 * names bin codes, test names, or STDF fields; the site token is the only untranslated value.
 */
function renderTakeaway(
  report: AutopsyReport,
  locale: Locale,
  untranslated: Record<string, string>,
): string {
  const key = report.sublineKey;
  if (key === undefined) {
    return '';
  }
  const p = report.sublineParams ?? {};
  const yieldText = formatPercent(locale, Number(p.yield ?? 0));
  switch (key) {
    case 'takeaway.healthy':
      return t(locale, key, {
        passed: formatInteger(locale, Number(p.passed ?? 0)),
        total: formatInteger(locale, Number(p.total ?? 0)),
      });
    case 'takeaway.edgeRing':
      return t(locale, key, {
        rings: formatInteger(locale, Number(p.rings ?? 3)),
        yield: yieldText,
      });
    case 'takeaway.scratch':
      return t(locale, key, {
        count: formatInteger(locale, Number(p.count ?? 1)),
        total: formatInteger(locale, Number(p.total ?? 1)),
        yield: yieldText,
      });
    case 'takeaway.site': {
      const site = formatSiteToken(locale, p.site);
      untranslated.site = site;
      return t(locale, key, {
        site,
        rate: formatPercent(locale, Number(p.rate ?? 0)),
        otherRate: formatPercent(locale, Number(p.otherRate ?? 0)),
        yield: yieldText,
      });
    }
    default:
      return t(locale, key, { yield: yieldText });
  }
}

/** Confidence level words (premium §7.4): >= 0.85 high, 0.60–0.84 moderate, < 0.60 low, on the shown 2-decimal value. */
export function resolveConfidenceLevel(
  value: number,
): 'high' | 'moderate' | 'low' {
  const shown = Math.round(value * 100) / 100;
  if (shown >= 0.85) return 'high';
  if (shown >= 0.6) return 'moderate';
  return 'low';
}

function renderHypothesisSpec(
  spec: ReportHypothesisSpec,
  locale: Locale,
): RenderedHypothesisItem {
  const headline = t(locale, spec.titleKey);
  let checkText: string;
  if (spec.checkKey === 'hypothesis.probeCard.check') {
    checkText = t(locale, 'hypothesis.probeCard.check', {
      site: formatSiteToken(locale, spec.params.site),
    });
  } else {
    checkText = t(locale, spec.checkKey);
  }
  return {
    id: spec.id,
    headline,
    checkText,
  };
}

function renderFindingTexts(
  messageKey: MessageKey,
  subMessageKey: MessageKey | undefined,
  params: ClaimParams,
  locale: Locale,
): {
  readonly headline: string;
  readonly subline: string;
  readonly untranslatedTokens: Readonly<Record<string, string>>;
} {
  const untranslated: Record<string, string> = {};

  switch (messageKey) {
    case 'findings.edgeBand.headline': {
      const headline = t(locale, 'findings.edgeBand.headline', {
        rings: formatInteger(locale, Number(params.rings ?? 3)),
      });
      const subline =
        subMessageKey === 'findings.edgeBand.sub'
          ? t(locale, 'findings.edgeBand.sub', {
              edgeRate: formatPercent(locale, Number(params.edgeRate ?? 0)),
              interiorRate: formatPercent(
                locale,
                Number(params.interiorRate ?? 0),
              ),
              wafers: formatInteger(locale, Number(params.wafers ?? 1)),
              total: formatInteger(locale, Number(params.total ?? 1)),
            })
          : '';
      return { headline, subline, untranslatedTokens: untranslated };
    }

    case 'findings.scratch.headline': {
      const headline = t(locale, 'findings.scratch.headline', {
        wafers: formatInteger(locale, Number(params.wafers ?? 1)),
      });
      const subline =
        subMessageKey === 'findings.scratch.sub'
          ? t(locale, 'findings.scratch.sub', {
              dies: formatInteger(locale, Number(params.dies ?? 0)),
              share: formatPercent(locale, Number(params.share ?? 0)),
            })
          : '';
      return { headline, subline, untranslatedTokens: untranslated };
    }

    case 'findings.dominantBin.headline': {
      const bin = String(params.bin ?? '');
      untranslated.bin = bin;
      const headline = t(locale, 'findings.dominantBin.headline', {
        share: formatPercent(locale, Number(params.share ?? 0)),
      });
      const subline =
        subMessageKey === 'findings.dominantBin.sub'
          ? t(locale, 'findings.dominantBin.sub', {
              bin,
              dies: formatInteger(locale, Number(params.dies ?? 0)),
            })
          : '';
      return { headline, subline, untranslatedTokens: untranslated };
    }

    case 'findings.secondaryBin.headline': {
      const bin = String(params.bin ?? '');
      untranslated.bin = bin;
      const headline = t(locale, 'findings.secondaryBin.headline', {
        bin,
        share: formatPercent(locale, Number(params.share ?? 0)),
      });
      const subline =
        subMessageKey === 'findings.secondaryBin.sub'
          ? t(locale, 'findings.secondaryBin.sub', {
              dies: formatInteger(locale, Number(params.dies ?? 0)),
              wafers: formatInteger(locale, Number(params.wafers ?? 1)),
            })
          : '';
      return { headline, subline, untranslatedTokens: untranslated };
    }

    case 'findings.capability.headline': {
      // Premium §9.3: the title names the test in plain words; Cpk and limits live in the sub-line
      const testName = String(params.testName ?? '');
      const test =
        testName.length > 0
          ? testName
          : String(params.testNum ?? params.test ?? '0');
      untranslated.test = test;
      const unitToken = String(params.units ?? '').trim();
      const cpkValue = Number(params.cpk ?? 0);
      const kind = t(locale, resolveTestKindKey(unitToken, testName));
      const headline = t(
        locale,
        cpkValue < 1 ? 'findings.capability.headline' : 'findings.capability.close',
        { kind, test },
      );

      let subline = '';
      if (subMessageKey === 'findings.capability.sub') {
        const units = String(params.units ?? '');
        const resScal = Number(params.resScal ?? 0);
        const llmScal = Number(params.llmScal ?? 0);
        const hlmScal = Number(params.hlmScal ?? 0);
        const hasLo = Number(params.hasLo ?? 0) !== 0;
        const hasHi = Number(params.hasHi ?? 0) !== 0;
        const loBase = Number(params.lo ?? 0);
        const hiBase = Number(params.hi ?? 0);

        const meanStr = formatLocalizedParametricValue(
          locale,
          Number(params.mean ?? 0),
          units,
          resScal,
        );

        let loStr: string;
        let hiStr: string;

        if (hasLo && hasHi) {
          const effLo = normalizeDisplayScalExp(units, llmScal);
          const effHi = normalizeDisplayScalExp(units, hlmScal);
          hiStr = formatLocalizedParametricValue(locale, hiBase, units, hlmScal);
          if (effLo === effHi && units.trim().length > 0) {
            loStr = formatDecimal2(locale, loBase * Math.pow(10, effLo));
          } else {
            loStr = formatLocalizedParametricValue(locale, loBase, units, llmScal);
          }
        } else if (hasLo) {
          loStr = formatLocalizedParametricValue(locale, loBase, units, llmScal);
          hiStr = t(locale, 'selection.none');
        } else if (hasHi) {
          loStr = t(locale, 'selection.none');
          hiStr = formatLocalizedParametricValue(locale, hiBase, units, hlmScal);
        } else {
          loStr = t(locale, 'selection.none');
          hiStr = t(locale, 'selection.none');
        }

        subline = t(locale, 'findings.capability.sub', {
          cpk: formatDecimal2(locale, cpkValue),
          mean: meanStr,
          lo: loStr,
          hi: hiStr,
        });
      }

      return { headline, subline, untranslatedTokens: untranslated };
    }

    case 'findings.center.headline':
    case 'findings.donut.headline':
    case 'findings.edgeLoc.headline':
    case 'findings.loc.headline':
    case 'findings.nearFull.headline': {
      const headline = t(locale, messageKey);
      const subline =
        subMessageKey === 'findings.pattern.sub'
          ? t(locale, 'findings.pattern.sub', {
              dies: formatInteger(locale, Number(params.dies ?? 0)),
              share: formatPercent(locale, Number(params.share ?? 0)),
              wafers: formatInteger(locale, Number(params.wafers ?? 1)),
              total: formatInteger(locale, Number(params.total ?? 1)),
            })
          : '';
      return { headline, subline, untranslatedTokens: untranslated };
    }

    case 'findings.site.headline': {
      const siteStr = formatSiteToken(locale, params.site);
      untranslated.site = siteStr;
      const headline = t(locale, 'findings.site.headline', {
        site: siteStr,
        ratio: formatDecimal1(locale, Number(params.ratio ?? 1)),
      });
      const subline =
        subMessageKey === 'findings.site.sub'
          ? t(locale, 'findings.site.sub', {
              rate: formatPercent(locale, Number(params.rate ?? 0)),
              site: siteStr,
              other: formatPercent(locale, Number(params.other ?? 0)),
              retests: formatInteger(locale, Number(params.retests ?? 0)),
            })
          : '';
      return { headline, subline, untranslatedTokens: untranslated };
    }

    case 'findings.excursion.headline': {
      const wafer = String(params.wafer ?? 'W01');
      untranslated.wafer = wafer;
      const headline = t(locale, 'findings.excursion.headline', {
        wafer,
        yield: formatPercent(locale, Number(params.yield ?? 0)),
      });
      const subline =
        subMessageKey === 'findings.excursion.sub'
          ? t(locale, 'findings.excursion.sub', {
              delta: formatPercent(locale, Number(params.delta ?? 0)),
            })
          : '';
      return { headline, subline, untranslatedTokens: untranslated };
    }

    default: {
      const headline = t(locale, 'findings.lotYield.headline', {
        yield: formatPercent(locale, Number(params.yield ?? 0)),
      });
      const subline = t(locale, 'findings.lotYield.sub', {
        firstPass: formatPercent(locale, Number(params.firstPass ?? 0)),
        retests: formatInteger(locale, Number(params.retests ?? 0)),
      });
      return { headline, subline, untranslatedTokens: untranslated };
    }
  }
}

/** Plain-language test kind from the test unit and name (premium §9.3 `finding.test.title`). */
function resolveTestKindKey(
  units: string,
  testName: string,
):
  | 'findings.testKind.leakage'
  | 'findings.testKind.current'
  | 'findings.testKind.voltage'
  | 'findings.testKind.timing'
  | 'findings.testKind.frequency'
  | 'findings.testKind.generic' {
  if (units === 'A') {
    return testName.toUpperCase().startsWith('IDDQ')
      ? 'findings.testKind.leakage'
      : 'findings.testKind.current';
  }
  if (units === 'V') return 'findings.testKind.voltage';
  if (units === 's') return 'findings.testKind.timing';
  if (units === 'Hz') return 'findings.testKind.frequency';
  return 'findings.testKind.generic';
}

/** Kind icon per finding (premium §7.6.2): spatial pattern, scratch, test site, parametric test, or bin. */
export function resolveFindingKind(messageKey: MessageKey): FindingKind {
  switch (messageKey) {
    case 'findings.scratch.headline':
      return 'scratch';
    case 'findings.edgeBand.headline':
    case 'findings.center.headline':
    case 'findings.donut.headline':
    case 'findings.edgeLoc.headline':
    case 'findings.loc.headline':
    case 'findings.nearFull.headline':
    case 'findings.excursion.headline':
      return 'pattern';
    case 'findings.site.headline':
      return 'site';
    case 'findings.capability.headline':
      return 'test';
    default:
      return 'bin';
  }
}

function isQualitativeHypothesisClaim(claim: ReportClaim): boolean {
  return (
    claim.claimId === 'claim:root-cause-hypothesis' ||
    claim.messageKey.startsWith('hypothesis.') ||
    claim.text.startsWith('Candidate mechanism:')
  );
}

/**
 * Deterministically renders an `AutopsyReport` for `locale` (`redesign.md` §6.9).
 */
export function renderReport(
  report: AutopsyReport,
  locale: Locale,
): RenderedAutopsyReport {
  const verdict = renderHeadlineAndSubline(report, locale);

  const rawConfidence = report.confidence ?? 0.95;
  const cappedConfidence = capDisplayedConfidence(rawConfidence);
  const useLlmProvenance =
    report.source === 'llm-verified' && locale === 'en';

  const level = resolveConfidenceLevel(cappedConfidence);
  const valueText = formatDecimal2(locale, cappedConfidence);
  const matchPattern = report.matchPattern ?? null;
  const confidence: RenderedConfidenceInfo = {
    confidenceValue: cappedConfidence,
    level,
    label: t(locale, `confidence.${level}`, { value: valueText }),
    methodTitle: t(locale, 'verdict.methodTitle'),
    definition: t(locale, 'glossary.confidence'),
    matchLabel:
      matchPattern !== null
        ? t(locale, 'confidence.match', { pattern: matchPattern })
        : null,
    matchPattern,
    valueText,
    methodBody: useLlmProvenance
      ? t(locale, 'verdict.methodLlm')
      : t(locale, 'verdict.methodTemplate'),
  };

  const renderedHypotheses: RenderedHypothesisItem[] = (
    report.hypotheses ?? []
  ).map((spec) => renderHypothesisSpec(spec, locale));

  const findings: RenderedFindingRow[] = [];
  for (let i = 0; i < report.bodyClaims.length; i += 1) {
    const claim = report.bodyClaims[i]!;
    if (isQualitativeHypothesisClaim(claim)) {
      continue;
    }

    const { headline: templateHeadline, subline, untranslatedTokens } =
      renderFindingTexts(
        claim.messageKey,
        claim.subMessageKey,
        claim.params ?? {},
        locale,
      );

    const headline =
      useLlmProvenance && claim.text.trim().length > 0
        ? claim.text
        : templateHeadline;

    const dieCount = claim.resolvedDieIndices.length;
    const dieCountLabel = tPlural(locale, 'findings.dieCount', dieCount);

    // Strip any trailing " Candidate mechanism:..." clause from quantitative English detail
    const candIdx = claim.text.indexOf(' Candidate mechanism:');
    const cleanEnglishSentence =
      candIdx > 0 ? claim.text.slice(0, candIdx).trim() : claim.text;

    const detailText =
      locale === 'en'
        ? cleanEnglishSentence
        : subline.length > 0
          ? `${headline} — ${subline}`
          : headline;

    // Attach check-next steps to the primary finding when hypotheses exist (§4.6)
    const isPrimaryFinding =
      claim.claimId === 'claim:primary-evidence' || findings.length === 0;
    const checkNextSteps =
      isPrimaryFinding && renderedHypotheses.length > 0
        ? renderedHypotheses.slice(0, 3).map((h) => h.checkText)
        : [];

    findings.push({
      claimId: claim.claimId,
      kind: resolveFindingKind(claim.messageKey),
      claim,
      headline,
      subline,
      dieCount,
      dieCountLabel,
      detailText,
      checkNextSteps,
      untranslatedTokens,
    });
  }

  return {
    locale,
    verdict,
    confidence,
    findingsHeading: t(locale, 'findings.label'),
    clearLabel: t(locale, 'findings.clear'),
    possibleCausesHeading: t(locale, 'causes.label'),
    checkNextLabel: t(locale, 'findings.checkNext'),
    causesNote: t(locale, 'causes.note'),
    findings,
    hypotheses: renderedHypotheses,
  };
}
