import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listDemoPresets } from '@/core/demo';
import { I18nProvider } from '@/ui/i18n';
import { EmptyStateCard } from './EmptyStateCard';

function renderLanding(
  cause: 'first-run' | 'parse-failed' | 'no-results',
): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: 'en' },
      React.createElement(EmptyStateCard, {
        cause,
        presets: listDemoPresets(),
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
        ...(cause === 'parse-failed'
          ? {
              parseError: {
                fileName: 'bad.bin',
                error: {
                  code: 'EMPTY_INPUT' as const,
                  message: 'empty',
                  byteOffset: 0,
                },
              },
            }
          : {}),
      }),
    ),
  );
}

describe('Task B landing hero ambient, sample-card stagger, and hero press', () => {
  it('mounts landing-hero-ambient only on first-run with aria-hidden, pointer-events-none, and three layers', () => {
    const firstRunHtml = renderLanding('first-run');
    expect(firstRunHtml).toContain(
      'aria-hidden="true" data-testid="landing-hero-ambient" class="landing-ambient pointer-events-none"',
    );
    expect(firstRunHtml).toContain('class="landing-ambient-wash"');
    expect(firstRunHtml).toContain('class="landing-ambient-grid"');
    expect(firstRunHtml).toContain('class="landing-ambient-grain"');

    const parseFailedHtml = renderLanding('parse-failed');
    expect(parseFailedHtml).not.toContain('landing-hero-ambient');

    const noResultsHtml = renderLanding('no-results');
    expect(noResultsHtml).not.toContain('landing-hero-ambient');
  });

  it('keeps demo-card buttons as direct children of landing-demo-cards and visible by default on SSR', () => {
    const html = renderLanding('first-run');
    const cardsBlockMatch = html.match(
      /data-testid="landing-demo-cards"[^>]*>(.*?)<\/section>/,
    );
    expect(cardsBlockMatch).not.toBeNull();
    const cardsMarkup = cardsBlockMatch![1]!;
    // First child immediately after the landing-demo-cards opening tag is the <button> (no wrapper div)
    expect(cardsMarkup.startsWith('<button ')).toBe(true);
    expect(cardsMarkup.match(/data-testid="demo-card-/g)).toHaveLength(3);
    // Visible by default (no inline opacity:0 or hidden transform baked into SSR)
    expect(cardsMarkup).not.toContain('opacity:0');
    expect(cardsMarkup).not.toContain('translateY(10px)');
  });

  it('defines reduced-motion, reduced-transparency, pause, and zero-ember ambient rules in globals.css', () => {
    const css = readFileSync(
      path.resolve(__dirname, '../../app/globals.css'),
      'utf8',
    );
    const ambientStart = css.indexOf('.landing-ambient {');
    expect(ambientStart).toBeGreaterThan(-1);
    const ambientCss = css.slice(ambientStart);

    expect(ambientCss).not.toMatch(/ember/i);
    expect(ambientCss).toContain('contain: paint;');
    expect(ambientCss).toContain('z-index: -1;');
    expect(ambientCss).toContain('background-size: 24px 24px;');
    expect(ambientCss).toContain('var(--hairline-strong)');
    expect(ambientCss).toContain('feTurbulence');
    expect(ambientCss).toContain('steps(4, end)');
    expect(ambientCss).toContain('hero-daylight-drift 18s');
    expect(ambientCss).toContain('[data-ambient-paused="true"]');
    expect(ambientCss).toContain(
      '@media (prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce)',
    );
    expect(ambientCss).toContain('display: none;');
    expect(ambientCss).toContain('animation: none;');
  });
});
