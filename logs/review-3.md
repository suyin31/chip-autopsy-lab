# Code Review — Task 3: Columnar Lot Model, Retest Resolution, and Yield Summary

**Reviewer:** Senior ATE/STDF Engineer (automated)
**Date:** 2026-11-17
**Scope:** `src/core/model/*.ts`, `src/core/analytics/yield-summary.ts`, their tests, against Requirements 7.1–7.4 and `design.md`.

---

## Findings

### BLOCKER

None.

### MAJOR

**M1. `detectSiteAnomalies` uses overall pooled proportion (including candidate site) for SE — correct statistically, but the z numerator direction should be validated against edge cases where `otherSitesFinalYield < siteFinalYield`.**
- **File:** [yield-summary.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.ts#L281-L296)
- **Detail:** The code at L281 checks `yieldDeltaPp < -MIN_YIELD_DROP_PP` (correctly rejecting sites with _higher_ yield), and at L294 computes `z = (otherYield - siteYield) / se` (positive when site is worse). The gate `z >= 3.0` at L295 is correct. The `pooledPassRate` at L243 for the SE denominator correctly includes the candidate site (standard two-proportion z-test under H₀: p₁ = p₂). **However**, when `pooledPassRate === 0` or `=== 1` (all pass / all fail across the entire lot), the function returns `[]` at L244-L246. This correctly handles the zero-variance edge case. The `!(se > 0)` guard at L290 handles numerical zero when pass rate is very close to 0 or 1. **This is sound** — downgrading from a concern to cleared.
- **Status:** ✅ Cleared on inspection (no fix needed).

**M2. `computeYieldSummary` bySite partition uses _final_ siteIndex from the last PRR, not the first PRR — this is correct per design but means the site yield partition is by _final_ test site, not the site that originally tested the die.**
- **File:** [yield-summary.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.ts#L119-L155)
- **Detail:** The columnar `siteIndex` is set from the _last_ PRR (see [lot-builder.ts:574](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/model/lot-builder.ts#L574)). For retested dies, if the retest was on a different site, the die's first-pass result is attributed to the _final_ site's partition, not the _original_ site. Req 7.3 says "per Test Site `(HEAD_NUM, SITE_NUM)`" but doesn't explicitly say "first" vs "last" for the partition key. Design.md at §3.2 says `siteIndex = e_k.siteIndex` (from the last PRR). **The spec and design are aligned** (final site), but this is a semantic subtlety for retest-heavy lots: `firstPassYield` per site becomes _"first-pass yield of dies whose final touchdown was on this site"_, not _"first-pass yield of dies first touched by this site."_ A documentation clarification would be appropriate but no code change is required per current specs.
- **Status:** ✅ Design-consistent (recommend documenting the semantic in a JSDoc comment on `computeYieldSummary`).

### MINOR

**m1. `tasks.md` checkboxes for sub-tasks 3.1–3.4 are all `[ ]` (unchecked), despite implementations existing and tests passing.**
- **File:** [tasks.md](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/.kiro/specs/chip-autopsy-lab/tasks.md#L31-L42)
- **Fix:** Mark sub-tasks 3.1 (`lot-builder.ts`), 3.2 (`yield-summary.ts`), 3.3 (`retest-resolver.prop.test.ts`), and 3.4 (`yield-summary.prop.test.ts`) as `[x]`, and change `- [ ] 3.` to `- [x] 3.` once all four are confirmed.

**m2. Property 3 test (`retest-resolver.prop.test.ts`) includes a ring-index BFS invariant test (L199–L248) that belongs more naturally in a separate describe block or in the lot-builder unit tests — it validates `computeWaferEdgeRingIndices`, not retest resolution.**
- **File:** [retest-resolver.prop.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/model/retest-resolver.prop.test.ts#L199-L248)
- **Fix:** Move to a dedicated `src/core/model/edge-ring.prop.test.ts` or rename the describe block to reflect both concerns. Low priority since the test itself is correct and comprehensive.

**m3. Property 4 test's `arbMultiSiteYieldScenario` generates arrays of length 5 but slices to `siteCount` (2–5) — the unused `perSiteTested` / `perSiteFailRate` entries are harmlessly wasted but the generator could be tighter.**
- **File:** [yield-summary.prop.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.prop.test.ts#L126-L136)
- **Fix:** Use `fc.array(..., { minLength: siteCount, maxLength: siteCount })` via `.chain()` instead of a fixed-length-5 array. Cosmetic — no correctness impact.

**m4. `computeWaferEdgeRingIndices` returns `0` for missing-coordinate dies as documented, but the type is `Uint16Array` initialized to `0` — if a caller accidentally passes a coord list where all coordinates are invalid (all `-32768`), every ring value is `0`, which is distinguishable from "ring 1" but could confuse downstream consumers. The lot-builder correctly filters these before calling.**
- **File:** [lot-builder.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/model/lot-builder.ts#L232-L374)
- **Status:** No fix needed — just a defensive note.

**m5. `yield-summary.test.ts` `detectSiteAnomalies` Gate 3 test (L296–L305) constructs a scenario with Site 1 at 100% and Site 2 at 95%, giving exactly −5.0 pp. The test correctly verifies no anomaly is flagged (Req 7.4: "more than 5.0 percentage points below", i.e., strictly `< -5.0`). However, the cross-product exact integer arithmetic at [yield-summary.ts:274–278](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.ts#L274-L278) might not produce exactly −5.0 pp for all rounding scenarios — the safeguard `MAX_SAFE_INTEGER` check at L277 is good but the floating-point fallback path could introduce epsilon drift. For 1000+1000 dies, the exact path is taken and produces exactly −5.0, so the test is valid.**
- **Status:** ✅ Correct as-is; the exact integer arithmetic path handles this test case.

**m6. `lot-builder.ts` missing-coordinate die ID format uses a per-wafer sequential counter (`missingCoordSeq`), producing IDs like `W01:part-0`, `W01:part-1`. Requirement 7.1 (via Glossary) says `<waferId>:part-<seq>` — this matches. However, if `x === STDF_MISSING_COORD` but `y` is valid (or vice versa), the die is correctly treated as missing-coordinate (L568: `isValidCoordPair` checks both). This aligns with Req 4.2.**
- **File:** [lot-builder.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/model/lot-builder.ts#L187-L196)
- **Status:** ✅ Correct.

**m7. `lot-builder.test.ts` golden fixture comparison at L346 (`expect({ ...beLot, endianness: 'little' }).toEqual(leLot)`) compares full LotModel objects via spread + override — this is a valid deep-equality check but the spread creates a shallow copy where `Uint16Array` / `Float32Array` typed arrays are compared by reference. Vitest's `toEqual` does handle typed array value equality, so this is correct, but worth noting.**
- **File:** [lot-builder.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/model/lot-builder.test.ts#L346)
- **Status:** ✅ Vitest typed array deep equality works correctly here.

**m8. `yield-summary.ts` `excessFailCount` computation at L301–L304 uses `Math.round(rawExcessFails)` clamped to `[1, siteMetrics.finalFailDies]`. When `rawExcessFails` is very small but positive (e.g., 0.4), it rounds to 0 and then clamps to 1 — this gives a minimum excess fail count of 1 for any flagged anomaly. This is intentional (guaranteed non-empty engine fact), but the `excessFailShare` derived from it at L305–L307 could be slightly inflated for borderline cases. Acceptable engineering trade-off.**
- **File:** [yield-summary.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.ts#L299-L308)
- **Status:** ✅ Acceptable — ensures non-empty die set in Engine Facts (Req 10.3).

---

## Sub-Task Completeness Checklist

| Sub-Task | File | Status | Notes |
|---|---|---|---|
| 3.1 `lot-builder.ts` | [lot-builder.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/model/lot-builder.ts) | ✅ Complete | Stable DieIds, first/last PRR retest resolution, PART_FLG bit 3/4 + HBIN fallback, 4-neighbour BFS ring index, missing-coordinate handling all implemented and passing. |
| 3.2 `yield-summary.ts` | [yield-summary.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.ts) | ✅ Complete | Lot/wafer/site yield, first-pass + final yield, retest counts, two-proportion z-test site anomaly detection all implemented and passing. |
| 3.3 Property 3 (`retest-resolver.prop.test.ts`) | [retest-resolver.prop.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/model/retest-resolver.prop.test.ts) | ✅ Complete | 3 property tests with 200 runs each. Covers retest determinism, ring BFS correctness (Bellman), and end-to-end writeStdfBytes→parseStdfBytes→buildLotModel PRR count conservation. |
| 3.4 Property 4 (`yield-summary.prop.test.ts`) | [yield-summary.prop.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.prop.test.ts) | ✅ Complete | 2 property tests with 200 runs each. Covers yield bounds, partition additivity (wafer + site), null-on-empty, and site anomaly invariant validation. |

---

## Test Quality Assessment

### Strengths
- **Property 3 is excellent**: The oracle-based independent re-derivation of `firstPass`/`finalPass` from raw `PART_FLG` + `HBIN_PF` is a strong _independent_ oracle, not a tautological mirror of the implementation. The Bellman identity check on ring indices is a mathematically rigorous invariant.
- **Property 4 is solid**: Partition additivity (sum of parts = whole) is a genuine algebraic invariant. The weighted-average yield check catches subtle off-by-one errors. The site anomaly invariant test validates all threshold gates.
- **Unit tests are concrete and meaningful**: `lot-builder.test.ts` constructs a nuanced retest scenario with PART_FLG bit 4 fallback, missing coordinates, PTR value leakage, and cross-endian golden fixtures. `yield-summary.test.ts` constructs a 4-die retest scenario with explicit expected values and validates all 4 threshold gates for `detectSiteAnomalies`.
- **Arbitrary generators are well-designed**: `arbChronologicalPrrStream` generates realistic multi-wafer, multi-site, multi-retest, mixed-coordinate, mixed-PART_FLG scenarios with valid/invalid `HBIN_PF` flags and `PTR` values.

### Weaknesses / Gaps
- **No dedicated test for `detectSiteAnomalies` with `selectionMask`**: The property test at [yield-summary.prop.test.ts:124–279](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.prop.test.ts#L124-L279) always calls `detectSiteAnomalies(lot)` without a mask. The function accepts an optional `selectionMask` parameter. No test exercises the masked path for anomaly detection.
- **No test for `detectSiteAnomalies` returning multiple anomalies**: Only the quad-site unit test exists and it returns exactly 1 anomaly. A scenario with 2+ simultaneously anomalous sites would strengthen coverage.
- **No test for the confidence score formula's boundary behavior**: The heuristic confidence formula at [yield-summary.ts:190–207](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/analytics/yield-summary.ts#L190-L207) is tested only via range assertions (`>= 0.65`, `<= 0.99`). No test verifies specific expected confidence values for known inputs.
- **No negative test for DieId stability under re-ordering of PRRs within the same wafer**: The spec says "chronologically first PRR" — if two PRRs for the same (x,y) arrive in a different order, `firstPass` should change. This is implicitly tested by `arbChronologicalPrrStream` but not explicitly verified with a hand-crafted negative test.

---

## Verdict

**PASS** — All sub-tasks 3.1–3.4 are implemented, all 15 tests pass (4 test files, including 5 property-based tests with 200 runs each). No blockers found. Requirements 7.1–7.4 are correctly addressed. `PART_FLG` bits 3/4 with HBIN fallback, stable DieIds, first/last PRR retest resolution, ring index BFS, missing coordinates, yield math, and site anomaly z-test are all correctly implemented. Property and unit tests are substantive, not tautological. Minor finding: update `tasks.md` checkboxes.
