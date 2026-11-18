import { describe, expect, it } from 'vitest';
import {
  computeHintPlacement,
  HINT_DELAY_MS,
  HINT_OFFSET_PX,
  HINT_ORDER,
  HINT_TIMEOUT_MS,
  hintEnterOffset,
  hintsDisabledBySearch,
  nextPendingHint,
  parseDismissedHints,
  preferredHintSide,
  resolveHintRingMs,
  serializeDismissedHints,
} from './coach-marks';

const viewport = { width: 1440, height: 900 };
const bubble = { width: 280, height: 100 };

describe('coach-mark rules (premium §2.4, §7.18, §11.4)', () => {
  it('defines exactly three hints in display order with their delays and timeouts', () => {
    expect(HINT_ORDER).toEqual(['h-show', 'h-hover', 'h-strip']);
    expect(HINT_DELAY_MS).toEqual({ 'h-show': 800, 'h-hover': 600, 'h-strip': 600 });
    expect(HINT_TIMEOUT_MS).toEqual({ 'h-show': 12_000, 'h-hover': 10_000, 'h-strip': 10_000 });
  });

  it('persists dismissed ids as a JSON array and tolerates malformed storage', () => {
    expect([...parseDismissedHints(null)]).toEqual([]);
    expect([...parseDismissedHints('not json')]).toEqual([]);
    expect([...parseDismissedHints('{"a":1}')]).toEqual([]);
    expect([...parseDismissedHints('["h-strip","bogus","h-show"]')].sort()).toEqual([
      'h-show',
      'h-strip',
    ]);
    expect(serializeDismissedHints(new Set(['h-strip', 'h-show']))).toBe('["h-show","h-strip"]');
  });

  it('picks the first undismissed hint', () => {
    expect(nextPendingHint(new Set())).toBe('h-show');
    expect(nextPendingHint(new Set(['h-show']))).toBe('h-hover');
    expect(nextPendingHint(new Set(['h-show', 'h-hover', 'h-strip']))).toBeNull();
  });

  it('turns hints off only for ?nohints=1', () => {
    expect(hintsDisabledBySearch('?nohints=1')).toBe(true);
    expect(hintsDisabledBySearch('?a=b&nohints=1')).toBe(true);
    expect(hintsDisabledBySearch('?nohints=0')).toBe(false);
    expect(hintsDisabledBySearch('')).toBe(false);
  });

  it('shows the ring before the bubble: 2 x 1.2 s pulses, or a 2 s static ring', () => {
    expect(resolveHintRingMs(false)).toBe(2_400);
    expect(resolveHintRingMs(true)).toBe(2_000);
  });

  it('places h-show right of the button on desktop and below it on mobile', () => {
    expect(preferredHintSide('h-show', 1440)).toBe('right');
    expect(preferredHintSide('h-show', 390)).toBe('bottom');
    expect(preferredHintSide('h-hover', 1440)).toBe('top');
    expect(preferredHintSide('h-strip', 390)).toBe('top');
  });

  it('offsets the bubble 10 px from the anchor and centres the arrow on it', () => {
    const anchor = { top: 300, left: 800, width: 140, height: 40 };
    const placed = computeHintPlacement('right', anchor, bubble, viewport, 52);
    expect(placed).toEqual({
      side: 'right',
      left: 800 + 140 + HINT_OFFSET_PX,
      top: 320 - 50,
      arrowOffset: 50,
    });
  });

  it('flips to the opposite side when the preferred side does not fit', () => {
    const anchor = { top: 300, left: 1200, width: 140, height: 40 };
    const placed = computeHintPlacement('right', anchor, bubble, viewport, 52);
    expect(placed?.side).toBe('left');
    expect(placed!.left + bubble.width).toBe(1200 - HINT_OFFSET_PX);
  });

  it('flips a top hint below when the nav leaves no room above', () => {
    const anchor = { top: 120, left: 500, width: 40, height: 40 };
    const placed = computeHintPlacement('top', anchor, bubble, viewport, 52);
    expect(placed?.side).toBe('bottom');
    expect(placed!.top).toBe(160 + HINT_OFFSET_PX);
  });

  it('skips the hint (null) when neither side fits, so the anchor is never covered', () => {
    const anchor = { top: 100, left: 100, width: 600, height: 760 };
    expect(computeHintPlacement('top', anchor, bubble, viewport, 52)).toBeNull();
  });

  it('never overlaps the anchor in any accepted placement', () => {
    const anchors = [
      { top: 200, left: 40, width: 120, height: 40 },
      { top: 700, left: 1300, width: 40, height: 40 },
      { top: 80, left: 600, width: 300, height: 300 },
    ];
    for (const anchor of anchors) {
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const p = computeHintPlacement(side, anchor, bubble, viewport, 52);
        if (p === null) continue;
        const overlapX =
          p.left < anchor.left + anchor.width && p.left + bubble.width > anchor.left;
        const overlapY = p.top < anchor.top + anchor.height && p.top + bubble.height > anchor.top;
        expect(overlapX && overlapY).toBe(false);
        expect(p.top).toBeGreaterThanOrEqual(52);
        expect(p.left).toBeGreaterThanOrEqual(8);
        expect(p.left + bubble.width).toBeLessThanOrEqual(viewport.width - 8);
      }
    }
  });

  it('enters from 4 px away and moves toward the anchor', () => {
    expect(hintEnterOffset('right')).toEqual({ x: 4, y: 0 });
    expect(hintEnterOffset('top')).toEqual({ x: 0, y: -4 });
    expect(hintEnterOffset('bottom')).toEqual({ x: 0, y: 4 });
    expect(hintEnterOffset('left')).toEqual({ x: -4, y: 0 });
  });
});
