import { describe, expect, it } from 'vitest';
import {
  DISCLOSURE_CLOSE_MS,
  DISCLOSURE_REVEAL_DELAY_MS,
  DISCLOSURE_REVEAL_MAX_WAIT_MS,
  anyRectsIntersect,
  rectsIntersect,
  shouldStartDisclosureReveal,
} from './disclosure';

const box = (left: number, top: number, w: number, h: number) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('disclosure motion (premium §8.6)', () => {
  it('uses the §8.6 timings: 40 ms reveal delay, 100 ms close', () => {
    expect(DISCLOSURE_REVEAL_DELAY_MS).toBe(40);
    expect(DISCLOSURE_CLOSE_MS).toBe(100);
  });

  it('counts only boxes that share a positive area as overlapping', () => {
    expect(rectsIntersect(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    // Touching edges and sub-pixel slivers are not an overlap
    expect(rectsIntersect(box(0, 0, 10, 10), box(0, 10, 10, 10))).toBe(false);
    expect(rectsIntersect(box(0, 0, 10, 10), box(0, 9.7, 10, 10))).toBe(false);
    expect(rectsIntersect(box(0, 0, 10, 10), box(20, 0, 10, 10))).toBe(false);
    expect(
      anyRectsIntersect([box(0, 0, 10, 10)], [box(30, 0, 5, 5), box(8, 8, 5, 5)]),
    ).toBe(true);
    expect(anyRectsIntersect([], [box(0, 0, 10, 10)])).toBe(false);
  });

  it('starts the fade 40 ms after mount once the gliding siblings clear the new text', () => {
    expect(shouldStartDisclosureReveal(0, false)).toBe(false);
    expect(shouldStartDisclosureReveal(39, false)).toBe(false);
    expect(shouldStartDisclosureReveal(40, false)).toBe(true);
    // A sibling still over the new text holds the fade, so no two visible text boxes overlap
    expect(shouldStartDisclosureReveal(120, true)).toBe(false);
    // The glide has settled by the wait limit; the fade never waits longer
    expect(shouldStartDisclosureReveal(DISCLOSURE_REVEAL_MAX_WAIT_MS, true)).toBe(true);
  });
});
