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

- [ ] 3. Build the columnar lot model, retest resolution, and yield summary
  - [ ] 3.1 Implement `src/core/model/lot-builder.ts`
    - Columnar `LotModel`/`WaferModel` with stable `DieId`s, first-`PRR` vs last-`PRR` retest resolution, `PART_FLG` bits 3/4 with HBIN fallback, ring index, missing-coordinate handling.
    - _Requirements: 7.1, 7.2_
  - [ ] 3.2 Implement `src/core/analytics/yield-summary.ts`
    - Tested, pass, fail, and retest counts; first-pass and final yield by lot, wafer, and test site; site anomaly z-test.
    - _Requirements: 7.3, 7.4_
  - [ ]* 3.3 Property test: retest resolution determinism
    - **Property 3** in `src/core/model/retest-resolver.prop.test.ts`
    - _Requirements: 7.1, 7.2_
  - [ ]* 3.4 Property test: yield bounds and partition additivity
    - **Property 4** in `src/core/analytics/yield-summary.prop.test.ts`
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 4. Generate the demo lots and run them through the Web Worker
  - [ ] 4.1 Implement `src/core/demo/prng.ts` and `demo-generator.ts`
    - Seeded Mulberry32 generator; 25-wafer x 633-die presets `edge-ring-etch`, `handling-scratch`, and `site2-probe-contact`, written through `stdf-writer.ts`.
    - _Requirements: 3.1_
  - [ ] 4.2 Implement `src/workers/autopsy.worker.ts` and `worker-client.ts`
    - Comlink module worker, `Comlink.transfer` buffer hand-off, `Comlink.proxy` progress callbacks (bytes, records, dies); demo lots use the same parse path as files.
    - _Requirements: 1.4, 1.10, 3.3, 15.2_
  - [ ] 4.3 Add the first-run empty state with the `"Load demo lot"` control
    - _Requirements: 3.2, 17.6_
  - [ ]* 4.4 Property test: demo lot determinism and ground-truth recovery
    - **Property 9** in `src/core/demo/demo-generator.prop.test.ts`; covers all three presets (finish after task 6 adds the classifier).
    - _Requirements: 3.1, 3.3, 7.4, 9.1_

- [ ] 5. Render the two-layer wafer map and central selection store
  - [ ] 5.1 Implement `src/ui/state/selection-store.ts`
    - Single Zustand store holding brush, bin, site, filter, and claim-highlight state, with derived `Uint8Array` die masks.
    - _Requirements: 10.4, 11.1, 11.4_
  - [ ] 5.2 Implement the base and overlay canvases in `src/ui/wafer-map/`
    - DPR-scaled base layer in Pass/Fail mode (`#FF7A1A` fail, `#53655D` pass, `1 px` street, fail micro-dot); overlay layer draws `#7CF2C1` outline/glow without repainting the base; wafer selector.
    - _Requirements: 4.1, 4.3, 4.4, 14.2, 15.4_

- [ ] 6. Implement the WM-811K spatial classifier and root-cause hypotheses
  - [ ] 6.1 Implement `src/core/patterns/wm811k-classifier.ts`
    - D4-invariant features, noise gate, nine class scores, `MIN_FAIL_FRACTION`, `MIN_CLASS_CONFIDENCE`, and stacked classification with `STACK_CELL_MIN_FAIL_RATE`.
    - _Requirements: 9.1, 9.2, 9.4_
  - [ ] 6.2 Implement `src/core/patterns/root-causes.ts`
    - Hedged hypotheses per class and for test-site concentration.
    - _Requirements: 9.3_
  - [ ]* 6.3 Property test: classifier determinism and rotation/mirror robustness
    - **Property 8** in `src/core/patterns/wm811k-classifier.prop.test.ts`
    - _Requirements: 9.1, 9.2, 9.4_

- [ ] 7. Build engine facts, the verdict, the template report, and the Autopsy Report card
  - [ ] 7.1 Implement `engine-facts.ts`, `verdict-precedence.ts` (6 tiers), and `template-report.ts`
    - Every claim cites fact IDs that resolve to non-empty die sets; cause-of-death line and number formats follow the design.
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 17.4_
  - [ ] 7.2 Implement `AutopsyReportCard` in `src/ui/report/`
    - Verdict first at the top of the workspace; clicking the headline or a claim writes its die set to the selection store and lights those dies on the overlay canvas.
    - _Requirements: 10.1, 10.4, 2.4_
  - [ ]* 7.3 Property test: verdict structure and claim-to-die referential integrity
    - **Property 10** in `src/core/report/autopsy-report.prop.test.ts`
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

- [ ] 8. Checkpoint: vertical slice end to end
  - Playwright spec: click `"Load demo lot"` on `edge-ring-etch`, see `Cause of death: Edge-Ring` within 3 s offline, click the headline, and assert the outer-ring dies are highlighted. Repeat for the other two presets.
  - Ensure all unit and property tests pass; ask the user if questions arise.
  - _Requirements: 3.2, 10.4, 15.6, 16.2_

- [ ] 9. Complete file ingest, error handling, and demo downloads
  - Full-window drop zone with `"Drop the body."`, keyboard file picker, gzip by magic bytes via `DecompressionStream`, parse-failed empty state, partial-result warnings via Sonner, bins-only mode above 200 MB, and `.stdf` download of the demo lots.
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 2.5, 3.4, 15.3, 17.6_

- [ ] 10. Add HBIN/SBIN wafer modes, the legend, and the Bin Pareto chart
  - [ ] 10.1 HBIN and SBIN colour modes with the equal-lightness LCH palette and an interactive legend that hides bins
    - _Requirements: 4.1, 4.6, 14.2_
  - [ ] 10.2 Implement `bin-pareto.ts` and the visx `BinParetoChart`
    - Sorted counts, cumulative share, dominant bin in `#FF7A1A`, bar click toggles a bin filter, claim click highlights the matching bar.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 10.4_
  - [ ]* 10.3 Property test: Pareto count conservation and monotonic ordering
    - **Property 5** in `src/core/analytics/bin-pareto.prop.test.ts`
    - _Requirements: 6.1, 6.2, 6.5_

- [ ] 11. Add the yield summary panel with site breakdown
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
