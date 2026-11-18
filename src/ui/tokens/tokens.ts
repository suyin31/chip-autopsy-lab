/**
 * Typography, spacing, layout grid, concentric radii, blur, z-layer,
 * and motion tokens. Typography follows `premium.md` §4.2–§4.3; spacing, radii,
 * z-layers, and motion follow `premium.md` §3.9–§3.12.
 */

export interface TypeRoleSpec {
  readonly sizePx: number;
  readonly lineHeight: number;
  readonly weight: 300 | 400 | 500 | 590 | 600;
  readonly trackingEm: number;
  readonly opsz?: 32;
  readonly mono?: true;
}

export interface ResponsiveTypeToken {
  readonly desktop: TypeRoleSpec;
  readonly mobile: TypeRoleSpec;
  readonly tabularNums: boolean;
}

/** Allowed font weights across the entire UI (redesign.md §2.2: never >= 700). */
export const ALLOWED_FONT_WEIGHTS = [300, 400, 500, 590, 600] as const;

export const HEADING_WEIGHT_BOUNDS = {
  statLight: 300,
  regular: 400,
  min: 500,
  default: 590,
  max: 600,
  forbiddenBoldMin: 700,
} as const;

/** Type styles from `premium.md` §4.2 (desktop >= 640 px, mobile < 640 px). */
export const TYPOGRAPHY_TOKENS = {
  displayXl: {
    desktop: {
      sizePx: 80,
      lineHeight: 1.04,
      weight: 600,
      trackingEm: -0.035,
      opsz: 32,
    },
    mobile: {
      sizePx: 48,
      lineHeight: 1.06,
      weight: 600,
      trackingEm: -0.03,
      opsz: 32,
    },
    tabularNums: false,
  },
  displayL: {
    desktop: {
      sizePx: 48,
      lineHeight: 1.08,
      weight: 600,
      trackingEm: -0.024,
      opsz: 32,
    },
    mobile: {
      sizePx: 32,
      lineHeight: 1.12,
      weight: 600,
      trackingEm: -0.02,
      opsz: 32,
    },
    tabularNums: false,
  },
  title1: {
    desktop: {
      sizePx: 34,
      lineHeight: 1.12,
      weight: 600,
      trackingEm: -0.02,
      opsz: 32,
    },
    mobile: {
      sizePx: 28,
      lineHeight: 1.14,
      weight: 600,
      trackingEm: -0.018,
      opsz: 32,
    },
    tabularNums: false,
  },
  title2: {
    desktop: {
      sizePx: 24,
      lineHeight: 1.2,
      weight: 600,
      trackingEm: -0.016,
      opsz: 32,
    },
    mobile: {
      sizePx: 21,
      lineHeight: 1.24,
      weight: 600,
      trackingEm: -0.012,
      opsz: 32,
    },
    tabularNums: false,
  },
  title3: {
    desktop: {
      sizePx: 21,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: -0.01,
    },
    mobile: {
      sizePx: 17,
      lineHeight: 1.41,
      weight: 400,
      trackingEm: -0.006,
    },
    tabularNums: false,
  },
  stat: {
    desktop: {
      sizePx: 40,
      lineHeight: 1,
      weight: 300,
      trackingEm: -0.022,
      opsz: 32,
    },
    mobile: {
      sizePx: 28,
      lineHeight: 1,
      weight: 300,
      trackingEm: -0.016,
      opsz: 32,
    },
    tabularNums: true,
  },
  statS: {
    desktop: {
      sizePx: 28,
      lineHeight: 1,
      weight: 300,
      trackingEm: -0.016,
      opsz: 32,
    },
    mobile: {
      sizePx: 24,
      lineHeight: 1,
      weight: 300,
      trackingEm: -0.012,
      opsz: 32,
    },
    tabularNums: true,
  },
  headline: {
    desktop: {
      sizePx: 17,
      lineHeight: 1.29,
      weight: 590,
      trackingEm: -0.012,
    },
    mobile: {
      sizePx: 16,
      lineHeight: 1.31,
      weight: 590,
      trackingEm: -0.01,
    },
    tabularNums: true,
  },
  body: {
    desktop: {
      sizePx: 17,
      lineHeight: 1.47,
      weight: 400,
      trackingEm: -0.012,
    },
    mobile: {
      sizePx: 15,
      lineHeight: 1.47,
      weight: 400,
      trackingEm: -0.006,
    },
    tabularNums: true,
  },
  rowTitle: {
    desktop: {
      sizePx: 15,
      lineHeight: 1.33,
      weight: 590,
      trackingEm: -0.008,
    },
    mobile: {
      sizePx: 15,
      lineHeight: 1.33,
      weight: 590,
      trackingEm: -0.008,
    },
    tabularNums: true,
  },
  callout: {
    desktop: {
      sizePx: 15,
      lineHeight: 1.4,
      weight: 400,
      trackingEm: -0.006,
    },
    mobile: {
      sizePx: 15,
      lineHeight: 1.4,
      weight: 400,
      trackingEm: -0.006,
    },
    tabularNums: true,
  },
  control: {
    desktop: {
      sizePx: 14,
      lineHeight: 1.29,
      weight: 500,
      trackingEm: -0.006,
    },
    mobile: {
      sizePx: 14,
      lineHeight: 1.29,
      weight: 500,
      trackingEm: -0.006,
    },
    tabularNums: true,
  },
  subhead: {
    desktop: {
      sizePx: 13,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: -0.003,
    },
    mobile: {
      sizePx: 13,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: -0.003,
    },
    tabularNums: true,
  },
  caption: {
    desktop: {
      sizePx: 12,
      lineHeight: 1.33,
      weight: 500,
      trackingEm: 0,
    },
    mobile: {
      sizePx: 12,
      lineHeight: 1.33,
      weight: 500,
      trackingEm: 0,
    },
    tabularNums: true,
  },
  monoData: {
    desktop: {
      sizePx: 13,
      lineHeight: 1.45,
      weight: 400,
      trackingEm: 0,
      mono: true,
    },
    mobile: {
      sizePx: 13,
      lineHeight: 1.45,
      weight: 400,
      trackingEm: 0,
      mono: true,
    },
    tabularNums: true,
  },
} as const satisfies Record<string, ResponsiveTypeToken>;

/** Desktop steps below 1440 px (`premium.md` §4.2, stat 36 at 1280 from §6.2): applied at max-width 1439 / 1279 px. */
export const TYPOGRAPHY_DESKTOP_STEPS_PX = {
  displayL: { 1280: 44, 1024: 36 },
  stat: { 1280: 36, 1024: 32 },
} as const;

/** Desktop (>= 1440 px) pixel sizes indexed by role (`premium.md` §4.2). */
export const TYPOGRAPHY_SCALE_PX = {
  caption: 12,
  subhead: 13,
  monoData: 13,
  control: 14,
  rowTitle: 15,
  callout: 15,
  headline: 17,
  body: 17,
  title3: 21,
  title2: 24,
  statS: 28,
  title1: 34,
  stat: 40,
  displayL: 48,
  displayXl: 80,
} as const;

/** CJK locale typography (`premium.md` §4.3): zero tracking on every token. */
export const CJK_TYPOGRAPHY_OVERRIDES = {
  trackingEm: 0,
  displayXlDesktopPx: 64,
  displayXlMobilePx: 40,
  displayLDesktopPx: 44,
  displayLMobilePx: 30,
  displayLStepsPx: { 1280: 40, 1024: 32 },
  lineHeight: {
    displayXl: 1.2,
    displayL: 1.25,
    title: 1.35,
    headline: 1.4,
    rowTitle: 1.4,
    body: 1.7,
    callout: 1.7,
    subhead: 1.55,
    caption: 1.55,
  },
  lineBreakStrict: ["zh-CN", "zh-TW", "ja"],
  wordBreakKeepAll: ["ko"],
} as const;

/** Spacing scale in CSS px (`premium.md` §3.10). */
export const SPACING_SCALE_PX = [
  2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 96, 128,
] as const;

/** Compatibility alias for `SPACING_SCALE_PX`. */
export const SPACING_GRID_PX = SPACING_SCALE_PX;

/** Reference viewport layout grid and minimum interactive hit targets (`redesign.md` §2.3). */
export const LAYOUT_GRID = {
  desktop: {
    columns: 12,
    gutterPx: 24,
    marginPx: 40,
    maxContentWidthPx: 1360,
  },
  mobile: {
    columns: 4,
    gutterPx: 12,
    marginPx: 16,
    contentWidthPx: 358,
  },
  hitTargetMinPx: {
    desktop: 40,
    mobile: 44,
  },
  /** Per-breakpoint grids (`premium.md` §3.10); `maxContentPx: null` = fluid. */
  breakpoints: {
    xl: {
      minPx: 1440,
      columns: 12,
      gutterPx: 24,
      marginPx: 40,
      maxContentPx: 1360,
    },
    lg: {
      minPx: 1280,
      columns: 12,
      gutterPx: 24,
      marginPx: 40,
      maxContentPx: 1200,
    },
    md: {
      minPx: 1024,
      columns: 8,
      gutterPx: 20,
      marginPx: 32,
      maxContentPx: null,
    },
    sm: {
      minPx: 640,
      columns: 1,
      gutterPx: 0,
      marginPx: 32,
      maxContentPx: 640,
    },
    xs: {
      minPx: 0,
      columns: 4,
      gutterPx: 12,
      marginPx: 16,
      maxContentPx: null,
    },
  },
} as const;

/**
 * Concentric border radii in CSS px (`premium.md` §3.9, tokens `r-xs` .. `r-pill`).
 * Rule: inner radius = outer radius - padding whenever the padding is <= 24 px.
 */
export const RADIUS_TOKENS_PX = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  pill: 999,
} as const;

/** Material backdrop-filter and animated blur bounds (`redesign.md` §2.4). */
export const BLUR_TOKENS_PX = {
  material: 24,
  heavy: 32,
  animatedMax: 8,
} as const;

/** Compatibility alias for blur bounds (`redesign.md` §2.4). */
export const OVERLAY_BLUR_BOUNDS_PX = {
  min: 24,
  default: 24,
  max: 32,
  animatedMax: 8,
} as const;

/** Explicit z-index stacking layers (`redesign.md` §2.5 plus `premium.md` §3.11). */
export const Z_LAYERS = {
  content: 0,
  canvasBase: 1,
  canvasFail: 2,
  canvasOverlay: 3,
  stageHud: 10,
  magnifier: 20,
  selectionPopover: 30,
  hints: 35,
  nav: 40,
  menus: 50,
  tooltips: 55,
  sheets: 60,
  toasts: 70,
  dragOverlay: 80,
} as const;

/**
 * Spring parameters for Motion and the custom rAF integrators (`premium.md` §3.12).
 * UI springs are duration-based with `bounce: 0`; no UI spring ever bounces.
 */
export const SPRING_TOKENS = {
  ui: {
    type: "spring",
    duration: 0.35,
    bounce: 0,
  },
  snappy: {
    type: "spring",
    duration: 0.22,
    bounce: 0,
  },
  camera: {
    stiffness: 170,
    damping: 26,
    mass: 1,
  },
  throw: {
    stiffness: 260,
    damping: 22,
    mass: 1,
  },
  sheen: {
    stiffness: 120,
    damping: 22,
    mass: 1,
  },
} as const;

/**
 * Mass-spring equivalents of the duration-based UI springs for own rAF integrators
 * (critically damped). `ui` is the premium.md §3.12 value; `snappy` scales the same
 * natural frequency by 0.35 / 0.22.
 */
export const SPRING_PHYSICS_EQUIVALENTS = {
  ui: { stiffness: 320, damping: 36, mass: 1 },
  snappy: { stiffness: 810, damping: 57, mass: 1 },
} as const;

/** Complete motion token suite (`premium.md` §3.12; reveal ceilings from `redesign.md` §5). */
export const MOTION_TOKENS = {
  springUi: SPRING_TOKENS.ui,
  springSnappy: SPRING_TOKENS.snappy,
  springCamera: SPRING_TOKENS.camera,
  springThrow: SPRING_TOKENS.throw,
  springSheen: SPRING_TOKENS.sheen,
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  easeOutTuple: [0.22, 1, 0.36, 1] as const,
  easeOutExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeOutExpoTuple: [0.16, 1, 0.3, 1] as const,
  /** Theme cross-fade only (`premium.md` §8.8). */
  easeInOut: "cubic-bezier(0.45, 0, 0.25, 1)",
  easeInOutTuple: [0.45, 0, 0.25, 1] as const,
  dur0Ms: 0,
  dur1Ms: 120,
  dur2Ms: 160,
  dur3Ms: 240,
  dur4Ms: 280,
  /** `:active` / pointerdown scale per surface kind. */
  pressScale: {
    button: 0.97,
    card: 0.985,
    row: 0.985,
    icon: 0.94,
    thumbnail: 0.94,
  },
  // Compatibility aliases (redesign.md §2.6 names)
  durInstantMs: 0,
  durFastMs: 120,
  durBaseMs: 160,
  decelPerMs: 0.998,
  // Compatibility aliases
  uiEaseOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  uiEaseOutTuple: [0.22, 1, 0.36, 1] as const,
  keyboardActionMs: 0,
  panelSpringMaxMs: 400,
  revealCeilingsMs: {
    probeSweep: 1200,
    verdictStagger: 60,
    statCountUp: 700,
    statUpdate: 300,
    claimEvidenceStagger: 600,
    waferGalleryCollapse: 800,
  },
} as const;
