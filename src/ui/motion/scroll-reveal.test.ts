import { expect, it } from 'vitest';
import { shouldWaitForReveal } from './reveal';

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
