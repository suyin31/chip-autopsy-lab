'use client';

import {
  animate,
  AnimatePresence,
  type AnimationPlaybackControls,
  motion,
  useIsPresent,
  useMotionValue,
  usePresence,
  useTransform,
} from 'motion/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { SPRING_MORPH, SPRING_MORPH_RETURN } from '@/ui/motion/tokens';
import { MOTION_TOKENS } from '@/ui/tokens';
import { cn } from './cn';

/**
 * Origin-anchored morphing dialog (UI plan §4 D, surprise #3). The idea comes from Motion
 * Primitives `MorphingDialog` (MIT, ibelick); this is a fresh implementation that works with
 * portals and `position: fixed`, which shared `layoutId` handles poorly:
 *
 * - On open, the trigger's viewport rect and the panel's rect are measured once. A surface layer
 *   (the glass) is then driven from the trigger's box to the panel's box by one spring
 *   (`SPRING_MORPH`) through `x / y / scaleX / scaleY`, with the corner radius counter-scaled
 *   every frame so the pill's ends stay round while it grows. Only the surface is scaled; the
 *   content rides the same centre, fades in over the last 20 % of the travel, and is never stretched.
 * - While open, the trigger is hidden (`data-morph-source="open"`) so the pill reads as having
 *   become the dialog. Closing (Escape, scrim, a command) runs the same path back on a faster
 *   spring (`SPRING_MORPH_RETURN`) and the pill reappears in the frame the surface lands on it.
 * - No origin (keyboard shortcut): opens and closes at 0 ms (premium §8 "Instant").
 * - Reduced motion: no travel or scale; a 120 ms opacity fade both ways.
 * - Re-opening mid-close reverses from the current value; nothing is queued.
 */

interface MorphGeometry {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  r0: number;
}

const REST_GEOMETRY: MorphGeometry = { dx: 0, dy: 0, sx: 1, sy: 1, r0: 0 };
const REDUCED_FADE = { duration: MOTION_TOKENS.dur1Ms / 1000, ease: 'linear' } as const;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function readCornerRadiusPx(el: HTMLElement, height: number): number {
  const raw = Number.parseFloat(window.getComputedStyle(el).borderTopLeftRadius);
  const radius = Number.isFinite(raw) ? raw : 0;
  return Math.min(radius, height / 2);
}

function measureGeometry(panel: HTMLElement, origin: HTMLElement): MorphGeometry | null {
  if (!origin.isConnected) return null;
  const p = panel.getBoundingClientRect();
  const o = origin.getBoundingClientRect();
  if (p.width <= 0 || p.height <= 0 || o.width <= 0 || o.height <= 0) return null;
  return {
    dx: o.left + o.width / 2 - (p.left + p.width / 2),
    dy: o.top + o.height / 2 - (p.top + p.height / 2),
    sx: o.width / p.width,
    sy: o.height / p.height,
    r0: readCornerRadiusPx(origin, o.height),
  };
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export interface MorphingPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Element the panel grows out of and returns to; `null` opens in place at 0 ms. */
  readonly origin: HTMLElement | null;
  /** Final corner radius of the surface in px (match `surfaceClassName`). */
  readonly radius?: number;
  /** Material of the surface layer (background, shadow, filter, radius class). */
  readonly surfaceClassName: string;
  /** Classes of the content layer above the surface (overflow, radius, layout). */
  readonly contentClassName?: string;
  readonly 'data-testid'?: string;
}

/**
 * The panel itself. Render it inside `AnimatePresence` so the return path can play before
 * unmount; it registers with presence and releases once the surface has landed on its origin.
 */
export const MorphingPanel = React.forwardRef<HTMLDivElement, MorphingPanelProps>(
  function MorphingPanel(
    { origin, radius = 24, surfaceClassName, contentClassName, className, children, ...props },
    forwardedRef,
  ) {
    const reduced = useReducedMotionPreference();
    const [isPresent, safeToRemove] = usePresence();
    const panelRef = React.useRef<HTMLDivElement | null>(null);
    const geometry = React.useRef<MorphGeometry>(REST_GEOMETRY);
    const controls = React.useRef<AnimationPlaybackControls | null>(null);
    const mounted = React.useRef(false);
    const morph = origin !== null && !reduced;

    const progress = useMotionValue(morph ? 0 : 1);
    const fade = useMotionValue(reduced ? 0 : 1);
    // Hidden until the first measurement so the unmeasured (full-size) surface never paints.
    const surfaceOpacity = useMotionValue(morph ? 0 : 1);

    const surfaceX = useTransform(progress, (p) => geometry.current.dx * (1 - p));
    const surfaceY = useTransform(progress, (p) => geometry.current.dy * (1 - p));
    const surfaceScaleX = useTransform(progress, (p) => lerp(geometry.current.sx, 1, p));
    const surfaceScaleY = useTransform(progress, (p) => lerp(geometry.current.sy, 1, p));
    const surfaceRadius = useTransform(progress, (p) => {
      const g = geometry.current;
      const r = lerp(g.r0, radius, p);
      const sx = Math.max(0.001, lerp(g.sx, 1, p));
      const sy = Math.max(0.001, lerp(g.sy, 1, p));
      return `${(r / sx).toFixed(2)}px / ${(r / sy).toFixed(2)}px`;
    });
    const contentOpacity = useTransform(progress, [0.8, 1], [0, 1]);
    const contentScale = useTransform(progress, [0, 1], [0.9, 1]);

    const setRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        panelRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    // Opening, closing, and re-opening mid-close all start from the current value.
    useIsomorphicLayoutEffect(() => {
      const panel = panelRef.current;
      const firstRun = !mounted.current;
      mounted.current = true;
      controls.current?.stop();

      const release = (): void => {
        if (origin) delete origin.dataset.morphSource;
        safeToRemove?.();
      };

      if (reduced) {
        const run = animate(fade, isPresent ? 1 : 0, REDUCED_FADE);
        controls.current = run;
        if (!isPresent) void run.then(release);
        return;
      }

      if (!morph || !panel || !origin) {
        progress.set(1);
        surfaceOpacity.set(1);
        if (!isPresent) release();
        return;
      }

      const measured = measureGeometry(panel, origin);
      if (!measured) {
        progress.set(1);
        surfaceOpacity.set(1);
        if (!isPresent) release();
        return;
      }
      geometry.current = measured;
      surfaceOpacity.set(1);

      if (isPresent) {
        origin.dataset.morphSource = 'open';
        // A value change is needed so the derived transforms pick up the measured geometry
        // before the first painted frame (setting 0 onto 0 would not notify).
        if (firstRun) progress.set(0.0001);
        controls.current = animate(progress, 1, SPRING_MORPH);
        return;
      }

      const run = animate(progress, 0, SPRING_MORPH_RETURN);
      controls.current = run;
      void run.then(release);
    }, [isPresent]);

    React.useEffect(
      () => () => {
        controls.current?.stop();
        if (origin) delete origin.dataset.morphSource;
      },
      [origin],
    );

    return (
      <motion.div
        ref={setRef}
        {...(props as React.ComponentProps<typeof motion.div>)}
        style={{ opacity: fade }}
        className={cn('relative', className)}
      >
        <motion.div
          aria-hidden="true"
          data-morph-surface=""
          className={cn('pointer-events-none absolute inset-0 origin-center', surfaceClassName)}
          style={{
            x: surfaceX,
            y: surfaceY,
            scaleX: surfaceScaleX,
            scaleY: surfaceScaleY,
            borderRadius: surfaceRadius,
            opacity: surfaceOpacity,
          }}
        />
        <motion.div
          className={cn('relative', contentClassName)}
          style={{ x: surfaceX, y: surfaceY, scale: contentScale, opacity: contentOpacity }}
        >
          {children}
        </motion.div>
      </motion.div>
    );
  },
);

export interface MorphingScrimProps {
  /** `true` when the dialog opened without an origin (keyboard): no fade either way. */
  readonly instant: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** Scrim that fades with the morph (`dur-3` in, `dur-2` out), or at 0 ms for keyboard opens. */
export function MorphingScrim({
  instant,
  onClick,
  className,
  'data-testid': testId,
}: MorphingScrimProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const enter = reduced
    ? REDUCED_FADE
    : { duration: MOTION_TOKENS.dur3Ms / 1000, ease: MOTION_TOKENS.easeOutTuple };
  const leave = reduced
    ? REDUCED_FADE
    : { duration: MOTION_TOKENS.dur2Ms / 1000, ease: MOTION_TOKENS.easeOutTuple };
  return (
    <motion.div
      aria-hidden="true"
      data-testid={testId}
      onClick={onClick}
      initial={instant && !reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1, transition: enter }}
      exit={{ opacity: 0, transition: instant && !reduced ? { duration: 0 } : leave }}
      className={className}
    />
  );
}

/** Fixed full-viewport layer that stops taking input the moment it starts to leave. */
export function MorphingLayer({
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const isPresent = useIsPresent();
  return (
    <div
      {...props}
      data-morph-layer={isPresent ? 'open' : 'closing'}
      className={cn('fixed inset-0', className)}
      style={isPresent ? style : { ...style, pointerEvents: 'none' }}
    />
  );
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function listFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

export interface MorphingDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Element the dialog grows out of; usually the `currentTarget` of the opening click. */
  readonly origin: HTMLElement | null;
  readonly titleId: string;
  readonly descriptionId?: string;
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Panel width classes; defaults to 560 px with a 16 px viewport margin. */
  readonly className?: string;
  readonly disablePortal?: boolean;
  readonly 'data-testid'?: string;
  readonly children: React.ReactNode;
}

/**
 * A complete modal on the morphing panel: scrim, `role="dialog"`, Tab focus trap, Escape and
 * scrim dismissal, focus return to the opener. The surface is floating glass (`--elev-dialog`).
 */
export function MorphingDialog({
  open,
  onClose,
  origin,
  titleId,
  descriptionId,
  initialFocusRef,
  className,
  disablePortal = false,
  'data-testid': testId,
  children,
}: MorphingDialogProps): React.JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const [isClientMounted, setIsClientMounted] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    setIsClientMounted(true);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return;
    previousFocusRef.current = (origin ?? document.activeElement) as HTMLElement | null;
    const focusTarget = (): void => {
      const preferred = initialFocusRef?.current;
      if (preferred && !preferred.hasAttribute('disabled')) {
        preferred.focus({ preventScroll: true });
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      const first = listFocusables(panel)[0];
      (first ?? panel).focus({ preventScroll: true });
    };
    focusTarget();
    return () => {
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        queueMicrotask(() => prev.focus({ preventScroll: true }));
      }
    };
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = listFocusables(panel);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (!active || active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  const tree = (
    <AnimatePresence>
      {open ? (
        <MorphingLayer
          key="morphing-dialog"
          onKeyDown={handleKeyDown}
          className="z-[var(--z-sheets)] flex items-center justify-center overscroll-contain p-4"
        >
          <MorphingScrim
            instant={origin === null}
            onClick={onClose}
            className="sheet-scrim-surface absolute inset-0"
          />
          <MorphingPanel
            ref={panelRef}
            origin={origin}
            radius={24}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            data-testid={testId}
            surfaceClassName="rounded-2xl bg-surface shadow-[var(--elev-dialog)]"
            contentClassName="max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain rounded-2xl p-6 sm:p-8"
            className={cn(
              'z-10 w-full max-w-[calc(100vw-32px)] text-text-primary outline-none',
              className ?? 'sm:w-[560px]',
            )}
          >
            {children}
          </MorphingPanel>
        </MorphingLayer>
      ) : null}
    </AnimatePresence>
  );

  if (disablePortal || !isClientMounted || typeof document === 'undefined') {
    return tree;
  }
  return createPortal(tree, document.body);
}
