/**
 * Glossary entries and in-text term matching for the `Term` component
 * (`src/core/i18n/glossary.ts`, premium §2.3, §7.17, §9.5).
 *
 * Framework-free: the UI wraps the returned segments in `Term` buttons.
 */

import { t } from './dictionary';
import type { Locale } from './locales';

export const GLOSSARY_TERM_IDS = [
  'stdf',
  'lot',
  'wafer',
  'die',
  'yield',
  'firstTest',
  'retest',
  'bin',
  'hardBin',
  'softBin',
  'testSite',
  'cpk',
  'confidence',
  'limits',
] as const;

export type GlossaryTermId = (typeof GLOSSARY_TERM_IDS)[number];

export const GLOSSARY_PATTERN_IDS = [
  'center',
  'donut',
  'edgeLoc',
  'edgeRing',
  'loc',
  'nearFull',
  'random',
  'scratch',
  'none',
] as const;

export type GlossaryPatternId = (typeof GLOSSARY_PATTERN_IDS)[number];

/** At most 2 `Term`s per sentence (premium §7.17). */
export const MAX_TERMS_PER_TEXT = 2 as const;

export interface GlossaryEntry {
  /** Line 1 of the popover, and the word the term matches in running text. */
  readonly term: string;
  readonly definition: string;
}

export function resolveGlossaryEntry(
  locale: Locale,
  id: GlossaryTermId,
): GlossaryEntry {
  return {
    term: t(locale, `glossary.term.${id}`),
    definition: t(locale, `glossary.${id}`),
  };
}

const CJK_LOCALES: ReadonlySet<Locale> = new Set(['zh-CN', 'zh-TW', 'ja', 'ko']);

/**
 * Definition of a WM-811K class (premium §9.5): the shared `glossary.pattern` sentence, then the
 * class sentence. CJK sentences join without a space. The class name stays untranslated.
 */
export function resolvePatternDefinition(
  locale: Locale,
  id: GlossaryPatternId,
): string {
  const joiner = CJK_LOCALES.has(locale) ? '' : ' ';
  return `${t(locale, 'glossary.pattern')}${joiner}${t(locale, `glossary.pattern.${id}`)}`;
}

export interface GlossaryCandidate {
  readonly id: GlossaryTermId;
  readonly term: string;
}

export type GlossarySegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'term'; readonly id: GlossaryTermId; readonly value: string };

const WORD_CHAR = /[A-Za-z0-9_]/;
const LATIN_LETTER = /[A-Za-z]/;

function findTermRange(
  text: string,
  lowerText: string,
  term: string,
): { readonly start: number; readonly end: number } | null {
  const needle = term.toLowerCase();
  if (needle.length === 0) return null;
  const latinStart = WORD_CHAR.test(needle[0]!);
  const latinEnd = LATIN_LETTER.test(needle[needle.length - 1]!);
  let from = 0;
  while (from <= lowerText.length - needle.length) {
    const start = lowerText.indexOf(needle, from);
    if (start < 0) return null;
    const before = start > 0 ? text[start - 1]! : '';
    if (latinStart && before !== '' && WORD_CHAR.test(before)) {
      from = start + 1;
      continue;
    }
    let end = start + needle.length;
    // Latin terms match inflected forms ("die" covers "dies", "Bin" covers "bins")
    if (latinEnd) {
      while (end < text.length && LATIN_LETTER.test(text[end]!)) end += 1;
    }
    return { start, end };
  }
  return null;
}

/**
 * Splits `text` into plain and term segments. Each candidate matches its first occurrence
 * (case-insensitive; Latin terms only at a word start). Candidates are taken in priority order
 * and never overlap; at most `max` terms are returned.
 */
export function splitGlossaryTerms(
  text: string,
  candidates: readonly GlossaryCandidate[],
  max: number = MAX_TERMS_PER_TEXT,
): readonly GlossarySegment[] {
  if (text.length === 0) return [];
  const lowerText = text.toLowerCase();
  const picked: Array<{ start: number; end: number; id: GlossaryTermId }> = [];
  for (const candidate of candidates) {
    if (picked.length >= max) break;
    if (picked.some((p) => p.id === candidate.id)) continue;
    const range = findTermRange(text, lowerText, candidate.term);
    if (range === null) continue;
    const overlaps = picked.some(
      (p) => range.start < p.end && p.start < range.end,
    );
    if (overlaps) continue;
    picked.push({ ...range, id: candidate.id });
  }
  if (picked.length === 0) return [{ kind: 'text', value: text }];
  picked.sort((a, b) => a.start - b.start);
  const segments: GlossarySegment[] = [];
  let cursor = 0;
  for (const p of picked) {
    if (p.start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, p.start) });
    }
    segments.push({ kind: 'term', id: p.id, value: text.slice(p.start, p.end) });
    cursor = p.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }
  return segments;
}
