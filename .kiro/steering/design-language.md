---
inclusion: always
---

# Design Language

Full specification: `.kiro/specs/chip-autopsy-lab/redesign.md` (wins on any conflict). This file is the short rule set.

## Principles
- **The wafer is the product shot**: one hero per screen; the wafer floats on pure black (>= 560 px on desktop) with a soft vignette and no surrounding box.
- **Type carries the hierarchy, not boxes**: size, weight, and white-alpha steps separate levels; borders only where they signal an affordance; at most one pill per region.
- **Verdict in one breath**: the cause of death is one sentence of <= 2 lines; its numbers live in a 3-item big-number stat row and one-line findings.
- **Orange means dead dies**: `failure` only on failing dies, the dominant fail bin, the cause phrase, and at most one key number per screen.
- **Colour never the only cue**: fail dies are full-cell, pass dies are 72 % squares; out-of-limit values also say "out of limits"; legends carry text.
- **Everything moves like it has mass, nothing waits**: interruptible springs for touchable things; input acknowledged < 100 ms; keyboard and high-frequency actions use 0 ms.
- **Every language is first-class**: no strings in components; layouts tolerate 40 % longer text and CJK line-height.

## Colour Tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#000000` | Canvas, wafer stage, landing (`color-scheme: dark`) |
| `surface-1` / `-2` / `-3` | `#0F0F10` / `#1A1A1C` / `#242426` | Card / selected or hovered row, input / pressed row, segmented thumb |
| `material` | `rgba(22, 22, 24, 0.72)` + `blur(24px) saturate(180%)` | Nav, menus, popovers, magnifier, toasts (32 px blur for drag overlay and sheet scrim) |
| `ring` / `ring-strong` | `inset 0 0 0 1px rgba(255,255,255,0.10)` / `0.16` | Shadow-as-border on material surfaces and cards |
| `separator` | `rgba(255, 255, 255, 0.08)` | Dividers between finding rows only |
| `text-primary` | `rgba(255, 255, 255, 0.92)` | Headlines, verdict, stat numbers (17.6:1) |
| `text-secondary` | `rgba(255, 255, 255, 0.56)` | Body, sub-lines, captions (6.5:1) |
| `text-tertiary` | `rgba(255, 255, 255, 0.48)` | Metadata and hints; floor for informative text (4.9:1 on `bg` and `surface-2`) |
| `accent` (ice) | `#D6E6FF` | Focus ring, selection rectangle, evidence glow, active indicators only |
| `failure` | `#FF6B2C` | Failing dies, dominant bin, cause phrase, one key number (7.4:1) |
| `failure-text` | `#FF8A57` | Orange text under 24 px |
| `pass-die` | `#63666C` | Passing dies, graphite (3.65:1 on `bg`, 3.2:1 on vignette peak) |
| `button-primary` | `#F5F5F7` fill, `#000000` text | The one primary button per screen |

## Data Colours
- **HBIN / SBIN**: dominant yield-loss bin `#FF6B2C`; others `#00ACEA, #AE90F3, #FD7584, #B99F35, #00B0C8, #E87AC7, #61A1FF` (~8:1 on `bg`).
- **Evidence highlight**: canvas-only `#000` 1 px keyline + 1.5 px `#D6E6FF` stroke + soft ice glow sprite; non-evidence dies dim under `rgba(0,0,0,0.62)`. Never a fill.
- **Heat maps**: `magma` with a numeric legend.
- **Contrast**: WCAG 2.2 AA: text >= 4.5:1, dies and controls >= 3:1.

## Typography
- **Families**: Inter Variable for everything (`opsz` 32 on display roles); Geist Mono only for raw numeric data (magnifier values, coordinates, table cells), never for labels. No ALL-CAPS labels.
- **Weights**: 300 (stat numbers only), 400, 500, 590, 600. Never >= 700.
- **Numbers**: `tabular-nums` on any changing number.

| Token | Desktop px / line-height / weight / tracking | Mobile |
|---|---|---|
| `display-xl` | 80 / 1.05 / 600 / -0.035em | 48 |
| `display-l` (verdict) | 48 / 1.08 / 600 / -0.022em | 32 |
| `stat` | 40 / 1.0 / 300 / -0.02em | 28 |
| `title-2` | 28 / 1.14 / 600 / -0.016em | 24 |
| `title-3` | 21 / 1.24 / 500 / -0.01em | 17 |
| `headline` | 17 / 1.29 / 590 / -0.008em | 16 |
| `body` | 17 / 1.47 / 400 / -0.008em | 15 |
| `callout` | 15 / 1.4 / 400 / -0.004em | 15 |
| `control` | 14 / 1.29 / 500 / -0.003em | 14 |
| `footnote` | 13 / 1.38 / 400 / 0 | 13 |
| `caption` | 12 / 1.33 / 500 / 0.01em | 12 |

- **CJK** (`zh-CN`, `zh-TW`, `ja`, `ko`): system CJK fallback after Inter, `letter-spacing: 0`, body line-height 1.65, headings 1.2-1.4, verdict 44 / 30 px, `word-break: keep-all` for `ko`.

## Spacing, Radii, Elevation, Layers
- **Spacing**: `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128`. Desktop grid 12 cols, 24 gutter, 40 margins; mobile 4 cols, 12 gutter, 16 margins.
- **Radii**: pill `999` (buttons, segmented, chips), `6`, `12` (menu rows, inputs), `16` (rows, popovers, toasts), `24` (cards, menus, sheets), `28` (drop overlay); nested radii are concentric.
- **Elevation**: surface steps + `material` + `ring` only. No DOM drop shadows; glows exist only on canvas.
- **Z**: HUD 10, magnifier 20, selection popover 30, nav 40, menus 50, sheets 60, toasts 70, drag overlay 80.

## Motion
- **Springs** (Motion): `spring-ui` stiffness 300 / damping 30; `spring-snappy` 520 / 40; `spring-camera` 170 / 26 (critically damped, independent x/y/scale); `spring-throw` 260 / 22 for rubber-band returns only.
- **CSS**: `cubic-bezier(0.22, 1, 0.36, 1)`, 120-160 ms, explicit properties only (`transform`, `opacity`, `background-color`); never `transition: all`.
- **Interruptible**: every animation restarts from the current on-screen value and velocity; input is never locked.
- **Reveal moments (only unprompted motion)**: probe sweep <= 1.2 s once per session (skippable); verdict rise-in (60 ms stagger); stat count-up 700 ms; finding evidence glow stagger <= 600 ms.
- **Instant**: keyboard actions, key-repeat wafer scrub, locale switch, palette open.
- **Reduced motion**: no sweep, stagger, inertia, or camera flight; opacity-only fades <= 120 ms; final values shown immediately.
- **Perf**: DOM animates `transform`/`opacity` only; no React render per frame; perf gate = 0 frames > 50 ms, median rAF < 20 ms.

## Copy, Tone, Number Formats
- **Tone**: plain, sentence case, active verbs. Autopsy phrasing only in `"Drop the body."` and `"Cause of death:"`. Errors say what happened and what to do.
- **Formats** (via `Intl` per locale): yield 1 decimal (`82.8%`), `Cp`/`Cpk` and confidence 2 decimals, grouped integers (`15,825`), SI unit prefixes (`uA`, `mV`).
- **Never translated**: bin names and codes, test names, STDF record/field names, lot/wafer IDs, WM-811K class names, product name.

## Forbidden
- Skulls, cobwebs, bats, pumpkins, Halloween illustrations, novelty fonts.
- Drop shadows on DOM surfaces; gradient-filled or 3D charts; boxes inside boxes.
- A second accent colour; `#FF6B2C` on anything except failures, the cause phrase, and one key number.
- Monospace or ALL-CAPS labels; meta strings joined with middle dots; more than one pill per region.
- Bold weights (>= 700).
