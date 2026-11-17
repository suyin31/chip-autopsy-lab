/**
 * Typography, spacing, radius, and motion design tokens
 * locked by `.kiro/steering/design-language.md` and Requirement 17.
 */

export const TYPOGRAPHY_SCALE_PX = {
  caption: 12,
  tableCell: 13,
  body: 14,
  claim: 16,
  sectionHeading: 20,
  verdictMultiClause: 28,
  verdictHero: 40,
  emptyDisplay: 64,
} as const;

export const HEADING_WEIGHT_BOUNDS = {
  min: 510,
  default: 540,
  max: 590,
  forbiddenBoldMin: 700,
} as const;

export const SPACING_GRID_PX = [4, 8, 12, 16, 24, 32, 48] as const;

export const RADIUS_TOKENS_PX = {
  control: 8,
  panel: 12,
} as const;

export const OVERLAY_BLUR_BOUNDS_PX = {
  min: 20,
  default: 24,
  max: 32,
} as const;

export const MOTION_TOKENS = {
  uiEaseOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  uiEaseOutTuple: [0.22, 1, 0.36, 1] as const,
  uiDurationMinMs: 150,
  uiDurationDefaultMs: 160,
  uiDurationMaxMs: 200,
  panelSpringMaxMs: 400,
  keyboardActionMs: 0,
  revealCeilingsMs: {
    probeSweep: 3000,
    waferGalleryCollapse: 800,
    causeOfDeathTypeOn: 1500,
    claimEvidenceStagger: 600,
  },
} as const;
