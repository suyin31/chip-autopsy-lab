# Premium pass acceptance evidence

## P2 — Colour, elevation, radius, and motion tokens
- A1 (tokens): `e2e/theme-tokens-p2.spec.ts` forces `data-theme` on `<html>`. Light gives body `rgb(245, 245, 247)` / text `rgb(29, 29, 31)` and `bg-surface` `rgb(255, 255, 255)`; dark gives `rgb(0, 0, 0)` / `rgb(17, 17, 19)`. No screenshot: nothing renders differently until P3 sets `data-theme`, and the full-page A1 check runs after P11/P12.
- A13 (token ratio): `src/ui/tokens/theme-tokens.test.ts` composites `pass-tile-hc` on `disc-mid` to `#696A6C` at >= 3.1:1 (the pixel sampling under `prefers-contrast: more` is checked in P6).

## P4 — Typography
- §4.2 computed styles: `e2e/typography-p4.spec.ts` reads the verdict headline (`display-l` 48 / 51.84 / 600 / -1.152 px at 1440; 32 / 35.84 / 600 / -0.64 px at 390), stat value (`stat` 40 / 300 / -0.88 px; 28 / -0.448 px), finding headline (`row-title` 15 / 590 / -0.12 px), and finding sub-line (`subhead` 13 / 400 / -0.039 px), with `cv11`/`ss03`, `opsz` 32 on display and stat, and tabular numerals. Pass at both widths.
- A40 (letter-spacing part): the same spec loads the demo in `ja`, `zh-CN`, `zh-TW`, `ko` at 1440 and 390; all four roles compute letter-spacing 0, `row-title` line-height 1.4, `line-break: strict` (zh, ja) and `word-break: keep-all` (ko). Landing screenshots re-captured by `landing-r4.spec.ts` for the new title sizes.

## P5 — Disc material
- A5: `e2e/disc-material-p5.spec.ts` reads the base canvas backing store at 1440 x 900 (edge-ring-etch, 624 px disc). Body L\* at 25 %/25 % is 18.4 vs 11.0 at 75 %/75 % (difference 7.4, needs >= 6); the pixel 0.008 D inside the 6 o'clock rim is transparent (notch) while the mirrored top pixel and a pixel 0.05 D beside the notch are opaque; top rim L\* 49.1 vs 14.7 just inside and 17.5 at the bottom rim. Screenshot: `logs/shots/p5-disc-1440.png`.
- Exclusion radius: `wafer-geometry.test.ts` checks every die cell corner of all three demo lots stays inside `R - 0.026 D` at 783 x 720, 390, and 152 px.

## P15 — Primitives
- A30: `e2e/primitives-p15.spec.ts` at 1440 x 900 on edge-ring-etch. Light: track `rgba(0, 0, 0, 0.055)`, 32 px high, no border, 28 px segments, thumb `rgb(255, 255, 255)` with `shadow-thumb`, active label `rgb(29, 29, 31)`, inactive `rgb(81, 81, 84)`. Dark: track `rgba(255, 255, 255, 0.08)`, thumb white 0.16 with only transparent shadow layers, active label white 0.92. Screenshots: `logs/shots/p15-segmented-light.png`, `logs/shots/p15-segmented-dark.png`.
- §7.11: the same spec checks the landing primary (`ink` / `on-ink`), the secondary (`fill-2`, hover `fill-3`), exactly one visible `data-variant="primary"`, and the keyboard-only `focus-ring` (no outline). `primitives.test.ts` uses `countPrimaryButtons` to assert one primary on the landing, parse-error, and bins-only screens.
