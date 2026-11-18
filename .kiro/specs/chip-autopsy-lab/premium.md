# Chip Autopsy Lab: Premium Specification (P-series)

Status: approved for implementation. This document **supersedes `redesign.md` for every visual and interaction decision** (tokens, typography, wafer rendering, layout, components, motion, copy tone). `redesign.md` still holds for anything this file does not mention: data flow, worker API, selection store, i18n plumbing (§6.1–§6.5, §6.9), parse error codes, bins-only logic, and the perf gate procedure. `design.md` and `requirements.md` keep the data model and correctness properties. Where `.kiro/steering/design-language.md` disagrees with this file, this file wins, and task P1 rewrites the steering file to match.

Reference viewports (CSS px): **desktop 1440 x 900** (primary), **desktop 1280 x 800**, **tablet 1024 x 768**, **mobile 390 x 844**.

Inputs: owner verdict on `logs/shots/r8-desktop.png`, `r8-mobile.png`, `t10-sbin.png`, `t10-full.png`, frames of `r8-demo.mp4`; `design-refs/*` and `design-refs/premium-references.md`; skills `apple-design`, `frontend-design`, `make-interfaces-feel-better` (+ `typography.md`, `surfaces.md`, `animations.md`, `icons.md`, `performance.md`), `animation-performance`.

Notation: `§n` = section of this file. `An` = acceptance item in §10 (A1, A2, …). Every colour is given as hex (sRGB). Contrast ratios are WCAG 2.x relative-luminance ratios, computed for this spec.

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
| Video: clicking the stage draws a heavy white rectangle around it | Focus ring shown on mouse focus | `:focus-visible` only, inset 28 px radius (§7.7). |
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
10. No skulls, cobwebs, pumpkins, novelty fonts, or Halloween imagery. The theme lives in two phrases and one light (§9.4).
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

Every control and heading uses the plain label below. The domain term, where kept, is defined on hover (§2.3). Bin codes, test names, and WM-811K class names stay untranslated and verbatim (§9.2).

| Old label | New label (en) | Term defined on hover |
|---|---|---|
| `Pass/Fail` / `HBIN` / `SBIN` (segments) | `Pass/fail` / `Hard bins` / `Soft bins` | "Hard bins", "Soft bins" |
| `Pan` / `Select` (segmented control) | Removed. One icon button "Select an area" (§7.7) | — |
| `Confidence 0.95` (pill) | `High confidence, 0.95` (text button, §7.4) | "Confidence" |
| Sub-line "Yield 82.8% across 25 wafers. Most loss in SBIN 7 IDDQ_EDGE_LEAK." | Takeaway sentence (§9.3), no bin codes | "Yield" inside the sentence |
| Stat caption "of fails sit in the outer 3 rings" | "of failing dies are in the outer 3 rings" | — |
| Stat caption "final yield, 81.5% first pass" | "final yield" + second line "81.5% on the first test" | "First test" |
| Stat caption "failing dies of 15,825 tested" | "dies failed, of 15,825 tested" | "Die" |
| Finding "Test 204 IDDQ_LEAK has Cpk 0.14" | Headline "Leakage test IDDQ_LEAK is far off target" + sub "Cpk 0.14, mean 10.22 uA, limits 0.20 to 15.00 uA" | "Cpk" |
| "Yield loss by bin" | "Where the yield went" (section title) + "Yield loss by bin" (chart label) | "Bin" |
| "Yield" (panel heading) | "Yield by test site and wafer" | "Test site", "First test", "Retests" |
| "Open STDF" (nav) | "Open file" | — |
| Lot picker trigger "CAL-ER-2401 Edge-Ring Plasma Etch" | Unchanged, plus the hover definition of "Lot" on the trigger tooltip | "Lot" |

### 2.3 Term definitions (glossary)

Component: `Term` (§7.17). A `Term` wraps a word inside a sentence or label, draws a 1 px dotted underline, and opens a definition on hover (300 ms delay), on keyboard focus, or on tap. Definitions are 1–2 sentences, at most 200 characters in English. Keys live under `glossary.*` (§9.5).

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

The `glossary.pattern` entry has one definition per class (`glossary.pattern.edgeRing`, `.center`, `.donut`, `.edgeLoc`, `.loc`, `.nearFull`, `.random`, `.scratch`, `.none`); English text in §9.5.

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

The 6 px vertical padding fully contains the 3.5 px ring and the 1.06 hover scale (40 x 0.03 = 1.2 px), so nothing clips (A12).

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
| 2 | Takeaway sentence, 2 lines max | 16 | `body`, `text-secondary` (§9.3) |
| 3 | Action row | 24 | Primary button "Show on wafer" 40 h + 16 + confidence text button (§7.4) |
| 4 | Stat row | 40 | 3 equal columns, gap 24 (§7.5) |
| 5 | "Findings" label + findings card | 48, then 12 between label and card | §7.6 |
| 6 | "Possible causes" disclosure | 16 | §7.6.5 |
| — | Fold at y = 900 | — | Computed: headline 136–240, takeaway 256–306, action 330–370, stats 410–492, label 540, card 574–776, possible causes 792–840. Blocks 1–6 fit (A15) |
| 7 | Section "Where the yield went" | 96 | §7.9 |
| 8 | Section "Yield by test site and wafer" | 96 | §7.10 |
| 9 | Footer line | 96, bottom padding 64 | `subhead` tertiary "Runs entirely in your browser. Raw STDF bytes never leave this device." |

Linking while scrolled: the stage is sticky, so a click in sections 7–8 lights dies on a visible wafer. A finding click never scrolls the page on desktop.

**1280 x 800:** content 1200 (col 78); stage cols 1–7 = 690, verdict cols 8–12 = 486. Wafer area 544 → D = 496. Verdict `display-l` 44; column padding-top 72; stat number 36. Fold at 800 shows blocks 1–5 and the top of 6 (A16).

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

- Desktop: centred, top y = 164: `title-1` primary error title (§9.6 table from `redesign.md` §3.7, unchanged copy); 12 px; `body` secondary max 560; 32 px; buttons: primary "Open another file", secondary "Open the sample lot"; 16 px; text button "Show details" (opens the error-details sheet with `mono-data` hex dump).
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

---

## 7. Components

Conventions for every component below:
- State columns are **rest / hover / pressed / selected (or open) / focus-visible / disabled**. A state not listed equals rest.
- Hover styles apply only under `@media (hover: hover)`. Pressed applies on `pointerdown` (not `click`).
- Transitions use the properties named in §8.9 only (`background-color`, `color`, `opacity`, `transform`), `dur-1` + `ease-out` unless stated.
- Focus ring is the `focus-ring` token (§3.2) on `:focus-visible` only, following the element's radius. Mouse focus never shows a ring.
- Icons: Lucide, 16 px, `stroke-width: 1.5`, `text-secondary` at rest. Icon-plus-text buttons use 2 px less padding on the icon side.
- Every string comes from the dictionary (§9.5). Every number is `tabular-nums`.

### 7.1 Nav bar (incl. theme toggle)

| Property | Desktop (`md` and up) | Mobile (`xs`, `sm`) |
|---|---|---|
| Box | `position: sticky; top: 0`, height 52, `material` (§3.8), z 40 | height 48 |
| Grid | `grid-template-columns: 1fr auto 1fr`, side padding = page margin (40 / 40 / 32) | `auto 1fr auto`, padding 0 16 |
| Bottom edge | `hairline` 1 px, opacity 0 at scroll 0, 1 after 4 px (§8.9) | same |
| Left | Wordmark "Chip Autopsy Lab", 15 / 1.33 / 590 / -0.01em, `text-primary`; a link to `/` with hover `opacity 0.72` | "Autopsy Lab" (`nav.wordmarkShort`) |
| Centre | Lot picker (§7.2); absent on landing, loading shows it disabled | Lot picker compact (lot ID only) |
| Right (order) | Language switcher, 4 px, theme toggle, 12 px, "Open file" secondary button 32 h | Globe icon button (menu also holds Appearance), folder-open icon button; 44 x 44 each, gap 0 |

**Language switcher.** Ghost button 32 h, padding 0 10 0 8: globe icon + 6 px + `control` short label ("EN", "简", "繁", "日", "한"). Menu per §7.12, width 220, rows in native names with `lang` attributes, check on the current row. Selecting applies at 0 ms (§8.14).

**Theme toggle (quiet).**
- Icon button 32 x 32 (§7.11), `aria-label` "Appearance: {preference}" ("Appearance: System, currently light"), tooltip "Appearance".
- Icon shows the **preference**, not the result: `sun-moon` (System), `sun` (Light), `moon` (Dark). Icon colour `text-secondary`; there is no label and no colour.
- Click opens a menu (§7.12) width 200 with a radio group: "Match system", "Light", "Dark"; leading 16 px icon per row; check on the current row; caption under the group, `subhead` tertiary: "Match system follows your device setting."
- Selecting closes the menu and switches the theme (§8.8). Keyboard: `Enter`/`Space` opens, arrows move, `Enter` selects, `Esc` returns focus to the button.
- Mobile: no separate button. The globe menu gets a second group "Appearance" with the same three rows, separated by a `hairline` inset 12.

Tab order: wordmark, lot picker, language, theme, Open file (A35).

### 7.2 Lot picker

**Trigger.** Pill, height 32, padding 0 12 0 14, `r-pill`, fill `fill-2`.
- Content: lot ID `control` primary "CAL-ER-2401" + 8 px + lot title `control` secondary "Edge-Ring Plasma Etch" (hidden below 1024) + 6 px + chevron-down 12 px `text-tertiary`.
- Max width 420; the title truncates with an ellipsis first, the lot ID never truncates.
- States: hover fill `fill-3`; pressed scale 0.97; open fill `fill-3` and chevron rotated 180° (§8.6); disabled (loading) `text-disabled`, no hover.
- Tooltip after 600 ms: the `glossary.lot` definition (§2.3).

**Menu.** Radix DropdownMenu, anchored centre-bottom of the trigger, 8 px offset, width 360, `material-thick`, `shadow-popover`, `r-2xl`, padding 8, z 50.

| Part | Style |
|---|---|
| Group label | `subhead` tertiary, padding 8 12 4: "Sample lots", "Recent files" |
| Lot row | Height 56, `r-lg`, padding 8 12, grid `40px 1fr 16px`, gap 12. 40 px disc thumbnail (§5.3), title `row-title` primary (1 line, ellipsis), meta `subhead` tertiary "Yield 82.8%, 25 wafers" |
| Recent row | Height 48, same grid with a 16 px `file` icon in a 40 px slot; title = file name; meta = size "9.8 MB" |
| Row states | Hover and keyboard-highlight fill `fill-1`; pressed fill `fill-2`; current lot: 16 px check `ink` in the last column |
| Separator | 1 px `hairline`, margin 4 12 |
| Last row | "Open file…" `control` primary with a keycap on the right: `caption` secondary on `fill-2`, `r-xs`, padding 2 6, "⌘O" / "Ctrl O" |

Recent files: at most 3, this session only. Keyboard: arrows, `Enter`, `Esc` (focus returns to trigger), typeahead by title.

### 7.3 Verdict headline and takeaway

- `<h1 data-testid="verdict-headline">`, `display-l` (§4.2), `max-width: 520`, `text-wrap: balance`, 2 lines max (3 in CJK and long Latin locales, then step down per §4.3).
- Span 1 "Cause of death:" `text-primary`, followed by a line break opportunity (`<wbr>`; the phrase wraps as a unit with `white-space: nowrap` on the cause phrase when it fits in one line).
- Span 2, the cause phrase ("Edge-Ring failure."), is a `<button>` styled as text, `ember-ink`:
  - Hover: `text-decoration: underline 1.5px; text-underline-offset: 6px; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent)`.
  - Pressed: opacity 0.72.
  - Selected (evidence active from this button, `aria-pressed="true"`): underline at 70 % mix.
  - Focus-visible: `focus-ring`, `r-md`, 4 px horizontal padding added via negative margin so the text does not move.
- Healthy lot (yield >= 99 %): "No cause of death." in `text-primary` and no button; the takeaway reads "{passed} of {total} dies passed every test." Nothing on the page is orange except failing dies.
- Takeaway `<p>` under the headline: `body` secondary, `max-width: 520`, 2 lines max at 1440 (3 at 1024, 4 on mobile), `text-wrap: pretty`. It may contain one `Term` ("yield"). It never contains bin codes, test names, or STDF field names (A26). Templates: §9.3.

### 7.4 Confidence chip

The only pill-shaped element in the verdict region.

| State | Style |
|---|---|
| Rest | Ghost pill, height 28, padding 0 10 0 12, `r-pill`, no fill. Text `control` secondary "High confidence, 0.95" (value tabular) + 6 px + `info` icon 14 px `text-tertiary` |
| Hover | Fill `fill-1`, text `text-primary`, icon `text-secondary` |
| Pressed | Fill `fill-2`, scale 0.97 |
| Open | Fill `fill-2`, text `text-primary` |

- Level words: `>= 0.85` "High confidence", `0.60–0.84` "Moderate confidence", `< 0.60` "Low confidence". The number always follows, 2 decimals.
- Placement: in the action row, 16 px after the primary button, vertically centred on it.
- Click opens a popover (§7.12), width 320, below-start, 8 px offset:
  1. `headline` primary "How this verdict was made".
  2. 8 px, `callout` secondary: the `glossary.confidence` definition.
  3. 12 px, a match row: `subhead` secondary "Match with {pattern}" left, `subhead` primary tabular "0.95" right; under it a 4 px bar, `r-pill`, track `fill-2`, fill `ink`, width = confidence.
  4. 12 px, `callout` secondary: template or narrator note (the `redesign.md` §4.4 copy, unchanged).
- Never orange. No ring, no badge, no second pill in the region.

### 7.5 Stats

- `<dl>` grid `repeat(3, 1fr)`, column gap 24 (12 on mobile). Each stat is a `<div>` containing a `<button>` that activates the stat's evidence dies (every number on the page is traceable).
- Number (`<dd>`): `stat` (§4.2), `text-primary`, tabular. **Never orange** (A4).
- Caption (`<dt>`, shown under the number via `flex-direction: column-reverse`): 6 px gap, `subhead` secondary, 2 lines max. Optional second caption line `subhead` tertiary (for example "81.5% on the first test").
- Button box: padding 12, margin -12 (the text stays on the grid), `r-lg`.

| State | Style |
|---|---|
| Hover | Fill `fill-1`; caption `text-primary` |
| Pressed | Fill `fill-2`; scale 0.985 |
| Selected (`aria-pressed`) | Fill `fill-2` |

- Edge-Ring demo values: "93.8%" / "of failing dies are in the outer 3 rings"; "82.8%" / "final yield" + "81.5% on the first test"; "2,721" / "dies failed, of 15,825 tested". Other lots use the `stat-facts.ts` mapping with the §9.3 phrasing.
- Count-up on reveal: §8.2.

### 7.6 Findings

#### 7.6.1 Label and card

- Label row: `headline` primary "Findings" + 8 px + `subhead` tertiary count "3". 12 px below: the card.
- Card: `<ul>`, `surface`, `r-xl` (20), `shadow-card`, padding 4. At most 3 rows at level 0; more findings sit behind a last row "Show 2 more findings" (`control` secondary, height 44, centred).
- Separators: 1 px `hairline` between rows, inset 16 left and right; hidden next to a hovered, pressed, or selected row (no double edges).

#### 7.6.2 Row at rest

- `<li><button aria-expanded aria-pressed>`, full width, `r-lg` (16), min-height 64, padding 12 16.
- Grid `16px 1fr auto`, column gap 12, `align-items: start`:
  - Col 1: kind icon 16 px `text-tertiary`, top-aligned to the headline cap height (margin-top 2): `circle-dashed` (spatial pattern), `minus` rotated 30° (scratch), `crosshair` (test site), `activity` (parametric test), `layers` (bin).
  - Col 2: headline `row-title` primary, 1 line with ellipsis on desktop, 2 lines on mobile. Plain-language first (§9.3). Sub-line 2 px below, `subhead` secondary, 1 line desktop / 2 mobile: the numbers and codes ("Cpk 0.14, mean 10.22 uA, limits 0.20 to 15.00 uA"). `Cpk` and `Limits` render as `Term`s only in the expanded body, not in the one-line sub-line.
  - Col 3: `subhead` tertiary tabular die count "2,552 dies" + 8 px + chevron-down 12 px `text-tertiary`.

#### 7.6.3 Row hover, pressed, selected

| State | Fill | Text and icons | Other |
|---|---|---|---|
| Hover | `fill-1` | Chevron `text-secondary` | Separators beside it hidden |
| Pressed | `fill-2` | — | Scale 0.985 |
| Selected (evidence on, expanded) | `fill-2` | Kind icon `text-primary`; count replaced by text button "Clear" (`control` primary) | Chevron rotated 180° |
| Focus-visible | — | — | `focus-ring` at `r-lg` |

One row is selected at a time. Selecting a row expands it and lights its dies (§8.3); clicking it again, "Clear", or `Esc` collapses it and clears the evidence.

#### 7.6.4 Row expanded

Body under the head, inside the same `fill-2` row, padding `0 16 16 44` (44 = 16 + 16 icon + 12, so text aligns with the headline):
1. Engine sentence, `callout` secondary, 3 lines max. `Term`s allowed here (Cpk, Limits, Test site, Bin).
2. 12 px, "Check next" `subhead` tertiary, then up to 3 steps, each `callout` primary with a 4 px `text-tertiary` dot at 8 px indent, 4 px between steps.
3. 12 px, a meta line `subhead` tertiary: "105 on this wafer, 2,552 on all 25 wafers".

No buttons inside the body except optional text buttons "Show in chart" (scrolls to §7.9 and selects the bar) and "Show this site" (§7.10). Content never animates its height (§8.6).

#### 7.6.5 Possible causes

- Disclosure below the findings card, 16 px gap. Trigger: `<button aria-expanded>`, full column width, height 48, padding 0 20 (aligns text with card rows: 4 + 16), `r-lg`.
- Trigger content: `headline` primary "Possible causes" left; right `subhead` tertiary count "3" + 8 px + chevron-down 12 px. Hover `fill-1`; pressed `fill-2` + scale 0.985; open chevron rotated 180°.
- Open content, padding `4 20 16`:
  - First line `subhead` tertiary: "These are likely explanations, not proof. Confirm them in the tool logs."
  - 12 px, then up to 3 causes, 16 px apart. Each: title `row-title` primary ("Deposition or etch uniformity"), 2 px, `callout` secondary check step ("Compare the etch chamber's edge-to-centre uniformity for this lot."), 2 px, `subhead` tertiary "Based on finding 1" (a text button that selects that finding).
- No card, no box. Open state persists per lot for the session.

### 7.7 Stage controls and stage focus

- Stage element: `<div role="application" aria-roledescription="wafer map">` covering the wafer area (§6.2). Mouse focus: no ring. `:focus-visible`: `outline: 2px solid var(--ink); outline-offset: -2px; border-radius: 28px` (`r-3xl`), inset 8 px from the wafer area so it never touches the control row (A35).
- Cursor: `default` over the disc at zoom 1; `grab` / `grabbing` at zoom > 1; `crosshair` in Select mode.
- **Select an area** icon button (§7.11), 32 x 32, `square-dashed` icon. Toggled (`aria-pressed="true"`): fill `fill-2`, icon `text-primary`. Shortcut `S`; Shift-drag selects without toggling.
- **Reset view**: hidden at zoom 1. At zoom ≠ 1: `caption` tertiary zoom value "182%" + 8 px + ghost button "Reset view" (32 h). Mobile: the zoom value is the button label. Shortcut `0`.
- Keyboard map on the focused stage is unchanged from `redesign.md` §4.7.

### 7.8 Segmented control

- Radix ToggleGroup `type="single"`, `role="radiogroup"` semantics.
- Track: height 32 (mobile 32; hit area 44 on coarse pointers via `::after`), padding 2, `r-pill`, fill `fill-2`. No border.
- Segment: height 28, padding 0 14, `r-pill`, `control` `text-secondary`. Hover `text-primary`. Pressed scale 0.97 on the label only.
- Thumb (active segment background): `r-pill`; light `#FFFFFF` + `shadow-thumb`; dark `rgba(255,255,255,0.16)`, no shadow. Active label `text-primary`.
- Thumb movement: §8.9 (`spring-snappy`, 0 ms on keyboard).
- Focus-visible: `focus-ring` on the focused segment, `r-pill`.
- Labels: "Pass/fail", "Hard bins", "Soft bins" (§2.2). In CJK the track keeps its height; segments shrink padding to 0 10 before the row wraps.

### 7.9 "Where the yield went" (bin Pareto)

Section card: `surface`, `r-2xl`, `shadow-card`, padding 24 (mobile 16). No nested boxes.

1. Title `title-2` primary "Where the yield went".
2. 8 px, takeaway `body` secondary, 2 lines max: "One bin holds 78% of the lost dies." (`pareto.takeaway`, share of the dominant bin).
3. 24 px, chart label `subhead` tertiary "Yield loss by bin" left; `subhead` tertiary "Share of all dies" right.
4. 8 px, rows.

| Part | Style |
|---|---|
| Row | Height 40, `r-md` (12 = 24 − 12 inset), padding 0 12, margin 0 -12, grid `88px 1fr 56px 88px`, gap 12, `align-items: center` |
| Bin code | `row-title` primary "SBIN 7"; the bin name shows in a tooltip after 600 ms |
| Bar | Height 8, `r-xs`, starts at the column's left edge, width = loss share / max share. Rank 0: `ember-mark`. All others: `bar-neutral` (light `rgba(0,0,0,0.16)`, dark `rgba(255,255,255,0.22)`). No track, no gridlines, no axis |
| Share | `subhead` primary tabular, right-aligned "9.2%" |
| Count | `subhead` tertiary tabular, right-aligned "1,456 dies" |
| Hover | Row fill `fill-1` |
| Pressed | Fill `fill-2`, scale 0.985 |
| Selected (clicked, or linked from a finding, stat, or the verdict) | Fill `fill-2`; non-dominant bar becomes `ink`; dominant bar stays `ember-mark`; `aria-pressed="true"` |

- Shows the top 6 loss bins. Below: text button "Show all 11 bins" / "Show fewer" (§8.6).
- The section follows the current Pass/fail, Hard bins, Soft bins mode: Pass/fail mode lists soft bins.
- Empty: "No yield loss. Every die passed." `callout` secondary, no chart.
- Screen reader: the existing table alternative stays.

`bar-neutral` is a new token; add it to §3.2 values in `palette.ts` (task P2).

### 7.10 Yield summary panel (`src/ui/charts/YieldSummaryPanel.tsx`)

Keeps today's behaviour (lot numbers, site rows and wafer rows as toggles that scope the selection store, wafer click shows that wafer, collapsible wafer list, anomaly stated in words). Changes are visual and copy only.

Section card as §7.9.

1. Title `title-2` primary "Yield by test site and wafer".
2. 8 px, takeaway `body` secondary, 2 lines max. Site anomaly lot: "Site 2 yields 61.3%, 24 points below the other sites." Otherwise: "Retests recovered {points} points of yield." (`yield.takeaway.*`).
3. 24 px, lot numbers: grid `repeat(3, 1fr)`, gap 24. Number `stat-s` primary tabular; caption 6 px below `subhead` secondary: "final yield", "on the first test" (`Term` First test), "retests" (`Term` Retests). Not buttons.
4. 32 px, sub-heading `headline` primary "Test sites"; 8 px; column header row `subhead` tertiary: "Site", "First test", "Final", "Retests" (numbers right-aligned).
5. Rows, then 32 px, sub-heading "Wafers", header "Wafer", same columns, the 5 lowest-yield wafers, then text button "Show all 25 wafers" / "Show fewer".

| Part | Style |
|---|---|
| Row | `<button aria-pressed>`, height 44, `r-md`, padding 0 12, margin 0 -12, grid `minmax(0,1fr) 72px 72px 56px`, gap 12, `align-items: center` |
| Name | `callout` primary "Site 2" / "W07" |
| Values | `callout` tabular: first test `text-secondary`, final `text-primary`, retests `text-secondary` |
| Anomaly (site the engine flagged) | After the name, 8 px: `triangle-alert` 14 px `text-secondary` + `subhead` secondary "Lowest yield". No orange, no red |
| Separators | `hairline`, inset 12, hidden next to hover or selected |
| Hover | `fill-1` |
| Pressed | `fill-2`, scale 0.985 |
| Selected | `fill-2`; final value weight 590; dies of that site or wafer become evidence (§8.3) |
| Missing value | En dash "–" `text-tertiary` |

- Single-site lots hide the "Test sites" block.
- Viewports narrower than 400 px hide the "Retests" column; the header then reads "First test", "Final".

### 7.11 Buttons

All buttons `r-pill`, `control` text unless stated, `transform-origin: center`. One primary per screen (§1.1 rule 4, A20).

| Variant | Size | Rest (light / dark) | Hover | Pressed | Disabled |
|---|---|---|---|---|---|
| Primary | 48 h landing and error, 40 h verdict action row, padding 0 22; label 15 / 590 / -0.01em | Fill `ink` (`#1D1D1F` / `#F5F5F7`), text `on-ink` | Fill `#333336` / `#FFFFFF` | Scale 0.97, fill `#000000` / `#E8E8ED` | Opacity 0.32, no hover |
| Secondary | 48, 44, or 32 h (nav), padding 0 20 (32 h: 0 14) | Fill `fill-2`, text `text-primary` | Fill `fill-3` | Scale 0.97 | Opacity 0.32 |
| Ghost | 32 h, padding 0 10 | Transparent, text `text-secondary` | Fill `fill-1`, text `text-primary` | Scale 0.97, fill `fill-2` | `text-disabled` |
| Text | Inline, no padding, hit area extended 8 px by `::after` | Transparent, text `text-secondary` (or `text-primary` when it is the row's action) | Text `text-primary` | Opacity 0.64 | `text-disabled` |
| Icon | 32 x 32 (44 x 44 coarse), icon 16 | Transparent, icon `text-secondary` | Fill `fill-1`, icon `text-primary` | Scale 0.94 | `text-disabled` |
| Icon, toggled | same | Fill `fill-2`, icon `text-primary` | Fill `fill-3` | Scale 0.94 | — |

- No loading spinners in buttons: every action in the product is local and acknowledges within 100 ms.
- No `→` or other trailing glyphs in labels. Leading icons only where listed in a component.
- Verb-first labels of 1–4 words (§9.1).

### 7.12 Menus, popovers, tooltips

| Surface | Width | Radius | Padding | Background | Rows |
|---|---|---|---|---|---|
| Menu (language, appearance, legend "+N more", bin list) | 200–240 | `r-2xl` | 12 | `material-thick` + `shadow-popover` | Height 40, `r-md`, padding 0 12, `control` primary; leading icon 16 `text-secondary` (8 px gap); check 16 `ink` on the current row; hover / highlight `fill-1`, pressed `fill-2` |
| Lot picker menu | 360 | `r-2xl` | 8 | same | §7.2 |
| Popover (confidence, legend entry detail) | 320 | `r-lg` | 16 | same | — |
| Tooltip | max 240 | `r-sm` | 6 10 | `material-thick` + `shadow-popover` | `caption` `text-primary`, 1–2 lines; shortcut keycap after 8 px |

- Offset 8 px from the trigger; flip and shift to stay 8 px inside the viewport; `transform-origin` at the trigger side (Radix `--radix-*-transform-origin`).
- Tooltip delay: 600 ms on controls; 0 ms when moving to another tooltip trigger within 400 ms of closing one. Never on touch.
- Menus and popovers close on `Esc`, outside click, and trigger click; focus returns to the trigger.
- Z: menus 50, tooltips 55.

### 7.13 Toasts (Sonner)

- Position bottom-centre, offset 24 (mobile 16 + `env(safe-area-inset-bottom)`), z 70, width `min(380px, 100vw − 32px)`.
- Toast: `material-thick`, `shadow-popover`, `r-lg`, padding 12 16, min-height 48, grid `auto 1fr auto`, gap 12, `align-items: center`.
  - Optional leading icon 16 `text-secondary`: `check` (success), `info` (notice), `circle-alert` (error). No red, no orange, no green.
  - Title `callout` primary; optional body `subhead` secondary 2 px below.
  - Optional action: text button `control` primary ("Show details", "Undo").
  - Error toasts persist and get an icon button "Dismiss" (`x`, 24 x 24).
- Timing: 4 s; hover or focus pauses the timer. At most 3 visible, `expand: true`, gap 8; the oldest leaves first.
- Copy: `redesign.md` §4.13 strings, plus "Theme set to dark." is **not** a toast (theme changes are silent).

### 7.14 Selection popover (box select)

- `material-thick`, `shadow-popover`, `r-lg`, padding 12 16, width 240, z 30. Anchoring and flipping as `redesign.md` §4.14.
- Content: `headline` primary tabular "148 dies selected"; 2 px; `subhead` secondary "31 failed, 79.1% yield"; 8 px; `subhead` secondary "Most loss: SBIN 7" (bin code untranslated); 12 px; a row with the text button "Clear" on the left and an "Esc" keycap (`caption` secondary on `fill-2`, `r-xs`, padding 2 6) on the right.
- Text tiers on this popover are primary and secondary only (it sits over the wafer).

### 7.15 Magnifier

- Container: `material-thick`, `shadow-popover`, `r-lg` (16), padding 8, width 200, z 20, `pointer-events: none`.
- Loupe (hover devices only): 184 x 112, `r-sm` (8 = 16 − 8), content per §5.9.
- Readout, 8 px below the loupe, padding 2 4 4, Inter only (no Geist Mono), 4 rows max, row gap 4:

| Row | Left | Right |
|---|---|---|
| 1 Status | 10 px swatch (full ember square for failed, hollow `hairline-strong` square for passed, bin colour in bin modes) + 6 px + `row-title` primary "Failed" / "Passed" | `subhead` secondary bin code "SBIN 7" |
| 2 Place | `subhead` secondary "X 12, Y −4" (tabular, true minus sign) | `subhead` secondary "Site 2" |
| 3 Key test (if any) | `subhead` secondary test name `IDDQ_LEAK` (ellipsis at 96 px) | `subhead` primary tabular "14.20 uA"; when outside limits, a second line right-aligned `caption` primary "out of limits" |
| 4 Retest (only if retested) | `subhead` secondary "Retested, passed on try 2" | — |

- Text tiers: primary and secondary only (no tertiary on material over the wafer). Nothing orange except the swatch.
- Touch: no loupe; the readout is pinned 12 px above the tapped die (flips below at the top edge) with the pinned-die stroke (§5.4).
- Placement and follow: `redesign.md` §4.8 (16 px offset, flips, never covers the hovered die). Motion: §8.4.

### 7.16 Sheets and dialogs

| Sheet | Desktop | Mobile |
|---|---|---|
| Bins-only (§6.6), error details, keyboard shortcuts | Centred dialog, width 480 (error details 560), `surface`, `r-2xl`, `shadow-popover`, padding 32; icon button "Close" (`x`) at 16 / 16 from the top-right | Bottom sheet, full width, radius `24 24 0 0`, padding 24 16 `calc(24px + env(safe-area-inset-bottom))`, grabber 36 x 5 `fill-3` `r-pill` centred 8 px from the top |
| Backdrop | `scrim` (§3.2), z 60 | same |

- Title `title-1` (error details: `title-2`); body `body` secondary; actions right-aligned on desktop (primary last), stacked full width on mobile (primary first).
- Focus trap; initial focus on the primary action; `Esc` closes; focus returns to the opener.

### 7.17 Term (glossary tooltip)

- Markup: `<button type="button" class="term" aria-describedby={popoverId}>` inline, inheriting font, colour, and size; no padding.
- Underline: `text-decoration: underline dotted 1px; text-underline-offset: 3px` (CJK 4px); `text-decoration-color: color-mix(in srgb, currentColor 45%, transparent)`. Hover / open: 80 % mix. Focus-visible: `focus-ring` at `r-xs`.
- Popover: `material-thick`, `shadow-popover`, `r-md` (12), padding 12 14, max-width 280, z 55, offset 6, placement top (flip to bottom).
  - Line 1: the term, `subhead` 590 `text-primary`.
  - 2 px, definition `subhead` `text-secondary`, line-height 1.45 (CJK 1.6), at most 3 lines at 280 px in English.
- Open: hover after 300 ms (600 ms when the term sits inside a control, §5.6), keyboard focus at 0 ms, tap toggles. Close: pointer leaves term and popover for 100 ms, `Esc`, blur, second tap.
- Limits: at most 2 `Term`s per sentence; never inside `display-*` or `stat` text; never on a bin code, test name, or WM-811K class name in the verdict headline.
- Screen readers: the definition is the button's description, not a live region.

### 7.18 Coach marks (first-use hints)

- Container: `material-thick`, `shadow-popover`, `r-md` (12), padding 12 14 12 16, max-width 280, z 35, `role="status"` (polite).
- Arrow: 12 x 6 SVG triangle in the container colour, with a 1 px `hairline` edge, centred on the anchor, 0 px gap to the container; container offset 10 px from the anchor.
- Content: text `callout` `text-primary` (2–3 lines); 8 px; footer row right-aligned with text button "Got it" (`control` primary). No step counter, no "Skip tour", no image, no orange.
- Anchoring and dismissal rules: §2.4. The anchor element is never covered: if the preferred side does not fit, flip; if neither fits, the hint is skipped and marked dismissed.
- `Esc` dismisses the visible hint without moving focus. Hints never take focus.

### 7.19 Empty, loading, and error states inside components

| Component | State | Content |
|---|---|---|
| Findings | No findings | Card replaced by one line `callout` secondary "No findings. This lot looks healthy." |
| Findings | Bins-only | Parametric findings omitted; notice per §6.6 |
| Pareto | No loss | §7.9 empty line |
| Yield panel | One site | "Test sites" block hidden |
| Magnifier | Die with no test records | Rows 1, 2 only |
| Strip | One wafer | Strip hidden; the control row keeps its height |
| Lot picker | No recent files | "Recent files" group hidden |
| Any section | Loading | Section absent until data exists. No skeletons, no spinners |

---

## 8. Interaction and motion

Rules for every entry below:
- **Animated properties:** DOM animates `transform` and `opacity` only (plus `background-color` and `color` for hover fills, §8.9). The wafer animates by canvas draws and the camera wrapper's `transform`.
- **Interruptible:** every animation restarts from the current on-screen value and velocity. No input is ever ignored or queued behind an animation.
- **Acknowledgement:** every pointer or key action changes something visible within 100 ms (target: the same frame), and writes a `data-ack` timestamp for the perf gate.
- **Reduced motion** (`prefers-reduced-motion: reduce`): the fallback column applies; final values appear at once.
- Token names refer to §3.12.

### 8.1 Load: probe sweep and ignite (signature moment 1)

| Aspect | Spec |
|---|---|
| Trigger | First lot load in a browser session (`sessionStorage["cal.sweep.v1"]` unset). Later loads skip to the ignite step |
| Disc | Material (§5.2) is drawn at frame 0, opacity 1. No fade on the disc |
| Sweep | Dies appear in probe stepping order (PRR order) as **pass tiles**, including future fail dies. Progress `p(t)`: follows real parse progress, but never faster than `t / 900 ms` and never slower than parse progress; the sweep for the demo lot lasts 900–1200 ms |
| Probe light | `probe-light` sprite on the overlay at the last drawn die; opacity 0 → 1 over the first 120 ms, 1 → 0 over the last 160 ms |
| Ignite | When the sweep ends: the fail canvas opacity 0 → 1 over `dur-4` (280 ms) `ease-out`, so dead dies turn ember all at once, a single "lights on" beat. Then the fail canvas merges into the base |
| Header | Stage caption "Reading…" swaps to "110 of 633 dies failed" at ignite start (0 ms) |
| Interrupt | Any key, click, or wheel: jump to the final state in the next frame (sweep complete, fail canvas at 1). Input is processed normally afterwards |
| Reduced motion | No sweep, no probe light. Final dies drawn; base canvas opacity 0 → 1 in 120 ms |
| Mark | Stage `data-sweep="done"` when complete |

### 8.2 Verdict reveal

| Aspect | Spec |
|---|---|
| Trigger | Ignite start (§8.1), or data ready when the sweep is skipped |
| What | Six blocks in order: headline line group, takeaway, action row, stat row, findings label + card, possible causes trigger. Each: `opacity 0 → 1` and `translateY(12px → 0)` |
| Timing | `spring-ui`, stagger 60 ms, last block starts at 300 ms; all settled by ≈ 650 ms. No blur |
| Count-up | Stat numbers count from 0 to the value over 700 ms `ease-out-expo`, starting with the stat block. Written to `textContent` through refs (no React render per frame). Format is the final format at every step (percent keeps 1 decimal; integers stay grouped). Width does not jitter (tabular numerals, `min-width` set from the final string) |
| Interrupt | Pointer or key input in the verdict column completes all blocks and counts instantly |
| Reduced motion | All blocks opacity 0 → 1 in 120 ms together; numbers final |
| Repeats | Every lot load (user-caused). Switching wafers does not replay it |

### 8.3 Evidence: finding click, dies light up, camera focus (signature moment 2)

Triggers: a finding row, the cause phrase, Show on wafer, a stat, a Pareto row, a yield row, or a Cmd-K filter. All go through the one selection store.

| Step | t | What animates | Spec |
|---|---|---|---|
| Acknowledge | 0 (pointerdown) | Row or button fill | `fill-2` at 0 ms |
| Veil | 0–200 ms | Overlay `dim-veil` alpha 0 → 1 | `ease-out`; evidence dies punched out |
| Ignite in pattern order | 0–600 ms | Per evidence die: `evidence-rim` and `evidence-bloom` alpha 0 → 1 over 180 ms `ease-out` | Start delay `rank / (n − 1) × 420 ms`. Order: Edge-Ring, Donut, Center by polar angle clockwise from 12 o'clock (the ring is traced like a lamp passing round it); Scratch by projection on the scratch axis (the line is drawn); site, Random, Loc, bins, and tests by distance from the evidence centroid |
| Camera | 0 → settle | Camera wrapper `transform` | Target: evidence bbox on this wafer + 48 px padding, scale clamped to [1, 4]; fit view (scale 1) when the bbox spans >= 70 % of D. Independent `spring-camera` integrators for x, y, scale from current value and velocity. Skipped if the user has panned or zoomed since the last evidence change |
| Strip | 0–160 ms | Thumbnail `opacity` → 0.32 for wafers with no evidence dies | `dur-2` `ease-out` |
| Caption and links | 0–120 ms | Stage caption cross-fade; matching Pareto row, yield row, and stat get their selected fill | `dur-1` |
| Body | §8.6 | Finding row expands | — |

- **Clear** (second click, "Clear", `Esc`): veil, rims, and bloom fade together to 0 over 160 ms from their current alpha; strip opacity → 1 in 160 ms; camera springs back to fit unless the user moved it during evidence.
- **Switch** to another evidence set mid-animation: the old set fades out from its current alpha (160 ms) while the new ignite starts at once; the camera retargets keeping its velocity.
- **Mobile:** if the stage is less than 50 % visible, the page scrolls so the stage top sits 8 px below the nav (`smooth`); the ignite starts when the stage is >= 50 % visible (IntersectionObserver) or after 400 ms, whichever is first.
- **Reduced motion:** veil, rims, and bloom at final alpha at once; no stagger; camera jumps; strip opacity at once; scroll `instant`.
- Overlay redraws only while an alpha or camera animation runs; then the rAF loop stops.

### 8.4 Hover and magnifier

| Aspect | Spec |
|---|---|
| Die hover stroke | Drawn on the overlay in the same frame as the `pointermove` (0 ms). O(1) hit test by grid index |
| Magnifier show | First die under the pointer: `opacity 0 → 1`, `scale(0.96 → 1)`, `spring-snappy`, `transform-origin` at the container corner nearest the pointer |
| Follow | Position written to `transform: translate3d()` in rAF, 1:1, no spring, no React state |
| Die change | Content swaps at 0 ms; no re-animation |
| Hide | Pointer off the disc for 80 ms: `opacity → 0` over `dur-1`. Re-entering during the fade reverses from the current opacity |
| Touch | Tap shows the pinned readout at 0 ms (opacity only, 120 ms); tap elsewhere hides it |
| During drag pan or camera spring | Hidden; returns after the camera settles and the pointer moves |
| Reduced motion | Opacity only, 120 ms; no scale |

### 8.5 Zoom and pan

| Input | Behaviour |
|---|---|
| Mouse wheel (discrete) | Target scale × `exp(−deltaY × 0.0015)`, anchored at the cursor; `spring-camera` toward the target |
| Trackpad pinch (`ctrlKey` wheel) and touch pinch | Direct 1:1 manipulation, factor `exp(−deltaY × 0.01)`; no spring while fingers move |
| Drag pan (zoom > 1) | 1:1. Past the bounds (disc centre must stay inside the stage), offset follows the rubber-band curve `b × (1 − 1 / (x × 0.55 / b + 1))`, b = stage half-size |
| Release with velocity | Inertia: velocity × 0.998 per ms until < 0.02 px/ms. If the end point is out of bounds, `spring-throw` returns it, keeping the release velocity |
| Scale range | 1 to 8. Below 1 during pinch: rubber-band; on release `spring-throw` to 1 |
| Double-click / double-tap | At scale 1: zoom 2.5× about the point. Otherwise: fit. `spring-camera` |
| Keyboard `+` `-` `0` | 0 ms jumps (1.5× steps about the cursor die) |
| Re-raster | After the camera rests 120 ms at scale > 2: the visible region re-renders at the new scale in one task (<= 8 ms) and swaps in without a visible change |
| Interrupt | A new gesture grabs the camera at its current presented value; the running spring stops and hands over its velocity |
| Reduced motion | Wheel and double-click jump (0 ms); no inertia (release stops); bounds clamp without rubber-band; pinch and drag stay 1:1 |

`will-change: transform` is set on the camera wrapper only while a gesture or spring runs.

### 8.6 Disclosure open and close

Applies to finding rows, Possible causes, "Show all 11 bins", "Show all 25 wafers", "Show 2 more findings".

| Aspect | Spec |
|---|---|
| Chevron | `rotate(0 → 180deg)`, `spring-snappy` |
| Content (open) | Mounted in flow in the same frame; no `height` animation and no size `layout` animation on text. The new body fades `opacity 0 → 1` and `translateY(−4px → 0)` over `dur-1` `ease-out`, starting 40 ms after the click |
| Siblings below | Motion `layout="position"` (translate only), `spring-ui`, so they glide to their new place; their text is never scaled, and no two text boxes overlap at any frame (A31) |
| Content (close) | Body `opacity → 0` over 100 ms, then unmounts; siblings glide up with `layout="position"`, `spring-ui` |
| Accordion | Opening a finding closes the open one in the same frame (both animate) |
| Interrupt | Reopening during close reverses the body from its current opacity; layout picks up from the current transform |
| Reduced motion | No layout animation; content snaps; body opacity 0 → 1 in 120 ms; chevron rotates at 0 ms |

### 8.7 Wafer switching

| Input | Behaviour |
|---|---|
| Thumbnail click | New wafer raster ready (cached `ImageBitmap` or draw <= 8 ms). A snapshot of the old wafer sits on a canvas above and fades `opacity 1 → 0` over `dur-2` (160 ms) `ease-out`. Strip scrolls the thumbnail to centre with `smooth` |
| Arrow keys, Home/End, PageUp/PageDown, key repeat | Swap at 0 ms; no crossfade; strip scroll `instant` |
| Camera | Keeps scale and position across wafers, so the same region can be compared |
| Evidence | Stays (evidence is lot-wide); rims and bloom draw at full alpha on the new wafer, no replayed ignite |
| Header | "Wafer W07" and its count swap at 0 ms |
| Active ring | Moves at 0 ms (no sliding ring) |
| Interrupt | A click during a crossfade replaces the snapshot with the currently visible frame and restarts the fade |
| Reduced motion | Swap at 0 ms; strip scroll `instant` |

### 8.8 Theme switch

| Aspect | Spec |
|---|---|
| Trigger | Selection in the Appearance menu |
| Animation | `document.startViewTransition()` root cross-fade, 280 ms (`dur-4`) `ease-in-out`, opacity only (`::view-transition-old(root)`, `::view-transition-new(root)`). Inside the callback: set `data-theme`, `color-scheme`, `theme-color`, and re-raster the canvases (disc pixels are theme-independent, so only the DOM shadow and halo layers differ) |
| Unsupported browsers | Instant switch |
| OS-driven change while on "Match system" | Instant (no animation) |
| Interrupt | A second change during the transition calls `skipTransition()` on the running one, then starts the new one |
| Reduced motion | Instant |
| Never | Animate individual colours, `filter`, or `background` per element |

### 8.9 Hover, press, and small UI changes

| Element | Property | Duration and easing |
|---|---|---|
| Rows, buttons, chips, legend entries | `background-color`, `color` | `dur-1` `ease-out` in and out |
| Press | `transform: scale(press-scale)` | In: 80 ms `ease-out` on `pointerdown`; release: `spring-snappy` (CSS fallback 160 ms `ease-out`) |
| Segmented thumb | Motion `layoutId` `transform` | `spring-snappy`; keyboard change 0 ms |
| Sample-lot card hover | Card `translateY(0 → −2px)`; a pseudo-element carrying `shadow-card-hover` fades `opacity 0 → 1` | `dur-3` `ease-out`; leave 160 ms |
| Sample-lot card press | `scale(0.985)` | 80 ms in, `spring-snappy` out |
| Strip thumbnail hover | `scale(1.06)` | 160 ms `ease-out` |
| Nav hairline on scroll | `opacity` | `dur-1` |
| Cause phrase underline | `text-decoration-color` | `dur-1` (paint-only on a short text run; allowed exception) |
| Reduced motion | Fills and colours unchanged; press scales and card lift removed | — |

Never `transition: all`. Hover effects are gated by `@media (hover: hover)`.

### 8.10 Coach marks

- Enter: `opacity 0 → 1` and `translate` 4 px toward the anchor → 0, `spring-ui`.
- Exit: `opacity → 0` over `dur-2`; the next hint (if any) waits for its own delay in §2.4.
- Never more than one visible; a hint never enters during the probe sweep, verdict reveal, or an evidence ignite.
- Reduced motion: opacity only, 120 ms.

### 8.11 Silicon sheen (signature moment 3)

| Aspect | Spec |
|---|---|
| Element | The sheen ellipse inside the disc mask (§5.2 step 6) |
| Rest | At the rest position in §5.2 |
| Pointer over the stage (hover devices) | Target offset = `clamp((pointer − disc centre) / R, −1, 1) × 0.05 D` on each axis, plus `rotate(dx × 3deg)`; `spring-sheen` toward the target. The light seems to slide across polished silicon as the pointer moves |
| Pointer leaves the stage | Target returns to rest, `spring-sheen` |
| During drag pan, pinch, or a camera spring | Target frozen; resumes after settle |
| Landing cards | Same effect on the card wafer while the card is hovered, amplitude 0.03 D |
| Touch, `prefers-reduced-motion`, `prefers-reduced-transparency` | Static at rest (hidden under reduced transparency) |
| Cost | One `transform` write per frame while the spring moves; no canvas redraw |

### 8.12 Toasts

- Enter: `translateY(16px → 0)`, `opacity 0 → 1`, `spring-ui`.
- Exit: `opacity → 0`, `translateY(→ 8px)`, `dur-2`.
- Stack reflow: siblings move by `transform`, `spring-ui`.
- Touch: swipe down > 40 px or velocity > 0.5 px/ms dismisses, following the finger 1:1.
- Reduced motion: opacity only, 120 ms.

### 8.13 Menus, popovers, tooltips, sheets

| Surface | Open | Close |
|---|---|---|
| Menu, popover (pointer) | `opacity 0 → 1`, `scale(0.97 → 1)` from the trigger-side origin, `spring-ui` | `opacity → 0`, `dur-2` |
| Menu (keyboard open) | 0 ms | 0 ms |
| Tooltip, Term popover | `opacity 0 → 1`, `dur-1` | `opacity → 0`, 100 ms |
| Selection popover | As `redesign.md` §4.14: `scale(0.96 → 1)` + opacity, `spring-snappy`, after the drag passes 8 px | `dur-1` |
| Dialog (desktop) | `opacity 0 → 1`, `scale(0.98 → 1)`, `spring-ui`; scrim opacity `dur-3` | `opacity → 0` `dur-2`; scrim `dur-2` |
| Bottom sheet (mobile) | `translateY(100% → 0)`, `spring-ui` | `translateY(→ 100%)`, `spring-ui`; drag down 1:1, dismiss past 30 % height or velocity > 0.5 px/ms |
| Reduced motion | Opacity only, 120 ms | Opacity only, 120 ms |

### 8.14 Instant actions (0 ms)

Locale switch, Cmd-K palette open, keyboard menu open, arrow-key die cursor, key-repeat wafer scrub, legend toggle redraw, mode switch redraw (Pass/fail, Hard bins, Soft bins), zoom keys.

### 8.15 Signature moments (the only "delight")

| # | Moment | Cause | Feeling | Bound |
|---|---|---|---|---|
| 1 | Probe sweep + ignite (§8.1) | First load per session | An examination lamp passes over the body, then the dead dies light up together | <= 1.2 s + 280 ms, skippable |
| 2 | Evidence ignite in pattern order (§8.3) | A click on any claim | The ring is traced clockwise, a scratch is drawn along its line | <= 600 ms |
| 3 | Silicon sheen (§8.11) | Pointer movement | The disc is a real polished object | Spring, no loop |

Nothing else animates unprompted. None loops; none blocks input; none plays twice for the same cause.

### 8.16 Reduced motion summary

| Item | Normal | Reduced |
|---|---|---|
| Probe sweep | §8.1 | None; 120 ms fade |
| Verdict reveal, count-up | Stagger + spring, 700 ms count | All at once, 120 ms fade, final numbers |
| Evidence ignite, camera | Stagger, spring | Final alpha at once, camera jump |
| Inertia, rubber-band | On | Off |
| Disclosure | Layout glide + fade | Snap + 120 ms fade |
| Wafer switch | 160 ms crossfade on click | 0 ms |
| Theme switch | 280 ms cross-fade | Instant |
| Sheen, card lift, press scale | On | Off |
| Popovers, toasts, hints, sheets | Springs | Opacity 120 ms |

### 8.17 Performance

- Budgets and the perf gate procedure: `redesign.md` §5.10, unchanged. Remove its blur allowance (no `filter` animation remains).
- Add to the gate script: one theme switch through the Appearance menu, and a 1 s pointer sweep across the disc (sheen). Pass criteria unchanged: 0 frames > 50 ms, median rAF < 20 ms, p95 < 34 ms (A39).
- Shadows: `box-shadow` is never animated; hover shadows cross-fade a pseudo-element's `opacity`.
- The magnifier is the only blurred surface that moves every frame. If its `backdrop-filter` pushes p95 rAF over 34 ms in the gate, it falls back to an opaque `surface` background.

---

## 9. Copy tone and i18n

### 9.1 Tone rules

1. Short and declarative: one idea per sentence, at most 20 words in UI copy (glossary definitions at most 2 sentences).
2. Plain words first, domain term second (§2.2). A first-time reader understands every level-0 sentence without a tooltip.
3. Sentence case everywhere. No exclamation marks, no "please", "simply", "just", "oops", "sorry", "successfully".
4. No hedging adverbs ("possibly", "perhaps", "seems") except inside Possible causes, which uses "may" and "likely" on purpose.
5. Buttons: verb first, 1–4 words, naming the result ("Show on wafer", "Open file", "Use bins-only"). Never "Submit", "OK", or "Click here".
6. Numbers as digits with `Intl` formatting (`redesign.md` §6.5): yield 1 decimal, Cpk and confidence 2 decimals, grouped integers, SI prefixes (`uA`, `mV`) with a space before the unit, true minus sign `−` in coordinates.
7. Errors: what happened, then what to do. No blame, no codes in the title.
8. Lists in prose use commas and "and"; never middle dots or slashes (the "Pass/fail" label is the one exception).

### 9.2 Never translated

Bin codes and names (`SBIN 7`, `HBIN 3`, `IDDQ_EDGE_LEAK`), test names and numbers (`IDDQ_LEAK`, `204`), STDF record and field names (`FAR`, `PRR`, `CPU_TYPE`), lot, part, and wafer IDs (`CAL-ER-2401`, `W01`), file names, units, WM-811K class names (`Edge-Ring`, `Scratch`, …), and "Chip Autopsy Lab". Embedded in a localized sentence, they are wrapped in `<bdi translate="no">`. Plain-language labels around them ("Leakage test", "Soft bins") are translated.

### 9.3 Sentence templates (English source)

| Key | Template | Notes |
|---|---|---|
| `verdict.pattern` | "Cause of death: {pattern} failure." | `{pattern}` untranslated |
| `verdict.site` | "Cause of death: test site {site} contact failure." | — |
| `verdict.random` | "Cause of death: random defects, no spatial signature." | — |
| `verdict.healthy` | "No cause of death." | No orange |
| `takeaway.edgeRing` | "Most failing dies sit in the outer {rings} rings of every wafer. Final yield is {yield}." | 2 lines at 1440 |
| `takeaway.scratch` | "Failing dies line up along a scratch on {count} of {total} wafers. Final yield is {yield}." | — |
| `takeaway.center` / `.donut` / `.edgeLoc` / `.loc` / `.nearFull` | "Most failing dies sit {where} of the wafer. Final yield is {yield}." with `{where}` = "in the centre", "in a ring around the centre", "in one area at the edge", "in one area", "across almost all" | `{where}` is its own key per class |
| `takeaway.site` | "Test site {site} fails {rate} of its dies, the other sites fail {otherRate}. Final yield is {yield}." | — |
| `takeaway.random` | "Failures are scattered with no shape. Look at the tests before the process. Final yield is {yield}." | — |
| `takeaway.healthy` | "{passed} of {total} dies passed every test." | — |
| `finding.pattern.title` | "Failures concentrate in the outer {rings} rings" (Edge-Ring); one key per class | Row headline |
| `finding.test.title` | "{kind} {test} is far off target" (Cpk < 1.0) / "{kind} {test} is close to its limits" (1.0 ≤ Cpk < 1.33) | `{kind}` from the test unit: A with name prefix `IDDQ` → "Leakage test"; A → "Current test"; V → "Voltage test"; s → "Timing test"; Hz → "Frequency test"; else "Test" |
| `finding.site.title` | "Site {site} fails {ratio} times more often than the others" | — |
| `finding.bin.title` | "One failure type causes {share} of the loss" | Sub-line names `SBIN 7` |
| `finding.test.sub` | "Cpk {cpk}, mean {mean}, limits {lo} to {hi}" | Numbers and codes live in sub-lines |
| `stage.caption` | "{failed} of {total} dies failed" | — |
| `stage.evidenceCaption` | "{lotCount} dies on {wafers} wafers, {waferCount} on this wafer" | — |
| `pareto.takeaway` | "One bin holds {share} of the lost dies." | — |
| `yield.takeaway.site` | "Site {site} yields {yield}, {points} points below the other sites." | `{points}` 0 decimals |
| `yield.takeaway.retest` | "Retests recovered {points} points of yield." | 1 decimal |

### 9.4 Autopsy phrasing (the only themed copy)

| Key | en | zh-CN | zh-TW | ja | ko |
|---|---|---|---|---|---|
| `landing.headline`, `drop.headline` | Drop the body. | 把遗体放这里。 | 把遺體放這裡。 | 遺体をここに。 | 시신을 여기에. |
| `verdict.prefix` | Cause of death: | 死因： | 死因： | 死因： | 사인: |

Plus one non-verbal touch: the probe light (§8.1). Outside these two phrases and the product name, "autopsy", "body", "dead", and "death" appear nowhere: not in buttons, errors, toasts, hints, or glossary text.

### 9.5 New and changed keys (English)

Every key below is added to all 5 dictionaries with placeholder parity (the existing parity test covers it).

| Key | en |
|---|---|
| `nav.openFile` | Open file |
| `theme.label` | Appearance |
| `theme.ariaLabel` | Appearance: {preference} |
| `theme.system` / `.light` / `.dark` | Match system / Light / Dark |
| `theme.systemNote` | Match system follows your device setting. |
| `landing.subline` | Find out why a wafer lot lost yield. Drop an STDF test log and get the cause, linked to the dies. |
| `landing.primary` / `landing.secondary` | Open the sample lot / Open file |
| `landing.hint` | Or drop a .stdf, .std, or gzip file anywhere. Files stay on this device. |
| `landing.cardMeta` | {wafers} wafers, {dies} dies |
| `verdict.showOnWafer` | Show on wafer |
| `confidence.high` / `.moderate` / `.low` | High confidence, {value} / Moderate confidence, {value} / Low confidence, {value} |
| `confidence.match` | Match with {pattern} |
| `mode.passFail` / `.hardBins` / `.softBins` | Pass/fail / Hard bins / Soft bins |
| `legend.failed` / `.passed` / `.good` / `.more` | Failed / Passed / Good / +{count} more |
| `stage.selectArea` / `.resetView` | Select an area / Reset view |
| `strip.earlier` / `.later` | Earlier wafers / Later wafers |
| `findings.label` / `.clear` / `.more` / `.checkNext` | Findings / Clear / Show {count} more findings / Check next |
| `causes.label` / `.note` / `.basedOn` | Possible causes / These are likely explanations, not proof. Confirm them in the tool logs. / Based on finding {n} |
| `pareto.title` / `.chartLabel` / `.axisLabel` / `.showAll` / `.empty` | Where the yield went / Yield loss by bin / Share of all dies / Show all {count} bins / No yield loss. Every die passed. |
| `yield.title` / `.sites` / `.wafers` / `.lowest` / `.showAll` | Yield by test site and wafer / Test sites / Wafers / Lowest yield / Show all {count} wafers |
| `yield.col.firstPass` / `.final` / `.retests` | First test / Final / Retests |
| `magnifier.failed` / `.passed` / `.place` / `.outOfLimits` / `.retested` | Failed / Passed / X {x}, Y {y} / out of limits / Retested, passed on try {n} |
| `hints.show` / `.hover` / `.hoverTouch` / `.strip` / `.gotIt` | Start here. This lights up the dies behind the verdict. / Point at any die to read its bin and test values. / Tap any die to read its bin and test values. / Flip through all {count} wafers here, or press ← and →. / Got it |
| `glossary.*` | §2.3 table |
| `glossary.pattern.center` | Failures cluster in the middle of the wafer. |
| `glossary.pattern.donut` | Failures form a ring between the centre and the edge. |
| `glossary.pattern.edgeLoc` | Failures cluster in one patch at the wafer edge. |
| `glossary.pattern.edgeRing` | Failures form a ring around the whole wafer edge. |
| `glossary.pattern.loc` | Failures cluster in one patch away from the edge. |
| `glossary.pattern.nearFull` | Almost every die on the wafer failed. |
| `glossary.pattern.random` | Failures are scattered with no spatial shape. |
| `glossary.pattern.scratch` | Failures line up along a thin line or arc. |
| `glossary.pattern.none` | No spatial failure pattern was found. |

Each `glossary.pattern.*` definition is prefixed at render time with the shared sentence "A failure shape from the WM-811K wafer map taxonomy." The class name itself stays untranslated.

### 9.6 Errors

Titles and bodies: `redesign.md` §3.7 table, unchanged. Changes: the secondary button reads "Open the sample lot" (`landing.primary`), and the title uses `title-1`. A truncated file with at least one complete wafer opens the loaded view and shows a persistent toast (§7.13) with the same title, body, and a "Show details" action.

### 9.7 i18n constraints

- **Locales:** `en` (source), `zh-CN`, `zh-TW`, `ja`, `ko`. Detection, persistence, and formatting are unchanged (`redesign.md` §6.4–§6.5).
- **No strings in components.** Every visible string, `aria-label`, tooltip, and hint is a dictionary key.
- **Length tolerance:** every component survives strings 40 % longer than English. Behaviour when text is long:

| Component | Overflow behaviour |
|---|---|
| Verdict headline | Up to 3 lines, then size steps down (§4.3) |
| Takeaway | Up to 3 lines desktop, 5 mobile |
| Buttons, segmented labels | Never truncate; the row wraps (segmented padding shrinks to 0 10 first) |
| Finding headline | Ellipsis at 1 line desktop with full text in `title` and in the expanded body; 2 lines mobile |
| Lot picker title, file names, test names in the magnifier | Ellipsis |
| Stat captions | 2 lines, then 3 at 1024 and below |
| Glossary definitions, hints | Up to 4 lines at 280 px |

- **CJK** (`zh-CN`, `zh-TW`, `ja`, `ko`): typography per §4.3 (letter-spacing 0, line-heights, size steps, `line-break: strict` for zh and ja, `word-break: keep-all` for ko). Additional rules:
  - Full-width punctuation in CJK strings (`：`, `。`, `，`); `verdict.prefix` keeps its own colon, so templates never add one.
  - Latin digits and codes stay in Inter; there is no space added between CJK and Latin runs beyond what the translation contains.
  - Term underline offset 4 px; glossary definitions at most 90 characters.
  - Hints keep the arrow-key glyphs `←` `→`.
  - Nav at 390 px fits the short wordmark, the compact lot picker, and two icon buttons on one line in every locale (A40).
- **Language menu rows** carry their own `lang` attribute so each name renders in its own font.
- **Plurals:** `Intl.PluralRules` with `.one` / `.other` keys in English (`redesign.md` §6.3).

---

## 10. Acceptance checklist

Each item is verified on a Playwright screenshot (Chromium, `deviceScaleFactor: 2`, `?nohints=1` unless the item is about hints, demo lot `edge-ring-etch` unless stated) plus, where noted, a DOM or pixel assertion. Viewports: 1440 x 900, 1280 x 800, 1024 x 768, 390 x 844. "Both themes" means `colorScheme: "light"` and `"dark"` with the preference on Match system. Results go to `logs/premium-acceptance.md` with one screenshot per item.

**Tokens and theme**

- **A1.** Light, 1440, landing and loaded: page background samples `#F5F5F7`, sample cards and section cards `#FFFFFF`, body text `#1D1D1F`. (§3.2)
- **A2.** OS dark on Match system: the first painted frame after reload is already `#000000` (no light flash). Choosing Light in the Appearance menu turns the page `#F5F5F7`, persists across reload, and the menu shows the check on "Light". (§3.1, §7.1, §8.8)
- **A3.** Loaded view, 1440, both themes: elements whose computed colour or fill is in the ember family (`#FF6B2C`, `#E8591E`, `#D94E14`, `#FF8A57`), outside the wafer canvases, thumbnails, legend swatches, and magnifier swatch, are at most 2 per viewport (cause phrase and dominant Pareto bar). A healthy lot has 0. (§3.4)
- **A4.** Stat numbers, finding text, legend labels, buttons, focus rings, toasts, and hints are never ember-coloured; stat numbers compute to `text-primary`. (§7.5, §1.3)

**Wafer**

- **A5.** Disc crop at 1440: a pixel at 25 % / 25 % of the disc box is lighter than one at 75 % / 75 % by >= 6 units of L\*; the notch is visible at 6 o'clock; the top rim shows a lighter bevel than the bottom rim. (§5.2)
- **A6.** A pass tile and the disc around it sample at 1.1–1.3:1; a fail die samples >= 5:1 against both. The wafer no longer reads as a grid of grey squares. (§5.3)
- **A7.** At zoom 400 %, fail dies fill the cell minus the street with rounded corners and a top facet; pass dies are smaller (80 %) squares. (§5.3)
- **A8.** Light: a soft contact shadow sits under the disc and no box, border, or fill surrounds the stage. Dark: a faint halo separates the disc from black. (§5.1, §3.3)
- **A9.** After Show on wafer: evidence fail dies sample `#FF6B2C` with a white rim; non-evidence fail dies are a dark ember-brown (hue within 15° of `#FF6B2C`, L\* < 35), never salmon or grey; pass tiles under the veil are invisible. (§5.4)
- **A10.** Hovering a fail die: the die has the white hover stroke; the magnifier shows at most 4 readout rows, status first, in Inter (no monospace computed font), with no tertiary-grey text and no orange text. (§7.15)
- **A11.** Control row at 1440: one line under the wafer holding the segmented control ("Pass/fail", "Hard bins", "Soft bins"), the legend "Failed 110" and "Passed 523", and the Select an area button; nothing floats over the wafer. (§5.6, §5.7)
- **A12.** Wafer strip at all 4 viewports: the active thumbnail ring, the first and last thumbnails, and hovered thumbnails are fully visible (no clipped pixels); the edge fade shows only on a side that can scroll; chevrons show on desktop only when that side can scroll. (§5.8)
- **A13.** With `contrast: "more"` emulated (`prefers-contrast: more`), pass tiles sample >= 3:1 against the disc. (§5.3)

**Layout**

- **A14.** Landing 1440 x 900: headline, subline, both buttons, the hint line, three sample cards, and the footer line are all above the fold; nothing touches a viewport edge. (§6.1)
- **A15.** Loaded 1440 x 900: the verdict column shows blocks 1–6 (headline, takeaway, action row, stats, findings, Possible causes) above the fold; the disc diameter is 596 ± 2 px. (§6.2)
- **A16.** Loaded 1280 x 800: blocks 1–5 and the top of block 6 are above the fold; the disc diameter is 496 ± 2 px. (§6.2)
- **A17.** Loaded 1024 x 768: no horizontal scroll; the legend sits on its own line under the segmented control; the verdict is at most 3 lines. (§6.2)
- **A18.** Loaded 390 x 844: verdict, takeaway, action row, the full wafer disc, the control row, and the strip are above the fold; `document.documentElement.scrollWidth` equals 390. (§6.2)
- **A19.** Stage column at 1440 stays visible (sticky) when the page is scrolled to "Yield by test site and wafer"; clicking a site row lights dies on the visible wafer. (§6.2, §7.10)

**Clarity**

- **A20.** Exactly one primary (filled `ink`) button is visible on each screen: landing ("Open the sample lot"), loaded ("Show on wafer"), parse error ("Open another file"), bins-only sheet ("Use bins-only"). (§2.1, §7.11)
- **A21.** No level-0 control or heading is jargon-only: the visible labels are the §2.2 plain labels; "Hard bins", "Soft bins", "yield", and "Confidence" carry the dotted `Term` underline or a definition tooltip. (§2.2, §7.17)
- **A22.** Hovering "Cpk" in an expanded finding opens a definition popover within 300–400 ms, at most 3 lines at 280 px, not clipped by the viewport. (§2.3, §7.17)
- **A23.** With `localStorage` cleared and hints enabled: the "Start here" hint appears next to Show on wafer about 800 ms after the verdict settles; after clicking Show on wafer it is gone and does not return after reload. (§2.4, §7.18)
- **A24.** No screenshot in the full acceptance run shows two hints at once, a hint covering its anchor, or a hint during the sweep; `?nohints=1` shows none. (§2.4)
- **A25.** Loaded 1440: the verdict column above the fold contains at most 14 lines of text in total, and no bin code, test name, or STDF field name above the findings card. (§2.5, §6.2)
- **A26.** The takeaway is at most 2 lines at 1440, has no bin codes or test names, and no exclamation mark appears anywhere in the UI. (§7.3, §9.1)
- **A27.** Each finding row at 1440 is a one-line plain-language headline plus a one-line sub-line; the expanded row shows the engine sentence, "Check next" steps, and the meta line aligned to the headline's left edge. (§7.6)

**Components**

- **A28.** Nav at 1440: wordmark left, lot picker centred, then language, theme icon button (32 x 32, no label), and "Open file". The Appearance menu lists "Match system", "Light", "Dark" with one check. Mobile: the Appearance group lives in the globe menu. (§7.1)
- **A29.** Lot picker menu: three sample rows with 40 px disc thumbnails and meta like "Yield 82.8%, 25 wafers" (comma, no middle dot), check on the current lot, and an "Open file…" row with a keycap. (§7.2)
- **A30.** Segmented control, light: grey track, white thumb with a soft shadow, active label `text-primary`; dark: translucent white thumb, no shadow. (§7.8)
- **A31.** Expanding and collapsing a finding, frames captured at 0, 40, 80, 120, 200, and 320 ms show no overlapping text boxes (bounding-rect intersection = 0) and no scaled text. (§8.6)
- **A32.** "Where the yield went": only the dominant bar is ember; the others are neutral grey; selecting the Edge-Ring finding gives the matching row the `fill-2` selected state; no gridlines or axis lines. (§7.9)
- **A33.** "Yield by test site and wafer": a section card with 3 lot numbers, a test-site table, the 5 lowest-yield wafers, and "Show all 25 wafers"; on `site2-probe-contact` the site 2 row reads "Lowest yield" in words with no orange or red. (§7.10)
- **A34.** A toast (download a sample file) appears bottom-centre on `material-thick` with `shadow-popover`, no coloured icon, and disappears after about 4 s; an error toast stays until dismissed. (§7.13)
- **A35.** Clicking the stage with a mouse shows no focus ring; tabbing to it shows a 2 px ink ring with 28 px corners inside the wafer area. Tab order in the nav: wordmark, lot picker, language, theme, Open file. (§7.1, §7.7)

**Motion**

- **A36.** With `reducedMotion: "reduce"`: the first screenshot after the lot loads shows all dies, the final stat values, and the verdict at full opacity; no sweep frame is ever captured. (§8.16)
- **A37.** First load (normal motion): a screenshot at about 500 ms shows a partly swept wafer with the probe light and no ember dies; the sweep finishes within 1.2 s; pressing a key mid-sweep shows the final wafer on the next frame. (§8.1)
- **A38.** Evidence ignite: a screenshot 650 ms after clicking the Edge-Ring finding equals the settled state (pixel diff < 1 % inside the disc); at 250 ms the lit dies are concentrated in the clockwise arc starting at 12 o'clock. (§8.3)
- **A39.** The perf gate (§8.17), including the theme switch and the sheen pointer sweep, logs 0 frames > 50 ms, median rAF < 20 ms, and p95 < 34 ms. (§8.17)

**i18n**

- **A40.** For `ja`, `zh-CN`, `zh-TW`, and `ko` at 1440 and 390: the verdict is at most 3 lines, letter-spacing computes to 0, no glyph or label is clipped, the nav stays on one line, segmented labels do not truncate, and bin codes, test names, and `Edge-Ring` appear untranslated. (§4.3, §9.7)


## 11. Inspiration deltas (added 2026-11-18)

Rules distilled from current award-gallery work (godly/recent.design, land-book, 60fps.design). Nothing is copied; each rule is restated in our own material (silicon, probe station, ember). Where a rule conflicts with §1–§10, this section wins only for the items it names.

### 11.1 Landing hero shows the product working (P26a)
- Reference rule: the best tool landings put one large, real product artifact directly under the headline, framed like an instrument, instead of only small cards.
- Ours: between the hint line and "Sample lots", show one hero wafer at 320 px (1440/1280), 280 (1024), 240 (sm), 220 (xs), rendered with the real `edge-ring-etch` W01 data, the §5 disc material, stage shadows and at-rest sheen.
- Instrument frame: a thin probe-station reticle around the disc: a `hairline` circle at D + 32, with tick marks every 10° (4 px, `hairline-strong`; 8 px every 90°) and four tiny coordinate labels at 12/3/6/9 o'clock ("0°", "90°", "180°", "270°", `caption-2`, `text-tertiary`, tabular). No other ornament. This is our identity mark; it must read as a measuring instrument, not decoration.
- To the right of the disc at ≥1024 (below it under 1024), one quiet result card: eyebrow "Example result" (`caption-1`, `text-tertiary`), "Edge-Ring failure." (`title-2`, `ember-ink`), one line "93.8% of fails sit in the outer 3 rings." (`body`, `text-secondary`), and a text button "See how it was found →" that opens the sample lot. Card: `surface`, `r-2xl`, `shadow-card`, padding 24, width 280.
- The hero wafer is a button with the same action as "Open the sample lot" (aria-label "Open the sample lot"). Hover: sheen follows pointer (P32 rules), cursor pointer.
- Vertical rhythm: hint line → 56 px → hero row → 72 px → "Sample lots". At 1440 x 900 the headline, CTA and the top half of the hero wafer must be above the fold; the sample cards may move below the fold.
- Reduced motion: no sheen follow.

### 11.2 Sample cards: caption outside, one fact inside (P26a)
- Reference rule: feature cards keep the artifact inside a soft tile and the text below the tile, outside the surface.
- Ours: each sample card becomes a `fill-1` tile (`r-2xl`, no shadow at rest, `shadow-card` on hover with the existing lift) holding only the disc; name, one-line cause and "25 wafers, 15,825 dies" sit below the tile on the page background, left-aligned, 16 px gap.
- Inside the tile, bottom-left, a small chip with the pattern name in plain words ("Edge ring", "Scratch", "Probe site"), `caption-1`, `fill-2`, `r-full`, height 24.

### 11.3 "Where the yield went": one solid bar, the rest ghosted (P20)
- Reference rule: show every bar as a quiet outline and fill only the one that matters, with a small percent pill.
- Ours: non-top bins draw as `bar-neutral` at 40 % fill with a 1 px `hairline-strong` outline; only the top-loss bin is solid `ember`. Selected bin (store-linked) becomes solid `ink` (dark: `text-primary`). Each row ends with a percent-of-fails pill (`caption-1`, `fill-2`, `r-full`, tabular). Card header keeps the one big number (lot yield loss) left and the existing segmented control right.

### 11.4 Coach marks point with a pulse, not a bubble first (P25)
- Reference rule: first-run hints draw the eye with a soft border pulse on the real control, then reveal text.
- Ours: each hint target gets a 2 px `ember` 40 % ring that pulses twice (scale 1 → 1.06, opacity 0.4 → 0, 1.2 s each, `ease-out`), then the hint bubble fades in. Reduced motion: static ring for 2 s, no pulse.

### 11.5 Numbers tick, they do not just appear (P28)
- Reference rule: hero numbers count with a short ticker and settle with a tiny overshoot-free ease.
- Ours: stat numbers and the hero card percent count up over 600 ms (`ease-out-quart`), digits tabular so width never jumps; percent sign and units do not animate. Already covered by §8.2 count-up; this adds the landing result card and the "Where the yield went" pills to the same rule.

### 11.6 Acceptance
- A41: landing at 1440 x 900 shows headline, CTA, and ≥ 50 % of the hero wafer above the fold; reticle ticks present (72 ticks); hero click opens the sample lot.
- A42: sample card text sits outside the tile; pattern chip present on all three tiles.
- A43: in "Where the yield went", exactly one bar is solid `ember` at rest.
- A44: first-run coach mark shows a pulse ring before its text (or a static ring under reduced motion).
