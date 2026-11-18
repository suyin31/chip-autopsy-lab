# Chip Autopsy Lab: Premium Specification (P-series)

Status: approved for implementation. This document **supersedes `redesign.md` for every visual and interaction decision** (tokens, typography, wafer rendering, layout, components, motion, copy tone). `redesign.md` still holds for anything this file does not mention: data flow, worker API, selection store, i18n plumbing (§6.1–§6.5, §6.9), parse error codes, bins-only logic, and the perf gate procedure. `design.md` and `requirements.md` keep the data model and correctness properties. Where `.kiro/steering/design-language.md` disagrees with this file, this file wins, and task P1 rewrites the steering file to match.

Reference viewports (CSS px): **desktop 1440 x 900** (primary), **desktop 1280 x 800**, **tablet 1024 x 768**, **mobile 390 x 844**.

Inputs: owner verdict on `logs/shots/r8-desktop.png`, `r8-mobile.png`, `t10-sbin.png`, `t10-full.png`, frames of `r8-demo.mp4`; `design-refs/*` and `design-refs/premium-references.md`; skills `apple-design`, `frontend-design`, `make-interfaces-feel-better` (+ `typography.md`, `surfaces.md`, `animations.md`, `icons.md`, `performance.md`), `animation-performance`.

Notation: `§n` = section of this file. `A-nn` = acceptance item in §12. Every colour is given as hex (sRGB). Contrast ratios are WCAG 2.x relative-luminance ratios, computed for this spec.

---

## 0. Diagnosis of the current build

| Seen in the R8/T10 screenshots and video | Why it reads cheap | Premium fix |
|---|---|---|
| Pass dies are `#63666C` squares at 72 % of the cell, 633 of them, the same weight as the fail dies | The wafer reads as a spreadsheet grid; the 110 dead dies have no stage | Pass dies become a faint texture on the silicon (1.2:1, §5.3). Fail dies are the only bright marks. |
| Orange on the 48 px cause phrase, the 93.8 % stat, 110 dies, 25 thumbnails, the legend, and the Pareto bars | Orange is everywhere, so it marks nothing | One accent, three uses per screen at most (§3.4). Stats, findings, and non-dominant bars lose their colour. |
| Wafer disc is a flat `#0B0B0C` fill with a 1 px ring and a tiny notch | No material, no light, no depth: a diagram, not an object | Polished-silicon disc with body gradient, thin-film iridescence, bevel, exclusion ring, real notch, and a contact shadow (§5.2). |
| Verdict column above the fold holds about 16 lines of text: 2-line sub-line with `SBIN 7 IDDQ_EDGE_LEAK`, 2-line stat captions, three 2-line findings with trailing counts | Dense, jargon-first; a first-time judge cannot find the point | Verdict + one plain sentence + one button + 3 stats + 3 one-line findings. Jargon moves one click deeper (§2, §6.2). |
| Two segmented controls (`Pass/Fail HBIN SBIN`, `Pan Select`) above the wafer, legend bottom-left, a floating `W01` bottom-right | Controls are scattered around the hero; jargon-only labels | One control row under the wafer; plain labels; a wafer title above it (§6.2, §7.7). |
| Wafer strip: active `W01` ring clipped at the top, last thumbnail cut mid-glyph (`V`) | Clipping reads as unfinished | Scroller padding contains the ring; edge fades and chevrons (§5.8). |
| Video: expanding a finding makes the next rows' text overlap for ~200 ms | Layout animation scales text containers | Content snaps in flow; siblings move by `layout="position"` only; body fades (§8.6). |
| Video: clicking the stage draws a heavy white rectangle around it | Focus ring shown on mouse focus | `:focus-visible` only, inset 28 px radius (§7.6). |
| Video: evidence mode dims orange dies under a black scrim and they turn salmon-brown | A third, muddy colour appears | Dimming uses the disc colour and evidence keeps pure ember with a white rim (§5.4). |
| Magnifier in Geist Mono with 7 rows | Debug console, not a product | Inter tabular, 4 rows, status first (§7.15). |
| All UI motion is the same 120 ms fade | Generic | Springs for touchable things, one cinematic reveal, two quiet delight moments (§8). |

---

## 1. Principles, and what "expensive" means here

### 1.1 Principles (the 6 rules every decision is checked against)

1. **The wafer is a lit object.** One hero per screen: a polished dark silicon disc on a light page, with real material, light, and a contact shadow. Nothing competes with it.
2. **One accent, spent on death.** Ember orange marks failing dies and at most two other things per screen. Everything else is ink and grey.
3. **The answer comes first, in plain words.** Every screen and every panel opens with one sentence a non-engineer understands; numbers come second; jargon comes third, with a definition on hover.
4. **One obvious next action.** Each screen has exactly one filled button. Everything else is quieter.
5. **Space is the luxury.** Fewer blocks, larger gaps, hairlines instead of boxes, no element touching an edge.
6. **Motion has mass and never waits.** Springs without bounce for UI, 1:1 tracking for the wafer, one reveal per session, and instant response to every key.

### 1.2 "Expensive" in this product, concretely

- **Restraint you can measure:** at most 5 content blocks above the fold; at most 3 accent uses per viewport; at most 1 filled button per screen; at most 2 text colours per block.
- **Material, not decoration:** the only rich rendering is the silicon disc (gradient, film, bevel, shadow). UI chrome is flat white or translucent material with a hairline.
- **Precision:** tabular numerals on every number, concentric radii, optical alignment of icons, 1 px hairlines at exactly 8 % ink, nothing clipped, nothing off-grid.
- **Calm interaction:** hover changes are fills and opacity at 120–160 ms; nothing bounces; nothing animates that the user did not cause, except the one reveal.
- **Confidence in copy:** short declarative sentences, no exclamation marks, no hedging adverbs, no apologies.

### 1.3 DON'Ts (rejected in review without discussion)

1. No orange on stats, finding text, legend labels, Pareto bars other than the dominant one, buttons, links, icons, focus rings, or selection.
2. No second accent colour. Focus, selection, and active states use ink (light) or white (dark).
3. No ALL-CAPS labels, no letter-spaced eyebrows, no monospace labels, no meta strings joined with middle dots, no `→` appended to button text.
4. No boxes inside boxes. A card never contains another card or a bordered panel.
5. No gradients on DOM surfaces or charts. The disc and the sheen are the only gradients and they live inside the wafer stage.
6. No bounce (`bounce > 0`) on any UI spring. `spring-throw` exists only for the wafer rubber-band return.
7. No `transition: all`, no animated `width`/`height`/`top`/`left`/`box-shadow`, no `layout` (size) animation on text containers.
8. No unprompted motion except the probe-sweep reveal (§8.1) and the verdict rise-in (§8.2). No looping animation anywhere.
9. No jargon-only control label (`HBIN`, `SBIN`, `Cpk`, `PRR`) without a plain-language label or a definition (§2.3).
10. No skulls, cobwebs, pumpkins, novelty fonts, or Halloween imagery. The theme lives in two phrases and one light (§10.4).
11. No font weight >= 700. No text under 12 px. No informative text below 4.5:1.
12. No element that clips: thumbnails, rings, focus outlines, popovers, and glyph descenders must all be fully visible at every reference viewport.

---

## 2. Clarity (first-time user, no ATE background)

The target user for every screen in this section is a hackathon judge who has never seen an STDF file. They must be able to say what the product does and what the wafer shows within 10 seconds, without reading any tooltip.

### 2.1 The three questions each screen answers above the fold

| Screen | What is this? | What happened? | What do I do next? (the one filled button) |
|---|---|---|---|
| Landing | Headline + one-sentence subline (§6.1) | Not applicable | **Open the sample lot** (loads `edge-ring-etch`) |
| Loading | File name + "Reading wafer 7 of 25" | Dies appear in test order | None (no button; any key skips the reveal) |
| Loaded verdict | Wafer title "Wafer W01" + "110 of 633 dies failed" | Verdict headline + plain takeaway sentence | **Show on wafer** (lights the dies behind the verdict) |
| Parse error | Error title in plain words | Error body says what is wrong | **Open another file** |
| Bins-only sheet | Sheet title states the file size | Body says what bins-only keeps | **Use bins-only** |

Rule: if a screen needs a second filled button, the design is wrong; demote one to secondary.

### 2.2 Plain-language labels

Every control and heading uses the plain label below. The domain term, where kept, is defined on hover (§2.3). Bin codes, test names, and WM-811K class names stay untranslated and verbatim (§10.2).

| Old label | New label (en) | Term defined on hover |
|---|---|---|
| `Pass/Fail` / `HBIN` / `SBIN` (segments) | `Pass/fail` / `Hard bins` / `Soft bins` | "Hard bins", "Soft bins" |
| `Pan` / `Select` (segmented control) | Removed. One icon button "Select an area" (§7.7) | — |
| `Confidence 0.95` (pill) | `High confidence, 0.95` (text button, §7.4) | "Confidence" |
| Sub-line "Yield 82.8% across 25 wafers. Most loss in SBIN 7 IDDQ_EDGE_LEAK." | Takeaway sentence (§10.3), no bin codes | "Yield" inside the sentence |
| Stat caption "of fails sit in the outer 3 rings" | "of failing dies are in the outer 3 rings" | — |
| Stat caption "final yield, 81.5% first pass" | "final yield" + second line "81.5% on the first test" | "First test" |
| Stat caption "failing dies of 15,825 tested" | "dies failed, of 15,825 tested" | "Die" |
| Finding "Test 204 IDDQ_LEAK has Cpk 0.14" | Headline "Leakage test IDDQ_LEAK is far off target" + sub "Cpk 0.14, mean 10.22 uA, limits 0.20 to 15.00 uA" | "Cpk" |
| "Yield loss by bin" | "Where the yield went" (section title) + "Yield loss by bin" (chart label) | "Bin" |
| "Yield" (panel heading) | "Yield by test site and wafer" | "Test site", "First test", "Retests" |
| "Open STDF" (nav) | "Open file" | — |
| Lot picker trigger "CAL-ER-2401 Edge-Ring Plasma Etch" | Unchanged, plus the hover definition of "Lot" on the trigger tooltip | "Lot" |

### 2.3 Term definitions (glossary)

Component: `Term` (§7.17). A `Term` wraps a word inside a sentence or label, draws a 1 px dotted underline, and opens a definition on hover (300 ms delay), on keyboard focus, or on tap. Definitions are 1–2 sentences, at most 200 characters in English. Keys live under `glossary.*` (§10.5).

| Key | Term (en) | Definition (en) |
|---|---|---|
| `glossary.stdf` | STDF | The standard binary file a chip tester writes. It records every die it tested and every measurement. |
| `glossary.lot` | Lot | A batch of wafers made together. Problems in one lot often share a cause. |
| `glossary.wafer` | Wafer | A thin disc of silicon that holds hundreds of chips before they are cut apart. |
| `glossary.die` | Die | One chip on the wafer. Each square on the map is one die. |
| `glossary.yield` | Yield | The share of dies that passed every test. |
| `glossary.firstTest` | First test | Yield before any die was retested. The gap to final yield shows how much retesting recovered. |
| `glossary.retest` | Retests | Dies the tester measured again after a failure, often because of a poor probe contact. |
| `glossary.bin` | Bin | The category a die is sorted into after testing, such as "good" or a specific failure. |
| `glossary.hardBin` | Hard bins | Coarse sort categories (HBIN) that decide where a die physically goes. |
| `glossary.softBin` | Soft bins | Detailed failure categories (SBIN) that say which test a die failed. |
| `glossary.testSite` | Test site | One of the probe positions that test dies in parallel. A bad site fails good dies. |
| `glossary.cpk` | Cpk | How well a measurement fits inside its limits. Below 1.33 is a risk; below 1.0 means dies fall outside. |
| `glossary.confidence` | Confidence | How strongly the wafer pattern matches the named class, from 0 to 1. Computed on this device. |
| `glossary.pattern` | Edge-Ring (and the other 8 WM-811K classes) | A failure shape from the WM-811K wafer map taxonomy. Edge-Ring means failures concentrate in a ring at the edge. |
| `glossary.limits` | Limits | The low and high values a measurement must stay between to pass. |

The `glossary.pattern` entry has one definition per class (`glossary.pattern.edgeRing`, `.center`, `.donut`, `.edgeLoc`, `.loc`, `.nearFull`, `.random`, `.scratch`, `.none`); English text in §10.5.

### 2.4 First-use hints (coach marks)

- At most **3** hints exist; at most **one** is visible at a time; each appears **once per browser** and never again after it is dismissed or its action is used.
- Persistence: `localStorage["cal.hints.v1"]` holds a JSON array of dismissed hint ids. Clearing it brings them back (used by e2e).
- Hints never appear while a sheet, menu, popover, drag overlay, or the probe sweep is active, and never under `?nohints=1` (used by screenshot tests).

| Id | Anchor | Copy (en) | Appears | Dismissed by |
|---|---|---|---|---|
| `h-show` | Right side of the **Show on wafer** button, arrow pointing left (mobile: below, arrow up) | "Start here. This lights up the dies behind the verdict." | 800 ms after the verdict rise-in settles on the first loaded lot | Clicking Show on wafer, the cause phrase, or any finding row; "Got it"; `Esc`; 12 s timeout |
| `h-hover` | Top edge of the wafer disc, arrow down | "Point at any die to read its bin and test values." (mobile: "Tap any die…") | 600 ms after the first evidence highlight is cleared, or after `h-show` is dismissed | A magnifier shown for 600 ms; "Got it"; `Esc`; 10 s timeout |
| `h-strip` | Above the active thumbnail, arrow down | "Flip through all 25 wafers here, or press ← and →." (count from the lot) | 600 ms after `h-hover` is dismissed | Any wafer change; "Got it"; `Esc`; 10 s timeout |

Visual: §7.18. Motion: §8.10.

### 2.5 Progressive disclosure ladder

| Level | Where | Contents |
|---|---|---|
| 0, glance (above the fold) | Verdict column top + wafer | Verdict, takeaway sentence, Show on wafer, 3 stats, 3 one-line findings, "Possible causes" closed |
| 1, one click | Finding row expanded; Possible causes open; legend "+N more"; magnifier | Engine sentence, die counts, "Check next" steps, hedged hypotheses, all bins, per-die values |
| 2, scroll | Below the fold in the verdict column | "Where the yield went" (Pareto), "Yield by test site and wafer" |
| 3, deliberate | Popovers and sheets | "How this verdict was made", error details with hex bytes, full bin list, keyboard shortcuts |

Rule: nothing at level 0 may need level 1 to be understood.

---

## 3. Tokens

### 3.1 Theme mechanism

- Attribute: `<html data-theme="light">` or `"dark"`. Every token below is a CSS custom property defined under `:root[data-theme="light"]` and `:root[data-theme="dark"]`; Tailwind v4 maps them in `@theme inline` so utilities read the variables. Dark utilities use `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`.
- Preference: `localStorage["cal.theme"]` is `"system"` (default), `"light"`, or `"dark"`. `"system"` resolves through `matchMedia("(prefers-color-scheme: dark)")` and follows live changes. When the OS reports no preference, the result is light. **Assumption:** "light by default, dark follows the OS" means the default preference is `"system"`, and light is the designed default and the fallback. If the owner wants light even on dark-mode machines, change the default to `"light"` in one constant (`DEFAULT_THEME_PREFERENCE`). The demo video is recorded with the toggle set to Light.
- A pre-hydration inline script in `layout.tsx` (next to the existing locale script) sets `data-theme` and `style.colorScheme` before first paint, so there is no flash.
- `<meta name="theme-color">` is `#F5F5F7` (light) and `#000000` (dark), updated on change.
- Canvas code never reads CSS variables per frame. `src/ui/tokens/palette.ts` exports `THEME_TOKENS.light`, `THEME_TOKENS.dark`, and `WAFER_TOKENS` (theme-independent, §3.3); a `useResolvedTheme()` hook (Zustand slice `theme`) triggers one base re-raster on change.

### 3.2 UI colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F5F5F7` | `#000000` | Page canvas on every screen; wafer stage background (no box) |
| `surface` | `#FFFFFF` | `#111113` | Cards: sample-lot cards, findings card, section cards, sheets |
| `surface-sunken` | `#EBEBEF` | `#1C1C1F` | Pressed rows, input fill, segmented track (light uses `fill-2`, see below) |
| `fill-1` | `rgba(0, 0, 0, 0.035)` | `rgba(255, 255, 255, 0.05)` | Hover fill on rows and ghost buttons |
| `fill-2` | `rgba(0, 0, 0, 0.055)` | `rgba(255, 255, 255, 0.08)` | Selected row, secondary button, segmented track, lot-picker trigger |
| `fill-3` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.12)` | Pressed state of `fill-2` controls; progress track |
| `material` | `rgba(250, 250, 252, 0.80)` + `backdrop-filter: blur(20px) saturate(180%)` | `rgba(22, 22, 24, 0.72)` + `blur(24px) saturate(180%)` | Nav bar |
| `material-thick` | `rgba(255, 255, 255, 0.92)` + `blur(24px) saturate(180%)` | `rgba(28, 28, 30, 0.88)` + `blur(24px) saturate(180%)` | Magnifier, popovers over the wafer, hints, menus, toasts, selection popover |
| `scrim` | `rgba(245, 245, 247, 0.60)` + `blur(24px)` | `rgba(0, 0, 0, 0.55)` + `blur(32px)` | Sheet backdrop, drag overlay |
| `hairline` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.08)` | 1 px dividers: findings rows, table rows, nav scroll edge |
| `hairline-strong` | `rgba(0, 0, 0, 0.14)` | `rgba(255, 255, 255, 0.16)` | Input outline, drag overlay frame, hollow legend swatch |
| `text-primary` | `#1D1D1F` (15.5:1 on `bg`, 16.8:1 on `surface`) | `rgba(255, 255, 255, 0.92)` (17.6:1 on `bg`, 15.2:1 on `surface`) | Headlines, verdict, numbers, active labels |
| `text-secondary` | `#515154` (7.3:1 on `bg`, 6.7:1 on `surface-sunken`) | `rgba(255, 255, 255, 0.64)` (6.6:1 on `surface-sunken`) | Body, takeaway, sub-lines, captions |
| `text-tertiary` | `#6A6A70` (4.9:1 on `bg`, 5.4:1 on `surface`, 4.5:1 on `surface-sunken`) | `rgba(255, 255, 255, 0.56)` (5.2:1 on `surface-sunken`) | Metadata, counts, hints, legend counts. Floor for informative text. Never on material over the wafer. |
| `text-disabled` | `rgba(29, 29, 31, 0.32)` | `rgba(255, 255, 255, 0.28)` | Disabled labels and hidden legend entries only |
| `ink` | `#1D1D1F` | `#F5F5F7` | Primary button fill, focus ring, active thumbnail ring, selected bar fill, segmented active text |
| `on-ink` | `#FFFFFF` | `#000000` | Text on `ink` |
| `ember` | `#FF6B2C` | `#FF6B2C` | Failing dies on the disc (5.9:1 on the disc body) |
| `ember-mark` | `#E8591E` (3.3:1 on `bg`, 3.6:1 on `surface`) | `#FF6B2C` (6.6:1 on `surface`) | Ember marks on the page: dominant Pareto bar, fail legend swatch |
| `ember-ink` | `#D94E14` (3.8:1 on `bg`, large text only) | `#FF8A57` (9.0:1 on `bg`) | The verdict cause phrase (>= 30 px only) |
| `focus-ring` | `0 0 0 2px var(--bg), 0 0 0 4px #1D1D1F` | `0 0 0 2px #000000, 0 0 0 4px rgba(255,255,255,0.92)` | `:focus-visible` on every control (box-shadow form; `outline` form for canvas stage, §7.6) |
| `selection` | `::selection { background: rgba(29,29,31,0.14) }` | `rgba(255,255,255,0.22)` | Text selection |

Rule: `ember-ink` is never used below 30 px. Light-theme orange text under 30 px does not exist in this product.

### 3.3 Wafer tokens (theme-independent; the disc is the same object in both themes)

| Token | Value | Use |
|---|---|---|
| `disc-hi` | `#2B2D33` | Body gradient stop 0 (light catch, upper-left) |
| `disc-mid` | `#1C1D21` | Body gradient stop 0.55; reference colour for all die contrast |
| `disc-lo` | `#121316` | Body gradient stop 1.0 (lower-right) |
| `film-1..4` | `rgba(120,150,255,0.06)`, `rgba(180,120,255,0.05)`, `rgba(90,220,200,0.04)`, `rgba(255,190,120,0.04)` | Thin-film iridescence conic stops (§5.2) |
| `bevel-top` / `bevel-bottom` | `rgba(255,255,255,0.38)` / `rgba(255,255,255,0.06)` | Outer rim stroke gradient |
| `bevel-inner` | `rgba(0,0,0,0.45)` | Inner rim stroke |
| `exclusion-line` | `rgba(255,255,255,0.05)` | Edge-exclusion ring line |
| `pass-tile` | `rgba(255,255,255,0.06)` → composite `#2A2B2E` (1.19:1 on `disc-mid`) | Passing die: texture only |
| `pass-tile-hc` | `rgba(255,255,255,0.34)` → composite `#696A6C` (3.1:1) | Passing die under `prefers-contrast: more` |
| `fail-die` | `#FF6B2C` (5.9:1 on `disc-mid`, 5.0:1 on a pass tile) | Failing die, dominant fail bin |
| `fail-facet` | `rgba(255,255,255,0.18)` | 1 px top edge on fail dies when pitch >= 10 css px |
| `dim-veil` | `rgba(18,19,22,0.78)` | Evidence-mode veil over non-evidence dies (disc colour, so dimmed ember stays ember-hued, never salmon) |
| `evidence-rim` | `rgba(255,255,255,0.90)` 1 px inside the die | Evidence die outline |
| `evidence-bloom` | Pre-rendered sprite: `#FF6B2C` at 0.35 alpha, 8 css px gaussian, composited `lighter` at 0.6 | Warm glow under evidence fail dies |
| `hover-stroke` | 1.5 px `rgba(255,255,255,0.95)` + 1 px `rgba(0,0,0,0.6)` outside | Hovered die |
| `pinned-stroke` | 2 px `#FFFFFF` + 1 px `#000000` outside | Pinned (keyboard or tapped) die |
| `selection-rect` | 1 px `rgba(255,255,255,0.90)` stroke, `rgba(255,255,255,0.06)` fill, radius 4 | Box-select rectangle |
| `probe-light` | Sprite: white at 0.28 alpha, radius 3 die pitches, gaussian | Probe-sweep head light |
| `contact-shadow` (DOM, light) | `radial-gradient(closest-side, rgba(0,0,0,0.26), rgba(0,0,0,0.10) 55%, rgba(0,0,0,0) 100%)`, ellipse 0.86 D x 0.10 D, centred 0.50 D + 0.035 D below the disc centre's lowest point | Contact shadow under the disc |
| `ambient-shadow` (DOM, light) | `radial-gradient(closest-side, rgba(0,0,0,0.10), rgba(0,0,0,0) 100%)`, circle 1.16 D, offset +0.04 D down | Soft ambient occlusion |
| `halo` (DOM, dark) | `radial-gradient(closest-side, rgba(255,255,255,0.055), rgba(255,255,255,0.018) 55%, rgba(255,255,255,0) 100%)`, circle 1.5 D | Separates the dark disc from the black page; replaces both shadows in dark |

### 3.4 The accent budget

`ember` family (`ember`, `ember-mark`, `ember-ink`) may appear only in these places:

| Use | Counts against the budget? |
|---|---|
| Failing dies on the main wafer, thumbnails, landing wafers, magnifier loupe | No: this is the data itself (one use, "the dies") |
| Fail swatch in the stage legend | No: part of the data key |
| Verdict cause phrase ("Edge-Ring failure.") | Yes |
| Dominant bin bar in "Yield loss by bin" | Yes |
| Dominant bin dot in the bin legend (bin modes) | No: part of the data key |

Max per viewport: the data + 2 budgeted uses. Stats, finding rows, magnifier text, hints, buttons, focus, selection, toasts, and errors are never orange. A healthy lot (yield >= 99 %) has no orange text at all.

### 3.5 Bin palette

Rank 0 (dominant yield-loss bin) is always ember. Ranks 1–7 cycle through 7 hues. Two lightness variants exist because bins are drawn on the dark disc and listed on the light page.

| Rank | On the disc (`bin-n`, both themes; 6.4–6.5:1 on `disc-mid`) | On the light page (`bin-n-ink`; >= 4.6:1 on `bg`) | On the dark page (`bin-n-ink`, dark) |
|---|---|---|---|
| 0 | `#FF6B2C` | `#E8591E` (mark) | `#FF6B2C` |
| 1 | `#00ACEA` | `#0A6FB0` | `#00ACEA` |
| 2 | `#AE90F3` | `#7353C9` | `#AE90F3` |
| 3 | `#FD7584` | `#C23A55` | `#FD7584` |
| 4 | `#B99F35` | `#7A6510` | `#B99F35` |
| 5 | `#00B0C8` | `#007A8C` | `#00B0C8` |
| 6 | `#E87AC7` | `#A63E8C` | `#E87AC7` |
| 7 | `#61A1FF` | `#2D63CC` | `#61A1FF` |
| Good bins | `pass-tile` | hollow swatch, `hairline-strong` 1 px | same |

Non-colour cue: every bin swatch is always followed by its code text (`SBIN 7`); colour is never the only cue.

### 3.6 Heat maps

Stacked fail heat map and parametric mode: `magma` sampled on t ∈ [0.18, 1.0] (so zero-fail cells sink into the disc instead of drawing black squares), drawn on the disc in place of die colours; numeric legend under the wafer: a 160 x 6 px bar, radius 3, with min and max values in `caption` tabular at both ends and the unit after the max.

### 3.7 Elevation and shadows

Light theme uses soft layered shadows on DOM surfaces (the R-series "no DOM shadows" rule is lifted for light). Dark theme uses rings plus deep shadows only on floating layers.

| Token | Light | Dark | Use |
|---|---|---|---|
| `shadow-card` | `0 0 0 1px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.05)` | `inset 0 0 0 1px rgba(255,255,255,0.08)` | Cards at rest |
| `shadow-card-hover` | `0 0 0 1px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.05), 0 16px 40px rgba(0,0,0,0.08)` | `inset 0 0 0 1px rgba(255,255,255,0.13)` | Sample-lot card hover (not animated: cross-fade a pseudo-element's opacity, §8.9) |
| `shadow-popover` | `0 0 0 1px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08), 0 24px 48px rgba(0,0,0,0.12)` | `inset 0 0 0 1px rgba(255,255,255,0.10), 0 24px 48px rgba(0,0,0,0.60)` | Menus, popovers, magnifier, hints, toasts, sheets |
| `shadow-thumb` | `0 0 0 0.5px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.10), 0 3px 8px rgba(0,0,0,0.05)` | none (thumb is `rgba(255,255,255,0.16)`) | Segmented control thumb |
| `shadow-chevron` | `0 0 0 1px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.10)` | `inset 0 0 0 1px rgba(255,255,255,0.12)` | Strip scroll chevrons |

### 3.8 Material and blur

| Surface | Background | Filter | Edge |
|---|---|---|---|
| Nav | `material` | `blur(20px) saturate(180%)` light / `blur(24px) saturate(180%)` dark | `hairline` bottom, opacity 0 at scroll 0, 1 after 4 px |
| Menus, popovers, toasts, hints, magnifier, selection popover | `material-thick` | `blur(24px) saturate(180%)` | `shadow-popover` |
| Sheet scrim, drag overlay | `scrim` | as in §3.2 | — |

`prefers-reduced-transparency: reduce`: every material becomes opaque (`surface` colour), filter `none`.

### 3.9 Radii (concentric)

| Token | px | Use |
|---|---|---|
| `r-xs` | 4 | Legend swatches, keyboard caps, selection rect |
| `r-sm` | 8 | Magnifier loupe, tooltip |
| `r-md` | 12 | Menu rows, input, Pareto selected row, hint |
| `r-lg` | 16 | Finding rows, popovers, toasts, magnifier |
| `r-xl` | 20 | Findings card (= row 16 + padding 4) |
| `r-2xl` | 24 | Sample-lot cards, section cards, sheets, menus |
| `r-3xl` | 28 | Drag overlay frame, stage focus ring |
| `r-pill` | 999 | Buttons, segmented control and thumb, lot-picker trigger, chevrons |

Rule: inner radius = outer radius − padding whenever the padding is <= 24 px.

### 3.10 Spacing and grid

- Scale (px): `2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 96, 128`. No other values in margins, paddings, or gaps.
- Grids per breakpoint:

| Breakpoint | Range | Columns | Gutter | Side margin | Max content |
|---|---|---|---|---|---|
| `xl` | >= 1440 | 12 | 24 | 40 | 1360 (centred beyond 1440) |
| `lg` | 1280–1439 | 12 | 24 | 40 | 1200 at 1280 |
| `md` | 1024–1279 | 8 | 20 | 32 | fluid |
| `sm` | 640–1023 | single column | — | 32 | 640 |
| `xs` | < 640 | 4 | 12 | 16 | fluid (358 at 390) |

- Hit targets: >= 40 x 40 desktop, >= 44 x 44 touch (`@media (pointer: coarse)`), extended by `::after` when the visual is smaller; hit areas never overlap.

### 3.11 Z-layers

Unchanged from `redesign.md` §2.5, plus: hints 35 (above selection popover, below nav), tooltips and term popovers 55 (above menus).

### 3.12 Motion tokens

| Token | Value | Use |
|---|---|---|
| `spring-ui` | Motion `{ type: "spring", duration: 0.35, bounce: 0 }` (≈ stiffness 320, damping 36) | Popovers, menus, sheets, verdict rise, hints, toasts |
| `spring-snappy` | `{ type: "spring", duration: 0.22, bounce: 0 }` | Segmented thumb, magnifier show, chevron rotation, press release |
| `spring-camera` | stiffness 170, damping 26, mass 1 (ζ = 1.0), own rAF integrator, independent x / y / scale | Wafer zoom, pan, frame, reset |
| `spring-throw` | stiffness 260, damping 22 (ζ ≈ 0.68) | Rubber-band return after a flick past bounds only |
| `spring-sheen` | stiffness 120, damping 22, mass 1 (ζ ≈ 1.0) | Pointer-follow silicon sheen (§8.11) |
| `ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Hover fills, fades, strip crossfade |
| `ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Count-up |
| `ease-in-out` | `cubic-bezier(0.45, 0, 0.25, 1)` | Theme cross-fade only |
| `dur-0` | 0 ms | Keyboard actions, key-repeat scrub, locale switch, palette open |
| `dur-1` | 120 ms | Hover fill, opacity reveals, magnifier hide |
| `dur-2` | 160 ms | Exits, strip crossfade, scrim fade-out |
| `dur-3` | 240 ms | Card hover lift, scrim fade-in |
| `dur-4` | 280 ms | Theme cross-fade, fail ignite |
| `press-scale` | 0.97 buttons, 0.985 cards and rows, 0.94 icon buttons and thumbnails | `:active` / `pointerdown` |

---

## 4. Typography

### 4.1 Families and global settings

```css
--font-sans: var(--font-inter), "Inter", var(--font-cjk, sans-serif), -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace; /* hex dump and raw coordinates in error details only */
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; font-optical-sizing: auto; font-feature-settings: "cv11", "ss03"; text-rendering: optimizeLegibility; }
```

- Inter Variable is the only UI face. Display roles set `font-variation-settings: "opsz" 32` (Inter Display cut); text roles keep `opsz` auto.
- `font-variant-numeric: tabular-nums` on every number that can change (stats, counts, legend, tables, magnifier, progress, zoom). Static display numbers on the landing page use proportional figures.
- Headings: `text-wrap: balance`. Body, sub-lines, captions, list items: `text-wrap: pretty` (disabled for CJK).
- Case: sentence case everywhere. No `text-transform`.
- Max measure: body 64 characters (`max-width: 34em` for 17 px body); takeaway 520 px desktop.
- Weights allowed: 300 (stat numbers only), 400, 500, 590, 600.

### 4.2 Type styles

| Token | Desktop size / line-height / weight / tracking | Mobile (< 640) | Numerals | Used for |
|---|---|---|---|---|
| `display-xl` | 80 / 1.04 / 600 / -0.035em, opsz 32 | 48 / 1.06 / 600 / -0.03em | proportional | Landing "Drop the body.", drag overlay |
| `display-l` | 48 / 1.08 / 600 / -0.024em, opsz 32 (1280: 44; 1024: 36) | 32 / 1.12 / 600 / -0.02em | proportional | Verdict headline |
| `title-1` | 34 / 1.12 / 600 / -0.02em, opsz 32 | 28 / 1.14 / 600 / -0.018em | — | Error title, bins-only sheet title |
| `title-2` | 24 / 1.2 / 600 / -0.016em, opsz 32 | 21 / 1.24 / 600 / -0.012em | — | Section titles ("Where the yield went") |
| `title-3` | 21 / 1.38 / 400 / -0.01em | 17 / 1.41 / 400 / -0.006em | — | Landing subline |
| `stat` | 40 / 1.0 / 300 / -0.022em, opsz 32 (1024: 32) | 28 / 1.0 / 300 / -0.016em | tabular | Big-number stats |
| `stat-s` | 28 / 1.0 / 300 / -0.016em, opsz 32 | 24 / 1.0 / 300 / -0.012em | tabular | Lot yield numbers in the yield section |
| `headline` | 17 / 1.29 / 590 / -0.012em | 16 / 1.31 / 590 / -0.01em | tabular | "Findings" label, wafer title, card titles, sheet section heads |
| `body` | 17 / 1.47 / 400 / -0.012em | 15 / 1.47 / 400 / -0.006em | tabular | Takeaway sentence, section takeaways, error body |
| `row-title` | 15 / 1.33 / 590 / -0.008em | 15 / 1.33 / 590 / -0.008em | tabular | Finding headline, Pareto bin code, possible-cause title |
| `callout` | 15 / 1.4 / 400 / -0.006em | 15 / 1.4 / 400 / -0.006em | tabular | Expanded finding text, card description, popover body |
| `control` | 14 / 1.29 / 500 / -0.006em | 14 / 1.29 / 500 / -0.006em | tabular | Buttons, segmented control, menu rows, nav items |
| `subhead` | 13 / 1.38 / 400 / -0.003em | 13 / 1.38 / 400 / -0.003em | tabular | Finding sub-line, stat caption, legend, wafer caption, magnifier values |
| `caption` | 12 / 1.33 / 500 / 0 | 12 / 1.33 / 500 / 0 | tabular | Thumbnail labels, magnifier labels, tooltip, hint "Got it" |
| `mono-data` | 13 / 1.45 / 400 / 0, `--font-mono` | same | tabular | Error-details hex dump only |

### 4.3 CJK (`zh-CN`, `zh-TW`, `ja`, `ko`)

- Font stacks per locale as in `redesign.md` §6.7 (system fonts only).
- `letter-spacing: 0` on every token.
- Line-height: `display-xl` 1.2, `display-l` 1.25, `title-*` 1.35, `headline` and `row-title` 1.4, `body` and `callout` 1.7, `subhead` and `caption` 1.55.
- Sizes: `display-xl` 64 desktop / 40 mobile; `display-l` 44 / 30 (1280: 40; 1024: 32); weights unchanged (600 max; CJK system faces render 600 as their semibold).
- `line-break: strict` for zh and ja; `word-break: keep-all` for ko; no italics; emphasis by weight 590.
- Layouts must survive strings 40 % longer than English: verdict headline max 3 lines in CJK and long Latin locales, then the size steps down one token (`display-l` → 40 → 36).

---
## 5. Wafer rendering (canvas)

All values are CSS px at the fit view (scale 1) unless marked "device px". `D` = disc diameter, `R = D / 2`, `p` = die pitch (centre-to-centre distance). The canvas architecture (base / fail / overlay canvases, camera wrapper, supersampled raster, re-raster after settle) is unchanged from `redesign.md` §4.7.

### 5.1 Stage composition (back to front)

1. Stage background: transparent (page `bg` shows through). No box, border, or fill.
2. DOM shadow layers inside the camera wrapper, so they pan and zoom with the disc: light theme `ambient-shadow` then `contact-shadow`; dark theme `halo`. Each is a `div` with the gradient as `background-image`, `pointer-events: none`.
3. Base canvas: disc material (§5.2) then die tiles (§5.3).
4. Fail canvas (sweep only, §8.1).
5. Sheen layer (DOM, §5.2 step 6, §8.11).
6. Overlay canvas (screen space): veil, evidence rims and bloom, hover, pinned, selection rect, probe light.
7. HUD and popovers (DOM).

### 5.2 Disc material (base canvas, drawn once per raster)

1. **Outline path:** circle of radius `R` with a V-notch at the orientation from `WCR.WF_FLAT` (default 6 o'clock = bottom). Notch: opening width `0.030 D`, depth `0.016 D`, apex rounded with radius `0.002 D`. Every later step clips to this path.
2. **Body:** radial gradient centred at `(cx − 0.12 D, cy − 0.20 D)`, radius `0.78 D`; stops `disc-hi` 0, `disc-mid` 0.55, `disc-lo` 1.0.
3. **Thin film:** `createConicGradient(200° in radians, cx, cy)` with stops `film-1` 0, `film-2` 0.25, `film-3` 0.5, `film-4` 0.75, `film-1` 1; `globalCompositeOperation = "screen"`. If `createConicGradient` is missing, skip this step.
4. **Edge exclusion line:** circle at radius `R − 0.026 D`, 1 device px, `exclusion-line`. Dies never cross it (the existing rim clearance already keeps them inside; assert in a unit test).
5. **Bevel:** outer stroke 1.5 css px along the outline path with a vertical linear gradient `bevel-top` (y = cy − R) to `bevel-bottom` (y = cy + R); then an inner stroke 1 device px at `R − 1.5`, `bevel-inner`.
6. **Specular sheen (DOM layer, not canvas):** a `div` the size of the disc, `border-radius: 50%`, `overflow: hidden`, `mask` = the notch-cut disc (SVG mask data URI generated from the same geometry), containing a child ellipse `0.92 D x 0.58 D`, rotated `-24deg`, centred at `(0.34 D, 0.26 D)` from the disc's top-left, `background: radial-gradient(closest-side, rgba(255,255,255,0.10), rgba(255,255,255,0.03) 60%, rgba(255,255,255,0) 100%)`, `mix-blend-mode: screen`. The child moves by `transform` only (§8.11). Under `prefers-reduced-transparency` the sheen is hidden.

### 5.3 Die tiles

| Property | Rule |
|---|---|
| Street (gap) | `max(1 device px, round(0.10 p))`. At 1440 x 900, `p` ≈ 19.4 for the 633-die demo wafers, street = 2 px |
| Fail die | Full cell minus street; corner radius `clamp(0.5, 0.12 p, 2)` px; fill `fail-die` (Pass/fail mode) or the bin colour (bin modes) |
| Fail facet | When `p >= 10`: a 1 px line along the die's top edge, inset by the corner radius, `fail-facet`. Batched into one path per raster |
| Pass die | Centred square at **80 %** of the fail-die side; radius `clamp(0.5, 0.10 p, 1.5)` px; fill `pass-tile` (`pass-tile-hc` under `prefers-contrast: more`) |
| Good bins in bin modes | Same as pass die |
| Hidden bin (legend toggle) | Not drawn (the disc shows through) |
| Missing coordinates | Not drawn (unchanged) |
| Thumbnails (strip, landing, lot picker) | Same disc material at their size with steps 3 and 6 skipped; pass tiles omitted when `p < 3` (the disc body alone reads as silicon); fail dies drawn at full cell with no street when `p < 3` |

Rationale for the contrast exemption: pass dies are substrate texture. The information "which dies failed" is carried by fail dies at >= 5.0:1 against both the disc and the pass tile, plus the geometric cue (full cell vs 80 % square), the legend counts, the magnifier, and the existing accessible table. This amends Requirement 14.1 ("chart marks >= 3:1") for pass dies only; `prefers-contrast: more` restores 3.1:1. Record the amendment in `requirements.md` (task P1).

### 5.4 Die states (overlay canvas, screen space)

| State | Trigger | Drawing |
|---|---|---|
| Rest | — | Nothing on the overlay |
| Hover | Pointer over a die (hover-capable devices) | `hover-stroke` on the die rect (1.5 px inside, 1 px dark keyline outside) |
| Pinned | `Enter` on a keyboard-focused die, or tap on touch | `pinned-stroke` (2 px white inside, 1 px black outside), plus the magnifier stays open |
| Keyboard cursor | Arrow keys on the focused stage | Same as hover; camera pans only when the die leaves a 48 px inner margin |
| Evidence (cited) | A finding, the cause phrase, Show on wafer, a Pareto bar, or a yield row is active | Fill `dim-veil` over the disc with evidence dies punched out (`destination-out` mask built once per selection); each evidence fail die gets `evidence-rim` and `evidence-bloom`; each evidence pass die gets a 1 px `rgba(255,255,255,0.55)` rim |
| Dimmed | Every non-evidence die while evidence is active | Under the veil: ember reads as `#5C3324`-ish ember-brown at 22 % visibility, pass tiles vanish. No black scrim |
| Selected region | Box select (Shift+drag or Select tool) | `selection-rect`; dies inside get no extra stroke; dies outside are not dimmed |
| Hidden by legend | Legend toggle | Not drawn on the base (unchanged) |

### 5.5 Stage header (DOM, above the wafer)

- Left-aligned with the stage column's left edge; single line, baseline-aligned: `headline` primary "Wafer W01" + 12 px + `subhead` secondary "110 of 633 dies failed".
- While evidence is active the caption cross-fades (120 ms opacity) to "2,552 dies on 25 wafers, 105 on this wafer" (`stage.evidenceCaption`). The old floating pill at the stage bottom is removed.
- In box-select mode the caption reads "148 dies selected" (the popover keeps the detail).

### 5.6 Control row (DOM, below the wafer)

One row, height 40, `display: flex; align-items: center; justify-content: space-between`, aligned to the stage column edges.

- Left: segmented control "Pass/fail | Hard bins | Soft bins" (§7.8). "Hard bins" and "Soft bins" are `Term`s: hover shows the definition after 600 ms (longer than the 300 ms default, because these are controls).
- Centre-right, 24 px after the segmented control: legend (§5.7).
- Right: icon button "Select an area" (dashed-rectangle icon, 32 x 32, tooltip "Select an area (S, or Shift-drag)"); when zoom ≠ 100 %, a ghost button `control` "Reset view" with the zoom value `caption` tertiary before it ("182%"), 8 px gap.
- Mobile: the legend moves to a second line under the row (left-aligned, 8 px gap); the "Reset view" label shortens to the zoom value only.

### 5.7 Legend

| Mode | Entries |
|---|---|
| Pass/fail | `[12 x 12 ember-mark tile, r-xs]` "Failed 110" · gap 16 · `[12 x 12 hollow tile, 1 px hairline-strong, r-xs]` "Passed 523" |
| Bins | Up to 4 fail bins by count: `[8 px dot bin-n-ink]` + `SBIN 7` (`subhead`, primary, 500) + count (`subhead` tertiary); then "+3 more" text button (opens a popover listing all bins with names); good bins grouped as one hollow-swatch entry "Good 523" |

- Text: `subhead`; label `text-secondary`, count `text-tertiary` tabular, 4 px between label and count. Gap between entries 16.
- Each entry is a `button` (`aria-pressed`) that toggles visibility; hidden: label and count `text-disabled` with `text-decoration: line-through`, swatch opacity 0.4. Hover: label `text-primary`, 120 ms.
- Bin names (`IDDQ_EDGE_LEAK`) are not in the inline legend. They show in the entry tooltip and the "+N more" popover.

### 5.8 Wafer strip

| Property | Desktop | Mobile |
|---|---|---|
| Scroller | `overflow-x: auto; overflow-y: hidden; scrollbar-width: none; scroll-snap-type: x proximity; padding: 6px 8px; scroll-padding-inline: 32px` | same with `padding: 6px 16px` |
| Height | 76 (6 + 64 item + 6) | 64 (6 + 52 + 6) |
| Item (button, `role="option"`) | 48 x 64, thumbnail 40 x 40 centred at top (y 4), label `caption` at y 50 | 44 x 52, thumbnail 36, label only on the active item |
| Gap | 0 (the 48 px item width contains 4 px each side) | 0 |
| Thumbnail | Dark disc per §5.3 (thumbnail row), `border-radius: 50%` | same |
| Rest | Label `text-tertiary` | — |
| Hover | Thumbnail `scale(1.06)` (160 ms `ease-out`), label `text-secondary` | — |
| Pressed | Thumbnail `scale(0.94)` | same |
| Active | Thumbnail ring `box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--ink)`; label `text-primary` weight 590 | same |
| Focus-visible | Same ring geometry with 4 px outer width | same |
| Evidence active | Wafers with zero evidence dies: opacity 0.32; others 1.0 | same |
| Edge fade | `mask-image: linear-gradient(90deg, transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%)`, applied only on the side that can scroll (toggle classes from scroll position) | same |
| Chevrons | 28 x 28 pill buttons, `surface` + `shadow-chevron`, 14 px chevron icon `text-secondary`, vertically centred on the thumbnails, 4 px inside the strip ends; shown only when that side can scroll; click scrolls by 80 % of the visible width (`behavior: smooth`, instant under reduced motion); `aria-label` "Earlier wafers" / "Later wafers" | hidden (touch scroll) |

The 6 px vertical padding fully contains the 3.5 px ring and the 1.06 hover scale (40 x 0.03 = 1.2 px), so nothing clips (A-12).

### 5.9 Magnifier loupe content

The loupe copies a 9 x 6 die neighbourhood from the base canvas at 3x on-screen size (unchanged mechanism). Under the loupe image, the hovered die gets a 1.5 px white rim drawn on the loupe. The loupe has `r-sm` corners and an inner 1 px `rgba(255,255,255,0.08)` ring so the disc edge never looks cut.

---

## 6. Layout per screen and breakpoint

Common: nav bar on top (§7.1). Page background `bg`. All coordinates are top-left of the viewport in CSS px; "y" is the top edge of the element's box.

### 6.1 Landing (empty state)

**Desktop 1440 x 900**

```
y=0     nav 52 (wordmark | — | language, theme, Open file)
y=140   Drop the body.                                   display-xl, centred
y=244   Find out why a wafer lot lost yield. Drop an      title-3 secondary, centred, max-width 640
        STDF test log and get the cause, linked to the dies.
y=334   [ Open the sample lot ]  [ Open file ]            primary 48 h + secondary 48 h, gap 12, centred
y=394   Or drop a .stdf, .std, or gzip file anywhere. Files stay on this device.   subhead tertiary
y=468   Sample lots                                       headline primary, left at x=40
y=506   ┌ card 421 x 288 ┐ ┌ card ┐ ┌ card ┐              cols 1-4, 5-8, 9-12; gutter 24
y=794   └────────────────┘ └──────┘ └──────┘
y=852   Runs entirely in your browser.   Download sample files     subhead tertiary left; text button right
```

- Sample card: `surface`, `r-2xl`, `shadow-card`, no padding on the card itself.
  - Wafer: 152 px disc (§5.3 thumbnail rules, with sheen and contact shadow at that size), centred horizontally, top at 28 px.
  - Text block at y = 204 inside the card, padding `0 24 24`: title `headline` primary (1 line), 4 px, description `callout` secondary (1 line, ellipsis), 8 px, meta `subhead` tertiary "25 wafers, 15,825 dies".
  - The whole card is one `button` (`aria-label` "Open sample lot {title}").
- Above the fold at 900: everything, including the footer line.

Card copy (plain-language descriptions replace the R-series ones):

| id | Title | Description |
|---|---|---|
| `edge-ring-etch` | Edge-Ring Plasma Etch | Etch damage kills dies around the wafer edge. |
| `handling-scratch` | Robotic Handling Scratch | A robot arm scratched a line across 18 wafers. |
| `site2-probe-contact` | Site 2 Probe Contact | One worn tester needle fails good dies. |

**1280 x 800:** same structure; headline top y = 116; cards 384 x 272 (wafer 140); footer at 760. Everything above the fold.

**1024 x 768:** margins 32; headline 64 px (step between xl and mobile), top y = 104; cards in a 3-up row of 299 x 256 (wafer 120); description wraps to 2 lines allowed; footer at 724.

**640–1023 (sm):** single column, left-aligned hero, max width 640; cards stack vertically full width, 160 high, wafer 112 on the left, text on the right.

**Mobile 390 x 844:**

```
y=0     nav 48 (wordmark short | — | globe, theme, open icons)
y=88    Drop the body.                 display-xl mobile 48, left-aligned, x=16
y=196   Find out why a wafer lot ...   title-3 mobile 17 secondary, 3 lines max
y=292   [ Open the sample lot ]        primary full width 358 x 48
y=352   Open file                      secondary full width 358 x 44
y=408   Files stay on this device.     subhead tertiary
y=452   Sample lots                    headline
y=484   ┌ card 300 x 248 ┐┌ peek       horizontal scroll-snap, gap 12, second card peeks 46 px
y=732   └────────────────┘
```

Above the fold: headline, subline, both buttons, hint, the first card, and the peek. Footer below.

### 6.2 Loaded verdict view

**Desktop 1440 x 900**

```
y=0    nav 52  [Chip Autopsy Lab]      [CAL-ER-2401 Edge-Ring Plasma Etch ⌄]       [EN] [◐] [Open file]
       ┌ stage column cols 1-7 (x 40..823), sticky ┐  24  ┌ verdict column cols 8-12 (x 847..1400), page scroll ┐
y=72   │ Wafer W01   110 of 633 dies failed        │      │                                                     │
y=136  │                                           │      │ Cause of death:                       display-l     │
       │             ( disc D = 596 )              │      │ Edge-Ring failure.  (ember-ink)                     │
y=256  │                                           │      │ Most failing dies sit in the outer 3 rings of        │
       │                                           │      │ every wafer. Final yield is 82.8%.     body 2 lines │
y=330  │                                           │      │ [ Show on wafer ]   High confidence, 0.95 ⓘ         │
y=410  │                                           │      │ 93.8%          82.8%          2,721      stat       │
       │                                           │      │ of failing…    final yield    dies failed, of…      │
y=540  │                                           │      │ Findings                                             │
y=574  │                                           │      │ ┌ findings card: 3 rows x 64 ───────────────────┐   │
y=756  │ [Pass/fail|Hard bins|Soft bins] ■ Failed 110 □ Passed 523      [⬚]       │      │ └───────────────────────────────────────────────┘   │
y=808  │ ( W01 ) W02  W03  …  (strip 76)           │      │ Possible causes                              ⌄      │
y=884  └───────────────────────────────────────────┘      └─────────────────────────────────────────────────────┘
```

Stage column (`position: sticky; top: 52px; height: calc(100dvh - 52px); min-height: 640px`), flex column:

| Part | Height | Notes |
|---|---|---|
| Top padding | 20 | — |
| Stage header | 40 | §5.5, text baseline at 28 |
| Wafer area | flex 1 (644 at 900) | `D = clamp(320, min(areaW − 96, areaH − 48), 680)` → 596 at 1440 x 900; disc centred |
| Control row | 40 | §5.6 |
| Gap | 12 | — |
| Strip | 76 | §5.8 |
| Bottom padding | 16 | — |

Verdict column (normal flow, scrolls with the page), `padding-top: 84` (the verdict cap height aligns with the top of the disc), text blocks `max-width: 520`:

| # | Block | Spacing above | Style |
|---|---|---|---|
| 1 | Verdict headline, 2 lines max | 84 (column top) | `display-l`; "Cause of death:" `text-primary`, cause phrase `ember-ink` (§7.3) |
| 2 | Takeaway sentence, 2 lines max | 16 | `body`, `text-secondary` (§10.3) |
| 3 | Action row | 24 | Primary button "Show on wafer" 40 h + 16 + confidence text button (§7.4) |
| 4 | Stat row | 40 | 3 equal columns, gap 24 (§7.5) |
| 5 | "Findings" label + findings card | 48, then 12 between label and card | §7.6 |
| 6 | "Possible causes" disclosure | 16 | §7.6.5 |
| — | Fold at y = 900 | — | Computed: headline 136–240, takeaway 256–306, action 330–370, stats 410–492, label 540, card 574–776, possible causes 792–840. Blocks 1–6 fit (A-15) |
| 7 | Section "Where the yield went" | 96 | §7.9 |
| 8 | Section "Yield by test site and wafer" | 96 | §7.10 |
| 9 | Footer line | 96, bottom padding 64 | `subhead` tertiary "Runs entirely in your browser. Raw STDF bytes never leave this device." |

Linking while scrolled: the stage is sticky, so a click in sections 7–8 lights dies on a visible wafer. A finding click never scrolls the page on desktop.

**1280 x 800:** content 1200 (col 78); stage cols 1–7 = 690, verdict cols 8–12 = 486. Wafer area 544 → D = 496. Verdict `display-l` 44; column padding-top 72; stat number 36. Fold at 800 shows blocks 1–5 and the top of 6 (A-16).

**1024 x 768 (md):** margins 32, gutter 20; stage column fixed 540, verdict column 400. Wafer area 512 → D = 444. Verdict 36 px; takeaway `callout`; stat `stat` at 32; stat captions may wrap to 3 lines; findings card full column width; control row legend moves to its own line under the segmented control (control row height 72). Fold shows blocks 1–4 and the first finding row.

**640–1023 (sm):** single column, max width 640, centred. Order: verdict, takeaway, action row, stage header, wafer (D = min(560, vw − 64)), control row, strip, stats, findings, possible causes, sections. Stage is not sticky.

**Mobile 390 x 844 (xs):**

```
y=0    nav 48
y=68   Cause of death:            display-l mobile 32, 2 lines (3 in CJK)
       Edge-Ring failure.
y=152  Most failing dies sit in the outer 3 rings      body mobile 15, 3 lines max
y=230  [ Show on wafer ]  High confidence, 0.95 ⓘ       primary 40 h, auto width
y=290  Wafer W01  110 of 633 dies failed               stage header 20
y=318  ┌ stage 390 x 390 full-bleed, D = 350 ┐
y=716  [Pass/fail|Hard bins|Soft bins]  [⬚]             control row 36
y=760  ( W01 ) …                                        strip 64
y=832  Failed 110  Passed 523                            legend line, straddles the fold at 844
y=882  93.8%   82.8%   2,721                             stats, 3 x 111, gap 12
y=994  Findings card full width 358 …
```

- Above the fold: verdict, takeaway, action, the whole wafer, controls, strip.
- Show on wafer on mobile: lights the dies; the wafer is already visible, so no scroll. A finding click (below the wafer) scrolls the page so the stage top sits 8 px under the nav (`scrollIntoView` smooth; instant under reduced motion).
- Gestures: `touch-action: pan-y` on the stage at zoom 1; pinch zooms; at zoom > 1 the stage uses `touch-action: none` and one finger pans (unchanged).

### 6.3 Loading (probe sweep)

Same layout as §6.2 from the first frame so nothing jumps.

- Stage header: "Wafer W01" + caption "Reading…" (`subhead` tertiary).
- Wafer: disc material appears at once (it needs only geometry); dies appear per §8.1.
- Verdict column at the verdict position: `headline` primary file name (1 line, ellipsis); 8 px; `body` secondary "Reading wafer 7 of 25" (or "Reading records"); 20 px; progress track 2 px `fill-3`, radius 999, width 320 (mobile: full width), fill `ink` scaled by `transform: scaleX(p)` from the left; 8 px; `subhead` tertiary tabular "4.2 of 9.8 MB"; 24 px; `subhead` tertiary "Press any key to skip the animation." while the sweep runs.
- No skeletons, no spinners.

### 6.4 Parse error

Replaces the landing hero; the sample cards stay below so the next step is one click.

- Desktop: centred, top y = 164: `title-1` primary error title (§10.6 table from `redesign.md` §3.7, unchanged copy); 12 px; `body` secondary max 560; 32 px; buttons: primary "Open another file", secondary "Open the sample lot"; 16 px; text button "Show details" (opens the error-details sheet with `mono-data` hex dump).
- Mobile: left-aligned at y = 96; buttons full width stacked, gap 12.
- No icon, no red, no orange.

### 6.5 Drag-over overlay

- Full viewport `scrim`. Frame: `inset: 16px`, `r-3xl`, `box-shadow: inset 0 0 0 1.5px var(--hairline-strong)`; no dot grid.
- Centred: "Drop the body." `display-xl`; 12 px; `title-3` secondary "Release to open. STDF, STD, or gzip."
- Non-file drag: copy "Only files can be opened here." and the frame stays `hairline-strong`.
- Not shown on touch devices.

### 6.6 Bins-only

- Sheet (before parse, file > 200 MB): desktop centred 480 wide, `surface`, `r-2xl`, `shadow-popover`, padding 32; mobile bottom sheet full width, radius `24 24 0 0`, 36 x 5 grabber `fill-3`. Title `title-1` "This file is 312 MB."; 12 px; `body` secondary; 28 px; primary "Use bins-only" (focused), secondary "Parse everything". Scrim `scrim`.
- After load: one line under the action row, `subhead` secondary with a 14 px info icon: "Bins-only mode. Parametric findings are hidden." + text button "Parse everything".

