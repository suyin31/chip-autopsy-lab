---
inclusion: always
---

# Design Language

## Principles
- **Verdict first**: open with the primary cause-of-death finding; place supporting charts below.
- **Progressive disclosure**: move from macro (lot yield, verdict) to meso (bins, wafer region, sites) to micro (single die) on demand.
- **Data first, chrome recedes**: dark neutral surfaces and hairline borders keep visual contrast on wafer dies and distributions.
- **Colour never the only cue**: pair every bin, pass/fail state, and highlight with text labels, bin codes, outlines, or geometry.
- **One Halloween note only**: clinical autopsy framing plus pumpkin orange (`#FF7A1A`) strictly for failures and cause of death.

## Colour Tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#0A0A0B` | Application canvas background (`color-scheme: dark`) |
| `panel` | `#111113` | Report container, chart cards, sidebars |
| `hairline` | `rgba(255, 255, 255, 0.08)` | 1 px panel borders, table rules, subtle dividers |
| `raised` | `rgba(255, 255, 255, 0.04)` | White 4% overlay on `panel` for hover rows and inset controls |
| `overlay` | `rgba(255, 255, 255, 0.08)` | White 8% overlay + `hairline` border + `20-32 px` backdrop blur for popovers, tooltips, and command palette |
| `text-primary` | `rgba(255, 255, 255, 0.92)` | Headlines, cause of death, primary KPIs, active labels |
| `text-secondary` | `rgba(255, 255, 255, 0.64)` | Report body, table values, filter chips |
| `text-tertiary` | `rgba(255, 255, 255, 0.48)` | Axis ticks, shortcut hints, metadata captions (minimum for informative text; ~5:1 on `bg`) |
| `accent` | `#7CF2C1` | Formalin green: selection, focus ring, AI conclusions, and claim markers only (`#0A0A0B` text on solid accent fills) |
| `failure` | `#FF7A1A` | Pumpkin orange: failing dies/bars and cause of death only, never decoration |

## Data Colours and Contrast
- **Pass dies**: muted low-saturation grey-green (starting point `#3A4A43`, tuned in LCH).
- **Pass/Fail mode**: fail uses `#FF7A1A`; pass uses `#3A4A43`.
- **HBIN / SBIN modes**: fail bins use an equal-lightness LCH categorical palette; the dominant yield-loss bin takes `#FF7A1A`; exclude hues near `#7CF2C1`.
- **Selection and evidence highlight**: render as an `#7CF2C1` outline or outer glow, never a fill, so it composes cleanly over any bin or heatmap colour.
- **Heat maps**: perceptually uniform `magma` ramp with a visible numeric legend.
- **Contrast**: meet WCAG 2.2 AA (`>= 4.5:1` for text, `>= 3:1` for non-text controls and graphical marks).

## Typography
- **UI font**: `Inter` (weights `400`, `500`).
- **Headings**: `Inter Display` (or `SF Pro Display`), `letter-spacing: -0.02em`, weights `510-590` only, never bold (`700`).
- **Numbers**: apply `font-variant-numeric: tabular-nums` everywhere; use `Geist Mono` or `JetBrains Mono` for numeric columns, chart axes, coordinates, and scrub readouts.

| Size | Role |
|---|---|
| `12 px` | Axis ticks, keyboard shortcut caps, bin badges, captions |
| `13 px` | Dense statistics table cells, filter tokens, secondary metadata |
| `14 px` | Default UI controls, body copy, command palette rows |
| `16 px` | Autopsy report claim sentences, panel titles |
| `20 px` | Section headings, secondary summary metrics |
| `28 px` | Cause-of-death line (multi-clause) and primary panel KPIs |
| `40 px` | Cause-of-death line (hero) and lot yield headline |
| `64 px` | Empty-state / hero display figure only |

## Spacing, Radii, and Elevation
- **Grid**: `4 px` spacing increments (`4, 8, 12, 16, 24, 32, 48 px`).
- **Radii**: `8 px` for controls, buttons, inputs, and chips; `12 px` for panels, dialogs, and command palette.
- **Elevation**: separate layers by surface brightness and `hairline` borders only; never use drop shadows.

## Motion
- **Standard UI**: `150-200 ms` ease-out (`cubic-bezier(0.22, 1, 0.36, 1)`), animating `transform` and `opacity` only.
- **Panels and overlays**: enter and exit with a stiff spring and slight overshoot (`<= 400 ms`).
- **Duration ceiling**: nothing exceeds `400 ms` except four named reveal moments:
  1. Probe-sweep file load (`~3 s`, once per session, skippable).
  2. Wafer gallery collapsing into the stacked fail map (`<= 800 ms`).
  3. Cause-of-death headline type-on (`<= 1.5 s`).
  4. Claim evidence die light-up stagger (`<= 600 ms`).
- **High-frequency actions**: keyboard-triggered actions (`Cmd-K` / `Ctrl-K` palette open, filter apply, scrub readout) use `0 ms` animation.
- **Reduced motion**: `prefers-reduced-motion: reduce` disables all non-essential motion, springs, sweeps, and staggers.

## Interaction Patterns

| Pattern | Rule | Source |
|---|---|---|
| Progressive disclosure | Macro (yield, verdict) -> meso (bin, region) -> micro (single die), expanded on demand | Apple WWDC22 *Design app experiences with charts* |
| Scrub readout | Hover/drag shows a vertical rule and floating value label that never covers plotted data | Apple Health / Stocks (`chartXSelection`) |
| Command palette | `Cmd-K` / `Ctrl-K`; right-aligned shortcuts, contextual actions, recents first, `Enter` = default action | Linear, Raycast |
| Empty states by cause | Distinct first-run, no-results, and parse-failed states, each with one next step plus `"Load demo lot"` | Vercel Geist Empty State |
| Elevation by brightness | Layer via 4-8% white overlays and hairline borders plus 20-32 px blur on floating surfaces; no shadows | Linear |
| Full-window drop zone | Whole viewport accepts files; drag-over shows subtle border and grid glow with copy `"Drop the body."` | Chip Autopsy Lab |
| Silent frequent actions | Keyboard-triggered and high-frequency actions do not animate; reserve motion for rare reveal moments | Emil Kowalski *You don't need animations* |
| Restrained charts | Foreground the data; keep gridlines minimal; never use colour as the sole differentiator | Apple HIG *Charting data* |

## Copy, Tone, and Number Formats
- **Tone**: clinical and concise. Restrict autopsy phrasing to `"Drop the body."`, `"Autopsy Report"`, and `"Cause of death"`. Use standard test terminology everywhere else.
- **Formats**: yield to 1 decimal (`82.4%`), `Cp`/`Cpk` to 2 decimals (`1.33`), confidence to 2 decimals (`0.91`), grouped integer counts (`12,480`), and SI unit prefixes (`nA`, `uA`, `mV`, `GHz`) for parametric values.

## Forbidden List
- Skulls, cobwebs, bats, pumpkin icons, or Halloween illustrations.
- Spooky, novelty, or decorative fonts.
- Drop shadows on panels, cards, or tooltips.
- Gradient-filled or 3D charts.
- Any second accent colour alongside `#7CF2C1`.
- Pumpkin orange (`#FF7A1A`) on anything other than failures and cause of death.
- Bold font weights (`>= 700`).
