# Premium pass acceptance evidence

## P2 — Colour, elevation, radius, and motion tokens
- A1 (tokens): `e2e/theme-tokens-p2.spec.ts` forces `data-theme` on `<html>`. Light gives body `rgb(245, 245, 247)` / text `rgb(29, 29, 31)` and `bg-surface` `rgb(255, 255, 255)`; dark gives `rgb(0, 0, 0)` / `rgb(17, 17, 19)`. No screenshot: nothing renders differently until P3 sets `data-theme`, and the full-page A1 check runs after P11/P12.
- A13 (token ratio): `src/ui/tokens/theme-tokens.test.ts` composites `pass-tile-hc` on `disc-mid` to `#696A6C` at >= 3.1:1 (the pixel sampling under `prefers-contrast: more` is checked in P6).
