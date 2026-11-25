import { cn } from './cn';

/**
 * Floating surfaces (premium §3.8, §7.12): `material-thick` + `blur(24px) saturate(180%)` +
 * `shadow-popover`. `prefers-reduced-transparency: reduce` turns the material into opaque
 * `surface` with no filter through the token variables in `globals.css`. Every floating surface
 * also carries a 1 px top specular edge (`--at-float-edge`, atelier.css) so it reads as cut glass.
 */
export const MATERIAL_THICK_CLASS =
  'bg-material-thick shadow-popover inset-shadow-[0_1px_0_var(--at-float-edge)] [backdrop-filter:var(--material-thick-filter)] [-webkit-backdrop-filter:var(--material-thick-filter)]';

/** Menu (language, appearance, legend "+N more", bin list): `r-2xl`, padding 12; width 200-240 set by the caller; the lot picker overrides padding to 8 (§7.2). */
export const MENU_SURFACE_CLASS = cn(MATERIAL_THICK_CLASS, 'rounded-2xl p-3');

/** Popover (confidence, legend entry detail): 320 wide, `r-lg`, padding 16. */
export const POPOVER_SURFACE_CLASS = cn(
  MATERIAL_THICK_CLASS,
  'w-[320px] max-w-[calc(100vw-16px)] rounded-lg p-4',
);

/** Tooltip: max 240 wide, `r-sm`, padding 6 10, `caption` `text-primary`, 1-2 lines. */
export const TOOLTIP_SURFACE_CLASS = cn(
  MATERIAL_THICK_CLASS,
  'max-w-[240px] rounded-sm px-2.5 py-1.5 type-caption text-text-primary',
);
