import { describe, expect, it } from 'vitest';
import { t, type MessageKey } from './dictionary';
import {
  GLOSSARY_PATTERN_IDS,
  GLOSSARY_TERM_IDS,
  type GlossaryTermId,
  resolveGlossaryEntry,
  resolvePatternDefinition,
  splitGlossaryTerms,
} from './glossary';
import { isCjkLocale, SUPPORTED_LOCALES } from './locales';

const termsIn = (text: string) =>
  splitGlossaryTerms(text, GLOSSARY_TERM_IDS.map((id) => ({ id, term: resolveGlossaryEntry('en', id).term })), 9)
    .filter((s) => s.kind === 'term')
    .map((s) => s.value);

describe('glossary (premium §2.3, §7.17, §9.5)', () => {
  it('defines every term in all 5 locales within the length limits', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const limit = isCjkLocale(locale) ? 90 : 200;
      for (const id of GLOSSARY_TERM_IDS) {
        const entry = resolveGlossaryEntry(locale, id);
        expect(entry.term.length).toBeGreaterThan(0);
        expect(entry.definition.length).toBeGreaterThan(0);
        expect(entry.definition.length).toBeLessThanOrEqual(limit);
        expect(entry.definition).not.toMatch(/autopsy|body|dead|death|!/i);
      }
      for (const id of GLOSSARY_PATTERN_IDS) {
        expect(resolvePatternDefinition(locale, id).length).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('keeps the English definitions verbatim from §2.3', () => {
    expect(resolveGlossaryEntry('en', 'cpk')).toEqual({
      term: 'Cpk',
      definition:
        'How well a measurement fits inside its limits. Below 1.33 is a risk; below 1.0 means dies fall outside.',
    });
    expect(resolvePatternDefinition('en', 'edgeRing')).toBe(
      'A failure shape from the WM-811K wafer map taxonomy. Failures form a ring around the whole wafer edge.',
    );
    expect(resolvePatternDefinition('ja', 'edgeRing').startsWith(t('ja', 'glossary.pattern'))).toBe(true);
    expect(resolvePatternDefinition('ja', 'edgeRing')).not.toContain(' 不良');
  });

  it('matches at word starts, covers inflections, and never splits bin codes', () => {
    expect(termsIn('Dominant bin SBIN 7 accounts for 91% of fails')).toEqual(['bin']);
    expect(termsIn('dies failed, of 15,825 tested')).toEqual(['dies']);
    expect(termsIn('Test sites')).toEqual(['Test sites']);
    expect(termsIn('mean 10.22 uA, Cpk 0.14')).toEqual(['Cpk']);
    expect(termsIn('HBIN 3 and SBIN 7')).toEqual([]);
  });

  it('takes candidates in priority order, without overlap, and at most 2 by default', () => {
    const candidates = (['cpk', 'limits', 'bin'] as const).map((id) => ({
      id,
      term: resolveGlossaryEntry('en', id).term,
    }));
    const segments = splitGlossaryTerms('bin limits Cpk', candidates);
    expect(segments).toEqual([
      { kind: 'text', value: 'bin ' },
      { kind: 'term', id: 'limits', value: 'limits' },
      { kind: 'text', value: ' ' },
      { kind: 'term', id: 'cpk', value: 'Cpk' },
    ]);
    expect(splitGlossaryTerms('', candidates)).toEqual([]);
  });

  it('finds every §2.2 placement in every locale', () => {
    const placements: ReadonlyArray<readonly [MessageKey, GlossaryTermId]> = [
      ['mode.hardBins', 'hardBin'],
      ['mode.softBins', 'softBin'],
      ['confidence.high', 'confidence'],
      ['confidence.moderate', 'confidence'],
      ['confidence.low', 'confidence'],
      ['takeaway.edgeRing', 'yield'],
      ['takeaway.site', 'yield'],
      ['stats.failingDies', 'die'],
      ['stats.firstPass', 'firstTest'],
      ['pareto.chartLabel', 'bin'],
      ['yield.lot.firstPass', 'firstTest'],
      ['yield.lot.retests', 'retest'],
      ['yield.sites', 'testSite'],
    ];
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, id] of placements) {
        const text = t(locale, key, {} as never);
        const segments = splitGlossaryTerms(text, [
          { id, term: resolveGlossaryEntry(locale, id).term },
        ]);
        expect(
          segments.some((s) => s.kind === 'term' && s.id === id),
          `${locale} ${key} should contain ${id}`,
        ).toBe(true);
      }
    }
  });
});
