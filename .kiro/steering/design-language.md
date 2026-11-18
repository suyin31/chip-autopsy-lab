---
inclusion: always
---

# Design Language

Full specification: `.kiro/specs/chip-autopsy-lab/premium.md` (wins on any conflict). `redesign.md` still governs only what premium.md does not mention (data flow, worker API, selection store, i18n plumbing, parse error codes, bins-only logic, perf gate procedure). This file is the short rule set for premium §1, §3, §4, and §8.

## Principles (premium §1.1)
- **The wafer is a lit object**: one hero per screen, a polished dark silicon disc on a light page with material, light, and a contact shadow. Nothing competes with it.
- **One accent, spent on death**: ember orange marks failing dies and at most two other things per screen. Everything else is ink and grey.
- **The answer comes first, in plain words**: every screen and panel opens with one sentence a non-engineer understands; numbers second; jargon third, defined on hover.
- **One obvious next action**: exactly one filled button per screen.
- **Space is the luxury**: fewer blocks, larger gaps, hairlines instead of boxes, nothing touching an edge.
- **Motion has mass and never waits**: bounce-free springs for UI, 1:1 tracking for the wafer, one reveal per session, instant response to every key.

## Measurable Restraint (premium §1.2)
- At most 5 content blocks above the fold, 3 accent uses per viewport, 1 filled button per screen, 2 text colours per block.
- The only rich rendering is the silicon disc. UI chrome is flat surface or translucent material with a hairline.
- Tabular numerals on every number, concentric radii, 1 px hairlines at 8 % ink, nothing clipped, nothing off-grid.

## Theme (premium §3.1)
- `<html data-theme="light" | "dark">`; tokens are CSS variables under `:root[data-theme="light"]` / `:root[data-theme="dark"]`, mapped in Tailwind `@theme inline`; dark variant `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`.
- Preference `localStorage["cal.theme"]`: `"system"` (default, `DEFAULT_THEME_PREFERENCE`), `"light"`, `"dark"`. System follows `prefers-color-scheme` live; no OS preference resolves to light. Light is the designed default.
- A pre-hydration script sets `data-theme` and `color-scheme` before first paint. `theme-color` meta: `#F5F5F7` light, `#000000` dark.
- Canvas code never reads CSS variables per frame; it uses `THEME_TOKENS.light`, `THEME_TOKENS.dark`, and `WAFER_TOKENS` from `src/ui/tokens/palette.ts`.

## UI Colour Tokens (premium §3.2)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F5F5F7` | `#000000` | Page canvas and wafer stage (no box) |
| `surface` | `#FFFFFF` | `#111113` | Cards and sheets |
| `surface-sunken` | `#EBEBEF` | `#1C1C1F` | Pressed rows, input fill |
| `fill-1` / `-2` / `-3` | black at 0.035 / 0.055 / 0.08 | white at 0.05 / 0.08 / 0.12 | Hover / selected row, secondary button, segmented track / pressed, progress track |
| `material` | `rgba(250,250,252,0.80)` + `blur(20px) saturate(180%)` | `rgba(22,22,24,0.72)` + `blur(24px) saturate(180%)` | Nav bar |
| `material-thick` | `rgba(255,255,255,0.92)` + `blur(24px) saturate(180%)` | `rgba(28,28,30,0.88)` + same | Magnifier, popovers, hints, menus, toasts, selection popover |
| `scrim` | `rgba(245,245,247,0.60)` + `blur(24px)` | `rgba(0,0,0,0.55)` + `blur(32px)` | Sheet backdrop, drag overlay |
| `hairline` / `-strong` | black at 0.08 / 0.14 | white at 0.08 / 0.16 | Dividers / input outline, overlay frame, hollow swatch |
| `text-primary` | `#1D1D1F` | `rgba(255,255,255,0.92)` | Headlines, verdict, numbers |
| `text-secondary` | `#515154` | `rgba(255,255,255,0.64)` | Body, takeaway, sub-lines, captions |
| `text-tertiary` | `#6A6A70` | `rgba(255,255,255,0.56)` | Metadata, counts, hints; floor for informative text (>= 4.5:1 on `bg`, `surface`, `surface-sunken`); never on material over the wafer |
| `text-disabled` | `rgba(29,29,31,0.32)` | `rgba(255,255,255,0.28)` | Disabled labels, hidden legend entries |
| `ink` / `on-ink` | `#1D1D1F` / `#FFFFFF` | `#F5F5F7` / `#000000` | Primary button, focus ring, active thumbnail ring, selected bar / text on it |
| `ember` | `#FF6B2C` | `#FF6B2C` | Failing dies on the disc |
| `ember-mark` | `#E8591E` | `#FF6B2C` | Dominant Pareto bar, fail legend swatch |
| `ember-ink` | `#D94E14` | `#FF8A57` | Verdict cause phrase, >= 30 px only |
| `focus-ring` | `0 0 0 2px var(--bg), 0 0 0 4px #1D1D1F` | `0 0 0 2px #000, 0 0 0 4px rgba(255,255,255,0.92)` | `:focus-visible` only |
| `selection` | `rgba(29,29,31,0.14)` | `rgba(255,255,255,0.22)` | `::selection` |

## Wafer Tokens (premium §3.3, theme-independent)
- **Disc**: body gradient `disc-hi #2B2D33`, `disc-mid #1C1D21` (contrast reference), `disc-lo #121316`; thin film `film-1..4` (conic, `screen`, skipped without `createConicGradient`); bevel `rgba(255,255,255,0.38)` top to `0.06` bottom, inner `rgba(0,0,0,0.45)`; `exclusion-line rgba(255,255,255,0.05)`; notch from `WCR.WF_FLAT` (default 6 o'clock).
- **Dies**: `pass-tile rgba(255,255,255,0.06)` (1.19:1, texture only), `pass-tile-hc rgba(255,255,255,0.34)` (3.1:1) under `prefers-contrast: more`; `fail-die #FF6B2C` (5.9:1 on `disc-mid`); `fail-facet rgba(255,255,255,0.18)` when pitch >= 10 px.
- **States**: `dim-veil rgba(18,19,22,0.78)` (disc colour, so dimmed ember stays ember-hued); `evidence-rim rgba(255,255,255,0.90)` 1 px inside; `evidence-bloom` ember sprite composited `lighter`; `hover-stroke` 1.5 px white 0.95 + 1 px black 0.6; `pinned-stroke` 2 px white + 1 px black; `selection-rect` 1 px white 0.90, fill white 0.06, radius 4; `probe-light` white 0.28 sprite.
- **Stage shadows (DOM, inside the camera wrapper)**: light uses `ambient-shadow` + `contact-shadow`; dark uses `halo`. No box, border, or fill around the stage.

## Accent Budget (premium §3.4)
- Ember appears only on: failing dies (main wafer, thumbnails, landing, magnifier loupe), the fail legend swatch, the dominant-bin legend dot, the verdict cause phrase, and the dominant bar in "Yield loss by bin".
- Budgeted per viewport: cause phrase and dominant bar (max 2). Stats, finding rows, magnifier text, hints, buttons, focus, selection, toasts, and errors are never orange. A healthy lot (yield >= 99 %) has no orange text.

## Bin Palette and Heat Maps (premium §3.5, §3.6)
- Rank 0 is always ember. Ranks 1-7 on the disc (`bin-n`): `#00ACEA, #AE90F3, #FD7584, #B99F35, #00B0C8, #E87AC7, #61A1FF`. On the light page (`bin-n-ink`): `#0A6FB0, #7353C9, #C23A55, #7A6510, #007A8C, #A63E8C, #2D63CC` (rank 0 `#E8591E`); the dark page uses the disc values. Good bins: pass tile on the disc, hollow `hairline-strong` swatch on the page.
- Every swatch is followed by its code text (`SBIN 7`); colour is never the only cue.
- Heat maps: `magma` on t in [0.18, 1.0], drawn on the disc, with a 160 x 6 px numeric legend.

## Elevation, Material, Radii, Spacing, Layers (premium §3.7-§3.11)
- **Shadows**: light theme uses layered soft DOM shadows (`shadow-card`, `shadow-card-hover`, `shadow-popover`, `shadow-thumb`, `shadow-chevron`); dark uses inset 1 px white rings, plus a deep shadow on floating layers only. `box-shadow` is never animated; hover shadows cross-fade a pseudo-element's opacity.
- **Material**: nav on `material` with a bottom hairline that appears after 4 px of scroll; floating surfaces on `material-thick` + `shadow-popover`. `prefers-reduced-transparency: reduce` makes every material opaque `surface` with no filter.
- **Radii**: `r-xs 4` (swatches, keycaps, selection rect), `r-sm 8` (loupe, tooltip), `r-md 12` (menu rows, input, Pareto selected row, hint), `r-lg 16` (finding rows, popovers, toasts, magnifier), `r-xl 20` (findings card), `r-2xl 24` (cards, sheets, menus), `r-3xl 28` (drag overlay, stage focus ring), `r-pill 999` (buttons, segmented, lot picker, chevrons). Inner radius = outer - padding when padding <= 24 px.
- **Spacing**: `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 96, 128` only. Grids: `xl` >= 1440 12 cols / 24 gutter / 40 margin / 1360 max; `lg` 1280-1439 12 / 24 / 40; `md` 1024-1279 8 / 20 / 32; `sm` 640-1023 single column, 32 margin, 640 max; `xs` < 640 4 / 12 / 16.
- **Hit targets**: >= 40 x 40 desktop, >= 44 x 44 on `pointer: coarse`, extended with `::after`; hit areas never overlap.
- **Z**: HUD 10, magnifier 20, selection popover 30, hints 35, nav 40, menus 50, tooltips and term popovers 55, sheets 60, toasts 70, drag overlay 80.

## Typography (premium §4)
- **Family**: Inter Variable is the only UI face, with `font-feature-settings: "cv11", "ss03"`, antialiased smoothing, `opsz` 32 on display roles. Geist Mono only for the error-details hex dump and raw coordinates in error details.
- **Weights**: 300 (stat numbers only), 400, 500, 590, 600. Never >= 700. No text under 12 px.
- **Numbers**: `tabular-nums` on every changing number; static landing numbers stay proportional.
- **Wrapping**: headings `text-wrap: balance`; body and captions `text-wrap: pretty` (off for CJK). Body measure 34em; takeaway 520 px max on desktop. Sentence case, no `text-transform`.

| Token | Desktop px / lh / weight / tracking | Mobile (< 640) | Use |
|---|---|---|---|
| `display-xl` | 80 / 1.04 / 600 / -0.035em | 48 / 1.06 / -0.03em | Landing headline, drag overlay |
| `display-l` | 48 / 1.08 / 600 / -0.024em (1280: 44, 1024: 36) | 32 / 1.12 / -0.02em | Verdict headline |
| `title-1` | 34 / 1.12 / 600 / -0.02em | 28 / 1.14 / -0.018em | Error and sheet titles |
| `title-2` | 24 / 1.2 / 600 / -0.016em | 21 / 1.24 / -0.012em | Section titles |
| `title-3` | 21 / 1.38 / 400 / -0.01em | 17 / 1.41 / -0.006em | Landing subline |
| `stat` | 40 / 1.0 / 300 / -0.022em (1024: 32) | 28 / 1.0 / -0.016em | Big-number stats |
| `stat-s` | 28 / 1.0 / 300 / -0.016em | 24 / 1.0 / -0.012em | Lot yield numbers |
| `headline` | 17 / 1.29 / 590 / -0.012em | 16 / 1.31 / -0.01em | Findings label, wafer title, card titles |
| `body` | 17 / 1.47 / 400 / -0.012em | 15 / 1.47 / -0.006em | Takeaway, section takeaways, error body |
| `row-title` | 15 / 1.33 / 590 / -0.008em | same | Finding headline, Pareto bin code |
| `callout` | 15 / 1.4 / 400 / -0.006em | same | Expanded finding, card description, popover body |
| `control` | 14 / 1.29 / 500 / -0.006em | same | Buttons, segmented, menu rows, nav |
| `subhead` | 13 / 1.38 / 400 / -0.003em | same | Finding sub-line, stat caption, legend, magnifier values |
| `caption` | 12 / 1.33 / 500 / 0 | same | Thumbnail labels, magnifier labels, tooltip |
| `mono-data` | 13 / 1.45 / 400 / 0, mono | same | Error-details hex dump only |

- **CJK** (`zh-CN`, `zh-TW`, `ja`, `ko`): system CJK fonts after Inter; `letter-spacing: 0`; line-height `display-xl` 1.2, `display-l` 1.25, `title-*` 1.35, `headline`/`row-title` 1.4, `body`/`callout` 1.7, `subhead`/`caption` 1.55; `display-xl` 64 / 40, `display-l` 44 / 30 (1280: 40, 1024: 32); `line-break: strict` for zh and ja, `word-break: keep-all` for ko; no italics.
- Layouts survive 40 % longer strings: the verdict is at most 3 lines, then steps down (`display-l` -> 40 -> 36).

## Motion Tokens (premium §3.12)
- **Springs**: `spring-ui` duration 0.35, bounce 0; `spring-snappy` duration 0.22, bounce 0; `spring-camera` stiffness 170 / damping 26 (own rAF integrator, independent x/y/scale); `spring-throw` 260 / 22 for rubber-band returns only; `spring-sheen` 120 / 22. No UI spring has bounce > 0.
- **Easings**: `ease-out cubic-bezier(0.22, 1, 0.36, 1)`; `ease-out-expo cubic-bezier(0.16, 1, 0.3, 1)` (count-up); `ease-in-out cubic-bezier(0.45, 0, 0.25, 1)` (theme cross-fade only).
- **Durations**: `dur-0` 0 ms, `dur-1` 120 ms, `dur-2` 160 ms, `dur-3` 240 ms, `dur-4` 280 ms. **Press scale**: 0.97 buttons, 0.985 cards and rows, 0.94 icon buttons and thumbnails.

## Interaction and Motion Rules (premium §8)
- DOM animates `transform` and `opacity` only (plus `background-color`/`color` for hover fills). Never `transition: all`; never animate `width`, `height`, `top`, `left`, `box-shadow`, `filter`, or size `layout` on text containers. Hover effects sit behind `@media (hover: hover)`.
- Every animation is interruptible from its current value and velocity; no input is ignored or queued. Every action is acknowledged visibly within 100 ms and writes a `data-ack` timestamp.
- **Signature moments (the only delight)**: probe sweep + ignite on first load per session (<= 1.2 s + 280 ms, skippable by any input, `sessionStorage["cal.sweep.v1"]`); evidence ignite in pattern order (<= 600 ms, ring traced clockwise from 12 o'clock, scratch along its axis); silicon sheen following the pointer (`spring-sheen`, no loop). Nothing else animates unprompted except the verdict rise-in (six blocks, `spring-ui`, 60 ms stagger, 700 ms `ease-out-expo` count-up via refs).
- **Evidence**: veil 0-200 ms, rims and bloom 180 ms each, camera `spring-camera` to the evidence bbox (scale [1, 4]) unless the user moved it, strip non-evidence thumbnails to 0.32 opacity; clear fades 160 ms from current alpha.
- **Disclosure**: content mounts in flow; body fades with `translateY(-4px)` over `dur-1`; siblings move with `layout="position"` only; text never scales or overlaps.
- **Wafer**: wheel zoom on `spring-camera`; pinch and drag 1:1; inertia and rubber-band (`spring-throw`); scale 1-8; keyboard `+ - 0` 0 ms. Thumbnail click cross-fades 160 ms; arrow keys and key repeat swap at 0 ms; camera and evidence persist across wafers.
- **Theme switch**: `document.startViewTransition()` root cross-fade, 280 ms, opacity only; instant when unsupported, OS-driven, or reduced motion.
- **Surfaces**: menus and popovers `scale(0.97 -> 1)` + opacity on `spring-ui` (keyboard open 0 ms); tooltips opacity `dur-1`; toasts rise 16 px on `spring-ui`; bottom sheet slides on `spring-ui`.
- **Instant (0 ms)**: locale switch, Cmd-K open, keyboard menu open, die cursor, key-repeat scrub, legend toggle, mode switch, zoom keys.
- **Reduced motion**: no sweep, stagger, inertia, rubber-band, camera flight, sheen, card lift, or press scale; opacity-only fades of 120 ms; final values shown at once.
- **Perf**: no React render per frame; perf gate = 0 frames > 50 ms, median rAF < 20 ms, p95 < 34 ms, including a theme switch and a sheen pointer sweep.

## Copy, Tone, Number Formats (premium §9)
- Short declarative sentences, <= 20 words; plain words first, domain term second; sentence case; no exclamation marks, "please", "simply", "just", "oops", "sorry", or hedging adverbs (except in Possible causes). Autopsy phrasing only in `"Drop the body."` and `"Cause of death:"`.
- Buttons are verb first, 1-4 words, naming the result. Errors say what happened, then what to do.
- Numbers via `Intl` per locale: yield 1 decimal, `Cpk` and confidence 2 decimals, grouped integers, SI prefixes with a space before the unit, true minus sign in coordinates.
- Never translated (wrapped in `<bdi translate="no">`): bin codes and names, test names and numbers, STDF record/field names, lot/part/wafer IDs, file names, units, WM-811K class names, product name.

## Forbidden (premium §1.3)
- Orange on stats, finding text, legend labels, non-dominant Pareto bars, buttons, links, icons, focus rings, or selection. A second accent colour.
- ALL-CAPS labels, letter-spaced eyebrows, monospace labels, middle-dot meta strings, `→` appended to button text.
- Boxes inside boxes. Gradients on DOM surfaces or charts (only the disc and sheen are gradients).
- Bounce on UI springs; unprompted or looping motion beyond the signature moments.
- Jargon-only control labels (`HBIN`, `SBIN`, `Cpk`, `PRR`) without a plain label or definition.
- Skulls, cobwebs, pumpkins, novelty fonts, Halloween imagery. Weights >= 700; text under 12 px; informative text below 4.5:1.
- Anything clipped: thumbnails, rings, focus outlines, popovers, descenders.
