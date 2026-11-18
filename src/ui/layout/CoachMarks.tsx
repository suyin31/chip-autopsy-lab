'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { StoreApi } from 'zustand';
import type { LotModel } from '@/core/model';
import { useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/primitives/cn';
import { MATERIAL_THICK_CLASS } from '@/ui/primitives/surfaces';
import type { SelectionStoreState } from '@/ui/state';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { readPrefersReducedMotionSync } from '@/ui/wafer-map/probe-sweep';
import {
  computeHintPlacement,
  HINT_ARROW_DEPTH_PX,
  HINT_ARROW_WIDTH_PX,
  HINT_DELAY_MS,
  HINT_EVIDENCE_IGNITE_MS,
  HINT_MAGNIFIER_USE_MS,
  HINT_PULSE_COUNT,
  HINT_PULSE_MS,
  HINT_PULSE_OPACITY,
  HINT_PULSE_SCALE,
  HINT_TIMEOUT_MS,
  HINTS_STORAGE_KEY,
  type HintId,
  type HintPlacement,
  type HintRect,
  hintEnterOffset,
  hintsDisabledBySearch,
  nextPendingHint,
  parseDismissedHints,
  preferredHintSide,
  resolveHintRingMs,
  serializeDismissedHints,
  VERDICT_SETTLE_MS,
  VERDICT_SETTLE_REDUCED_MS,
} from './coach-marks';

/** Hints never show while any of these is open (§2.4): sheet, menu, popover, drag overlay, sweep. */
const BLOCKING_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '[data-testid="term-popover"]',
  '[data-testid="wafer-selection-popover"][data-visible="true"]',
  '[data-testid="full-window-drop-overlay"]',
  '[data-sweep="running"]',
  '[data-sweep="ignite"]',
].join(', ');

const TICK_MS = 200;
/** The pulse ring sits 4–6 px outside the anchor, clear of the active thumbnail's ink ring. */
const RING_OUTSET_PX = 6;
const RING_BORDER_PX = 2;

interface ResolvedAnchor {
  readonly rect: HintRect;
  readonly radius: string;
}

type HintPhase = 'measure' | 'ring' | 'bubble';

interface ActiveHint {
  readonly id: HintId;
  readonly phase: HintPhase;
  readonly anchor: ResolvedAnchor;
  readonly placement: HintPlacement | null;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function toRect(r: DOMRect): HintRect {
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function resolveAnchor(id: HintId): ResolvedAnchor | null {
  if (typeof document === 'undefined') return null;
  if (id === 'h-show') {
    const el = document.querySelector<HTMLElement>('[data-testid="verdict-show-on-wafer"]');
    if (!el) return null;
    return { rect: toRect(el.getBoundingClientRect()), radius: '999px' };
  }
  if (id === 'h-hover') {
    const stage = document.querySelector<HTMLElement>('[data-testid="wafer-stage"]');
    if (!stage) return null;
    const box = stage.getBoundingClientRect();
    const diameter = Number(stage.dataset.waferDiameterPx);
    const cx = Number(stage.dataset.discCenterX ?? box.width / 2);
    const cy = Number(stage.dataset.discCenterY ?? box.height / 2);
    if (!Number.isFinite(diameter) || diameter <= 0) return null;
    return {
      rect: {
        top: box.top + cy - diameter / 2,
        left: box.left + cx - diameter / 2,
        width: diameter,
        height: diameter,
      },
      radius: '50%',
    };
  }
  const thumb = document.querySelector<HTMLElement>(
    '[data-testid="wafer-strip"] [role="option"][aria-selected="true"] [data-testid="wafer-strip-thumb-ring"]',
  );
  if (!thumb) return null;
  return { rect: toRect(thumb.getBoundingClientRect()), radius: '50%' };
}

/** The anchor's centre must be on screen below the nav before a hint can start. */
function anchorOnScreen(rect: HintRect, topLimit: number): boolean {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return cx >= 0 && cx <= window.innerWidth && cy >= topLimit && cy <= window.innerHeight;
}

function resolveTopLimit(): number {
  const nav = document.querySelector<HTMLElement>('[data-testid="nav-bar"]');
  return nav ? nav.getBoundingClientRect().bottom : 0;
}

function readDismissed(): Set<HintId> {
  try {
    return parseDismissedHints(window.localStorage.getItem(HINTS_STORAGE_KEY));
  } catch {
    return parseDismissedHints(null);
  }
}

function writeDismissed(dismissed: ReadonlySet<HintId>): void {
  try {
    window.localStorage.setItem(HINTS_STORAGE_KEY, serializeDismissedHints(dismissed));
  } catch {
    // Storage unavailable: hints still dismiss for this page
  }
}

export interface CoachMarksProps {
  readonly lot: LotModel;
  /** `true` once the verdict rise-in has started for `lot` (§8.2). */
  readonly verdictRevealed: boolean;
  readonly store: StoreApi<SelectionStoreState>;
}

/**
 * First-use hints (premium §2.4, §7.18, §8.10, §11.4). At most one is visible; each shows once
 * per browser (`localStorage["cal.hints.v1"]`), never under `?nohints=1`, and never while a
 * sheet, menu, popover, the drag overlay, the probe sweep, the verdict rise-in, or an evidence
 * ignite is active. Each hint first pulses a 2 px ember ring on its target twice (static for
 * 2 s under reduced motion), then the bubble fades in. Hints never take focus.
 */
export function CoachMarks({ lot, verdictRevealed, store }: CoachMarksProps): React.JSX.Element | null {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const prefersReduced = readPrefersReducedMotionSync(shouldReduceMotion);
  const prefersReducedRef = React.useRef(prefersReduced);
  prefersReducedRef.current = prefersReduced;

  const [enabled, setEnabled] = React.useState(false);
  const [active, setActiveState] = React.useState<ActiveHint | null>(null);
  const [touch, setTouch] = React.useState(false);
  const activeRef = React.useRef<ActiveHint | null>(null);
  const setActive = React.useCallback((next: ActiveHint | null): void => {
    activeRef.current = next;
    setActiveState(next);
  }, []);

  const dismissedRef = React.useRef<Set<HintId>>(new Set());
  const settledAtRef = React.useRef<number | null>(null);
  const eligibleAtRef = React.useRef<number | null>(null);
  const lastClaimChangeAtRef = React.useRef<number>(-Infinity);
  const magnifierSinceRef = React.useRef<number | null>(null);
  const phaseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  const bubbleSizeRef = React.useRef<{ width: number; height: number } | null>(null);
  const lotWaferCountRef = React.useRef(lot.wafers.length);
  lotWaferCountRef.current = lot.wafers.length;

  const clearPhaseTimer = React.useCallback((): void => {
    if (phaseTimerRef.current !== null) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  }, []);

  const dismiss = React.useCallback(
    (id: HintId): void => {
      const dismissed = dismissedRef.current;
      if (dismissed.has(id)) return;
      const wasCandidate = nextPendingHint(dismissed) === id;
      dismissed.add(id);
      writeDismissed(dismissed);
      if (activeRef.current?.id === id) {
        clearPhaseTimer();
        setActive(null);
      }
      if (!wasCandidate) return;
      const next = nextPendingHint(dismissed);
      eligibleAtRef.current =
        next !== null && settledAtRef.current !== null
          ? Math.max(now(), settledAtRef.current) + HINT_DELAY_MS[next]
          : null;
    },
    [clearPhaseTimer, setActive],
  );

  React.useEffect(() => {
    if (hintsDisabledBySearch(window.location.search)) return;
    dismissedRef.current = readDismissed();
    setTouch(window.matchMedia?.('(hover: none)').matches ?? false);
    setEnabled(true);
  }, []);

  // A new lot (or its verdict reveal) restarts the schedule; a visible hint hides without dismissal
  React.useEffect(() => {
    clearPhaseTimer();
    setActive(null);
    if (!verdictRevealed) {
      settledAtRef.current = null;
      eligibleAtRef.current = null;
      return;
    }
    const settledAt =
      now() + (prefersReducedRef.current ? VERDICT_SETTLE_REDUCED_MS : VERDICT_SETTLE_MS);
    settledAtRef.current = settledAt;
    const next = nextPendingHint(dismissedRef.current);
    eligibleAtRef.current = next !== null ? settledAt + HINT_DELAY_MS[next] : null;
  }, [lot, verdictRevealed, clearPhaseTimer, setActive]);

  // Actions that use a hint (§2.4): evidence for `h-show`, a user wafer change for `h-strip`
  React.useEffect(() => {
    if (!enabled) return;
    return store.subscribe((state, prev) => {
      const claimChanged = state.claimHighlight !== prev.claimHighlight;
      if (claimChanged) {
        lastClaimChangeAtRef.current = now();
        if (state.claimHighlight !== null) {
          dismiss('h-show');
        } else if (
          prev.claimHighlight !== null &&
          nextPendingHint(dismissedRef.current) === 'h-hover' &&
          activeRef.current === null
        ) {
          const at = now() + HINT_DELAY_MS['h-hover'];
          eligibleAtRef.current = Math.min(eligibleAtRef.current ?? Infinity, at);
        }
      }
      // Evidence may move to its target wafer in the same update; only a direct change counts
      if (
        state.lot === prev.lot &&
        state.activeWaferIndex !== prev.activeWaferIndex &&
        !claimChanged
      ) {
        dismiss('h-strip');
      }
    });
  }, [enabled, store, dismiss]);

  // Scheduler: starts the next hint when it is due and nothing blocks it
  React.useEffect(() => {
    if (!enabled) return;
    const tick = (): void => {
      const time = now();
      const magnifier = document.querySelector<HTMLElement>(
        '[data-testid="wafer-hover-magnifier"][data-visible="true"]',
      );
      if (magnifier) {
        magnifierSinceRef.current ??= time;
        if (time - magnifierSinceRef.current >= HINT_MAGNIFIER_USE_MS) dismiss('h-hover');
      } else {
        magnifierSinceRef.current = null;
      }

      const blocked =
        document.querySelector(BLOCKING_SELECTOR) !== null ||
        time - lastClaimChangeAtRef.current < HINT_EVIDENCE_IGNITE_MS;
      const current = activeRef.current;
      if (current !== null) {
        if (blocked) {
          // Hide without dismissing; it starts again once nothing blocks it
          clearPhaseTimer();
          setActive(null);
          eligibleAtRef.current = time;
        }
        return;
      }
      const candidate = nextPendingHint(dismissedRef.current);
      const eligibleAt = eligibleAtRef.current;
      if (candidate === null || eligibleAt === null || time < eligibleAt || blocked) return;
      // A one-wafer lot has no strip to point at; the hint waits for a multi-wafer lot
      if (candidate === 'h-strip' && lotWaferCountRef.current < 2) return;
      const anchor = resolveAnchor(candidate);
      if (anchor === null || !anchorOnScreen(anchor.rect, resolveTopLimit())) return;
      setActive({ id: candidate, phase: 'measure', anchor, placement: null });
    };
    const interval = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(interval);
      clearPhaseTimer();
    };
  }, [enabled, dismiss, clearPhaseTimer, setActive]);

  const place = React.useCallback((id: HintId): ActiveHint | null => {
    const bubble = bubbleSizeRef.current;
    const anchor = resolveAnchor(id);
    if (bubble === null || anchor === null) return null;
    const placement = computeHintPlacement(
      preferredHintSide(id, window.innerWidth),
      anchor.rect,
      bubble,
      { width: window.innerWidth, height: window.innerHeight },
      resolveTopLimit(),
    );
    return placement === null ? null : { id, phase: 'measure', anchor, placement };
  }, []);

  // Measure the hidden bubble, place it (flip, or skip when neither side fits), then run the ring
  React.useLayoutEffect(() => {
    if (active?.phase !== 'measure') return;
    const el = bubbleRef.current;
    bubbleSizeRef.current = el ? { width: el.offsetWidth, height: el.offsetHeight } : null;
    const placed = place(active.id);
    if (placed === null) {
      dismiss(active.id);
      return;
    }
    const id = active.id;
    setActive({ ...placed, phase: 'ring' });
    clearPhaseTimer();
    phaseTimerRef.current = setTimeout(() => {
      const cur = activeRef.current;
      if (cur?.id !== id) return;
      setActive({ ...cur, phase: 'bubble' });
      phaseTimerRef.current = setTimeout(() => dismiss(id), HINT_TIMEOUT_MS[id]);
    }, resolveHintRingMs(prefersReducedRef.current));
  }, [active, place, dismiss, clearPhaseTimer, setActive]);

  // Follow the anchor on scroll and resize
  const activeId = active?.id ?? null;
  React.useEffect(() => {
    if (activeId === null) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const cur = activeRef.current;
      if (cur === null || cur.phase === 'measure') return;
      const placed = place(cur.id);
      if (placed !== null) setActive({ ...placed, phase: cur.phase });
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [activeId, place, setActive]);

  // Esc dismisses the visible hint without moving focus (§7.18)
  React.useEffect(() => {
    if (activeId === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const cur = activeRef.current;
      if (cur !== null && cur.phase !== 'measure') dismiss(cur.id);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeId, dismiss]);

  if (!enabled || typeof document === 'undefined') return null;

  const text =
    active === null
      ? ''
      : active.id === 'h-show'
        ? t('hints.show')
        : active.id === 'h-hover'
          ? t(touch ? 'hints.hoverTouch' : 'hints.hover')
          : t('hints.strip', { count: formatInteger(lot.wafers.length) });

  const ring =
    active !== null && active.phase === 'ring' ? (
      <motion.div
        key={`ring-${active.id}`}
        aria-hidden="true"
        data-testid="coach-mark-ring"
        data-hint-id={active.id}
        data-pulse={prefersReduced ? 'static' : 'pulse'}
        className="pointer-events-none fixed z-[var(--z-hints)] border-ember border-solid"
        style={{
          top: active.anchor.rect.top - RING_OUTSET_PX,
          left: active.anchor.rect.left - RING_OUTSET_PX,
          width: active.anchor.rect.width + RING_OUTSET_PX * 2,
          height: active.anchor.rect.height + RING_OUTSET_PX * 2,
          borderWidth: RING_BORDER_PX,
          borderRadius: active.anchor.radius,
        }}
        initial={{ opacity: HINT_PULSE_OPACITY, scale: 1 }}
        animate={
          prefersReduced
            ? { opacity: HINT_PULSE_OPACITY, scale: 1 }
            : {
                opacity: [HINT_PULSE_OPACITY, 0],
                scale: [1, HINT_PULSE_SCALE],
                transition: {
                  duration: HINT_PULSE_MS / 1000,
                  ease: MOTION_TOKENS.easeOutTuple,
                  repeat: HINT_PULSE_COUNT - 1,
                },
              }
        }
        exit={{ opacity: 0, transition: { duration: MOTION_TOKENS.dur1Ms / 1000 } }}
      />
    ) : null;

  const placement = active?.placement ?? null;
  const shown = active?.phase === 'bubble' && placement !== null ? active : null;
  const offset = placement ? hintEnterOffset(placement.side) : { x: 0, y: 0 };

  const bubbleBody = (
    <>
      <p className="type-callout text-pretty text-text-primary">{text}</p>
      <div className="mt-2 flex justify-end">
        <Button
          variant="text"
          data-testid="coach-mark-got-it"
          className="text-text-primary"
          onClick={() => {
            const cur = activeRef.current;
            if (cur !== null) dismiss(cur.id);
          }}
        >
          {t('hints.gotIt')}
        </Button>
      </div>
    </>
  );

  const bubbleClass = cn(
    MATERIAL_THICK_CLASS,
    'fixed z-[var(--z-hints)] w-max max-w-[min(280px,calc(100vw-16px))] rounded-md pt-3 pr-3.5 pb-3 pl-4 text-left',
  );

  return createPortal(
    <>
      <AnimatePresence>{ring}</AnimatePresence>
      {/* Hidden measuring copy: sized like the real bubble, never visible or focusable */}
      {active !== null && active.phase === 'measure' ? (
        <div
          ref={bubbleRef}
          aria-hidden="true"
          className={bubbleClass}
          style={{ top: 0, left: 0, visibility: 'hidden' }}
        >
          {bubbleBody}
        </div>
      ) : null}
      <AnimatePresence>
        {shown !== null && placement !== null ? (
          <motion.div
            key={`bubble-${shown.id}`}
            ref={bubbleRef}
            role="status"
            aria-live="polite"
            data-testid="coach-mark"
            data-hint-id={shown.id}
            data-side={placement.side}
            className={bubbleClass}
            style={{ top: placement.top, left: placement.left }}
            initial={
              prefersReduced ? { opacity: 0 } : { opacity: 0, x: offset.x, y: offset.y }
            }
            animate={
              prefersReduced
                ? { opacity: 1, transition: { duration: MOTION_TOKENS.dur1Ms / 1000 } }
                : { opacity: 1, x: 0, y: 0, transition: SPRING_TOKENS.ui }
            }
            exit={{
              opacity: 0,
              transition: {
                duration: (prefersReduced ? MOTION_TOKENS.dur1Ms : MOTION_TOKENS.dur2Ms) / 1000,
                ease: MOTION_TOKENS.easeOutTuple,
              },
            }}
          >
            <HintArrow placement={placement} />
            {bubbleBody}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>,
    document.body,
  );
}

const ARROW_ROTATION: Readonly<Record<HintPlacement['side'], number>> = {
  top: 0,
  bottom: 180,
  right: 90,
  left: -90,
};

/** 12 x 6 triangle in the container colour with a 1 px `hairline` edge, touching the container. */
function HintArrow({ placement }: { readonly placement: HintPlacement }): React.JSX.Element {
  const w = HINT_ARROW_WIDTH_PX;
  const d = HINT_ARROW_DEPTH_PX;
  const { side, arrowOffset } = placement;
  // The SVG points down; rotate it about its centre and put that centre d/2 outside the edge
  const style: React.CSSProperties =
    side === 'top'
      ? { top: '100%', left: arrowOffset - w / 2 }
      : side === 'bottom'
        ? { top: -d, left: arrowOffset - w / 2 }
        : side === 'right'
          ? { left: -d / 2 - w / 2, top: arrowOffset - d / 2 }
          : { left: `calc(100% - ${w / 2 - d / 2}px)`, top: arrowOffset - d / 2 };
  return (
    <svg
      aria-hidden="true"
      data-testid="coach-mark-arrow"
      width={w}
      height={d}
      viewBox={`0 0 ${w} ${d}`}
      className="pointer-events-none absolute overflow-visible"
      style={{ ...style, transform: `rotate(${ARROW_ROTATION[side]}deg)` }}
    >
      <path d={`M0 0 L${w / 2} ${d} L${w} 0 Z`} fill="var(--material-thick)" />
      <path
        d={`M0 0 L${w / 2} ${d} L${w} 0`}
        fill="none"
        stroke="var(--hairline)"
        strokeWidth={1}
      />
    </svg>
  );
}
