/**
 * Typography, spacing, layout grid, concentric radii, blur, z-layer,
 * and physics-spring motion tokens locked by `redesign.md` §2.2–§2.6 and §6.7.
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

/** Full responsive typography table from `redesign.md` §2.2. */
export const TYPOGRAPHY_TOKENS = {
  displayXl: {
    desktop: {
      sizePx: 80,
      lineHeight: 1.05,
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
  },
  displayL: {
    desktop: {
      sizePx: 48,
      lineHeight: 1.08,
      weight: 600,
      trackingEm: -0.022,
      opsz: 32,
    },
    mobile: {
      sizePx: 32,
      lineHeight: 1.12,
      weight: 600,
      trackingEm: -0.018,
      opsz: 32,
    },
  },
  stat: {
    desktop: {
      sizePx: 40,
      lineHeight: 1.0,
      weight: 300,
      trackingEm: -0.02,
      opsz: 32,
    },
    mobile: {
      sizePx: 28,
      lineHeight: 1.0,
      weight: 300,
      trackingEm: -0.015,
      opsz: 32,
    },
  },
  title2: {
    desktop: {
      sizePx: 28,
      lineHeight: 1.14,
      weight: 600,
      trackingEm: -0.016,
      opsz: 32,
    },
    mobile: {
      sizePx: 24,
      lineHeight: 1.17,
      weight: 600,
      trackingEm: -0.014,
      opsz: 32,
    },
  },
  title3: {
    desktop: {
      sizePx: 21,
      lineHeight: 1.24,
      weight: 500,
      trackingEm: -0.01,
    },
    mobile: {
      sizePx: 17,
      lineHeight: 1.29,
      weight: 500,
      trackingEm: -0.008,
    },
  },
  headline: {
    desktop: {
      sizePx: 17,
      lineHeight: 1.29,
      weight: 590,
      trackingEm: -0.008,
    },
    mobile: {
      sizePx: 16,
      lineHeight: 1.31,
      weight: 590,
      trackingEm: -0.006,
    },
  },
  body: {
    desktop: {
      sizePx: 17,
      lineHeight: 1.47,
      weight: 400,
      trackingEm: -0.008,
    },
    mobile: {
      sizePx: 15,
      lineHeight: 1.47,
      weight: 400,
      trackingEm: -0.004,
    },
  },
  callout: {
    desktop: {
      sizePx: 15,
      lineHeight: 1.4,
      weight: 400,
      trackingEm: -0.004,
    },
    mobile: {
      sizePx: 15,
      lineHeight: 1.4,
      weight: 400,
      trackingEm: -0.004,
    },
  },
  control: {
    desktop: {
      sizePx: 14,
      lineHeight: 1.29,
      weight: 500,
      trackingEm: -0.003,
    },
    mobile: {
      sizePx: 14,
      lineHeight: 1.29,
      weight: 500,
      trackingEm: -0.003,
    },
  },
  footnote: {
    desktop: {
      sizePx: 13,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: 0,
    },
    mobile: {
      sizePx: 13,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: 0,
    },
  },
  caption: {
    desktop: {
      sizePx: 12,
      lineHeight: 1.33,
      weight: 500,
      trackingEm: 0.01,
    },
    mobile: {
      sizePx: 12,
      lineHeight: 1.33,
      weight: 500,
      trackingEm: 0.01,
    },
  },
  monoData: {
    desktop: {
      sizePx: 13,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: 0,
      mono: true,
    },
    mobile: {
      sizePx: 13,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: 0,
      mono: true,
    },
  },
} as const satisfies Record<string, ResponsiveTypeToken>;

/** Desktop pixel sizes indexed by role (`redesign.md` §2.2). */
export const TYPOGRAPHY_SCALE_PX = {
  caption: 12,
  footnote: 13,
  monoData: 13,
  control: 14,
  callout: 15,
  headline: 17,
  body: 17,
  title3: 21,
  title2: 28,
  stat: 40,
  displayL: 48,
  displayXl: 80,
} as const;

/** CJK locale typography adjustments (`redesign.md` §6.7). */
export const CJK_TYPOGRAPHY_OVERRIDES = {
  trackingEm: 0,
  displayXlDesktopPx: 64,
  displayXlMobilePx: 40,
  displayLDesktopPx: 44,
  displayLMobilePx: 30,
  lineHeight: {
    display: 1.2,
    displayL: 1.25,
    headline: 1.4,
    body: 1.65,
    callout: 1.65,
    footnote: 1.5,
  },
} as const;

/** Spacing scale in CSS px (`redesign.md` §2.3). */
export const SPACING_SCALE_PX = [
  2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128,
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
} as const;

/** Concentric border radii in CSS px (`redesign.md` §2.3). */
export const RADIUS_TOKENS_PX = {
  xs: 6,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 28,
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

/** Explicit z-index stacking layers (`redesign.md` §2.5). */
export const Z_LAYERS = {
  content: 0,
  canvasBase: 1,
  canvasFail: 2,
  canvasOverlay: 3,
  stageHud: 10,
  magnifier: 20,
  selectionPopover: 30,
  nav: 40,
  menus: 50,
  sheets: 60,
  toasts: 70,
  dragOverlay: 80,
} as const;

/** Physics spring parameters for Motion and the custom rAF camera integrator (`redesign.md` §2.6). */
export const SPRING_TOKENS = {
  ui: {
    type: 'spring',
    stiffness: 300,
    damping: 30,
    mass: 1,
  },
  snappy: {
    type: 'spring',
    stiffness: 520,
    damping: 40,
    mass: 1,
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
} as const;

/** Complete motion token suite (`redesign.md` §2.6, §5.1–§5.4). */
export const MOTION_TOKENS = {
  springUi: SPRING_TOKENS.ui,
  springSnappy: SPRING_TOKENS.snappy,
  springCamera: SPRING_TOKENS.camera,
  springThrow: SPRING_TOKENS.throw,
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeOutTuple: [0.22, 1, 0.36, 1] as const,
  easeOutExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeOutExpoTuple: [0.16, 1, 0.3, 1] as const,
  durInstantMs: 0,
  durFastMs: 120,
  durBaseMs: 160,
  decelPerMs: 0.998,
  // Compatibility aliases
  uiEaseOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
