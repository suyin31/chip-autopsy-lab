/**
 * Landing sample-card wafer sizes per breakpoint (`premium.md` §6.1, §3.10): 152 px at
 * `xl` (>= 1440), 140 px at `lg` (1280–1439), 120 px at `md` (1024–1279), and 112 px in the
 * stacked `sm` cards (640–1023) and the mobile carousel (< 640).
 */

export const LANDING_WAFER_SIZE_STEPS = [
  { minWidth: 1440, size: 152 },
  { minWidth: 1280, size: 140 },
  { minWidth: 1024, size: 120 },
] as const;

export const LANDING_WAFER_SIZE_COMPACT = 112 as const;

/** Server snapshot and first paint: the designed 1440 desktop size. */
export const LANDING_WAFER_SIZE_DEFAULT = 152 as const;

export function resolveLandingWaferSize(viewportWidth: number): number {
  for (const step of LANDING_WAFER_SIZE_STEPS) {
    if (viewportWidth >= step.minWidth) {
      return step.size;
    }
  }
  return LANDING_WAFER_SIZE_COMPACT;
}
