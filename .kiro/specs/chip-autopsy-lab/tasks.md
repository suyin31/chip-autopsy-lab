# Implementation Plan

Tasks 1-8 build one working vertical slice: built-in demo lot -> Web Worker parse -> Pass/Fail wafer map -> verdict card whose claims highlight dies. Later tasks widen each layer. Sub-tasks marked `*` are optional `fast-check` property tests; each names its correctness property from `design.md`.

- [x] 1. Scaffold the Next.js app, tooling, and design tokens
  - Create the Next.js App Router project with TypeScript `strict`, Tailwind CSS v4, Vitest, `fast-check`, and Playwright.
  - Add `src/ui/tokens/` and the `@theme` CSS variables for `bg`, `panel`, `hairline`, `raised`, `overlay`, text tiers, `accent`, `failure`, and pass die `#53655D`; self-host Inter and Geist Mono with `next/font`.
  - Add a lint rule that blocks React, Next.js, and DOM imports inside `src/core/`.
  - Record the `dev`, `build`, `lint`, `typecheck`, `test`, and `test:e2e` scripts in `.kiro/steering/tech.md`.
  - _Requirements: 16.2, 17.1, 17.2, 17.3, 17.7_

- [x] 2. Implement the STDF V4 binary reader and writer
  - [x] 2.1 Build `types.ts` record schemas and the bounds-checked `binary-cursor.ts`
    - Shared field schemas for reader and writer; `U*n`, `I*n`, `R*n`, `C*n`, `B*n`, `D*n`, `kxTYPE` reads with `offset + byteCount <= recordEnd` checks; big- and little-endian from `FAR.CPU_TYPE`.
    - _Requirements: 1.5, 2.1_
  - [x] 2.2 Build `stdf-parser.ts`
    - FAR validation, decode of the 16 used record types, skip by `REC_LEN` for others, missing optional trailing fields, `PTR` defaults keyed by `TEST_NUM` with `OPT_FLAG` bits 0/4/5 (inherit) and 6/7 (no limit), multi-site `PIR`/`PRR` open-part map.
    - Keep `RESULT`, `LO_LIMIT`, and `HI_LIMIT` in base units; store `RES_SCAL`/`LLM_SCAL`/`HLM_SCAL` as display exponents only.
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 2.2, 2.3_
  - [x] 2.3 Build `stdf-writer.ts` and golden fixtures in `tests/fixtures/`
    - Deterministic serializer from `StdfWriteLotSpec`; big-endian, little-endian, truncated, and malformed fixtures.
    - _Requirements: 1.5, 3.1_
  - [x]* 2.4 Property test: STDF V4 write-to-parse round-trip
    - **Property 1** in `src/core/stdf/stdf-roundtrip.prop.test.ts`
    - _Requirements: 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 3.1_
  - [x]* 2.5 Property test: parser bounds safety and truncated-stream recovery
    - **Property 2** in `src/core/stdf/stdf-parser-safety.prop.test.ts`
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Build the columnar lot model, retest resolution, and yield summary
  - [x] 3.1 Implement `src/core/model/lot-builder.ts`
    - Columnar `LotModel`/`WaferModel` with stable `DieId`s, first-`PRR` vs last-`PRR` retest resolution, `PART_FLG` bits 3/4 with HBIN fallback, ring index, missing-coordinate handling.
    - _Requirements: 7.1, 7.2_
  - [x] 3.2 Implement `src/core/analytics/yield-summary.ts`
    - Tested, pass, fail, and retest counts; first-pass and final yield by lot, wafer, and test site; site anomaly z-test.
    - _Requirements: 7.3, 7.4_
  - [x]* 3.3 Property test: retest resolution determinism
    - **Property 3** in `src/core/model/retest-resolver.prop.test.ts`
    - _Requirements: 7.1, 7.2_
  - [x]* 3.4 Property test: yield bounds and partition additivity
    - **Property 4** in `src/core/analytics/yield-summary.prop.test.ts`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 4. Generate the demo lots and run them through the Web Worker
  - [x] 4.1 Implement `src/core/demo/prng.ts` and `demo-generator.ts`
    - Seeded Mulberry32 generator; 25-wafer x 633-die presets `edge-ring-etch`, `handling-scratch`, and `site2-probe-contact`, written through `stdf-writer.ts`.
    - _Requirements: 3.1_
  - [x] 4.2 Implement `src/workers/autopsy.worker.ts` and `worker-client.ts`
    - Comlink module worker, `Comlink.transfer` buffer hand-off, `Comlink.proxy` progress callbacks (bytes, records, dies); demo lots use the same parse path as files.
    - _Requirements: 1.4, 1.10, 3.3, 15.2_
  - [x] 4.3 Add the first-run empty state with the `"Load demo lot"` control
    - _Requirements: 3.2, 17.6_
  - [x]* 4.4 Property test: demo lot determinism and ground-truth recovery
    - **Property 9** in `src/core/demo/demo-generator.prop.test.ts`; covers all three presets (finish after task 6 adds the classifier).
    - _Requirements: 3.1, 3.3, 7.4, 9.1_

- [x] 5. Render the two-layer wafer map and central selection store
  - [x] 5.1 Implement `src/ui/state/selection-store.ts`
    - Single Zustand store holding brush, bin, site, filter, and claim-highlight state, with derived `Uint8Array` die masks.
    - _Requirements: 10.4, 11.1, 11.4_
  - [x] 5.2 Implement the base and overlay canvases in `src/ui/wafer-map/`
    - DPR-scaled base layer in Pass/Fail mode (`#FF7A1A` fail, `#53655D` pass, `1 px` street, fail micro-dot); overlay layer draws `#7CF2C1` outline/glow without repainting the base; wafer selector.
    - _Requirements: 4.1, 4.3, 4.4, 14.2, 15.4_

- [x] 6. Implement the WM-811K spatial classifier and root-cause hypotheses
  - [x] 6.1 Implement `src/core/patterns/wm811k-classifier.ts`
    - D4-invariant features, noise gate, nine class scores, `MIN_FAIL_FRACTION`, `MIN_CLASS_CONFIDENCE`, and stacked classification with `STACK_CELL_MIN_FAIL_RATE`.
    - _Requirements: 9.1, 9.2, 9.4_
  - [x] 6.2 Implement `src/core/patterns/root-causes.ts`
    - Hedged hypotheses per class and for test-site concentration.
    - _Requirements: 9.3_
  - [x]* 6.3 Property test: classifier determinism and rotation/mirror robustness
    - **Property 8** in `src/core/patterns/wm811k-classifier.prop.test.ts`
    - _Requirements: 9.1, 9.2, 9.4_

- [x] 7. Build engine facts, the verdict, the template report, and the Autopsy Report card
  - [x] 7.1 Implement `engine-facts.ts`, `verdict-precedence.ts` (6 tiers), and `template-report.ts`
    - Every claim cites fact IDs that resolve to non-empty die sets; cause-of-death line and number formats follow the design.
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 17.4_
  - [x] 7.2 Implement `AutopsyReportCard` in `src/ui/report/`
    - Verdict first at the top of the workspace; clicking the headline or a claim writes its die set to the selection store and lights those dies on the overlay canvas.
    - _Requirements: 10.1, 10.4, 2.4_
  - [x]* 7.3 Property test: verdict structure and claim-to-die referential integrity
    - **Property 10** in `src/core/report/autopsy-report.prop.test.ts`
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

- [x] 8. Checkpoint: vertical slice end to end
  - Playwright spec: click `"Load demo lot"` on `edge-ring-etch`, see `Cause of death: Edge-Ring` within 3 s offline, click the headline, and assert the outer-ring dies are highlighted. Repeat for the other two presets.
  - Ensure all unit and property tests pass; ask the user if questions arise.
  - _Requirements: 3.2, 10.4, 15.6, 16.2_

- [x] 9. Complete file ingest, error handling, and demo downloads
  - Full-window drop zone with `"Drop the body."`, keyboard file picker, gzip by magic bytes via `DecompressionStream`, parse-failed empty state, partial-result warnings via Sonner, bins-only mode above 200 MB, and `.stdf` download of the demo lots.
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 2.5, 3.4, 15.3, 17.6_

- [x] 10. Add HBIN/SBIN wafer modes, the legend, and the Bin Pareto chart
  - [x] 10.1 HBIN and SBIN colour modes with the equal-lightness LCH palette and an interactive legend that hides bins
    - _Requirements: 4.1, 4.6, 14.2_
  - [x] 10.2 Implement `bin-pareto.ts` and the visx `BinParetoChart`
    - Sorted counts, cumulative share, dominant bin in `failure` (`#FF6B2C`, redesign accent), bar click toggles a bin filter, claim click highlights the matching bar.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 10.4_
  - [x]* 10.3 Property test: Pareto count conservation and monotonic ordering
    - **Property 5** in `src/core/analytics/bin-pareto.prop.test.ts`
    - _Requirements: 6.1, 6.2, 6.5_

- [x] 11. Add the yield summary panel with site breakdown
  - Lot, wafer, and site tables with first-pass and final yield; clicking a wafer or site scopes the selection; site anomaly surfaces in the report for `site2-probe-contact`.
  - _Requirements: 7.3, 7.4, 7.5_

- [ ] 12. Add the stacked multi-wafer heatmap and wafer gallery
  - [ ] 12.1 Implement `stacked-heatmap.ts`, the gallery, and the magma heatmap with numeric legend, hover readout, and region selection
    - _Requirements: 5.1, 5.2, 5.4, 5.5_
  - [ ] 12.2 Animate the gallery collapse into the stacked heatmap (`<= 800 ms`, Motion layout)
    - _Requirements: 5.3, 14.5_
  - [ ]* 12.3 Property test: stacked heatmap failure conservation
    - **Property 6** in `src/core/analytics/stacked-heatmap.prop.test.ts`
    - _Requirements: 5.2, 5.4_

- [ ] 13. Add parametric analysis
  - [ ] 13.1 Implement `parametric-stats.ts`
    - Welford mean and sigma, two-sided and single-sided `Cp`/`Cpk`, histogram bins, `formatScaledMeasurement` with SI prefixes from the display exponent.
    - _Requirements: 8.3, 8.4, 17.4_
  - [ ] 13.2 Build the test catalog, `ParametricHistogram` with limit markers and scrub readout, and the wafer map Parametric mode
    - _Requirements: 8.1, 8.2, 8.5, 8.6_
  - [ ]* 13.3 Property test: `Cp`/`Cpk` invariants and affine scale equivariance
    - **Property 7** in `src/core/analytics/parametric-stats.prop.test.ts`
    - _Requirements: 8.3, 8.4_

- [ ] 14. Add live cross-chart brushing
  - Rectangular brush on the single-wafer map and stacked heatmap, removable filter chip, combined brush and attribute filters, `Escape` and click-out clearing; all linked views update within 100 ms at 25 x 10,000 dies.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 15.5_
  - [ ]* 14.1 Property test: brush and selection filter idempotence, containment, and commutativity
    - **Property 12** in `src/core/query/selection-predicates.prop.test.ts`
    - _Requirements: 11.1, 11.2, 11.4, 12.2, 12.5_

- [ ] 15. Add wafer map hover readout, pan/zoom, and WCR orientation
  - Floating readout that never covers the die (X/Y, bin, test values), wheel/drag/button zoom and pan, axis direction and flat/notch from `WCR`.
  - _Requirements: 4.2, 4.5, 4.7_

- [ ] 16. Add the LLM narrator route with citation validation
  - [ ] 16.1 Implement `sanitizeOutboundNarratePayload` and `validateLlmNarration` in `citation-validator.ts`
    - _Requirements: 10.6, 10.7, 16.3_
  - [ ] 16.2 Implement `src/app/api/autopsy/narrate/route.ts`
    - Server-only `LLM_API_KEY` (no `NEXT_PUBLIC_`), schema validation in and out, 4 s client timeout, template report kept on missing key, error, or failed validation.
    - _Requirements: 10.5, 10.6, 16.3, 16.4_
  - [ ]* 16.3 Property test: citation validator soundness and deterministic fallback
    - **Property 11** in `src/core/report/citation-validator.prop.test.ts`
    - _Requirements: 10.6, 10.7_
  - [ ]* 16.4 Property test: outbound LLM payload privacy
    - **Property 14** in `src/core/report/llm-payload-privacy.prop.test.ts`
    - _Requirements: 16.1, 16.3_

- [ ] 17. Add the Filter DSL and the Cmd-K / Ctrl-K palette
  - [ ] 17.1 Implement `filter-dsl.ts` and the offline `nl-grammar.ts`
    - Handles `"only bin 7"`, `"tests with Cpk < 1.33"`, `"edge 3 rings"`, and `"show edge failures with Cpk < 1.33"`; invalid input leaves the selection unchanged.
    - _Requirements: 12.2, 12.4, 12.5_
  - [ ] 17.2 Build `CommandPalette` (cmdk) with `0 ms` open, recents first, right-aligned shortcuts, filter chips, and the no-results empty state
    - _Requirements: 12.1, 12.5, 12.6, 17.6_
  - [ ]* 17.3 Property test: Filter DSL round-trip serialization
    - **Property 13** (DSL part) in `src/core/query/filter-dsl-codec.prop.test.ts`
    - _Requirements: 12.2_

- [ ] 18. Add the reveal motion moments
  - Skippable probe-sweep load (`~3 s`, once per session), cause-of-death type-on (`<= 1.5 s`), claim evidence light-up stagger (`<= 600 ms`), panel springs, and full `prefers-reduced-motion` handling.
  - _Requirements: 1.11, 10.1, 14.5, 17.5_

- [ ] 19. Accessibility and copy pass
  - WCAG 2.2 AA contrast checks, non-colour cues on every mark, keyboard operability with `#7CF2C1` focus rings, screen-reader tables for canvas/SVG views, live-region announcements, number formats, and clinical copy.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 17.4_

- [ ] 20. Performance, offline, and privacy gates
  - Playwright and Vitest gates for parse throughput, main-thread task length, base-layer draw time, brush latency, and demo time-to-report; an offline run with zero third-party requests; a bundle scan for secrets; a check that no request body contains STDF bytes or die IDs.
  - _Requirements: 15.1, 15.2, 15.4, 15.5, 15.6, 16.1, 16.2, 16.4_

- [ ]* 21. Stretch features
  - Cmd-K LLM translation into the Filter DSL, shareable URL state with the Property 13 URL round-trip test, `MPR` parametric support, and the Alt-key autopsy lamp (off by default).
  - _Requirements: 4.8, 8.7, 12.3, 13.1, 13.2, 13.3, 13.4_

- [ ] 22. Deploy and prepare the demo video
  - Deploy to Vercel; update `README.md` with the Kiro usage table (specs, steering, hooks, MCP), third-party disclosures, and demo lot downloads; script and record the five demo moments in under 3 minutes with the problem stated in the first 15 seconds; write the phase summary in `logs/`.
  - _Requirements: 3.4, 15.6, 16.2_

## Redesign

Specification: `.kiro/specs/chip-autopsy-lab/redesign.md`. Each task is a <= 15-minute chunk and must leave `pnpm lint`, `pnpm typecheck`, and `pnpm test` green.

- [x] R1. Tokens and globals
  - Apply redesign §2 to `src/ui/tokens/palette.ts`, `tokens.ts`, and `src/app/globals.css` (`bg #000000`, ice `accent #D6E6FF`, `failure #FF6B2C`, `pass-die #63666C`, type scale, radii, springs, z-layers, CJK font variables and `:lang()` overrides); update palette tests.
  - Accept: `pass-die` >= 3:1 on `#000` and `#141416`; `text-tertiary` >= 4.5:1 on `#000` and `#1A1A1C`; no `7CF2C1` or `FF7A1A` left in `src/`.
- [x] R2. i18n core and provider
  - Add `src/core/i18n/` (locales, typed `t`, `Intl` formatters, `en` table from redesign §6.8, `zh-CN`, `zh-TW`, `ja`, `ko`) and `src/ui/i18n/` (provider, `useT`, pre-hydration locale script, `localStorage["cal.locale"]`).
  - Accept: key and placeholder parity across all 5 locales; `matchLocale` maps `zh-HK` to `zh-TW`, `zh` to `zh-CN`, `fr` to `en`; core isolation lint passes.
- [x] R3. Primitives and nav
  - Restyle buttons (§4.11), add segmented control and menus, build `NavBar`, `LotPicker`, `LanguageSwitcher`; remove the old header, toolbar row, `Browser Sandbox` badge, and footer counter.
  - Accept: nav 52 px desktop / 48 px mobile; language change updates `<html lang>` and survives reload; ice 2 px focus rings; Tab order wordmark, lot picker, language, Open STDF.
- [x] R4. Landing, drag overlay, parse error, bins-only
  - Landing hero with three demo cards and wafer thumbnails (§3.1), drag overlay (§3.2), error view per code (§3.7), bins-only sheet and notice (§3.8).
  - Accept: Playwright screenshots at 1440 x 900 and 390 x 844 match §3.1 above the fold; one click on a card loads the lot; a PNG drop shows "This file isn't an STDF log."; a stubbed 312 MB file opens the sheet with "Use bins-only" focused.
- [x] R5. Verdict column
  - Split `AutopsyReportCard` into `VerdictHero`, `ConfidencePill` (absorbs `NarrationBadge`), `StatRow`, `FindingsList`; add `messageKey`/`params` to claims, `renderReport(report, locale)`, and `stat-facts.ts`.
  - Accept: "Cause of death: Edge-Ring failure." fits <= 2 lines at 553 px with the cause phrase orange; exactly 3 stats; borderless one-line findings; no monospace or uppercase labels in the column; per-locale report rendering is deterministic.
- [x] R6. Wafer stage layout, rendering, and camera
  - Loaded layout grid (§3.4), boxless stage with vignette and top light, pass/fail geometry cue, three canvases, camera controller (wheel, pinch, drag pan with inertia and rubber-band, double-click reset) on a CSS-transform wrapper with re-raster after settle.
  - Accept: wafer >= 560 px at 1440 x 900 and 350 px at 390 px; wheel zoom anchored at the cursor; flick pan coasts; double-click resets; no React render during drag; arrow-key die stepping still works.
- [x] R7. Linked interactions
  - Hover magnifier (§4.8), finding select with scrim, ordered glow, and camera frame (§5.4), box select with live stats popover (§3.6, §5.7), wafer strip with scroll-snap, roving keyboard, crossfade, and evidence dots (§4.9, §5.8).
  - Accept: the edge-band finding lights ring dies clockwise within 600 ms and a second click clears; Shift+drag stats update during the drag; held ArrowRight swaps wafers instantly; magnifier placement never covers the hovered die (unit test).
- [x] R8. Reveal motion, reduced motion, and perf gate
  - Also fix every open item (a)–(h) in logs/visual-acceptance.md (R4 landing + R6 stage visual issues) and mark each fixed there.
  - Probe sweep (§5.1), verdict rise-in (§5.2), count-up (§5.3), toast styling (§4.13), reduced-motion paths, and `e2e/perf-gate.spec.ts` (§5.10); record measurements in `logs/`.
  - Accept: first load sweeps in <= 1.2 s and any key skips it; with `reducedMotion: "reduce"` there is no sweep or stagger and stats show final values; perf gate shows 0 frames > 50 ms, median rAF < 20 ms, p95 < 34 ms; demo time-to-verdict < 3 s.

## Premium pass

Specification: `.kiro/specs/chip-autopsy-lab/premium.md` (supersedes `redesign.md` for visuals and interaction). Each task is one ~15-minute agent session, must leave `pnpm lint`, `pnpm typecheck`, and `pnpm test` green, and records the screenshots for its acceptance items in `logs/premium-acceptance.md`.

**Tokens and theme**

- [x] P1. Steering and requirement amendments
  - Rewrite `.kiro/steering/design-language.md` as the short form of premium §1, §3, §4, §8 (light default, one accent, new tokens); record the pass-die contrast amendment to Requirement 14.1 in `requirements.md` (premium §5.3).
  - Accept: no steering rule contradicts premium.md; `requirements.md` 14.1 names the `prefers-contrast: more` fallback.
- [x] P2. Colour, elevation, radius, and motion tokens
  - `src/ui/tokens/palette.ts` exports `THEME_TOKENS.light`, `THEME_TOKENS.dark`, `WAFER_TOKENS`, bin palettes (`bin-n`, `bin-n-ink`), and `bar-neutral`; `globals.css` defines the variables under `:root[data-theme]` and maps them in `@theme inline`; contrast tests for every ratio in premium §3.2, §3.3, §3.5 (premium §3.2–§3.12, §7.9).
  - Accept: A1 (tokens), A13 (token ratio); palette tests assert `text-tertiary` >= 4.5:1 on `bg`, `surface`, `surface-sunken` in both themes.
- [x] P3. Theme mechanism
  - Pre-hydration script for `data-theme` and `color-scheme`, `localStorage["cal.theme"]`, `DEFAULT_THEME_PREFERENCE = "system"`, live `matchMedia` listener, `theme-color` meta, Zustand `theme` slice and `useResolvedTheme()` (premium §3.1).
  - Accept: A2 (without the menu, set via `localStorage`).
- [x] P4. Typography
  - Type tokens and utilities for every style in premium §4.2, Inter feature settings, `opsz` on display roles, CJK line-heights, sizes, and break rules (premium §4.1–§4.3).
  - Accept: computed styles match §4.2 for `display-l`, `stat`, `row-title`, `subhead` at 1440 and 390; A40 letter-spacing check.

**Wafer rendering**

- [x] P5. Disc material
  - Notch geometry from `WCR.WF_FLAT`, body gradient, thin film (feature-detected), exclusion line, bevel; unit test that no die crosses the exclusion radius (premium §5.2 steps 1–5).
  - Accept: A5.
- [x] P6. Die tiles and thumbnails
  - Street, fail die radius and facet, 80 % pass tile, `pass-tile-hc` under `prefers-contrast: more`, thumbnail rules for `p < 3` (premium §5.3).
  - Accept: A6, A7, A13.
- [x] P7. Stage shadows and static sheen
  - Ambient and contact shadow (light), halo (dark) inside the camera wrapper; sheen layer with the SVG notch mask at its rest position; hidden under reduced transparency (premium §5.1, §5.2 step 6, §3.3).
  - Accept: A8.
- [x] P8. Overlay die states
  - `dim-veil` with punched evidence mask, evidence rim and pre-rendered bloom sprite, hover and pinned strokes, selection rect (premium §5.4).
  - Accept: A9 (static state, no animation yet).
- [x] P9. Wafer strip
  - Scroller padding, 48 x 64 items, active and focus rings, hover scale, evidence opacity, side-aware edge fades, desktop chevrons (premium §5.8).
  - Accept: A12.
- [x] P10. Stage header, control row, legend
  - Header caption and evidence caption, one control row, legend entries and "+N more" popover, Select an area and Reset view, stage focus ring (premium §5.5–§5.7, §7.7).
  - Accept: A11, A35 (stage part).

**Layout**

- [x] P11. Landing
  - Hero, buttons, hint, sample cards with 152 px discs, footer, at 1440, 1280, 1024, sm, and 390 (premium §6.1).
  - Accept: A14, A20 (landing).
- [x] P12. Loaded view, desktop
  - Sticky stage column, verdict column blocks 1–9 with the §6.2 spacing at 1440 and 1280 (premium §6.2).
  - Accept: A15, A16, A19.
- [x] P13. Loaded view, tablet and mobile
  - 1024 two-column variant, sm single column, 390 order and full-bleed stage, mobile finding-click scroll (premium §6.2).
  - Accept: A17, A18.
- [x] P14. Loading, error, drag overlay, bins-only
  - Loading column and progress, parse error layout, drag overlay frame, bins-only sheet and notice (premium §6.3–§6.6, §9.6).
  - Accept: A20 (error, bins-only).

**Components**

- [x] P15. Primitives
  - Buttons (all variants and states), segmented control, menu, popover, and tooltip surfaces (premium §7.11, §7.8, §7.12).
  - Accept: A30; primitives test asserts one primary variant per screen helper.
- [x] P16. Nav, theme toggle, lot picker
  - Nav grid and scroll hairline, language switcher, Appearance menu (desktop button, mobile globe group), lot picker trigger and menu (premium §7.1, §7.2).
  - Accept: A2 (menu path), A28, A29, A35 (tab order).
- [x] P17. Verdict headline, takeaway, confidence chip
  - Cause phrase button states, healthy-lot variant, takeaway templates in core, confidence levels and popover (premium §7.3, §7.4, §9.3).
  - Accept: A25, A26.
- [x] P18. Stats
  - Stat buttons with evidence, captions, second caption line, no orange (premium §7.5).
  - Accept: A4.
- [x] P19. Findings and possible causes
  - Card, rows (rest, hover, pressed, selected), kind icons, expanded body, "Show N more", Possible causes disclosure, finding title templates (premium §7.6, §9.3).
  - Accept: A27.
- [x] P20. "Where the yield went"
  - Section card, takeaway, bar rows with `bar-neutral`, selected state linked to the store, show-all, empty state (premium §7.9).
  - Accept: A32, A43 (also apply premium §11.3).
- [x] P21. Yield summary panel
  - Restyle `src/ui/charts/YieldSummaryPanel.tsx`: section card, takeaway, lot numbers, site and wafer rows, anomaly label, narrow-viewport column rule; keep current store behaviour and tests (premium §7.10).
  - Accept: A33, A19.
- [x] P22. Toasts, selection popover, sheets
  - Sonner styling and timing, selection popover content, dialog and bottom-sheet surfaces (premium §7.13, §7.14, §7.16).
  - Accept: A34.
- [x] P23. Magnifier
  - Inter readout with 4 rows, status first, loupe radius and rim, touch pinned readout (premium §7.15, §5.9).
  - Accept: A10.
- [x] P24. Term and glossary
  - `Term` component and popover, all `glossary.*` keys in 5 locales, Terms placed per §2.2 (premium §2.3, §7.17, §9.5).
  - Accept: A21, A22.
- [x] P25. Coach marks
  - Three hints, anchoring, persistence in `localStorage["cal.hints.v1"]`, `?nohints=1`, suppression rules (premium §2.4, §7.18).
  - Accept: A23, A24, A44 (also apply premium §11.4).
- [x] P26. Copy and i18n pass
  - Plain labels from §2.2, every key in §9.5 in all 5 locales with parity, `<bdi translate="no">` wrapping, overflow behaviours from §9.7 (premium §9).
  - Accept: A40, A26 (no exclamation marks).
- [x] P26a. Landing hero and sample tiles (inspiration deltas)
  - Hero wafer with probe-station reticle and example result card; sample cards as tiles with captions outside and pattern chips (premium §11.1, §11.2). Also apply §11.3 in P20, §11.4 in P25, §11.5 in P28 when those run.
  - Accept: A41, A42.
- [x] P26b. Editorial accent pass
  - Warm paper bg, one italic serif accent word, bigger landing headline, mono instrument notes (premium §12). Update e2e colour/contrast expectations that the new tokens change.
  - Fonts are already installed (no network needed): load via next/font/local from node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2 and node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2 (both OFL).
  - Accept: A45, A46, A47, A48, and A1–A10 still pass.

**Motion**

- [x] P27. Probe sweep and ignite
  - Session flag, progress pacing, probe light, 280 ms ignite, skip on any input, reduced-motion fade, `data-sweep` (premium §8.1).
  - Accept: A37, A36 (sweep part).
- [x] P28. Verdict reveal and count-up
  - Six-block stagger with `spring-ui`, ref-based count-up, interrupt on input, reduced-motion path (premium §8.2).
  - Accept: A36 (also apply premium §11.5).
- [x] P29. Evidence ignite and camera focus
  - Veil fade, pattern-ordered rim and bloom stagger, camera targeting rules, strip dimming, clear and switch behaviour, mobile scroll then ignite (premium §8.3).
  - Accept: A38, A9 (animated).
- [x] P30. Hover, magnifier, zoom, and pan motion
  - Magnifier show and hide, wheel and pinch factors, rubber-band curve, inertia, `spring-throw`, double-click, reduced-motion paths (premium §8.4, §8.5).
  - Accept: A10; perf gate wheel and drag steps stay within A39 limits.
- [x] P31. Disclosure, wafer switching, toasts, overlays
  - `layout="position"` glide without text scaling, chevrons, wafer crossfade on click and 0 ms on keys, toast, menu, popover, and sheet motion (premium §8.6, §8.7, §8.12, §8.13).
  - Accept: A31.
- [x] P32. Theme cross-fade and silicon sheen
  - View Transitions cross-fade with `skipTransition()` on repeat; sheen pointer follow with `spring-sheen`, landing-card variant, freeze during gestures (premium §8.8, §8.11).
  - Accept: A2 (no flash on switch), A39 (theme and sheen steps).

**Polish**

- [x] P33. Accent and hover audit
  - Automated check counting ember-family elements per viewport; remove stray orange; verify every hover uses the §8.9 properties and no `transition: all` remains (premium §3.4, §8.9, §1.3).
  - Accept: A3, A4.
- [x] P34. Reduced motion and perf gate
  - Extend `e2e/perf-gate.spec.ts` with the theme switch and sheen sweep; reduced-motion e2e covering every row of §8.16; record numbers in `logs/` (premium §8.16, §8.17).
  - Accept: A36, A39.
- [ ] P35. Full acceptance run (also amend requirements.md 14.2/14.3 focus colours and product.md mobile non-goal to match premium.md)
  - Screenshots for A1–A40 at the four viewports and both themes; fix small regressions found; write `logs/premium-acceptance.md` with pass or fail per item and `logs/phase-premium-summary.md` (premium §10).
  - Accept: every item A1–A40 marked pass.
