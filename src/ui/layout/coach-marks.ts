/**
 * Coach-mark rules (premium §2.4, §7.18, §8.10, §11.4): ids, order, timing, persistence, the
 * `?nohints=1` switch, and bubble placement. DOM-free so it runs in Node tests.
 */

export type HintId = 'h-show' | 'h-hover' | 'h-strip';

/** Display order; each hint waits for the previous one to be dismissed (§2.4). */
export const HINT_ORDER: readonly HintId[] = ['h-show', 'h-hover', 'h-strip'];

/** `localStorage` key holding a JSON array of dismissed hint ids (§2.4). */
export const HINTS_STORAGE_KEY = 'cal.hints.v1';

/** The verdict rise-in settles by ≈ 650 ms (§8.2: last block at 300 ms + `spring-ui` 350 ms). */
export const VERDICT_SETTLE_MS = 650;
/** Reduced motion: every verdict block fades in together over 120 ms (§8.2). */
export const VERDICT_SETTLE_REDUCED_MS = 120;

/** Delay after the trigger before each hint starts (§2.4). */
export const HINT_DELAY_MS: Readonly<Record<HintId, number>> = {
  'h-show': 800,
  'h-hover': 600,
  'h-strip': 600,
};

/** Auto-dismiss after the bubble has been visible this long (§2.4). */
export const HINT_TIMEOUT_MS: Readonly<Record<HintId, number>> = {
  'h-show': 12_000,
  'h-hover': 10_000,
  'h-strip': 10_000,
};

/** `h-hover` is used once a magnifier has been shown this long (§2.4). */
export const HINT_MAGNIFIER_USE_MS = 600;
/** Evidence ignite length; no hint enters during it (§8.3, §8.10). */
export const HINT_EVIDENCE_IGNITE_MS = 600;

/** Pulse ring (§11.4): 2 pulses of 1.2 s; reduced motion shows a static ring for 2 s. */
export const HINT_PULSE_MS = 1_200;
export const HINT_PULSE_COUNT = 2;
export const HINT_PULSE_SCALE = 1.06;
export const HINT_PULSE_OPACITY = 0.4;
export const HINT_STATIC_RING_MS = 2_000;

/** Time from hint start to the bubble fading in (the ring always comes first, A44). */
export function resolveHintRingMs(prefersReducedMotion: boolean): number {
  return prefersReducedMotion
    ? HINT_STATIC_RING_MS
    : HINT_PULSE_MS * HINT_PULSE_COUNT;
}

/** Container offset from the anchor, arrow size, and viewport margin (§7.18). */
export const HINT_OFFSET_PX = 10;
export const HINT_ARROW_WIDTH_PX = 12;
export const HINT_ARROW_DEPTH_PX = 6;
export const HINT_VIEWPORT_MARGIN_PX = 8;
/** Keeps the arrow clear of the container's 12 px corner radius. */
const HINT_ARROW_CORNER_INSET_PX = 12 + HINT_ARROW_WIDTH_PX / 2;

/** Reads the dismissed ids; anything malformed counts as none dismissed. */
export function parseDismissedHints(raw: string | null): Set<HintId> {
  const out = new Set<HintId>();
  if (raw === null) return out;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return out;
    for (const value of parsed) {
      if ((HINT_ORDER as readonly unknown[]).includes(value)) {
        out.add(value as HintId);
      }
    }
  } catch {
    // Malformed storage: treat as nothing dismissed
  }
  return out;
}

/** Serialises dismissed ids in display order. */
export function serializeDismissedHints(dismissed: ReadonlySet<HintId>): string {
  return JSON.stringify(HINT_ORDER.filter((id) => dismissed.has(id)));
}

/** `?nohints=1` turns every hint off (screenshot tests, §2.4). */
export function hintsDisabledBySearch(search: string): boolean {
  return new URLSearchParams(search).get('nohints') === '1';
}

/** First hint in order that is not dismissed, or `null` when all are done. */
export function nextPendingHint(dismissed: ReadonlySet<HintId>): HintId | null {
  return HINT_ORDER.find((id) => !dismissed.has(id)) ?? null;
}

export type HintSide = 'top' | 'bottom' | 'left' | 'right';

export interface HintRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface HintPlacement {
  readonly side: HintSide;
  readonly top: number;
  readonly left: number;
  /** Arrow centre along the container edge that faces the anchor, in container px. */
  readonly arrowOffset: number;
}

const OPPOSITE: Readonly<Record<HintSide, HintSide>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** Preferred side per hint (§2.4): `h-show` sits right of the button (below on mobile). */
export function preferredHintSide(id: HintId, viewportWidth: number): HintSide {
  if (id === 'h-show') return viewportWidth < 640 ? 'bottom' : 'right';
  return 'top';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function placeOnSide(
  side: HintSide,
  anchor: HintRect,
  bubble: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  topLimit: number,
): HintPlacement | null {
  const m = HINT_VIEWPORT_MARGIN_PX;
  const minTop = Math.max(m, topLimit);
  const maxBottom = viewport.height - m;
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;

  if (side === 'top' || side === 'bottom') {
    if (bubble.width > viewport.width - 2 * m) return null;
    const top =
      side === 'top'
        ? anchor.top - HINT_OFFSET_PX - bubble.height
        : anchor.top + anchor.height + HINT_OFFSET_PX;
    if (top < minTop || top + bubble.height > maxBottom) return null;
    const left = clamp(cx - bubble.width / 2, m, viewport.width - m - bubble.width);
    const arrowOffset = cx - left;
    if (
      arrowOffset < HINT_ARROW_CORNER_INSET_PX ||
      arrowOffset > bubble.width - HINT_ARROW_CORNER_INSET_PX
    ) {
      return null;
    }
    return { side, top, left, arrowOffset };
  }

  if (bubble.height > maxBottom - minTop) return null;
  const left =
    side === 'left'
      ? anchor.left - HINT_OFFSET_PX - bubble.width
      : anchor.left + anchor.width + HINT_OFFSET_PX;
  if (left < m || left + bubble.width > viewport.width - m) return null;
  const top = clamp(cy - bubble.height / 2, minTop, maxBottom - bubble.height);
  const arrowOffset = cy - top;
  if (
    arrowOffset < HINT_ARROW_CORNER_INSET_PX ||
    arrowOffset > bubble.height - HINT_ARROW_CORNER_INSET_PX
  ) {
    return null;
  }
  return { side, top, left, arrowOffset };
}

/**
 * Places the bubble on the preferred side, flips to the opposite side when it does not fit, and
 * returns `null` when neither fits (the hint is then skipped and marked dismissed, §7.18). The
 * bubble never covers its anchor: it sits `HINT_OFFSET_PX` outside the anchor's edge.
 */
export function computeHintPlacement(
  preferred: HintSide,
  anchor: HintRect,
  bubble: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  topLimit: number,
): HintPlacement | null {
  return (
    placeOnSide(preferred, anchor, bubble, viewport, topLimit) ??
    placeOnSide(OPPOSITE[preferred], anchor, bubble, viewport, topLimit)
  );
}

/** Enter offset: the bubble starts 4 px away from the anchor and moves toward it (§8.10). */
export function hintEnterOffset(side: HintSide): { readonly x: number; readonly y: number } {
  switch (side) {
    case 'top':
      return { x: 0, y: -4 };
    case 'bottom':
      return { x: 0, y: 4 };
    case 'left':
      return { x: -4, y: 0 };
    case 'right':
      return { x: 4, y: 0 };
  }
}
