# Code Review — Task 4 (Sub-tasks 4.1 – 4.3)

**Reviewer:** Senior ATE/STDF Engineer  
**Date:** 2026-11-17  
**Scope:** `src/core/demo/*`, `src/workers/*`, `src/ui/**`, `src/app/page.tsx`, and their tests  
**Standard:** Requirements 3.1–3.3, 1.4, 1.10, 2.2, 2.5, 3.2, 14.x, 15.2, 17.x; design.md; `.kiro/steering/design-language.md`

---

## BLOCKER

### B-1 · Demo wafer grid hard-codes only 633 dies but has no radius-aware circular wafer boundary
**File:** [`src/core/demo/demo-generator.ts#L274-L303`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L274-L303)  
**Issue:** The grid uses `x ∈ [-14, 15]` and `y ∈ [-14, 15]` (via `2*bx + dx` where `bx ∈ [-7,7]` and `dx ∈ {0,1}`) filtered by `x² + y² ≤ 14.2²`. This produces a 633-die circular grid. However the `2×2` quad-site stepping origin `(bx=-7..7)` × offset `(0,1)` gives integer `x ∈ [-14, 15]` — an asymmetric grid range (30 columns). A real 200mm wafer probe card at 5.8 mm die pitch would see a diameter of roughly 200/5.8 ≈ 34.5 die pitches across, so a ±17 coordinate range (or ~929 valid coordinates inside a 200mm circle). **633 dies is plausible for a ~164 mm active area** — not unreasonable for a smaller exclusion ring, but the design spec says `die pitch = 5.8 mm` and `wafer size = 200 mm`, which should give ≈ 929 dies. The discrepancy is because the stepping only goes `bx ∈ [-7, 7]` (15 blocks × 2 = 30 die pitches across), corresponding to 174 mm — a ~13% exclusion is aggressive but not unheard of with an edge-exclusion of ~13 mm. **Acceptable under ATE realism scrutiny.** Downgraded below.

*Verdict on B-1: Re-classified to MINOR (M-1) after analysis — see below.*

---

## MAJOR

### J-1 · `FullWindowDropZone` stale-closure bug with `onFileDrop` in `useEffect` deps
**File:** [`src/ui/layout/FullWindowDropZone.tsx#L112`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/FullWindowDropZone.tsx#L112)  
**Issue:** The `useEffect` lists `[disabled, isDraggingOver, onFileDrop]` as deps. Including `isDraggingOver` causes the effect to tear down and re-add all 6 `window` event listeners on every drag enter/leave — potentially dozens of times per file drop interaction. Each teardown resets `dragDepthRef` only implicitly via the returned cleanup closing over the ref. While not functionally broken, this churning is unnecessary and can cause the drag-over state to flicker. Including `onFileDrop` is correct (identity-stable via `useCallback` in `AppShell`), but `isDraggingOver` should be accessed via a ref inside the handler, not as a dep.  
**Fix:** Remove `isDraggingOver` from the dep array; use a ref for reads inside `handleDragOver` or simply always call `setIsDraggingOver(true)` (React no-ops on same value).

### J-2 · Worker `retainedRawBytes` holds entire file in memory across a UI prompt
**File:** [`src/workers/autopsy.worker.ts#L228-L229`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/workers/autopsy.worker.ts#L228-L229) and [`worker-client.ts#L113-L116`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/workers/worker-client.ts#L113-L116)  
**Issue:** When the large-file prompt fires, both the worker (`pendingLargeBytes`) and the client (`pendingClientLargeFile`) hold the full raw bytes simultaneously until the user picks a mode. For a 400 MB file this means ~800 MB retained across two contexts — potentially OOMing the browser. The client path (`loadFile`) retains the whole `File` object, which is cheaper (blobs are OS-backed), but the worker path retains a full decompressed `Uint8Array`.  
**Fix:** For the worker-side retained bytes during the gzip path, store only the compressed source bytes and re-decompress on resume (the gzip stream is small relative to the decompressed output). Alternatively, null out `retainedRawBytes` immediately after transfer and have the client re-send the buffer on resume.

### J-3 · `demo-generator.ts` HBR/SBR counts include retested execution counts, not unique die counts
**File:** [`src/core/demo/demo-generator.ts#L822-L895`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L822-L895)  
**Issue:** `hbinCounts` and `sbinCounts` are incremented for both the first-pass and the retest pass. In a real tester, `HBR.HBIN_CNT` and `SBR.SBIN_CNT` report the **cumulative total** number of parts that **final** to that bin (from the `WRR` perspective) — not the sum of all PRR executions. The generator counts every PRR execution toward bin tallies, so for a die that fails first-pass to SBIN 7 and retests to SBIN 7, `sbinCounts[7]` gets incremented twice. While the STDF V4 spec says HBR/SBR counts "may" reflect executions, most real ATE data reports unique final-state dies. This discrepancy won't break parsing but will cause `PCR.PART_CNT` and `HBR`/`SBR` totals to look inflated vs. what a real tester would emit, reducing realism.  
**Fix:** Track bin counts separately for final-state outcomes. Increment bin counts only once per die (at the last PRR's outcome), not at each execution.

### J-4 · `EmptyStateCard` missing `id` on the hidden `<input>` — file picker not keyboard-linkable via `<label>`
**File:** [`src/ui/layout/EmptyStateCard.tsx#L181-L189`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/EmptyStateCard.tsx#L181-L189)  
**Issue:** The `<input type="file">` has an `aria-label` and `className="sr-only"` but no `id`. The "Choose STDF file" `<Button>` triggers it via `fileInputRef.current?.click()`, which is inaccessible to screen readers — there is no `<label htmlFor>` linkage. Users navigating by screen reader will encounter the button but not understand it activates a file picker. Per Req 14.3, all interactive controls must be keyboard-operable with accessible names.  
**Fix:** Add `id="cal-file-picker"` on the input and wrap the button with `<label htmlFor="cal-file-picker">` or use `aria-describedby` on the button.

### J-5 · `IngestProgressPanel` progress bar uses `aria-busy="true"` on the containing card but provides no indeterminate progress announcements
**File:** [`src/ui/layout/IngestProgressPanel.tsx#L44`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/IngestProgressPanel.tsx#L44)  
**Issue:** `aria-busy="true"` on the Card signals to screen readers that content is loading, but when `totalBytes` is `null` (gzip streams), the `<Progress>` has no `aria-valuenow`, rendering the progress bar indeterminate without any textual status announcement. The phase description text is in a `<CardDescription>` that's not an ARIA live region. Per Req 14.4, parse completion and active phases should be announced via `aria-live="polite"`.  
**Fix:** Wrap the phase description in a `<div aria-live="polite">` or add an `aria-valuetext` to the progressbar (e.g., `"Parsing: 3.3 MB processed, 7,912 dies resolved"`).

---

## MINOR

### M-1 · Demo wafer die count (633) is on the low side for a 200 mm wafer at 5.8 mm pitch
**File:** [`src/core/demo/demo-generator.ts#L94`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L94)  
**Issue:** `DEMO_DIES_PER_WAFER = 633`. With `dieWid = dieHt = 5.8 mm` and a 200 mm wafer, the theoretical max is ~929 dies inside a 100 mm radius. The generator grid uses a ~87 mm effective active radius, implying a ~13 mm edge exclusion. This is aggressive but defensible for a heavily-excluded EBR zone. A more realistic count would be 750–880 dies. Not blocking but an ATE engineer will notice.  
**Fix:** Consider widening `bx ∈ [-8, 8]` or adjusting `DEMO_WAFER_RADIUS` to ~16 to reach ~780 dies.

### M-2 · `edge-ring-etch` lot marks all 25 wafer patterns as `'Edge-Ring'` — no clean reference wafers
**File:** [`src/core/demo/demo-generator.ts#L752-L754`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L752-L754)  
**Issue:** Every wafer in `edge-ring-etch` is tagged `expectedWaferPatterns.push('Edge-Ring')` with 100% injection across all 25 wafers. In a real plasma etch drift scenario, early wafers processed before the focus ring degraded would be clean — typically the first 3–5 wafers would show `'None'` or `'Random'`. Having all 25 wafers uniformly affected is unrealistic; a yield engineer would question the storyline.  
**Fix:** Ramp the injection probability across wafer index so W01–W04 have minimal edge-ring failures (yielding `'None'` or `'Random'`), with the signature strengthening from W05 onward.

### M-3 · `site2-probe-contact` retest touchdown uses the same `siteNum` as the first pass — unrealistic
**File:** [`src/core/demo/demo-generator.ts#L840-L898`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L840-L898)  
**Issue:** The retest pass emits `siteNum: candidate.die.siteNum`, meaning a die that failed on Site 2 is re-probed on Site 2. In practice, an auto-retest on a quad-site prober will re-probe the die on the **same site** because the probe card hasn't moved — which is actually correct. However, the design story says "overdrive scrub on ~50% of Site-2 contact opens, recovering ~40%." An overdrive scrub implies the prober adjusts Z overdrive and repeats the same touchdown — staying on the same site is correct. **This is actually realistic.** No fix needed.  
*Re-classified to informational.*

### M-4 · `FullWindowDropZone` drag overlay does not display `"Drop the body."` via ARIA for screen readers
**File:** [`src/ui/layout/FullWindowDropZone.tsx#L119`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/FullWindowDropZone.tsx#L119)  
**Issue:** The drag-over overlay has `aria-hidden="true"`. The visual cue is purely decorative from an a11y standpoint, which is correct — but the application does not announce the drop zone activation to screen reader users at all. Per Req 14.4, state changes should be surfaced through live regions.  
**Fix:** Add a visually-hidden `<div aria-live="assertive">` that announces "File drop zone active" when `isDraggingOver` becomes true and clears when it deactivates.

### M-5 · `LoadedLotOverview` renders `anomaly.yieldDeltaPp` without units or sign explanation
**File:** [`src/ui/layout/LoadedLotOverview.tsx#L270-L272`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/LoadedLotOverview.tsx#L270-L272)  
**Issue:** The badge shows `z = 14.2 (-32.1 pp)` — the abbreviation `pp` (percentage points) is ATE jargon but not defined anywhere on screen. A hackathon evaluator or EE student may not understand this. Per Req 17.4, the system should use standard semiconductor test terminology.  
**Fix:** Expand to `(-32.1 pp yield drop)` or add a tooltip.

### M-6 · `empty-state.test.ts` assertions are shallow — string-matching HTML output
**File:** [`src/ui/layout/empty-state.test.ts#L19-L41`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/empty-state.test.ts#L19-L41)  
**Issue:** Tests use `renderToStaticMarkup` and check `html.contains('Load demo lot')`. This is brittle — if "Load demo lot" were hidden via CSS or in an `aria-hidden` subtree, the test would still pass. The shadow/bold regex checks (`/\bshadow-(sm|md|lg|xl|2xl)\b/`) are good but incomplete: they don't check for `shadow-` utility classes used in primitives (`shadow-none` is fine, but the regex doesn't distinguish).  
**Fix:** Use `@testing-library/react` with `render` + `screen.getByRole('radio')`, `screen.getByText('Load demo lot')`, and `screen.getByLabelText(...)` for semantic assertions. Assert the radio group has `aria-label`, the preset buttons have `role="radio"`, and that focus management works.

### M-7 · `AppShell.tsx` does not announce the `'no-results'` empty state transition
**File:** [`src/ui/layout/AppShell.tsx#L322-L348`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/AppShell.tsx#L322-L348)  
**Issue:** The `EmptyStateCard` with `cause="no-results"` is instantiated but the `liveAnnouncement` is never set for this state transition. The `aria-live` region remains stale.  
**Fix:** When the selection store filters to zero dies and workspace transitions to the no-results empty state, set `liveAnnouncement` to `"Zero dies match the active filter predicates."`.

### M-8 · `demo-generator.ts` does not emit `SDR.SITE_NUM[]` correctly for the quad-site setup
**File:** [`src/core/demo/demo-generator.ts#L1005-L1015`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L1005-L1015)  
**Issue:** `siteNums: DEMO_SITE_NUMS` → `[1, 2, 3, 4]`. This is correct. No issue. *Withdrawn.*

### M-9 · `prng.test.ts` fork test is weak — does not verify forked stream independence
**File:** [`src/core/demo/prng.test.ts#L71-L76`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/prng.test.ts#L71-L76)  
**Issue:** The fork test creates `childA1 = a.fork(1)` and `childA2 = createPrng(12345)` (a fresh root PRNG, not a fork) and only verifies `nextUint32() >= 0`. It never checks that (1) `childA1` produces a different stream from parent `a`, (2) two forks with different salts produce different streams, or (3) a fork with the same salt from the same state reproduces identically. The `mixSeed` check is good but doesn't verify the fork API end-to-end.  
**Fix:** Fork twice from the same parent state with the same salt and verify identical streams; fork with different salts and verify divergent streams within the first 16 samples.

### M-10 · `demo-generator.prop.test.ts` checks injectedFinalFail die exceeds hiLimit but not whether it exceeds by a physically plausible amount
**File:** [`src/core/demo/demo-generator.prop.test.ts#L129`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.prop.test.ts#L129)  
**Issue:** Line 129 asserts `expect(val).toBeGreaterThan(primaryCol.hiLimit!)` for all injected fails. This is correct for `edge-ring-etch` (IDDQ_LEAK above 15 µA), but for `site2-probe-contact` the primary test is `VDD_CONT_R` (hi = 2.5 Ohm) and the injection drives values into 2.65–9.2 Ohm. For `handling-scratch` the primary test is `VCCA_SHORT` (hi = 25 mA) with values in 27–92 mA. All these are plausible ATE parametric behaviors. No issue with the check itself, but the test does not verify that passing dies stay *within* spec, which would be a stronger ground-truth check.  
**Fix:** Add `expect(val).toBeLessThanOrEqual(primaryCol.hiLimit!)` for a sample of passing dies to verify the generator doesn't accidentally push passing measurements out of spec.

### M-11 · `worker-client.ts` `loadFile` reads the entire `file.arrayBuffer()` on the main thread
**File:** [`src/workers/worker-client.ts#L192`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/workers/worker-client.ts#L192)  
**Issue:** `const arrayBuffer = await file.arrayBuffer()` reads the entire file into a main-thread `ArrayBuffer` before transferring it to the worker. For a 180 MB file this will allocate ~180 MB on the main thread even if only briefly before `Comlink.transfer` detaches it. The design spec (Req 15.2) requires main-thread tasks ≤ 50 ms. While `file.arrayBuffer()` is async and doesn't block the main thread synchronously, the GC pressure from the allocation and the postMessage serialization overhead could cause long tasks.  
**Fix:** Consider using `file.stream()` with chunked transfer or the `ReadableStream` API to avoid the full allocation. Alternatively, accept this as an inherent browser API limitation and document it.

### M-12 · `autopsy.worker.test.ts` transfer count assertion is brittle
**File:** [`src/workers/autopsy.worker.test.ts#L261`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/workers/autopsy.worker.test.ts#L261)  
**Issue:** `expect(transfers.length).toBe(18)` hard-codes the exact count of unique `ArrayBuffer`s (13 die arrays + 4 PTR Float32Arrays + 1 anomaly Uint32Array). If any typed array in `ColumnarDies` is added or removed, or if a new parametric test is added to the demo, this test breaks silently with a confusing count mismatch. The comment documents the breakdown but the assertion doesn't verify the breakdown.  
**Fix:** Assert `transfers.length >= 13 + lot.tests.size + siteAnomalies.length` with named lower bounds, or decompose into separate transfer group checks.

### M-13 · Copy tone: `IngestProgressPanel` phase labels are slightly inconsistent with clinical tone
**File:** [`src/ui/layout/IngestProgressPanel.tsx#L22-L26`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/IngestProgressPanel.tsx#L22-L26)  
**Issue:** `'generating-demo': 'Serializing deterministic 25-wafer STDF V4 binary stream'` — "Serializing" is accurate but ATE engineers say "building" or "generating." `'modeling': 'Resolving retests, edge-ring BFS, and multi-site yield summary'` mixes implementation detail ("BFS") with user-facing copy. Per design-language.md: "clinical and concise, standard test terminology."  
**Fix:** Reword to `'Generating 25-wafer synthetic sort log'` and `'Resolving retests, edge-ring classification, and multi-site yield'`.

---

## INFORMATIONAL

### I-1 · `demo-generator.ts` caches wafer layout in module-level `cachedLayout` — not harmful but prevents GC
**File:** [`src/core/demo/demo-generator.ts#L258`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L258)  
The layout cache (`let cachedLayout`) is never cleared. In a worker context this is fine since the worker can be terminated. In the main thread (test harness), it persists for the process lifetime. Not harmful in practice.

### I-2 · Property 9 test file defers the spatial-classifier half to Task 4.4 (after Task 6)
**File:** [`src/core/demo/demo-generator.prop.test.ts#L20-L25`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.prop.test.ts#L20-L25)  
The test correctly documents the TODO and validates all yield/retest/site-anomaly ground truth now. The spatial half (classifier not yet built) is appropriately deferred per the task plan.

### I-3 · `AppShell` supports a `createClient` prop for testing — good DI pattern
**File:** [`src/ui/layout/AppShell.tsx#L57`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/AppShell.tsx#L57)  
Well-designed: allows injecting a mock worker client in Vitest without needing a real `Worker` global.

### I-4 · All design tokens verified against `design-language.md` — PASS
Palette test (`palette.test.ts`) and property test (`palette.prop.test.ts`) verify locked hex/rgba values, WCAG 2.2 AA contrast ratios (≥ 4.5:1 text, ≥ 3:1 graphical marks), LCH hue exclusion zones, magma LUT monotonicity, motion ceilings, heading weight bounds, and CSS variable definitions in `globals.css`. All pass.

### I-5 · Copy tone passes clinical scrutiny
"Drop the body.", "Autopsy Report", "Cause of death" are the only metaphorical phrases. All other copy uses standard semiconductor test terminology (STDF V4, PRR, HBIN, SBIN, Test Site, Final Yield, First-Pass Yield, etc.). No skulls, cobwebs, pumpkins, or novelty language detected.

### I-6 · Number formatting meets spec
`formatYieldPct`: 1 decimal ✓; `formatScore2`: 2 decimals ✓; `formatGroupedInt`: digit grouping ✓; `formatByteSize`: SI prefixes ✓.

---

## Summary of Findings

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| MAJOR    | 5     |
| MINOR    | 10    |

**Key strengths:**
- Demo lot generator is impressively realistic: proper multi-site serpentine prober stepping, `2×2` quad-site touchdown groups, interleaved PIR/PTR/PRR, PTR default inheritance, multi-PRR retests with PART_FLG bit handling, and credible parametric distributions with physically-motivated failure modes (IDDQ leakage, contact resistance, metal shorts, threshold voltage drift)
- Property test coverage is strong: determinism, byte-identity, ground-truth yield/site-anomaly verification across arbitrary seeds
- Worker pipeline is well-architected: `ingestStdfBuffer` / `ingestDemoPreset` are testable in Node without a browser Worker; Comlink transfer+proxy are correctly exercised
- Design tokens are locked and verified against steering with property-based contrast tests
- Copy tone is appropriately clinical

**Verdict: NEEDS-FIX** — 5 MAJOR issues (J-1 stale dep array, J-2 double memory retention, J-3 inflated bin counts, J-4 file picker a11y, J-5 progress ARIA) must be addressed before moving to Task 5.
