import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Premium P33 source audit (premium.md §3.4, §8.9, §1.3): no `transition: all` or broad
 * colour transitions, transition lists only name the §8.9 properties, and DOM ember utilities
 * live only in the files that own an allowed use. The rendered counterpart is
 * `e2e/accent-hover-p33.spec.ts` (A3, A4).
 */

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__test-utils__') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

/** §8.9 (and §8 DOM rule): transform-family, opacity, and hover colours only. */
const ALLOWED_TRANSITION_PROPS = new Set([
  'transform',
  'translate',
  'scale',
  'rotate',
  'opacity',
  'background-color',
  'color',
  'text-decoration-color',
]);

/** Files that own an allowed ember use (premium §3.4, §11.1, §11.4, §12.2, §12.4). */
const EMBER_OWNERS = new Set([
  'app/globals.css', // token definitions, cause phrase, accent word, eyebrow dot
  'ui/report/VerdictHero.tsx', // verdict cause phrase (budgeted)
  'ui/primitives/accent-word.tsx', // the one italic accent word (§12.2)
  'ui/charts/BinParetoChart.tsx', // dominant bar (budgeted)
  'ui/wafer-map/BinLegend.tsx', // fail legend swatch (data key)
  'ui/wafer-map/HoverMagnifier.tsx', // magnifier swatch (data key)
  'ui/layout/EmptyStateCard.tsx', // landing example result and eyebrow dots (§11.1, §12.4)
  'ui/layout/CoachMarks.tsx', // hint target pulse ring (§11.4)
]);

describe('premium P33 accent and hover audit (source)', () => {
  it('has no transition: all and no broad transition-colors utility', () => {
    const offenders = FILES.filter(({ text }) =>
      /\btransition-all\b|\btransition-colors\b|transition(?:-property)?\s*:\s*all\b/.test(text),
    ).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it('names only §8.9 properties in arbitrary transition lists', () => {
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      for (const match of text.matchAll(/\btransition-\[([^\]]+)\]/g)) {
        for (const prop of match[1]!.split(',')) {
          if (!ALLOWED_TRANSITION_PROPS.has(prop.trim())) offenders.push(`${rel}: ${prop}`);
        }
      }
      if (!rel.endsWith('.css')) continue;
      for (const match of text.matchAll(/transition-property\s*:\s*([^;]+);/g)) {
        for (const prop of match[1]!.split(',')) {
          if (!ALLOWED_TRANSITION_PROPS.has(prop.trim())) offenders.push(`${rel}: ${prop}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses DOM ember utilities only in files that own an allowed use', () => {
    const offenders = FILES.filter(
      ({ rel, text }) =>
        !EMBER_OWNERS.has(rel) &&
        /\b(?:bg|text|border|fill|stroke|outline|ring|shadow|decoration|from|via|to)-ember(?:-mark|-ink)?\b|var\(--ember/.test(
          text,
        ),
    ).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
