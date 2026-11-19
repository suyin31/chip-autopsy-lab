Repo: Next.js + TS (pnpm). Read .kiro/steering/*, .kiro/specs/chip-autopsy-lab/premium.md §2 and §12 (palette, ember accent, warm paper), src/ui/tokens/palette.ts, src/ui/theme/ThemeController.tsx, src/ui/layout/ThemeToggle.tsx, NavBar.tsx, src/app/globals.css first.

Feature: user-selectable accent colour ("Colour" option), independent of light/dark/system.
- Turn the existing Appearance toggle into a small popover menu (reuse src/ui/primitives/menu.tsx, same restrained premium style) with two groups: Appearance (System / Light / Dark, existing behaviour) and Accent: 4 swatches — Ember (current default #FF6B2C family), Cobalt (blue), Jade (green), Violet. Each swatch a 20px circle with 2px ink focus/selected ring, accessible name, radio semantics, keyboard operable.
- Implement via a `data-accent` attribute on <html>, CSS variables for ember / emberMark / emberInk / soft tints in BOTH light and dark themes. Pick values that pass the same contrast tests as ember (emberInk >= 4.5:1 on the light paper #F6F3EE and on the dark surfaces; mark >= 3:1). Extend palette.ts + theme-tokens.test.ts with the new palettes and contrast assertions.
- Wafer failing dies, verdict cause phrase, Pareto rank-0 bar, focus accents etc. must all follow the accent through the existing tokens (do not hardcode). Pass/neutral greys unchanged.
- Persist in localStorage "cal.accent"; apply pre-hydration (same script approach as theme) so there is no flash. Smooth 240ms colour crossfade, respect reduced motion.
- i18n: add labels to all 5 locales (en, zh-cn, zh-tw, ja, ko), keep parity tests green.
- e2e/accent.spec.ts: open menu, pick Cobalt, assert html[data-accent=cobalt], verdict cause phrase colour changes, survives reload, keyboard path works; screenshot to logs/shots/accent-<name>-light.png for all 4 accents on the loaded sample report (1440x900).
Keep pnpm lint, typecheck, test green. Don't touch tsconfig.tsbuildinfo / next-env.d.ts. Do not commit.
