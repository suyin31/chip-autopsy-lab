# Premium pass acceptance evidence

## P2 — Colour, elevation, radius, and motion tokens
- A1 (tokens): `e2e/theme-tokens-p2.spec.ts` forces `data-theme` on `<html>`. Light gives body `rgb(245, 245, 247)` / text `rgb(29, 29, 31)` and `bg-surface` `rgb(255, 255, 255)`; dark gives `rgb(0, 0, 0)` / `rgb(17, 17, 19)`. No screenshot: nothing renders differently until P3 sets `data-theme`, and the full-page A1 check runs after P11/P12.
- A13 (token ratio): `src/ui/tokens/theme-tokens.test.ts` composites `pass-tile-hc` on `disc-mid` to `#696A6C` at >= 3.1:1 (the pixel sampling under `prefers-contrast: more` is checked in P6).

## P4 — Typography
- §4.2 computed styles: `e2e/typography-p4.spec.ts` reads the verdict headline (`display-l` 48 / 51.84 / 600 / -1.152 px at 1440; 32 / 35.84 / 600 / -0.64 px at 390), stat value (`stat` 40 / 300 / -0.88 px; 28 / -0.448 px), finding headline (`row-title` 15 / 590 / -0.12 px), and finding sub-line (`subhead` 13 / 400 / -0.039 px), with `cv11`/`ss03`, `opsz` 32 on display and stat, and tabular numerals. Pass at both widths.
- A40 (letter-spacing part): the same spec loads the demo in `ja`, `zh-CN`, `zh-TW`, `ko` at 1440 and 390; all four roles compute letter-spacing 0, `row-title` line-height 1.4, `line-break: strict` (zh, ja) and `word-break: keep-all` (ko). Landing screenshots re-captured by `landing-r4.spec.ts` for the new title sizes.
