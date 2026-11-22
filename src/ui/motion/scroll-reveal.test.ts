import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { shouldWaitForReveal } from './reveal';
import { ScrollReveal, useScrollReveal } from './scroll-reveal';

const below = { top: 800, viewportHeight: 800, alreadyRevealed: false, disabled: false, canObserve: true };

it('arms a fresh key only below the viewport', () => {
  expect(shouldWaitForReveal(below)).toBe(true);
  for (const top of [-200, 0, 799]) expect(shouldWaitForReveal({ ...below, top })).toBe(false);
});

it('settles seen keys, opt-outs and unsupported browsers', () => {
  for (const override of [{ alreadyRevealed: true }, { disabled: true }, { canObserve: false }]) {
    expect(shouldWaitForReveal({ ...below, ...override })).toBe(false);
  }
});

it('paints ScrollReveal at final identity state during SSR (JS off) and preserves useScrollReveal shape', () => {
  const html = renderToStaticMarkup(
    React.createElement(ScrollReveal, {
      replayKey: 'lot-1',
      'data-testid': 'panel-reveal',
      children: React.createElement('span', null, 'Panel body'),
    }),
  );
  expect(html).toContain('data-testid="panel-reveal"');
  expect(html).toContain('opacity:1');
  expect(html).not.toContain('opacity:0');
  expect(html).toContain('Panel body');

  let hookKeys: string[] = [];
  let hookRevealed = false;
  function HookProbe(): React.JSX.Element {
    const result = useScrollReveal({ replayKey: 'lot-1' });
    hookKeys = Object.keys(result).sort();
    hookRevealed = result.revealed;
    return React.createElement('div', { ref: result.ref });
  }
  renderToStaticMarkup(React.createElement(HookProbe));
  expect(hookKeys).toEqual(['ref', 'revealed']);
  expect(hookRevealed).toBe(true);
});
