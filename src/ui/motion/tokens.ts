/**
 * Motion tokens, spring physics parameters, and compositor-only transition resolvers
 * for Task 18 (`premium.md` §3.12, §8.1–§8.17, Requirements 1.11, 10.1, 14.5, 17.5).
 */

import {
  MOTION_TOKENS,
  SPRING_PHYSICS_EQUIVALENTS,
  SPRING_TOKENS,
} from '@/ui/tokens';

export { MOTION_TOKENS, SPRING_PHYSICS_EQUIVALENTS, SPRING_TOKENS };

/**
 * Optical-bench springs (UI plan §3.2.5). All three are critically damped (damping ratio >= 1),
 * so nothing overshoots; they differ only in weight.
 * - `SPRING_TACTILE`: keycaps, segmented thumbs, press release (~140 ms).
 * - `SPRING_MORPH`: a trigger growing into its dialog and back (~300 ms, has mass).
 * - `SPRING_SHELF`: drawers and staggered rows (~360 ms).
 */
export const SPRING_TACTILE = { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 } as const;
export const SPRING_MORPH = { type: 'spring', stiffness: 360, damping: 36, mass: 0.85 } as const;
export const SPRING_MORPH_RETURN = { type: 'spring', stiffness: 520, damping: 44, mass: 0.85 } as const;
export const SPRING_SHELF = { type: 'spring', stiffness: 300, damping: 34, mass: 0.9 } as const;

/**
 * UI v2 springs (plan §2.2.6). Lightly under-damped on purpose: these are the hand-feel
 * springs (tilt, magnetic pull, folder fan, odometer digits), where a small settle reads as mass.
 * They never drive layout and never run under reduced motion.
 * - `SPRING_BENTO_TILT`: card 3D tilt and hover lift (damping ratio ~0.88).
 * - `SPRING_MAGNETIC`: primary button follows the pointer by a few px (~0.73).
 * - `SPRING_FOLDER`: evidence folder cards fanning out (~0.69).
 * - `SPRING_ODOMETER`: sliding-number digit wheels (~0.87).
 */
export const SPRING_BENTO_TILT = { type: 'spring', stiffness: 320, damping: 28, mass: 0.8 } as const;
export const SPRING_MAGNETIC = { type: 'spring', stiffness: 420, damping: 30, mass: 1 } as const;
export const SPRING_FOLDER = { type: 'spring', stiffness: 360, damping: 26, mass: 1 } as const;
export const SPRING_ODOMETER = { type: 'spring', stiffness: 380, damping: 34, mass: 1 } as const;
export const SPRING_STAGE_3D = { type: 'spring', stiffness: 210, damping: 26, mass: 0.9 } as const;

/** Bento card tilt limits (plan §4 row 1): degrees, hover lift in px, perspective in px. */
export const BENTO_TILT_MAX_DEG = 4.5 as const;
export const SAMPLE_CARD_TILT_MAX_DEG = 4.5 as const;
export const BENTO_HOVER_LIFT_PX = -3 as const;
export const BENTO_PERSPECTIVE_PX = 1000 as const;
/** True 3D exploded instrument stage constants (v3: strictly capped at 4 deg). */
export const STAGE_3D_PERSPECTIVE_PX = 1400 as const;
// Hero stage sits flat (owner, 2026-11-26: the top-right hero cards must not be tilted).
export const STAGE_3D_MAX_TILT_DEG = 0 as const;
export const STAGE_3D_REST = {
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
} as const;
/** Primary CTA magnetic pull ceiling in px (plan §2.2.6). */
export const MAGNETIC_MAX_PX = 4 as const;

/** Shared-element `layoutId` bridging landing demo wafer -> ingest loading disc -> loaded stage. */
export const WAFER_MORPH_LAYOUT_ID = 'cal-wafer-disc-morph' as const;

/** Workspace `<LayoutGroup>` id coordinating shared wafer morphs across view switches. */
export const WORKSPACE_LAYOUT_GROUP_ID = 'cal-workspace-layout' as const;

/** Hard ceiling for landing -> report and lot-switcher view transitions (`< 450 ms`). */
export const VIEW_SWITCH_MAX_MS = 450 as const;

/** Hard ceiling for panel and disclosure springs (`<= 400 ms`). */
export const PANEL_SPRING_MAX_MS = 400 as const;

/** Total first-session reveal budget (`~3 s`, Requirement 1.11). */
export const PROBE_SWEEP_BUDGET_MS = 3000 as const;

/** Default cause-of-death headline type-on duration (`480 ms <= 1,500 ms`). */
export const TYPE_ON_DEFAULT_MS = 480 as const;

/** Hard ceiling for cause-of-death type-on reveal (`<= 1,500 ms`, Requirement 10.1, 17.5). */
export const TYPE_ON_MAX_MS = 1500 as const;

/** Hard ceiling for claim evidence light-up stagger (`420 ms` window + `180 ms` die fade = `600 ms`). */
export const EVIDENCE_STAGGER_MAX_MS = 600 as const;

/** Start-delay window across ordered evidence dies (`rank / (n - 1) * 420 ms`). */
export const EVIDENCE_STAGGER_WINDOW_MS = 420 as const;

/** Per-die evidence rim & bloom fade duration (`180 ms` `ease-out`). */
export const EVIDENCE_DIE_FADE_MS = 180 as const;

/** Vertical entry offset for panel rise-in blocks (`translateY(16px -> 0)`). */
export const PANEL_ENTER_OFFSET_Y_PX = 16 as const;

/** Initial scale for panel unfold enter motion (`scale(0.985 -> 1)`). */
export const PANEL_ENTER_SCALE = 0.985 as const;

/** Panel unfold enter transition duration (`420 ms`, ease-out). */
export const PANEL_ENTER_MS = 420 as const;

/** Sample-lot card hover lift (`translateY(-2px)` over `240 ms` `ease-out`). */
export const CARD_HOVER_LIFT_PX = -2 as const;

/** Wafer strip thumbnail hover scale (`scale(1.06)` over `160 ms` `ease-out`). */
export const THUMB_HOVER_SCALE = 1.06 as const;

/** Wafer strip non-evidence thumbnail opacity while evidence mode is active (`0.32`). */
export const THUMB_DIM_OPACITY = 0.32 as const;

export type PressScaleKind = keyof typeof MOTION_TOKENS.pressScale;

const INSTANT_TRANSITION = { duration: 0 } as const;

/**
 * Resolves the tactile `:active` / `pointerdown` scale factor for an interactive surface.
 * Under `prefers-reduced-motion: reduce`, returns `1` (no scale transform, `premium.md` §8.9, §8.16).
 */
export function resolvePressScale(
  kind: PressScaleKind,
  reducedMotion: boolean,
): number {
  if (reducedMotion) {
    return 1;
  }
  return MOTION_TOKENS.pressScale[kind];
}

/**
 * Resolves a critically-damped (`bounce: 0`) UI spring (`'ui'` or `'snappy'`), collapsing to
 * `{ duration: 0 }` when `reducedMotion` or `instant` (e.g. keyboard navigation) is true.
 */
export function resolveSpringTransition(
  kind: 'ui' | 'snappy',
  reducedMotion: boolean,
  instant = false,
): (typeof SPRING_TOKENS)['ui' | 'snappy'] | { readonly duration: 0 } {
  if (reducedMotion || instant) {
    return INSTANT_TRANSITION;
  }
  return SPRING_TOKENS[kind];
}

/**
 * Resolves the shared-element wafer morph transition (`spring-ui`, `duration: 0.35`, `bounce: 0`,
 * `< 450 ms`), collapsing to `{ duration: 0 }` under `prefers-reduced-motion: reduce`.
 */
export function resolveViewMorphTransition(
  reducedMotion: boolean,
): typeof SPRING_TOKENS.ui | { readonly duration: 0 } {
  if (reducedMotion) {
    return INSTANT_TRANSITION;
  }
  return SPRING_TOKENS.ui;
}

/**
 * Resolves compositor-only panel enter motion (`opacity`, `translateY`, `scale`).
 * Uses a `420 ms` ease-out unfold so four staggered panels settle without spring overshoot.
 * Under `prefers-reduced-motion: reduce`, disables mount translation and scale (`initial: false`, `duration: 0`).
 */
export function resolvePanelEnterMotion(
  reducedMotion: boolean,
  index = 0,
  staggerMs = 60,
): {
  readonly initial:
    | false
    | { readonly opacity: number; readonly y: number; readonly scale: number };
  readonly animate: { readonly opacity: 1; readonly y: 0; readonly scale: 1 };
  readonly transition: Record<string, unknown>;
} {
  if (reducedMotion) {
    return {
      initial: false,
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: INSTANT_TRANSITION,
    };
  }
  const safeIndex = Number.isFinite(index) ? Math.max(0, index) : 0;
  const safeStagger = Number.isFinite(staggerMs) ? Math.max(0, staggerMs) : 0;
  const delay = (safeIndex * safeStagger) / 1000;
  return {
    initial: {
      opacity: 0,
      y: PANEL_ENTER_OFFSET_Y_PX,
      scale: PANEL_ENTER_SCALE,
    },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: {
      duration: PANEL_ENTER_MS / 1000,
      ease: MOTION_TOKENS.easeOutTuple,
      delay,
    },
  };
}

/**
 * Resolves popover/menu enter & exit motion (`premium.md` §8.13):
 * - Pointer open: `opacity: 0 -> 1`, `scale(scaleFrom -> 1)` on `spring-ui`; exit `opacity -> 0` in `160 ms` (`dur-2`).
 * - Keyboard/instant open (`instant: true`): `0 ms` enter and exit with `scale: 1`.
 * - Reduced motion: `120 ms` (`dur-1`) opacity-only cross-fade with `scale: 1`.
 */
export function resolvePopoverMotion(options: {
  readonly reducedMotion: boolean;
  readonly instant?: boolean;
  readonly scaleFrom?: number;
}): {
  readonly initial: { readonly opacity: number; readonly scale: number };
  readonly animate: {
    readonly opacity: 1;
    readonly scale: 1;
    readonly transition: Record<string, unknown>;
  };
  readonly exit: {
    readonly opacity: 0;
    readonly transition: Record<string, unknown>;
  };
} {
  const { reducedMotion, instant = false, scaleFrom = 0.97 } = options;

  if (instant) {
    return {
      initial: { opacity: 1, scale: 1 },
      animate: { opacity: 1, scale: 1, transition: INSTANT_TRANSITION },
      exit: { opacity: 0, transition: INSTANT_TRANSITION },
    };
  }

  if (reducedMotion) {
    const fadeSec = MOTION_TOKENS.dur1Ms / 1000;
    return {
      initial: { opacity: 0, scale: 1 },
      animate: {
        opacity: 1,
        scale: 1,
        transition: { duration: fadeSec, ease: 'linear' },
      },
      exit: {
        opacity: 0,
        transition: { duration: fadeSec, ease: 'linear' },
      },
    };
  }

  return {
    initial: { opacity: 0, scale: scaleFrom },
    animate: {
      opacity: 1,
      scale: 1,
      transition: SPRING_TOKENS.ui,
    },
    exit: {
      opacity: 0,
      transition: {
        duration: MOTION_TOKENS.dur2Ms / 1000,
        ease: MOTION_TOKENS.easeOutTuple,
      },
    },
  };
}
