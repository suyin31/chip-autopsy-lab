# Chip Autopsy Lab: Redesign Specification (R-series)

Status: approved for implementation. Supersedes the visual parts of `design.md` §UI and the old token table. Data model, worker API, analytics, and the selection store do not change. Where this document and `.kiro/steering/design-language.md` disagree, this document wins; the steering file was updated to match it.

Inputs: `research/redesign-brief.md`, `research/shot-8-Edge.png`, `research/shot-empty2.png`, the four design skills in `.kiro/skills/`.

Reference viewports: **desktop 1440 x 900**, **mobile 390 x 844**. All sizes are CSS px.

---

## 0. Diagnosis of the current UI (from the screenshots)

| Seen in `shot-8-Edge.png` / `shot-empty2.png` | Why it reads as a developer dashboard | Fix |
|---|---|---|
| Header row "STDF V4 · Local-First Workbench" + "Browser Sandbox" chip | Meta strings with middle dots and a badge that says nothing actionable | Calm nav: product name, lot picker, language, one button |
| A second toolbar row (lot title, `<select>`, "Load demo lot", "Choose STDF file") | Two toolbars stacked; native select | Lot picker moves into the nav as a menu |
| "AUTOPSY REPORT", "Template · Offline", "High · 0.95", "Click a finding to light its dies" | ALL-CAPS monospace eyebrow plus three pills before any content | One sentence verdict; one "Confidence 0.95" pill; narration source moves to an info popover |
| Verdict card with green tinted fill, green border, orange + white 4-line paragraph | Box inside a box; the verdict is a paragraph of numbers | 48 px two-line headline; numbers move to the stat row |
| Every claim in its own bordered card with chips "2,552 dies", "SBIN 7" | Wall of bordered cards and chips | Borderless list rows: one-line headline, one muted sub-line, details on click |
| Wafer inside a bordered panel with a "Claim evidence" chip bar and a Pass/Fail chip bar above it | The product shot is one panel among many | Wafer stage has no box, a soft vignette, and floats on pure black |
| Neon mint 1 px squares around orange dies | Reads "gamer" | Highlight becomes an ice-white glow with a black keyline, and non-evidence dies dim |
| Monospace for "Notch 6 o'clock · POS_X R · POS_Y U · Hover or arrow-step dies…" | Monospace used for labels and instructions | Sans for all labels; mono only for raw data columns |
| Six bordered KPI cards below the fold | KPIs hidden and boxed | Three big-number stats in the verdict column, above the fold |
| Empty state: card with header, two sub-cards, dashed drop zone, small "Drop the body." | Form-like; the best line is 16 px | Landing hero: 80 px "Drop the body.", three demo lot cards with real wafer thumbnails |

### Remove

1. The `Browser Sandbox` badge, the `STDF V4 · Local-First Workbench` meta string, and the footer `0 bytes ingested` counter.
2. All ALL-CAPS labels and every monospace label (keep mono only in numeric table columns and the magnifier readout values).
3. `NarrationBadge` pills in the report header (moves to an info popover on the confidence pill).
4. Card borders on claims, KPI cards, the wafer panel, the lot strip container, and the drop zone (dashed border).
5. The second toolbar row and the native `<select>`.
6. The `Prev` / `Next` text buttons under the strip (keyboard and swipe replace them; the strip itself is the control).
7. The mint `#7CF2C1` accent everywhere. It is replaced by ice `#D6E6FF`.
8. The cause-of-death type-on effect (gimmicky and broken for CJK). It is replaced by a rise-in.

---

## 1. Design principles

1. **The wafer is the product shot.** One hero per screen. On the loaded view the wafer is at least 560 px across on desktop, floats on pure black with a vignette and top light, and has no surrounding box.
2. **Type carries the hierarchy, not boxes.** Size, weight, and the white-alpha ladder (92 / 56 / 48 %) separate levels. Borders appear only where they signal an affordance (inputs, focus, selection rectangle).
3. **Verdict in one breath.** The cause of death is one sentence of at most 2 lines. Every number that used to live in the sentence moves to a big-number stat or a finding sub-line.
4. **Orange means dead dies.** `#FF6B2C` is used on failing dies, the dominant fail bin, the cause phrase in the verdict, and at most one key number per screen. Nothing else.
5. **Everything moves like it has mass, and nothing waits.** Springs for anything touchable, interruptible from the current on-screen value; input acknowledged in under 100 ms; keyboard and high-frequency actions are instant.
6. **One orchestrated reveal.** The probe sweep and the verdict rise-in are the only unprompted motion. Everything else answers a user action.
7. **Every language is first-class.** Layout tolerates 40 % longer strings (German-length English) and CJK line-height. No string lives in a component.

---

## 2. Tokens

### 2.1 Colour

All values are final. Contrast ratios are WCAG 2.x relative-luminance ratios, computed against `bg #000000` unless noted.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `bg` | `#000000` | Canvas, wafer stage, landing | — |
| `surface-1` | `#0F0F10` | Cards on the landing, menus' base fill, expanded finding body | — |
| `surface-2` | `#1A1A1C` | Selected finding row, hovered card, input fill | — |
| `surface-3` | `#242426` | Pressed row, segmented-control thumb | — |
| `material` | `rgba(22, 22, 24, 0.72)` + `backdrop-filter: blur(24px) saturate(180%)` | Nav, popovers, magnifier, toasts, menus, drop overlay | — |
| `ring` | `inset 0 0 0 1px rgba(255, 255, 255, 0.10)` (box-shadow) | Edge of material surfaces and cards (shadow-as-border, no layout cost) | — |
| `ring-strong` | `inset 0 0 0 1px rgba(255, 255, 255, 0.16)` | Hovered card, input focus-within | — |
| `separator` | `rgba(255, 255, 255, 0.08)` | 1 px dividers between finding rows only | — |
| `text-primary` | `rgba(255, 255, 255, 0.92)` | Headlines, verdict, stat numbers, active labels | 17.6:1 |
| `text-secondary` | `rgba(255, 255, 255, 0.56)` | Body, sub-lines, stat captions | 6.5:1 on `bg`, 6.2:1 on `surface-2` |
| `text-tertiary` | `rgba(255, 255, 255, 0.48)` | Metadata, die counts, legend, hints (floor for informative text) | 4.9:1 on `bg`, 4.9:1 on `surface-2` |
| `text-disabled` | `rgba(255, 255, 255, 0.28)` | Disabled control labels only (exempt from 4.5:1) | — |
| `accent` (ice) | `#D6E6FF` | Focus ring, selection rectangle, evidence glow, active segment indicator | 16.6:1 |
| `accent-soft` | `rgba(214, 230, 255, 0.12)` | Selection rectangle fill, hovered strip thumbnail ring | — |
| `failure` | `#FF6B2C` | Failing dies, dominant fail bin, cause phrase, one key number | 7.4:1 |
| `failure-text` | `#FF8A57` | Orange text under 24 px (small key number on mobile) | 9.0:1 |
| `pass-die` | `#63666C` | Passing dies (graphite) | 3.65:1 on `bg`, 3.2:1 on vignette peak `#141416` |
| `die-street` | `#000000` | Gaps between dies | — |
| `dim-scrim` | `rgba(0, 0, 0, 0.62)` | Canvas scrim over non-evidence dies when a finding is active | — |
| `button-primary` | `#F5F5F7` fill, `#000000` text | Primary button | 19.3:1 |
| `vignette` | `radial-gradient(closest-side, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 55%, rgba(255,255,255,0) 100%)` | Behind the wafer, diameter = wafer diameter x 1.5 | peak composite `#0E0E0E` (≤ `#141416`) |
| `top-light` | `linear-gradient(180deg, rgba(214,230,255,0.06) 0%, rgba(214,230,255,0) 40%)` masked to the wafer disc | A faint light catching the top of the wafer disc | — |
| `wafer-disc` | `#0B0B0C` fill, `ring` 1 px `rgba(255,255,255,0.10)` | Silicon disc behind the dies, including the notch | — |

**Fail-bin categorical palette (HBIN/SBIN modes):** rank 0 (dominant yield-loss bin) = `#FF6B2C`. Ranks 1+ keep the existing equal-lightness set `#00ACEA, #AE90F3, #FD7584, #B99F35, #00B0C8, #E87AC7, #61A1FF` (all ≈ 8.0:1 on `#000`). Pass bins use `pass-die`. Heat maps keep `magma` with a numeric legend.

**Non-colour cue for pass vs fail (Pass/Fail mode):** pass dies render as a centred square at **72 %** of the cell with `1 px` radius; fail dies fill the cell minus the 1 px street with `1.5 px` radius. Fail dies are visibly larger, so the map reads in greyscale. The legend draws the same two shapes.

**Evidence glow (canvas):** for each highlighted die, draw a 1 px `#000` keyline outside the die, then a 1.5 px `#D6E6FF` stroke, then a pre-rendered glow sprite (`#D6E6FF` at 45 % alpha, 6 px gaussian) composited with `lighter`. The keyline keeps ≥ 3:1 separation between ice and orange (ice vs orange alone is 2.2:1).

**Tests to update:** `palette.test.ts` must assert the values above and these ratios: `pass-die` on `#000` ≥ 3.0 and on `#141416` ≥ 3.0; `failure` on `#000` ≥ 3.0; `accent` on `#000` ≥ 3.0; `text-tertiary` composite on `#000` and on `#1A1A1C` ≥ 4.5; `text-secondary` ≥ 4.5 on both.

### 2.2 Typography

Families (already self-hosted via `next/font/local`):

```css
--font-sans: var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace;
/* CJK stacks appended per locale, see §6.6 */
```

Global: `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; font-optical-sizing: auto; font-feature-settings: "cv11", "ss01";` (Inter single-storey a off, open digits on). `font-variant-numeric: tabular-nums` on every element that shows a changing number. Static display numbers (landing, verdict) use proportional figures.

Inter Variable has an `opsz` axis (14–32). Display roles set `font-variation-settings: "opsz" 32`; text roles leave `font-optical-sizing: auto`.

| Token | Desktop px / line-height / weight / tracking | Mobile | Use |
|---|---|---|---|
| `display-xl` | 80 / 1.05 / 600 / -0.035em | 48 / 1.06 / 600 / -0.03em | "Drop the body." on landing and drag overlay |
| `display-l` | 48 / 1.08 / 600 / -0.022em | 32 / 1.12 / 600 / -0.018em | Verdict headline |
| `stat` | 40 / 1.0 / 300 / -0.02em | 28 / 1.0 / 300 / -0.015em | Big-number stats |
| `title-2` | 28 / 1.14 / 600 / -0.016em | 24 / 1.17 / 600 / -0.014em | Parse-error title, section heads on landing |
| `title-3` | 21 / 1.24 / 500 / -0.01em | 17 / 1.29 / 500 / -0.008em | Landing subline, bins-only sheet title |
| `headline` | 17 / 1.29 / 590 / -0.008em | 16 / 1.31 / 590 / -0.006em | Finding headline, card title, lot name in picker |
| `body` | 17 / 1.47 / 400 / -0.008em | 15 / 1.47 / 400 / -0.004em | Verdict sub-line, error body, expanded finding text |
| `callout` | 15 / 1.4 / 400 / -0.004em | 15 / 1.4 / 400 / -0.004em | Finding sub-line, card description, toast text |
| `control` | 14 / 1.29 / 500 / -0.003em | 14 / 1.29 / 500 / -0.003em | Buttons, nav items, menu rows, segmented control |
| `footnote` | 13 / 1.38 / 400 / 0 | 13 / 1.38 / 400 / 0 | Stat captions, die counts, legend, hints |
| `caption` | 12 / 1.33 / 500 / 0.01em | 12 / 1.33 / 500 / 0.01em | Zoom readout, strip wafer label, shortcut caps |
| `mono-data` | 13 / 1.38 / 400 / 0, `--font-mono` | same | Magnifier values, coordinates, stats table cells |

Weights allowed: 300 (stat only), 400, 500, 590, 600. Never ≥ 700. Headings use `text-wrap: balance`; body and sub-lines use `text-wrap: pretty`. Line length ≤ 72 characters for body.

### 2.3 Spacing, layout, radii

- Spacing scale (px): `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128`.
- Desktop grid: 12 columns, 24 px gutter, 40 px side margins, max content width 1360 (column = 91.33 px). Mobile: 4 columns, 12 px gutter, 16 px margins (content 358).
- Radii: `pill 999` (buttons, segmented control, chips), `xs 6` (keyboard caps, strip thumbnail focus), `sm 12` (menu rows, inputs, segmented thumb), `md 16` (finding rows, popovers, toasts, magnifier readout), `lg 24` (landing demo cards, sheets, menus), `xl 28` (drag overlay frame). Nested surfaces are concentric: inner radius = outer radius - padding (a 24-radius card with 8 px padding holds a 16-radius thumbnail).
- Hit targets ≥ 40 x 40 on desktop, ≥ 44 x 44 on mobile; expand with a pseudo-element when the visual is smaller.

### 2.4 Elevation, glows, blur

- No drop shadows on DOM surfaces. Floating surfaces use `material` + `ring`; separation from black comes from the material's lift, not a shadow.
- Blur values: `24px` for nav, menus, popovers, toasts, magnifier readout; `32px` for the drag overlay and bins-only sheet scrim. Animated blur (enter only) stays ≤ 8 px.
- Glow exists only on canvas (evidence glow, probe head light). DOM focus uses an outline, never a glow.

### 2.5 Z-layers

| Layer | z-index |
|---|---|
| Page content | 0 |
| Wafer base canvas / fail canvas / overlay canvas | 1 / 2 / 3 (inside the stage stacking context) |
| Stage HUD (mode segmented control, zoom readout, legend) | 10 |
| Magnifier | 20 |
| Selection popover | 30 |
| Nav bar | 40 |
| Menus (lot picker, language) | 50 |
| Sheets (bins-only, error details) and scrim | 60 |
| Toasts | 70 |
| Drag-over overlay | 80 |

### 2.6 Motion tokens

| Token | Value | Use |
|---|---|---|
| `spring-ui` | `{ type: "spring", stiffness: 300, damping: 30, mass: 1 }` (ζ ≈ 0.87, settles ≈ 350 ms) | Panels, popovers, menus, verdict rise, rows expanding |
| `spring-snappy` | `{ type: "spring", stiffness: 520, damping: 40, mass: 1 }` (ζ ≈ 0.88, ≈ 220 ms) | Segmented thumb, selected row fill, magnifier show |
| `spring-camera` | stiffness 170, damping 26, mass 1 (ζ = 1.0, critically damped), own rAF integrator | Wafer zoom/pan/frame/reset |
| `spring-throw` | stiffness 260, damping 22 (ζ ≈ 0.68) | Rubber-band return after a flick past bounds only |
| `ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | CSS hovers and fades |
| `ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Count-up |
| `dur-instant` | 0 ms | Keyboard actions, key-repeat scrub, locale switch, palette open |
| `dur-fast` | 120 ms | Hover fill, magnifier fade |
| `dur-base` | 160 ms | Strip crossfade, toast exit |
| `decel` | 0.998 per ms | Pan inertia projection (Apple scroll deceleration) |

---

## 3. Screens and states

Common to every screen: nav bar (§4.1) is sticky at the top. Body background `bg`. All copy below is the English source; keys are in §6.8.

### 3.1 Empty / landing

**Desktop 1440 x 900**

```
y=0    ┌──────────────── nav 52 ────────────────────────────────────────┐
y=52   │                                                                 │
y=148  │              Drop the body.                (display-xl, centred)│
y=232  │    Drop an STDF V4 wafer sort log anywhere on this page.        │
y=262  │    It is parsed on this device and never uploaded. (title-3)    │
y=312  │              [ Open STDF file ]   (primary, 44 h)               │
y=356  │            .stdf, .std, or gzip   (footnote, tertiary)          │
y=420  │  ┌ card 421x300 ┐  ┌ card ┐  ┌ card ┐   (3 x 4 cols, gutter 24)  │
y=720  │  └──────────────┘  └──────┘  └──────┘                           │
y=800  │  Runs entirely in your browser.        Download demo files      │
y=900  └─────────────────────────────────────────────────────────────────┘
```

- Hero block: centred text, `max-width: 880`. Headline top at y = 148 (96 px below nav). Subline `title-3` in `text-secondary`, `max-width: 640`, 16 px below headline. Button 32 px below subline. Hint 12 px below button.
- Demo cards row: top at y = 420, three cards each 4 columns wide (421 px), height 300, `surface-1`, radius 24, `ring`, padding 8.
  - Thumbnail area: 405 x 196, radius 16, `bg` fill, the card's W01 wafer drawn at 168 px diameter centred with the vignette; Pass/Fail colouring.
  - Text area padding 16 20 20: title `headline` (`text-primary`), 4 px, description `callout` `text-secondary` 1 line (ellipsis), 8 px, meta `footnote` `text-tertiary`.
  - Whole card is one button. Click loads the lot (no separate "Load demo lot" button, no "Selected" state).
- Footer line at y = 800 (bottom padding 64): left `footnote` tertiary "Runs entirely in your browser. Raw STDF bytes never leave this device."; right text button "Download demo files" (opens a menu with the 3 file links).
- **Above the fold:** everything above, including the full cards.

Demo card copy:

| id | Title | Description | Meta |
|---|---|---|---|
| `edge-ring-etch` | Edge-Ring Plasma Etch | Outer-ring IDDQ leakage after focus-ring erosion | 25 wafers, 15,825 dies |
| `handling-scratch` | Robotic Handling Scratch | A transfer-blade scratch across wafers 5 to 22 | 25 wafers, 15,825 dies |
| `site2-probe-contact` | Site 2 Probe Contact | Oxidized site 2 needles cause opens and retests | 25 wafers, 15,825 dies |

**Mobile 390 x 844**

- Nav 48. Headline `display-xl` mobile 48 px, left-aligned, top at y = 96, margins 16. Subline 17 px, 12 px below. Button full width 358 x 50, 24 px below. Hint below, 8 px.
- Cards become a horizontal scroll-snap carousel: card 300 x 280, gap 12, `scroll-snap-type: x mandatory`, `scroll-snap-align: start`, `scroll-padding-inline: 16`. The second card peeks 46 px to signal scroll.
- Above the fold: headline, subline, button, hint, the first card and a peek of the second. Footer below the fold.

### 3.2 Drag-over overlay (any screen)

- Full viewport `material` at `rgba(0,0,0,0.55)` with `blur(32px)`. Inset frame: `inset: 16px`, radius 28, `box-shadow: inset 0 0 0 1px rgba(214,230,255,0.35)`, plus a 24 px dot grid (`radial-gradient(rgba(214,230,255,0.10) 1px, transparent 1px) 0 0 / 24px 24px`) masked by a radial fade from the centre.
- Centred: "Drop the body." `display-xl`; 12 px below `title-3` secondary "Release to open. STDF, STD, or gzip."
- If the dragged item is not a file (text, link): copy changes to "Only files can be opened here." and the frame ring turns `text-tertiary`.
- Mobile: no drag-over (not applicable); the overlay is never shown.

### 3.3 Loading (probe sweep)

Desktop uses the loaded layout (§3.4) from the first frame so nothing jumps when parsing ends.

- Wafer stage (left 7 cols): disc outline and notch drawn immediately once `WCR`/first wafer geometry is known; before that, a 624 px disc outline with `ring` only.
- Dies appear in probe order (§5.1). A small ice probe-head light travels with the reveal.
- Right column, top aligned with the verdict position:
  - `headline` primary: file name, e.g. `edge-ring-etch.stdf` (plain text, ellipsis at 1 line).
  - 8 px, `body` secondary: "Reading wafer 7 of 25" (once wafers are known) or "Reading records" (before).
  - 16 px, progress track 2 px tall, full column width, `rgba(255,255,255,0.12)`, fill `text-primary`, radius 999, width driven by `transform: scaleX(p)` with `transform-origin: left`.
  - 8 px, `footnote` tertiary tabular: "4.2 of 9.8 MB".
  - 24 px, `footnote` tertiary: "Press any key to skip the animation." (only while the sweep animation is running).
- Stat row and findings area show nothing (no skeletons; empty space reads calmer).
- Mobile: verdict area shows the same file name and progress stack above the wafer stage.

### 3.4 Loaded verdict view

**Desktop 1440 x 900**

```
y=0   nav 52
y=52  ┌ margin 40 ┬──────── stage 783 x 720 (cols 1–7) ────────┬ 24 ┬── verdict column 553 (cols 8–12) ──┬ 40 ┐
y=76  │           │ [Pass/Fail | HBIN | SBIN]        (HUD)     │    │ Cause of death:                      │
      │           │                                            │    │ Edge-Ring failure.   (display-l)     │
      │           │              ( wafer 624 Ø )               │    │ Yield 82.8% across 25 wafers. Most   │
      │           │                                            │    │ loss in SBIN 7 IDDQ_EDGE_LEAK. (body)│
      │           │                                            │    │ (Confidence 0.95)                    │
      │           │                                            │    │ 93.8%      82.8%      2,721          │
      │           │ ▪ Pass 523  ■ Fail 110        W01  100%    │    │ fails on…  final yield dies failed   │
y=796 │           ├──── strip 64 ──────────────────────────────┤    │ Findings                              │
y=876 └───────────┴────────────────────────────────────────────┴────┴───────────────────────────────────────┘
```

- Main area: `height: calc(100dvh - 52px)`, no page scroll at ≥ 820 px viewport height. Padding top 24, bottom 24.
- **Stage:** 783 x 720, `bg`. Wafer diameter = `min(stageW, stageH) - 96` = 624. Vignette and top-light behind it. HUD:
  - Top-left (16, 16): segmented control "Pass/Fail", "HBIN", "SBIN" (§4.12), material, height 32.
  - Bottom-left (16, bottom 16): legend in `footnote` tertiary: pass shape + "Pass 523", fail shape + "Fail 110". In HBIN/SBIN mode: up to 6 bin entries "SBIN 7 IDDQ_EDGE_LEAK 105", then "+3 more" which opens the full list in a popover. Clicking an entry toggles the bin's visibility; hidden entries render at `text-disabled` with strikethrough.
  - Bottom-right (right 16, bottom 16): `caption` "W01" (current wafer) and the zoom readout pill "100%" (visible only when zoom ≠ 1; click resets).
  - Notch orientation label is removed from the HUD; it appears in the magnifier readout.
- **Strip:** 16 px below stage, 783 x 64 (§4.9).
- **Verdict column:** 553 wide, own scroll container (`overflow-y: auto; scrollbar-gutter: stable; overscroll-behavior: contain`), padding-top 56.
  1. Verdict headline `display-l`, max 2 lines at 553 px: "Cause of death: **Edge-Ring failure.**" The cause phrase is `failure` orange; "Cause of death:" is `text-primary`.
  2. 16 px, sub-line `body` secondary, max 2 lines: "Yield 82.8% across 25 wafers. Most loss in SBIN 7 IDDQ_EDGE_LEAK."
  3. 20 px, confidence pill (§4.4).
  4. 40 px, stat row: 3 equal columns of 168 px, gap 24 (§4.5).
     - `93.8%` (orange: the one key number) / "of fails sit in the outer 3 rings"
     - `82.8%` / "final yield, 81.5% first pass"
     - `2,721` / "failing dies of 15,825 tested"
  5. 48 px, "Findings" `headline` primary, then 8 px, finding rows (§4.6). Rows for the edge-ring lot:
     - "93.8% of fails are in the edge band" / "46.4% edge fail rate vs 1.6% interior, on 25 of 25 wafers" / "2,552 dies"
     - "SBIN 7 IDDQ_EDGE_LEAK leads the loss" / "2,483 dies, 91.3% of fails" / "2,483 dies"
     - "Test 204 IDDQ_LEAK has Cpk 0.14" / "Mean 10.22 uA against limits 0.20 to 15.00 uA" / "2,483 dies"
     - "Possible causes" (disclosure row; expanded shows the 3 hedged hypotheses and their next checks)
- **Above the fold (900):** nav, full stage with wafer, strip, verdict, sub-line, confidence, stat row, and the first two finding rows. The third row and "Possible causes" may need a short scroll.

**Mobile 390 x 844** (single column, page scroll; nav sticky)

- y=48: padding-top 20. Verdict `display-l` mobile 32 px, margins 16, max 3 lines.
- 12 px, sub-line 15 px secondary.
- 12 px, confidence pill.
- 24 px, stat row: 3 columns of 111 px, gap 12, number 28 px, caption 13 px (2 lines max).
- 24 px, stage full-bleed 390 x 390, wafer 350 Ø. HUD: segmented control top-left (12, 12) at 28 px height; legend bottom-left; zoom readout bottom-right.
- 12 px, strip 390 x 56 (thumbs 40), side padding 16.
- 32 px, Findings list, rows full width 358.
- Above the fold (844): nav, verdict, sub-line, confidence, stats, and the top ~320 px of the wafer stage. Scrolling 1 flick reveals the full wafer.
- Gestures on mobile: one-finger vertical drag scrolls the page while zoom = 1 (`touch-action: pan-y` on the stage); two-finger pinch zooms; once zoom > 1 the stage sets `touch-action: none` and one-finger drag pans.

### 3.5 Finding selected

Trigger: click/Enter on a finding row, or click the verdict cause phrase (it is a button bound to the spatial-pattern fact).

- Row: fill `surface-2`, radius 16, headline stays primary, the trailing die count is replaced by a text button "Clear" (`control`, secondary → primary on hover). `aria-pressed="true"`.
- Row expands (spring-ui, height via Motion `layout` on the row container only) to show details: the full engine sentence in `callout` secondary (no extra links in this phase).
- Stage: non-evidence dies fade under `dim-scrim` (0 → 0.62 in 200 ms), evidence dies glow in sequence (§5.4), camera eases to frame (§5.4).
- Stage caption: a material pill centred at the stage bottom (y = stage bottom - 16), `footnote` primary: "2,552 dies on 25 wafers, 105 on this wafer". The legend fades out while the caption shows.
- Strip: thumbnails of wafers with zero evidence dies drop to 40 % opacity; wafers with evidence get a 4 px ice dot under them.
- Clear: click the row again, the "Clear" button, `Esc`, or click empty stage background. Scrim fades out 160 ms, glow fades 160 ms (no stagger on exit), camera returns to fit only if the user did not zoom/pan manually since the frame.
- Mobile: same; selecting a finding scrolls the page so the stage top sits 8 px below the nav (smooth scroll, instant under reduced motion), because the list is below the wafer.

### 3.6 Region selected (box select)

Trigger: Shift+drag on desktop, or press `S` to toggle Select tool (the HUD shows a second segmented control "Pan | Select"); mobile: long-press 350 ms then drag.

- Rectangle: 1 px `accent` stroke, `accent-soft` fill, corners square-snapped to die cells after release (live rect follows pointer 1:1 while dragging).
- Live stats popover follows the rectangle's top-right corner (§4.8) and updates every frame during drag:
  - Title `headline`: "148 dies"
  - Rows (`callout`, values `mono-data` right-aligned): "Failing 37", "Yield 75.0%", "Top bin SBIN 7 (31)"
  - Footer after release: text buttons "Clear" and "Zoom to selection".
- Linked views: stat row values switch to the selection (captions get the suffix " in selection"), finding die counts switch to "31 of 2,552 in selection". This uses the existing brush rect in the selection store; compute runs in the worker for > 2,000 dies or main thread under 1 ms otherwise.
- Clear: `Esc`, "Clear", or a click on empty stage. Stats animate back via count-up (300 ms).

### 3.7 Parse error

Replaces the landing hero content (cards remain below so the next step is one click).

- Desktop: icon-free. Title `title-2` primary centred at y = 180: per error code (table below). 12 px body secondary `max-width: 560`. 24 px: primary "Open another file", secondary "Load demo lot" (loads `edge-ring-etch`). 12 px: text button "Show details" opens a sheet with record offset and the first 16 bytes as hex (`mono-data`).
- Mobile: left aligned, same order, buttons full width stacked with 12 px gap.

| Code | Title | Body |
|---|---|---|
| `not-stdf` | This file isn't an STDF log. | The first record must be FAR (0, 10). This file starts with bytes {hex}. |
| `unsupported-version` | This STDF version isn't supported. | FAR reports STDF_VER {version}. Chip Autopsy Lab reads STDF V4. |
| `vax-cpu` | DEC VAX byte order isn't supported. | FAR.CPU_TYPE is 0. Re-export the log with CPU_TYPE 1 or 2. |
| `truncated` | The file ends in the middle of a record. | Record {recType} at byte {offset} needs {need} bytes, but only {have} remain. Wafers before it were read. |
| `gzip-failed` | The gzip stream couldn't be decompressed. | The file starts with gzip bytes 1F 8B but the stream is corrupt at byte {offset}. |
| `empty` | The file is empty. | Choose a file that contains STDF records. |
| `no-parts` | No tested dies found. | The log has no PRR records, so there is nothing to map. |

For `truncated` with at least one complete wafer: open the loaded view instead, and show a persistent toast with the same title and body plus "Show details".

### 3.8 Bins-only notice

Two moments:

1. **Before parse** (file > 200 MB): sheet centred on desktop (480 wide, radius 24, material, padding 32), bottom sheet on mobile (full width, radius 24 24 0 0, drag handle 36 x 5).
   - Title `title-3`: "This file is 312 MB."
   - Body: "Parsing every test result may take about 21 s. Bins-only mode skips parametric results and keeps the wafer maps, bins, and yield."
   - Buttons: primary "Use bins-only" (default, Enter), secondary "Parse everything".
   - Scrim `rgba(0,0,0,0.5)` with 32 px blur.
2. **After load in bins-only mode:** one line under the confidence pill, `footnote` secondary with a leading info glyph: "Bins-only mode. Parametric findings are hidden." + text button "Parse everything". Parametric findings rows are not rendered.

---

## 4. Components

State conventions for every interactive component:

| State | Rule |
|---|---|
| Hover | Fill step (+1 surface level or +4 % white) in `dur-fast` `ease-out`; text secondary → primary. Pointer devices only (`@media (hover: hover)`). |
| Pressed | `transform: scale(0.97)` on `pointerdown` in 100 ms `ease-out` (buttons, cards scale 0.985); release springs back with `spring-snappy`. |
| Focus-visible | `outline: 2px solid #D6E6FF; outline-offset: 2px;` radius follows the element. Never on mouse focus. |
| Disabled | `opacity: 0.4`, `cursor: not-allowed`, no hover or press response, `aria-disabled="true"` (keep it focusable when a tooltip explains why). |

### 4.1 Nav bar

- Height 52 desktop / 48 mobile, `position: sticky; top: 0`, `material`. No bottom border at rest; a `separator` line fades in (opacity 0 → 1, 120 ms) when the page or verdict column is scrolled > 4 px.
- Desktop layout (3-zone grid `1fr auto 1fr`, side padding 40):
  - Left: wordmark "Chip Autopsy Lab", `headline` 15 px / 590 / -0.01em, primary. Click returns to landing (confirms nothing; the lot stays cached and appears under "Recent" in the lot picker).
  - Centre: lot picker (§4.2). Hidden on the landing state.
  - Right: language switcher (§4.10), 8 px, "Open STDF" secondary button (32 h).
- Mobile: left wordmark "Autopsy Lab" (key `nav.wordmarkShort`); centre lot picker compact; right globe icon button and folder-open icon button (both 44 x 44, `aria-label`).

### 4.2 Lot picker

- Trigger (pill, height 32, padding 0 12 0 14, `surface-2` at 60 %): lot ID `control` primary "CAL-ER-2401" + 8 px + lot title `control` secondary "Edge-Ring Plasma Etch" (hidden < 1024 px) + 6 px chevron-down 12 px. Hover: fill `surface-3`. Open: chevron rotates 180° (spring-snappy).
- Menu: anchored centre-bottom of trigger, 8 px gap, width 360, material, radius 24, padding 8, `transform-origin: top center`. Sections:
  - "Demo lots": 3 rows (height 56, radius 16, padding 8 12): 40 px wafer thumbnail, title `headline`, meta `footnote` tertiary "Yield 82.8%". Current lot row has a check icon on the right.
  - Separator.
  - "Recent": dropped files this session (file name, size), max 3.
  - Separator.
  - "Open STDF file…" with shortcut cap "⌘O" / "Ctrl O".
- Keyboard: Up/Down move, Enter selects, Esc closes and returns focus to trigger, typeahead by title. Built on Radix DropdownMenu.

### 4.3 Verdict hero

- `<h1>` with two spans. The cause phrase span is a `<button>` styled as text (orange, no underline at rest; on hover a 1 px underline at 6 px offset, `text-decoration-color: rgba(255,107,44,0.5)`); it toggles the spatial-pattern finding.
- Line limit 2 desktop, 3 mobile; if the localized text overflows, step down to 40 px desktop / 28 px mobile (single CSS clamp: `font-size: clamp(40px, 3.33vw, 48px)`).
- Verdict templates by pattern class (English):
  - Spatial pattern: "Cause of death: {pattern} failure."
  - Site anomaly: "Cause of death: test site {site} contact failure."
  - No dominant pattern: "Cause of death: random defects, no spatial signature."
  - Yield ≥ 99%: "No cause of death. Yield is {yield}." (no orange).

### 4.4 Confidence pill (the one pill in the verdict region)

- Height 28, padding 0 12, radius 999, `surface-2`, `footnote` secondary: "Confidence 0.95". Trailing 12 px info icon.
- Click opens a popover (width 300): "How this verdict was made" `headline`; body `callout` secondary: "Every number comes from the on-device analysis engine. The text is the built-in template." or, with the LLM narrator, "Every number comes from the on-device analysis engine. An AI model rephrased the text and every sentence cites an engine fact." This absorbs the old `NarrationBadge`.

### 4.5 Stat row

- `<dl>` with three `<div>` items. Number `<dd>` `stat` primary (key number in `failure`); caption `<dt>`, visually below via `flex-direction: column-reverse`, `footnote` secondary, 6 px gap, max 2 lines.
- Numbers count up on first reveal (§5.3). No borders, no cards, no icons.
- Edge-ring lot stats as in §3.4. Other lots: scratch "{n}% of fails on the scratch path"; site anomaly "{rate}% fail rate on site 2 vs {rate}% elsewhere". Stat selection comes from the verdict fact type; the template mapping lives in core (`stat-facts.ts`) and returns `{ value, format, captionKey, params, emphasis }`.

### 4.6 Findings list

- `<ul>` of rows. Row: `<button aria-expanded aria-pressed>` full width, padding 14 16, radius 16, min-height 64, grid `1fr auto`, column gap 16.
  - Headline `headline` primary, 1 line, ellipsis at desktop; wraps on mobile.
  - Sub-line `callout` secondary, 1 line desktop / 2 mobile, 2 px below.
  - Trailing `footnote` tertiary tabular: die count; becomes "Clear" when selected.
- Rows are separated by a `separator` 1 px line inset 16 px left and right; the line is hidden adjacent to a hovered or selected row (no double edges).
- Hover: `surface-1`. Selected: `surface-2`. Pressed: `surface-3` + scale 0.99.
- Expanded detail (selected only): 12 px below, `callout` secondary full sentence; if the fact has hypotheses, a list of "Check next: …" lines in `callout` primary.
- "Possible causes" row: same geometry with a chevron that rotates 90° on open; content lists 3 hypotheses each as headline (e.g. "Deposition or etch uniformity") + sub-line (the check-next step).

### 4.7 Wafer stage (canvas)

- DOM: `<div role="application" aria-roledescription="wafer map" aria-label="Wafer W01, 633 dies, 110 failing">` containing three canvases (base, fail, overlay) at device-pixel size, plus the HUD. A visually hidden table of failing dies (existing a11y table) stays.
- Rendering:
  - Base canvas: wafer disc, notch, all dies in their colours. Rendered at `devicePixelRatio x 2` of the fit-to-stage size (supersampled), capped at 4096 px per side, so CSS-scale zoom up to 2x stays crisp.
  - Fail canvas: fail dies only, used by the sweep completion fade; at rest it is merged into base and hidden.
  - Overlay canvas: scrim, glow, selection rect, hover outline, probe-head light. Sized to the stage viewport (not the wafer), redrawn only when its inputs change or an animation is running.
  - Camera: `{ scale, tx, ty }`. During any gesture or camera spring, base and fail canvases move via one CSS `transform: translate3d(tx, ty, 0) scale(s)` on their shared wrapper (composite only). After the camera settles for 120 ms at `scale > 2`, re-raster the visible region of the base at the new scale in one task (≤ 8 ms for 10,000 dies) and reset the CSS transform to match. Overlay draws in screen space every animated frame.
- Keyboard (stage focused): arrows move the hovered-die cursor 1 die (0 ms; camera pans only if the die leaves a 48 px inner margin), `+`/`=` zoom in 1.5x about the cursor die, `-` zoom out, `0` reset, `Enter` pins the magnifier, `Esc` clears selection then finding then pin, `S` toggles Select tool.

### 4.8 Hover magnifier

- Two parts in one material container (radius 16, padding 8, width 184):
  1. Loupe: 168 x 120 rounded 12, shows the 9 x 6 die neighbourhood around the hovered die at 3x the current on-screen die size, copied with `drawImage` from the base canvas; the hovered die gets a 1.5 px ice outline. Not shown on mobile (finger covers it) — mobile shows the readout only.
  2. Readout (`mono-data` values, `footnote` labels in sans, 2-column grid, row height 18):
     - "X, Y" `12, -4`
     - "Site" `2`
     - "Bin" `SBIN 7 IDDQ_EDGE_LEAK` (bin swatch shape at left)
     - "HBIN" `3`
     - Up to 2 key tests (the finding's test first): `IDDQ_LEAK  14.20 uA` with value in `failure-text` when out of limits plus the text "out of limits" (non-colour cue)
     - "Retested" `Yes, 2 passes` only when retested.
- Placement: 16 px right and 16 px above the pointer; flips horizontally/vertically to stay inside the stage with 8 px margin; never covers the hovered die (if no quadrant fits, place above the stage edge).
- Position follows the pointer 1:1 through `transform` written in a rAF (no spring, no state). Content updates when the hovered die changes (hit test is O(1) by grid index).
- Show: after the pointer rests 0 ms (immediately) on the first die, opacity 0 → 1 + scale 0.96 → 1 with `spring-snappy`, `transform-origin` at the corner nearest the pointer. Moving between dies does not re-animate. Hide: pointer leaves the wafer disc for 80 ms, opacity → 0 in 120 ms.
- Touch: tap a die shows the readout pinned above the die; tap elsewhere hides.

### 4.9 Wafer strip

- Horizontal `role="listbox"` `aria-orientation="horizontal"`, `overflow-x: auto`, `scroll-snap-type: x proximity`, children `scroll-snap-align: center`, `scrollbar-width: none`, momentum is native. Edge fade: `mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent)`.
- Thumbnail item: 48 x 48 desktop (40 mobile) circle canvas (ImageBitmap from the worker), gap 12, below it `caption` tertiary "W01" (desktop only; mobile shows the label only for the active wafer). Hit area 56 x 64.
- States: rest opacity 0.72; hover 1.0 and ring `accent-soft` 2 px; active: opacity 1, 2 px `accent` ring at 3 px offset, label primary; pressed scale 0.94.
- Active wafer scrolls into the centre with `scrollTo({ behavior: "smooth" })` on click; `instant` for keyboard repeat and reduced motion.
- Keyboard: roving `tabindex`; Left/Right ±1, Home/End, PageUp/PageDown ±5. Selection follows focus (the stage switches wafer on every step).

### 4.10 Language switcher

- Desktop trigger: ghost pill height 32, globe icon 16 + `control` "EN" / "简" / "繁" / "日" / "한". Mobile: icon button.
- Menu (width 220, material, radius 24, padding 8): rows in native names, each `lang` attribute set: "English", "简体中文", "繁體中文", "日本語", "한국어"; check on current; 0 ms open (keyboard-frequent), 120 ms fade when opened by pointer.
- Selecting applies instantly (no animation), updates `<html lang>`, persists, and announces "Language changed to English" via the live region (in the new language).

### 4.11 Buttons

| Variant | Size | Fill / text | Hover | Pressed |
|---|---|---|---|---|
| Primary | 44 h, padding 0 22, `control` 15 px / 590 | `#F5F5F7` / `#000` | `#FFFFFF` | scale 0.97, `#E8E8ED` |
| Secondary | 32 h (nav) or 44 h, padding 0 14 / 0 20 | `rgba(255,255,255,0.10)` / primary | `0.14` | scale 0.97, `0.08` |
| Ghost | 32 h, padding 0 10 | transparent / secondary | fill `0.06`, text primary | scale 0.97 |
| Text | inline, no padding, hit area extended 8 px | transparent / secondary (or primary) | text primary | opacity 0.7 |
| Icon | 32 x 32 (44 x 44 mobile), icon 16, radius 999 | transparent / secondary | fill `0.06` | scale 0.94 |

All radius 999. Icon + text buttons use 2 px less padding on the icon side (optical alignment). Only one primary button per screen.

### 4.12 Segmented control

- Height 32 (28 mobile), material, radius 999, padding 2. Segments `control` secondary; active segment primary on a `surface-3` thumb (radius 999) that slides with `spring-snappy` via Motion `layoutId` (on keyboard change: 0 ms). Radix ToggleGroup with `type="single"`.

### 4.13 Toasts (Sonner)

- Position bottom-centre, offset 24 (mobile: 16 + safe-area inset). Width 360 max. Material, radius 16, padding 12 16, `callout` primary title + optional `footnote` secondary body + optional text action right.
- Enter: y 16 → 0, opacity 0 → 1, `spring-ui`. Exit: opacity → 0, y → 8, 160 ms. Max 3 visible, stacked with 8 px gap. Duration 4 s; errors persist until dismissed.
- Copy: "Loaded 25 wafers in 0.8 s." / "Skipped {count} unrecognized records." / "Downloaded {fileName}." / "Bins-only mode is on."

### 4.14 Selection popover

- Material, radius 16, padding 12 14, width 220, z 30. Anchored to the selection rect's top-right corner with 8 px gap; flips to top-left / bottom-right / bottom-left so it never covers the rect or leaves the stage. While dragging it follows the corner 1:1 (rAF transform). Enter after the drag passes 8 px: opacity + scale 0.96 → 1, `spring-snappy`, origin at the anchored corner.

---

## 5. Motion and interaction

All Motion components import from `motion/react`. Every animation below checks `useReducedMotion()` (DOM) or a `prefersReducedMotion` flag passed to the canvas controller.

### 5.1 Probe-sweep load reveal

- Trigger: first lot load in a session (`sessionStorage["cal.sweep.seen"] !== "1"`). Later loads use a 240 ms fade of the base canvas.
- Order: dies sorted by part sequence (PRR order) on the current wafer, pre-sorted in the worker and transferred as `Uint32Array` die indices.
- Timing: total ≤ 1,200 ms. Reveal fraction `f(t) = min(parseProgress, easeInOutSine(t / 1200))`, so a slow parse holds the sweep instead of finishing early.
- Per frame: draw only newly revealed dies onto the base canvas in pass colour (incremental, total O(n)); overlay draws the probe-head light (ice sprite 3 die widths, 35 % alpha) at the last revealed die.
- Completion: the fail canvas (orange fail dies) fades `opacity 0 → 1` in 280 ms `ease-out`; then base is redrawn with final colours and the fail canvas hidden.
- Skip: any key, click, or tap completes immediately (draw all, show fails at once).
- Reduced motion: no sweep; the wafer appears complete with a 120 ms opacity fade.

### 5.2 Verdict rise-in

- Trigger: sweep reaches 85 % (or immediately on skip/no sweep).
- Elements (stagger 60 ms in this order): headline, sub-line, confidence pill, stat row, findings list (as one block).
- Each: `opacity 0 → 1`, `y 12 → 0`, `filter: blur(4px) → blur(0)`, `spring-ui`. The headline moves as one block (no word or letter splitting: CJK safe).
- Interruptible: a finding click or wafer interaction during the rise does not wait; springs continue from current values.
- Reduced motion: opacity only, 120 ms, no stagger.

### 5.3 Count-up stats

- Trigger: stat row's rise-in start; also when selection-linked values change (300 ms).
- From 0 (first reveal) or the previous value (updates) to target in 700 ms `ease-out-expo`, driven by one rAF loop writing `textContent` to refs (no React state per frame). Formatting via the locale's `Intl.NumberFormat` every frame, tabular figures so width does not jitter.
- Accessibility: the visible animating span is `aria-hidden`; a sibling visually hidden span holds the final value.
- Interruptible: a new target restarts from the current displayed value.
- Reduced motion: final value immediately.

### 5.4 Finding click: glow sequence and camera frame

1. On `pointerdown`: row fill changes to `surface-2` immediately (acknowledgement < 16 ms).
2. Scrim: overlay draws `dim-scrim` over all dies, punched out at evidence dies; scrim alpha animates 0 → 0.62 over 200 ms `ease-out`.
3. Camera: compute the bounding box of evidence dies on the current wafer; target scale = fit(bbox + 48 px padding), clamped to [1, 4]; if bbox covers ≥ 70 % of the wafer diameter (edge ring, near-full) the target is the fit view (scale 1). Animate tx, ty, scale with **independent** `spring-camera` integrators, starting from the current presentation values and velocity.
4. Glow sequence: each evidence die's glow alpha goes 0 → 1 over 180 ms `ease-out`, start delay by order:
   - Edge-Ring / Donut / Center: polar angle from 12 o'clock clockwise (a sweep around the ring).
   - Scratch: projection on the scratch's principal axis (a line drawn along the scratch).
   - Site anomaly / Random / Loc: distance from the cluster centroid.
   - Delay = `rank / (n - 1) x 420 ms` so the last die starts at 420 ms and finishes by 600 ms.
5. Overlay redraws every frame only while any glow, scrim, or camera animation is active; then the loop stops.
6. Second click (or Clear): scrim and glow alpha → 0 in 160 ms together; camera springs back to fit unless the user moved the camera.
7. Switching findings mid-animation: the old glow fades out from its current alpha while the new sequence starts; camera retargets with velocity preserved.
- Reduced motion: no stagger (all glows at once, 0 ms), camera jumps (0 ms), scrim at once.

### 5.5 Zoom, pan, inertia, reset

- Wheel (desktop, any `wheel` over the stage, `preventDefault`, `passive: false`): `scale *= exp(-deltaY x k)` with `k = 0.0015` (or `0.01` when `ctrlKey`, i.e. trackpad pinch); zoom about the pointer so the point under the cursor stays fixed. Applied directly (no spring) for 1:1 feel. `deltaMode` lines multiply by 16.
- Pinch (touch): two pointers, scale from distance ratio, centroid anchored; also pans with the centroid.
- Drag pan: `pointerdown` + 4 px threshold, `setPointerCapture`, 1:1 tracking respecting grab offset. Keep the last 5 `pointermove` samples (≤ 100 ms) for velocity.
- Release: projected end = `pos + (v / 1000) x 0.998 / (1 - 0.998)` per axis; animate to the projected end with `spring-camera` and the release velocity. If the projection passes the bounds (wafer may not leave the stage by more than 50 % of its diameter), target the bound and use `spring-throw`.
- While dragging past bounds, apply rubber-band `(o x d x 0.55) / (d + 0.55 x |o|)`.
- Scale limits [1, 8]; past the limits during pinch, rubber-band the scale with the same formula in log space; release springs back.
- Double-click / double-tap: reset to fit with `spring-camera`. If already at fit, zoom 2.5x about the point.
- Any new gesture during a spring cancels it and starts from the presentation values.
- Reduced motion: no inertia (stop on release), resets jump instantly; wheel and drag stay 1:1.

### 5.6 Hover magnifier

See §4.8. Pointer tracking 1:1 in rAF; show `spring-snappy`; hide 120 ms. The loupe's `drawImage` runs once per hovered-die change, not per frame. Reduced motion: show/hide opacity only.

### 5.7 Box select with live stats

- Shift+drag or Select tool: the rect follows the pointer 1:1 in overlay canvas. Stats recompute on every pointermove, throttled to one per rAF: the dies-in-rect count is computed from the grid range (O(rect area)), so 10,000 dies stays under 1 ms on the main thread. Lot-wide recomputes (25 wafers) post to the worker with a request id; stale responses are dropped.
- On release the rect snaps to die cell edges with `spring-snappy` per edge; popover gains the footer actions.
- "Zoom to selection": camera frame as in §5.4 step 3.

### 5.8 Wafer strip scroll-snap, scrub, crossfade

- Scroll: native momentum with `scroll-snap-type: x proximity`.
- Wafer change from a click or a single key press: the stage keeps two stacked base wrappers; the new wafer is drawn into the hidden one, then crossfade old → new in 160 ms `ease-out` (opacity only). The camera keeps its scale and position across wafers so the same spot can be compared.
- Key-repeat scrub (`event.repeat === true`) and reduced motion: swap instantly (0 ms), no crossfade.
- Thumbnail ring moves instantly (it is a state indicator).

### 5.9 Other UI motion

| Element | Trigger | Animation |
|---|---|---|
| Menus, popovers | open / close | opacity + scale 0.96 → 1 from the trigger-side origin, `spring-ui`; close 120 ms opacity + scale 0.98 |
| Sheets | open | desktop: opacity + scale 0.96, `spring-ui`; mobile bottom sheet: y 100 % → 0, `spring-ui` with drag-to-dismiss (velocity > 500 px/s or 30 % height) |
| Drag overlay | dragenter / dragleave | opacity 120 ms; headline scale 0.98 → 1 `spring-snappy` |
| Finding row expand | select | Motion `layout` on the list, `spring-ui`; content opacity 0 → 1 after 60 ms |
| Nav separator | scroll | opacity 120 ms |
| Landing card hover | hover | thumbnail wafer scale 1 → 1.03, 240 ms `ease-out`; card `ring` → `ring-strong` |

Every DOM transition lists explicit properties (`transition-property: opacity, transform` or `background-color`); never `transition: all`.

### 5.10 Performance budget

- DOM animation: `transform` and `opacity` only. `filter: blur()` only on the verdict rise-in (≤ 4 px, once). No animated `box-shadow`, `width`, `height`, `top`, `left`. Height expand uses Motion `layout` (transform-based).
- Canvas: base raster ≤ 8 ms for 10,000 dies; overlay frame ≤ 4 ms (glow via pre-rendered sprites and `drawImage`; no `shadowBlur` per die); magnifier `drawImage` ≤ 1 ms.
- No React re-render on pointermove, wheel, or animation frames: camera, magnifier position, rect, and count-up write to refs/canvas. Zustand subscriptions only for discrete changes (finding, wafer, mode, committed brush).
- Worker owns: parsing, analytics, lot-wide brush stats, probe-order arrays, thumbnail rendering (OffscreenCanvas → `ImageBitmap`, transferred). Main thread fallback for thumbnails uses `requestIdleCallback` in 5-thumbnail batches.
- `will-change: transform` only on the camera wrapper and only while a gesture or spring is active.

**Perf gate (Playwright, Chromium):** `e2e/perf-gate.spec.ts`

1. Load `/`, click the `edge-ring-etch` card, wait for `[data-testid="verdict-headline"]` visible and the sweep finished (`data-sweep="done"` on the stage).
2. Inject a recorder: `PerformanceObserver` on `long-animation-frame` (fallback `longtask` when unsupported), buffered; and a rAF loop pushing frame deltas.
3. Start recording, then script: 12 wheel events (`deltaY: -120`, 50 ms apart) over the wafer centre; 2 mouse drags of 200 px in 300 ms with 20 move steps; double-click; focus the strip and press ArrowRight 10 times 80 ms apart; click finding 1, wait 700 ms, click it again; Shift+drag a 200 x 160 rect.
4. Stop after the last action + 500 ms.
5. Assert: no long-animation-frame (or long task) with `duration > 50` ms; median rAF delta < 20 ms; p95 rAF delta < 34 ms; every action's first visual acknowledgement < 100 ms (measured by `data-ack` timestamps written on pointerdown/keydown handlers vs event `timeStamp`).
6. The test logs the numbers to the console for `logs/`.

---

## 6. Internationalization

### 6.1 Locales

`en` (source, default), `zh-CN`, `zh-TW`, `ja`, `ko`. Type: `type Locale = "en" | "zh-CN" | "zh-TW" | "ja" | "ko"`.

### 6.2 Files

```
src/core/i18n/
  locales.ts              # Locale type, SUPPORTED_LOCALES, nativeName map, matchLocale()
  dictionary.ts           # Dictionary type derived from en, t(), interpolation, plural helper
  messages/en.ts          # `export const en = { ... } as const`
  messages/zh-cn.ts       # `export const zhCN = { ... } satisfies Dictionary`
  messages/zh-tw.ts
  messages/ja.ts
  messages/ko.ts
  format.ts               # Intl formatters per locale (cached)
  i18n.test.ts            # key parity, placeholder parity, determinism
src/ui/i18n/
  I18nProvider.tsx        # React context, persistence, <html lang> sync
  use-t.ts                # useT() hook returning bound t and formatters
```

Core holds dictionaries because the template report renders in core and must stay framework-free.

### 6.3 Typed dictionary

```ts
export type MessageKey = keyof typeof en;
export type Dictionary = { readonly [K in MessageKey]: string };
type Params<S extends string> =
  S extends `${string}{${infer P}}${infer Rest}` ? { [K in P | keyof Params<Rest>]: string | number } : {};
export function t<K extends MessageKey>(locale: Locale, key: K, ...params: keyof Params<(typeof en)[K]> extends never ? [] : [Params<(typeof en)[K]>]): string;
```

- Interpolation: `{name}` replaced by the param; numbers in params must be pre-formatted by the caller via `format.ts` (so formatting is explicit and locale-correct).
- Plurals: English keys that need it use `.one` / `.other` suffixes (`findings.dieCount.one`, `.other`) selected by `Intl.PluralRules(locale)`; CJK dictionaries supply `.other` and copy it into `.one`.
- Missing key at runtime is impossible by type; the parity test also checks that each locale string has the same `{placeholder}` set as English.

### 6.4 Detection, switcher, persistence

1. `localStorage["cal.locale"]` if it is a supported value.
2. Else first match in `navigator.languages`: `zh-TW`, `zh-HK`, `zh-MO`, or any `zh-Hant*` → `zh-TW`; other `zh*` → `zh-CN`; `ja*` → `ja`; `ko*` → `ko`; `en*` → `en`.
3. Else `en`.

A tiny inline script in `layout.tsx` (`<script>` before hydration) applies steps 1–3 to `document.documentElement.lang` and `data-locale` to prevent a flash; `<html suppressHydrationWarning>`. The provider reads `data-locale` on mount. The switcher writes `localStorage`, updates `lang`, and re-renders. No URL locale segments (single-page tool).

### 6.5 Formatting

`format.ts` caches per locale:
- Integers: `Intl.NumberFormat(locale, { maximumFractionDigits: 0 })` → `15,825` (all five locales group with commas).
- Yield and percents: `Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })` on a ratio → `82.8%`.
- Cp/Cpk and confidence: 2 decimals.
- Durations: `Intl.NumberFormat(locale, { style: "unit", unit: "second", unitDisplay: "narrow", maximumFractionDigits: 1 })` → `0.8s`/`0.8秒`.
- File sizes: `{ style: "unit", unit: "megabyte", maximumFractionDigits: 1 }`.
- Parametric values keep the SI prefix strings from `src/ui/format.ts` (`uA`, `mV`), with the number part localized.

### 6.6 Untranslated content

Never translate: bin names (`IDDQ_EDGE_LEAK`), bin codes (`SBIN 7`, `HBIN 3`), test names and numbers, STDF record and field names (`FAR`, `PRR`, `CPU_TYPE`, `STDF_VER`), lot/part/job/wafer IDs (`CAL-ER-2401`, `W01`), file names, units, WM-811K class names (`Edge-Ring`, `Scratch`, `Center`, …), and the product name "Chip Autopsy Lab". Wrap them in `<bdi>` / `<span translate="no">` when embedded in localized sentences.

### 6.7 CJK typography

```css
:root[lang="zh-CN"] { --font-cjk: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC"; }
:root[lang="zh-TW"] { --font-cjk: "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Source Han Sans TC"; }
:root[lang="ja"]    { --font-cjk: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans JP"; }
:root[lang="ko"]    { --font-cjk: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR"; }
body { font-family: var(--font-inter), "Inter", var(--font-cjk, sans-serif), system-ui, sans-serif; }
```

- Latin and digits stay in Inter (Inter has no CJK glyphs, so the browser falls through to the CJK face per glyph). System fonts only: no CJK webfont download.
- For `:lang(zh-CN), :lang(zh-TW), :lang(ja), :lang(ko)`: `letter-spacing: 0` on every token (override the negative tracking), `font-variation-settings` unchanged for Latin runs; line-height: display 1.2, `display-l` 1.25, headline 1.4, body/callout 1.65, footnote 1.5.
- Verdict size steps down to 44 px desktop / 30 px mobile for CJK (denser glyphs read larger).
- `line-break: strict` for zh/ja; `word-break: keep-all` for ko; `text-wrap: balance` kept for headings, `pretty` disabled for CJK (no effect, avoids cost).
- No italics; emphasis by weight 590 or colour.
- `display-xl` landing headline in CJK uses weight 600 and 64 px desktop / 40 px mobile.

### 6.8 English string table (source of truth: `src/core/i18n/messages/en.ts`)

```ts
export const en = {
  // App + nav
  "app.title": "Chip Autopsy Lab",
  "app.description": "Find out why a wafer lot lost yield. STDF V4 analysis that runs in your browser.",
  "nav.wordmark": "Chip Autopsy Lab",
  "nav.wordmarkShort": "Autopsy Lab",
  "nav.openStdf": "Open STDF",
  "nav.openStdfAria": "Open an STDF file",
  "nav.languageAria": "Change language",
  "nav.home": "Back to start",

  // Lot picker
  "lotPicker.triggerAria": "Choose lot, current lot {lotId}",
  "lotPicker.demoSection": "Demo lots",
  "lotPicker.recentSection": "Recent",
  "lotPicker.openFile": "Open STDF file…",
  "lotPicker.yield": "Yield {yield}",
  "lotPicker.current": "Current lot",

  // Landing
  "landing.headline": "Drop the body.",
  "landing.subline": "Drop an STDF V4 wafer sort log anywhere on this page. It is parsed on this device and never uploaded.",
  "landing.primary": "Open STDF file",
  "landing.formats": ".stdf, .std, or gzip",
  "landing.demoHeading": "Or open a demo lot",
  "landing.privacy": "Runs entirely in your browser. Raw STDF bytes never leave this device.",
  "landing.downloadDemos": "Download demo files",
  "landing.demoMeta": "{wafers} wafers, {dies} dies",
  "demo.edgeRing.title": "Edge-Ring Plasma Etch",
  "demo.edgeRing.description": "Outer-ring IDDQ leakage after focus-ring erosion",
  "demo.scratch.title": "Robotic Handling Scratch",
  "demo.scratch.description": "A transfer-blade scratch across wafers 5 to 22",
  "demo.site2.title": "Site 2 Probe Contact",
  "demo.site2.description": "Oxidized site 2 needles cause opens and retests",
  "demo.openAria": "Open demo lot {title}",

  // Drag overlay
  "drop.headline": "Drop the body.",
  "drop.subline": "Release to open. STDF, STD, or gzip.",
  "drop.notFile": "Only files can be opened here.",

  // Loading
  "loading.readingRecords": "Reading records",
  "loading.readingWafer": "Reading wafer {current} of {total}",
  "loading.bytes": "{done} of {total}",
  "loading.skipHint": "Press any key to skip the animation.",
  "loading.progressAria": "Parsing {percent}",

  // Verdict
  "verdict.prefix": "Cause of death:",
  "verdict.pattern": "{pattern} failure.",
  "verdict.site": "test site {site} contact failure.",
  "verdict.random": "random defects, no spatial signature.",
  "verdict.healthy": "No cause of death. Yield is {yield}.",
  "verdict.subline": "Yield {yield} across {wafers} wafers. Most loss in {bin}.",
  "verdict.causeAria": "Show the dies behind this verdict",
  "verdict.confidence": "Confidence {value}",
  "verdict.methodTitle": "How this verdict was made",
  "verdict.methodTemplate": "Every number comes from the on-device analysis engine. The text is the built-in template.",
  "verdict.methodLlm": "Every number comes from the on-device analysis engine. An AI model rephrased the text and every sentence cites an engine fact.",

  // Stats
  "stats.edgeShare": "of fails sit in the outer {rings} rings",
  "stats.scratchShare": "of fails on the scratch path",
  "stats.siteRate": "fail rate on site {site} vs {other} elsewhere",
  "stats.finalYield": "final yield, {firstPass} first pass",
  "stats.failingDies": "failing dies of {tested} tested",
  "stats.inSelection": "{caption} in selection",

  // Findings
  "findings.heading": "Findings",
  "findings.dieCount.one": "{count} die",
  "findings.dieCount.other": "{count} dies",
  "findings.inSelection": "{count} of {total} in selection",
  "findings.clear": "Clear",
  "findings.possibleCauses": "Possible causes",
  "findings.checkNext": "Check next: {step}",
  "findings.edgeBand.headline": "{share} of fails are in the edge band",
  "findings.edgeBand.sub": "{edgeRate} edge fail rate vs {interiorRate} interior, on {wafers} of {total} wafers",
  "findings.scratch.headline": "A scratch crosses {wafers} wafers",
  "findings.scratch.sub": "{dies} dies on one path, {share} of fails",
  "findings.dominantBin.headline": "{bin} leads the loss",
  "findings.dominantBin.sub": "{dies} dies, {share} of fails",
  "findings.secondaryBin.headline": "{bin} adds {share} of fails",
  "findings.secondaryBin.sub": "{dies} dies on {wafers} wafers",
  "findings.capability.headline": "Test {test} has Cpk {cpk}",
  "findings.capability.sub": "Mean {mean} against limits {lo} to {hi}",
  "findings.site.headline": "Site {site} fails {ratio} times more often",
  "findings.site.sub": "{rate} fail rate on site {site} vs {other} on the other sites, {retests} retests",
  "findings.excursion.headline": "Wafer {wafer} dropped to {yield}",
  "findings.excursion.sub": "{delta} below the lot median",
  "findings.lotYield.headline": "Final yield {yield}",
  "findings.lotYield.sub": "{firstPass} first pass, {retests} retested dies",
  "hypothesis.etchUniformity": "Deposition or etch uniformity",
  "hypothesis.etchUniformity.check": "Compare chamber logs for the edge zone and check focus-ring hours.",
  "hypothesis.mechanical": "Mechanical handling",
  "hypothesis.mechanical.check": "Inspect transfer-blade alignment for the affected slots.",
  "hypothesis.probeCard": "Probe card or tester site, not process",
  "hypothesis.probeCard.check": "Clean or replace the site {site} needles and re-probe a sample.",
  "hypothesis.random": "Random particle defects",
  "hypothesis.random.check": "Review particle counts and defect inspection for the lot.",

  // Wafer stage
  "stage.aria": "Wafer {wafer}, {dies} dies, {fails} failing",
  "stage.roleDescription": "wafer map",
  "stage.mode.passFail": "Pass/Fail",
  "stage.mode.hbin": "HBIN",
  "stage.mode.sbin": "SBIN",
  "stage.tool.pan": "Pan",
  "stage.tool.select": "Select",
  "stage.legend.pass": "Pass {count}",
  "stage.legend.fail": "Fail {count}",
  "stage.legend.more": "+{count} more",
  "stage.legend.toggleAria": "Show or hide {bin}",
  "stage.zoomReset": "Reset zoom",
  "stage.evidenceCaption": "{dies} dies on {wafers} wafers, {here} on this wafer",

  // Magnifier
  "magnifier.coords": "X, Y",
  "magnifier.site": "Site",
  "magnifier.bin": "Bin",
  "magnifier.hbin": "HBIN",
  "magnifier.outOfLimits": "out of limits",
  "magnifier.retested": "Retested",
  "magnifier.retestedValue": "Yes, {count} passes",
  "magnifier.notch": "Notch",
  "magnifier.notchValue": "{clock} o'clock",

  // Selection popover
  "selection.dies.one": "{count} die",
  "selection.dies.other": "{count} dies",
  "selection.failing": "Failing",
  "selection.yield": "Yield",
  "selection.topBin": "Top bin",
  "selection.none": "None",
  "selection.clear": "Clear",
  "selection.zoom": "Zoom to selection",

  // Strip
  "strip.aria": "Wafers in lot {lotId}",
  "strip.itemAria": "Wafer {wafer}, yield {yield}",

  // Errors
  "error.notStdf.title": "This file isn't an STDF log.",
  "error.notStdf.body": "The first record must be FAR (0, 10). This file starts with bytes {hex}.",
  "error.version.title": "This STDF version isn't supported.",
  "error.version.body": "FAR reports STDF_VER {version}. Chip Autopsy Lab reads STDF V4.",
  "error.vax.title": "DEC VAX byte order isn't supported.",
  "error.vax.body": "FAR.CPU_TYPE is 0. Re-export the log with CPU_TYPE 1 or 2.",
  "error.truncated.title": "The file ends in the middle of a record.",
  "error.truncated.body": "Record {recType} at byte {offset} needs {need} bytes, but only {have} remain. Wafers before it were read.",
  "error.gzip.title": "The gzip stream couldn't be decompressed.",
  "error.gzip.body": "The file starts with gzip bytes 1F 8B but the stream is corrupt at byte {offset}.",
  "error.empty.title": "The file is empty.",
  "error.empty.body": "Choose a file that contains STDF records.",
  "error.noParts.title": "No tested dies found.",
  "error.noParts.body": "The log has no PRR records, so there is nothing to map.",
  "error.openAnother": "Open another file",
  "error.loadDemo": "Load demo lot",
  "error.showDetails": "Show details",
  "error.detailsTitle": "Details",

  // Bins-only
  "binsOnly.sheetTitle": "This file is {size}.",
  "binsOnly.sheetBody": "Parsing every test result may take about {seconds}. Bins-only mode skips parametric results and keeps the wafer maps, bins, and yield.",
  "binsOnly.useBinsOnly": "Use bins-only",
  "binsOnly.parseAll": "Parse everything",
  "binsOnly.notice": "Bins-only mode. Parametric findings are hidden.",

  // Toasts
  "toast.loaded": "Loaded {wafers} wafers in {duration}.",
  "toast.skippedRecords": "Skipped {count} unrecognized records.",
  "toast.downloaded": "Downloaded {fileName}.",
  "toast.binsOnly": "Bins-only mode is on.",
  "toast.dismiss": "Dismiss",

  // Language
  "language.changed": "Language changed to {language}.",
  "language.menuTitle": "Language",

  // Shortcuts / a11y
  "shortcut.open": "Open file",
  "a11y.skipToVerdict": "Skip to verdict",
  "a11y.failingDiesTable": "Failing dies on wafer {wafer}",
} as const;
```

The native language names (`English`, `简体中文`, `繁體中文`, `日本語`, `한국어`) live in `locales.ts`, not in dictionaries; they are never translated.

### 6.9 Report generation per locale

- `template-report.ts` keeps building facts and claims; each `ReportClaim` gains `messageKey` and `params` (raw numbers plus untranslated tokens). `renderReport(report, locale)` in core turns them into strings with `t` and `format.ts`. The existing English `text` field stays for the LLM payload and tests.
- Determinism test: for each demo lot and each locale, rendering twice yields identical strings; snapshot the `en` output.
- The LLM narrator only runs for `en` in this phase; for other locales the template is used (state "built-in template" in the method popover).

---

## 7. Halloween touch (exactly three moments)

1. **"Drop the body."** as the landing headline and the drag-over line, set huge and plain with no imagery. Translated literally per locale (e.g. ja "遺体をここに。", zh-CN "把遗体放这里。") — translators keep it short and deadpan.
2. **"Cause of death:"** as the verdict prefix, with the cause phrase in orange.
3. **The probe sweep's light.** The single ice probe-head glow that travels across the wafer once per session, like an examination lamp passing over the body. No sound, no flicker.

Nothing else: no skulls, no pumpkins, no orange outside failures, no spooky fonts, no "autopsy" in buttons, errors, or toasts.

---

## 8. Implementation plan

Each chunk is ≤ 15 minutes for one engineer, ships green (`pnpm lint && pnpm typecheck && pnpm test`), and does not break the existing e2e vertical slice. Order matters: later chunks rely on earlier ones.

**R1. Tokens and globals**
- Update `src/ui/tokens/palette.ts`, `tokens.ts`, `src/app/globals.css` `@theme` to §2 (colours, type scale, radii, motion, z-index). Rename `accent` to ice `#D6E6FF`, `failure` to `#FF6B2C`, `passDie` to `#63666C`, `bg` to `#000000`. Add CJK font variables and `:lang()` overrides (§6.7).
- Update `palette.test.ts` / `palette.prop.test.ts` to assert the §2.1 values and ratios.
- Accept: tests pass; computed contrast `pass-die`/`#000` ≥ 3.0, `pass-die`/`#141416` ≥ 3.0, tertiary ≥ 4.5 on `#000` and `#1A1A1C`; `grep -r "7CF2C1\|FF7A1A" src` returns nothing.

**R2. i18n core and provider**
- Add `src/core/i18n/*` (§6.2–6.5) with full `en` table (§6.8) and the four translations; `src/ui/i18n/I18nProvider.tsx`, `use-t.ts`; inline locale script in `layout.tsx`.
- Accept: `i18n.test.ts` proves every key exists in all 5 locales with identical placeholder sets; `matchLocale(["zh-HK"]) === "zh-TW"`, `(["zh"]) === "zh-CN"`, `(["fr"]) === "en"`; core lint gate passes (no React in core).

**R3. Primitives and nav**
- Restyle `button.tsx` to §4.11 variants; add `segmented-control.tsx`, `menu` (Radix DropdownMenu) styles; build `NavBar`, `LotPicker`, `LanguageSwitcher`; remove the old header, toolbar row, `Browser Sandbox` badge, footer counter.
- Accept: at 1440 x 900 the nav is 52 px with three zones; at 390 px it is 48 px with two icon buttons; switching language updates `<html lang>` and persists across reload; Tab order: wordmark, lot picker, language, Open STDF; focus rings are ice 2 px.

**R4. Landing, drag overlay, parse error, bins-only**
- Rebuild `EmptyStateCard` as the landing hero with three demo cards and worker-rendered W01 thumbnails; restyle `FullWindowDropZone`; add error view with the §3.7 code table; add bins-only sheet and notice.
- Accept: landing matches §3.1 above-the-fold at both viewports (Playwright screenshot `e2e/__screenshots__/landing-{desktop,mobile}.png`); one click on a card loads the lot; dropping a PNG shows "This file isn't an STDF log." with the hex prefix; a stubbed 312 MB size shows the sheet with "Use bins-only" focused.

**R5. Verdict column**
- Restructure `AutopsyReportCard` into `VerdictHero`, `ConfidencePill` (absorbs `NarrationBadge`), `StatRow`, `FindingsList`; add `messageKey/params` to claims and `renderReport(report, locale)`; add `stat-facts.ts`.
- Accept: edge-ring lot shows "Cause of death: Edge-Ring failure." in ≤ 2 lines at 553 px with the cause phrase orange; exactly 3 stats; finding rows are one-line headline + sub-line with no borders; no monospace or ALL-CAPS labels in the column (DOM check for `font-family` and `text-transform`); report rendering deterministic per locale (unit test).

**R6. Wafer stage: layout, rendering, camera**
- New loaded layout (§3.4 grid); stage without panel box; vignette and top light; pass/fail geometry cue; three canvases; camera controller (wheel, pinch, drag, inertia, rubber-band, double-click reset) writing CSS transforms on the wrapper and re-rastering after settle.
- Accept: wafer diameter ≥ 560 px at 1440 x 900 and 350 px at 390 px; wheel zooms about the cursor; flick pan coasts and stops softly; double-click resets; no React render during a drag (React Profiler or a render counter test); existing arrow-key stepping still works.

**R7. Linked interactions**
- Hover magnifier (§4.8); finding select scrim + ordered glow + camera frame (§5.4); box select with live popover and linked stats (§3.6, §5.7); strip with scroll-snap, roving keyboard, crossfade, evidence dots (§4.9, §5.8).
- Accept: clicking the edge-band finding lights dies around the ring clockwise within 600 ms and dims the rest; clicking again clears; Shift+drag shows "N dies / Failing / Yield / Top bin" updating during the drag; ArrowRight held through 25 wafers swaps instantly without crossfade; magnifier never covers the hovered die (unit test of placement function).

**R8. Reveal motion, reduced motion, perf gate**
- Probe sweep (§5.1), verdict rise-in (§5.2), count-up (§5.3), toasts styling (§4.13); `prefers-reduced-motion` paths everywhere; `e2e/perf-gate.spec.ts` (§5.10); update `logs/` with the measured numbers.
- Accept: first demo load shows the sweep ≤ 1.2 s, skippable by a key; second load fades; with `reducedMotion: "reduce"` in Playwright there is no sweep, no stagger, and stats show final values immediately; perf gate passes: 0 frames > 50 ms, median rAF < 20 ms, p95 < 34 ms; demo time-to-verdict < 3 s.
