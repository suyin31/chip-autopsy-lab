# Review: Task 6 (WM-811K Classifier & Root Causes) + Task 4.4 Classifier Half

**Reviewer:** Senior Yield/Product Engineer (wafer-map pattern recognition, WM-811K)
**Date:** 2026-11-17
**Scope:** `src/core/patterns/*`, `src/core/demo/demo-generator.prop.test.ts`, `design.md` Section 3.4, `tasks.md` Tasks 6 and 4.4

---

## Summary

The 9-class deterministic WM-811K spatial classifier is a well-engineered, weightless feature scorer with genuine D₄ invariance, correct bridged-component connected analysis, physically sensible zone/radial/angular features, and robust noise gating. Root-cause hypotheses read like actual fab/test engineering disposition notes with concrete verification steps. Tests are fast (full suite ≤ 5.3 s) and exercise all three demo presets plus fast-check D₄ transforms. I found **no blockers**, several **minor** code-vs-spec discrepancies and robustness items, and one **major** item regarding Random-score specification drift.

---

## Findings

### MAJOR-1 — Random-score radial-disparity and angular-resultant thresholds deviate from design.md

**Files:**
- [wm811k-classifier.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/wm811k-classifier.ts#L1068-L1075)
- [design.md](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/.kiro/specs/chip-autopsy-lab/design.md#L637-L638)

**Observation:** The design.md specification (Section 3.4 Step 6, `Random`) documents:
- `ramp(f_global, 0.02, 0.08)`
- `ramp(2.4 − r_zone, 0.0, 1.1)`
- `ramp(0.35 − M_ang, 0.0, 0.20)`
- `ramp(0.22 − Δc₈, 0.0, 0.16)`

The code uses:
- `ramp(globalFailFraction, 0.02, 0.06)` ← **spec says 0.08**
- `ramp(3.8 − radialDisparity, 0.0, 1.4)` ← **spec says 2.4, 1.1**
- `ramp(0.52 − angularResultant, 0.0, 0.22)` ← **spec says 0.35, 0.20**
- `ramp(0.25 − excessClust8, 0.0, 0.16)` ← **spec says 0.22**

Additionally, the code uses **smoothed** (Bayesian add-2/add-20) zone densities for radial disparity rather than the raw `d_inner, d_mid, d_edge3` specified in design.md. The smoothing is a sound engineering improvement (guards against small-sample binomial variance in the inner zone, which on a 633-die wafer has only ~40 cells), but the threshold constants have drifted substantially from the locked specification.

**Engineering Impact:** The wider `ramp(f_global, 0.02, 0.06)` band is **more aggressive** at calling Random on low-fail wafers (reaching score=1 at 6% vs. 8% fail fraction), making Random harder to trigger on a marginal wafer with 5–6% fails—which could cause it to fall through to `None` for wafers that an experienced engineer would call spatially random. Conversely, the much more permissive `ramp(3.8 − radialDisparity, …)` lets Random survive even with 3.8× radial imbalance (vs spec's 2.4×), which risks classifying a mild Center or Edge-Ring as Random when zone densities have moderate spread. The property tests pass because the archetype generators produce clean enough distributions, but a real wafer with moderate radial non-uniformity and ~6% fail fraction could be misclassified.

**Fix:** Either update `design.md` Section 3.4 Step 6 Random equation to match the tuned code constants (and document the smoothing decision), or revert the code to match the locked spec. The former is the correct action if these were tuned for the demo presets; in that case, document the tuning rationale next to the smoothing comment at L1047.

---

### MINOR-1 — Loc score `ramp(centroidRho, 0.22, 0.45)` favours off-center clusters but excludes center-ward ones

**File:** [wm811k-classifier.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/wm811k-classifier.ts#L701-L707) (L701–707)

**Observation:** The Loc score requires `centroidRho ≥ 0.22` (ramp starts at 0.22, saturates at 0.45), meaning a true localized cluster sitting near the center (`ρ ≈ 0.15`) scores 0 for Loc. Design.md § 3.4 Step 6 specifies the same, so this is by-design. However, in real fabs, localized clusters from chuck particles or CVD drip events can occur at any radius, including near-center positions (`ρ < 0.20`). A center-ward localized cluster that is clearly NOT a Center pattern (e.g., 15 fails in a 3×5 block at ρ=0.15, covering only 2% of the inner zone) would be misclassified as Center or fall to Random/None.

**Fix:** Consider lowering the centroidRho ramp start to 0.10 or removing it, and instead adding a check that the cluster subtends a small angular span of the inner zone (to discriminate from Center which covers the full inner disc). Alternatively, document this as a known limitation.

---

### MINOR-2 — Scratch chord in demo generator is deterministic (not seeded) and axis-aligned

**File:** [demo-generator.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L322-L324) (L322–324)

**Observation:** The scratch chord equation `0.55x − y + 1.5 = 0` is hardcoded with a fixed slope across all 25 wafers and all seeds. This means every `handling-scratch` wafer always produces a scratch at the same angle (~29° from X-axis). While the classifier correctly identifies this as Scratch and the D₄ property test rotates arbitrary wafers, the demo-lot-specific tests only ever exercise one scratch orientation. A real cassette handling scratch would vary in orientation across the wafer stack (transfer blade angle, cassette slot angle, etc.).

**Fix:** No code change required, but add a brief comment noting this is a fixed-angle synthetic and that the D₄ property tests cover rotation robustness. Consider varying the chord angle per-wafer using the PRNG in a future iteration to exercise more classifier paths.

---

### MINOR-3 — `coordLookup` Map in `getStaticWaferLayout()` is built but never read

**File:** [demo-generator.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/demo/demo-generator.ts#L276) (L276)

**Observation:** `const coordLookup = new Map<string, number>();` is populated at L307 but never subsequently queried. Dead code, likely a remnant from a removed neighbour-lookup or ring-index path that was replaced by `computeWaferEdgeRingIndices`.

**Fix:** Remove `coordLookup` and the `coordLookup.set(...)` call at L307.

---

### MINOR-4 — No test coverage for adversarial maps outside the three demo archetypes

**Files:**
- [wm811k-classifier.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/wm811k-classifier.test.ts)
- [wm811k-classifier.prop.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/wm811k-classifier.prop.test.ts)

**Observation:** The property test at L338–405 generates archetype wafers and asserts the classifier matches the archetype (`expect(baseClass.pattern).toBe(scenario.archetype)`). This is good, but the archetype generators produce "textbook" patterns with strong fail-rate contrast (e.g., Edge-Ring: 58% edge vs 1.2% interior). Real WM-811K maps in production show:

1. **Blended patterns**: E.g., Edge-Ring + Center (CMP center-fast + edge-fast dual non-uniformity), or Scratch + Edge-Loc (scratch ending at the edge). The classifier should return the dominant pattern, but neither the property test nor the unit test verifies this.
2. **Thin annular Donut near the edge**: A donut whose `ρ_mid` band extends to ring 2–3 would have high `edgeFailShare`, potentially confusing Donut with Edge-Ring.
3. **Short scratch (< 6 cells)**: Below the `|C| ≥ 6` threshold → drops to Loc or Random. This is documented but not tested.
4. **Very small wafer** (< 20 cells): Not tested; the classifier handles it via noise gate but no assertion.

The D₄ test does run with `radius ∈ [13, 16]` (~530–800 cells) and covers all 9 classes, which is reasonable for property-based testing. The concern is that archetypes are generated to be trivially separable, so the tests don't stress the boundary between classes.

**Fix:** Add 2–3 deterministic unit-test cases for boundary scenarios: (a) a Donut pattern near the edge where `edgeFrac3` of the mid-zone cells is high, (b) a 5-cell short scratch that should be Loc or None, (c) a blended Edge-Ring + Center map. These are not critical for correctness but protect against future threshold changes.

---

### MINOR-5 — Confidence formula yields narrow range [0.52, 0.98] for all non-None classifications

**File:** [wm811k-classifier.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/wm811k-classifier.ts#L1111-L1116) (L1111–1116)

**Observation:** The confidence formula `0.52 + 0.34 × s₁ + 0.12 × clamp((s₁ − s₂)/0.40)` with inputs in [0.45, 1.0] and cap at 0.98 yields a range of approximately [0.67, 0.98]. This is documented in design.md. However, when `s₁` is exactly at the MIN_CLASS_CONFIDENCE threshold of 0.45, confidence = `0.52 + 0.34 × 0.45 + 0` = 0.673 → rounds to 0.67. This means no non-None classification ever reports confidence below 0.67, which may mislead users into thinking the classifier is quite sure even on marginal calls.

An experienced yield engineer would want to see confidence < 0.50 on truly marginal maps, but this formula never produces that—the `None` path at L1108 (`1.0 − s₁`) returns higher confidences (0.55–1.0) for the absence of pattern. This is documented as a heuristic feature score, not a calibrated probability (Req 9.2), so it's technically correct, but the floor of 0.67 for non-None is high.

**Fix:** Document in a code comment and in the UI tooltip that confidence ≥ 0.67 for any non-None classification is an artefact of the linear mapping, not evidence of high certainty. No code change required unless the product team wants to widen the range (e.g., use 0.40 + 0.42 × s₁ + 0.16 × gap term).

---

### MINOR-6 — `classifyStackedPattern` delegates to single-wafer when `lot.wafers.length === 1`

**File:** [wm811k-classifier.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/wm811k-classifier.ts#L1382-L1384) (L1382–1384)

**Observation:** When a lot has exactly one wafer, `classifyStackedPattern` delegates to `classifyWaferPattern(lot, 0)`. This is correct per design.md Section 3.4, and the caller (verdict precedence, Req 10.1) uses the stacked result for single-wafer lots. The signatureDieIndices from `classifyWaferPattern` will correctly point to die indices in that wafer. No issue here, just confirming the delegation is correct.

---

### MINOR-7 — Donut hypothesis references "annular CVD gas recirculation vortex" which is not a standard fab term

**File:** [root-causes.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/root-causes.ts#L131-L136) (L131–136)

**Observation:** The hypothesis `hyp:donut:cvd-spin-annulus` mentions "annular CVD gas recirculation vortex." While CVD gas flow dynamics can create annular deposition non-uniformity, the specific term "recirculation vortex" is imprecise; CVD engineers would more likely cite "showerhead radial flow non-uniformity" or "gas depletion effects at mid-radius." This is minor—the hypothesis is hedged with "Candidate mechanism"—but a pedantic process engineer might raise an eyebrow.

The check-next step ("review interlayer dielectric and metallization radial thickness maps across the lot") is excellent and actionable.

**Fix:** Optional: reword to "annular CVD gas depletion or showerhead flow non-uniformity at mid-radius."

---

### MINOR-8 — Property test `D4_NUM_RUNS = 80` generates 80 × 8 = 640 D₄ transforms, each building a full LotModel

**File:** [wm811k-classifier.prop.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/patterns/wm811k-classifier.prop.test.ts#L41) (L41)

**Observation:** The D₄ test runs 80 scenarios × 8 transforms = 640 lot constructions + classifications. With `radius ∈ [13, 16]` (~530–800 cells), each classification takes ~0.1 ms. Total observed: 643 ms. This is fast and well within budget. No concern.

---

## Verification of Key Requirements

### Nine-Class Rules — Physical Sensibility

| Class | Physical sensibility | Verdict |
|---|---|---|
| **Center** | Inner-zone density contrast vs mid+outer. Maps to gas-flow, chuck thermal, CMP center pressure. ✓ Correct radial physics. | ✅ |
| **Donut** | Mid-zone density elevated vs both inner and edge. Maps to chuck zone boundary, CMP mid-zone, CVD annulus. ✓ | ✅ |
| **Edge-Ring** | Outer 3-ring density vs interior, edge fail share > 55%, low angular concentration (uniform around periphery). Maps to plasma etch, EBR, CMP retaining ring. ✓ | ✅ |
| **Edge-Loc** | Edge fails concentrated angularly (high `edgeAngularResultant`), single edge component dominates. Maps to clamp/aligner contact, edge defocus, cooling asymmetry. ✓ | ✅ |
| **Scratch** | Elongated bridged component (PCA λ₁ ≫ λ₂), high aspect ratio, long relative to wafer diameter, narrow width. Maps to robot blade, CMP debris, probe scrub. ✓ Excellent Hough-like line-band refinement for noisy scratches. | ✅ |
| **Loc** | Interior cluster, high 8-neighbour clustering, centroid at mid-radius, low edge fraction. Maps to particles, chuck hotspot, lithography defocus. ✓ | ✅ |
| **Random** | Uniform radial distribution (low disparity), low angular concentration, excess clustering matches Bernoulli expectation. Maps to baseline point defects. ✓ Smoothed disparity is a good defensive improvement. | ✅ (with MAJOR-1 caveat) |
| **Near-full** | High global fail fraction (>62%), all zones affected. Maps to test-setup failure, catastrophic excursion. ✓ | ✅ |
| **None** | Below noise gate thresholds. ✓ Three-tier gate (zero fails, < 5 fails, < 1.5% fraction). | ✅ |

### D₄ Invariance — Genuinely Real

The classifier's D₄ invariance is **exact** (not approximate):
- Angular resultant uses `‖mean unit vector‖₂`, which is O(2)-invariant (L907–912).
- Zone densities are radial, hence D₄-invariant.
- Ring indices are based on 4-neighbour BFS from the boundary, invariant under D₄.
- PCA eigenvalues are rotation-invariant; elongation and aspect ratio derived from eigenvalues are invariant.
- Component membership uses bridged Euclidean distance ≤ 2.25, which is rotation/reflection invariant on the integer lattice.
- Clustered fail fraction uses 8-neighbour count, invariant under D₄.

The property test at L338–405 verifies confidence within ±0.05 and class identity across all 8 D₄ elements on archetype wafers with both integer and half-integer centers. This is rigorous.

### Stacked Lot Classification — Correct

- `STACK_CELL_MIN_FAIL_RATE = 0.20` and `failCount ≥ min(2, waferCount)` correctly filter single-wafer noise (L1416–1418).
- Ring indices are recomputed on the stacked coordinate set (L1404), which is correct—stacking may expose different grid boundaries than individual wafers.
- The unit test at L166–184 verifies that a 10-wafer lot with center-recurring and non-recurring noise correctly classifies as Center on the stack.

### Supporting Die IDs — Correct

- Each class extracts the appropriate subset of failing dies (edge ring 3 for Edge-Ring, inner zone for Center, etc.) at L1119–1202.
- Fallback at L1205–1209 ensures non-None always has ≥ 1 die.
- Die IDs are looked up from `lotDieIds` at L1217–1219, ensuring canonical format.
- Property test verifies sorted, deduplicated, within bounds, and equivariant under D₄ transforms (L384–400).

### Overfitting to Demo Presets

The classifier uses **no demo-specific constants**. The thresholds are general-purpose ramp parameters. The demo generator at `demo-generator.ts` produces wafers whose fail distributions fall within the classifier's ramp ranges, but the classifier has no knowledge of the demo lot structure. The archetype generator in the property test (`generateArchetypeWaferGrid`) uses independent probabilities (not the demo generator's chord/ring/site logic), providing a second independent verification path. I see **no overfitting** to the three presets.

However, the tuned Random-score constants (MAJOR-1) may have been adjusted to work well with the `site2-probe-contact` preset's ~12% spatially-uniform fail fraction on each wafer, which is in the sweet spot of `ramp(f_global, 0.02, 0.06)`. A wafer with 7% random fails would score `ramp(0.07, 0.02, 0.06) = 1.0` on the first term → fine. But the other tuned terms (3.8 disparity cap, 0.52 angular cap) are looser than spec, which could mask mild non-uniformity.

### Performance on 25 × 633 Dies

The demo preset tests generate, parse, build, and classify all 25 wafers + 1 stacked heatmap per preset in:
- `edge-ring-etch`: 391 ms (including STDF binary generation + parse + build + classify)
- `handling-scratch`: 258 ms
- `site2-probe-contact`: 273 ms

Classification alone (from the property test) runs at ~175 ms for 200 arbitrary lots and ~643 ms for 80 × 8 D₄ scenarios. Per-wafer classification is well under 1 ms for 633 dies. For the full pipeline (build stacked cells + classify stacked + 25× classify wafer), I estimate < 5 ms on the target 25 × 633 = 15,825 dies. This is well within the ≤ 100 ms brushing budget (Req 15.5).

### Root-Cause Hypothesis Quality

Reviewed all hypotheses in `root-causes.ts`:

| Pattern | Hypothesis quality | Experienced engineer agreement |
|---|---|---|
| Edge-Ring | Plasma focus-ring erosion, EBR width, CMP edge pressure. All plausible, correctly hedged, specific check-next steps. | ✅ Would agree |
| Center | Center-peaked plasma/CVD, chuck thermal, CMP center membrane. Standard center-failure mechanisms. | ✅ Would agree |
| Donut | Chuck zone boundary, CMP mid-zone, CVD annulus (see MINOR-7). Plausible. | ✅ Would agree (with minor wording nit) |
| Scratch | Robot blade, CMP slurry gouge, probe scrub. These are the top 3 scratch mechanisms in real fabs. | ✅ Would strongly agree |
| Edge-Loc | Clamp/aligner contact, edge litho defocus, He cooling leak. Good coverage. | ✅ Would agree |
| Loc | Particle cluster, chuck particle defocus, thermal patch. Standard localized-defect mechanisms. | ✅ Would agree |
| Near-full | Unpowered supply, prober index offset, catastrophic excursion. The test-setup hypothesis first is excellent (most Near-full wafers in production are ATE errors, not wafer-wide silicon loss). | ✅ Strongly agree |
| Random | Baseline D₀ defectivity, parametric guardband tail. The note to "verify test-site yield balance first" is excellent advice. | ✅ Would agree |
| Site-conc | Probe needle contact, tester channel/PIB, Kelvin trace. These are the standard probe-card debugging steps. | ✅ Would strongly agree |

All hypotheses use "Candidate mechanism:" hedging. All have concrete "Check next:" steps. No horror tropes. No certainty statements. This is better than most commercial yield-management tools' root-cause suggestion engines.

### Test Suite Duration

| Test file | Duration | Assessment |
|---|---|---|
| `wm811k-classifier.test.ts` (4 unit tests) | 26 ms | ✅ Fast |
| `wm811k-classifier.prop.test.ts` (2 property tests, 280 runs) | 818 ms | ✅ Fast |
| `demo-generator.prop.test.ts` (5 tests, 15 runs + 3 presets) | 3,629 ms | ✅ Acceptable |
| **Total** | **5.33 s** | ✅ Not painful |

The test suite completes in 5.3 s. The demo generator property test with 15 runs is the slowest at 2.7 s (each run generates a 25-wafer lot). This is well within acceptable bounds for a Vitest run.

---

## Conclusions

The classifier implementation is solid engineering work. The D₄ invariance is mathematically correct, the feature scoring is physically grounded, the threshold values produce good separation on the demo presets without overfitting, the root-cause hypotheses would satisfy an experienced fab/test engineer, and the test suite is thorough without being slow.

The one **MAJOR** item (Random score spec drift) should be resolved by updating `design.md` to match the tuned code (since the tuned values are defensible improvements), or documenting the rationale. The **MINOR** items are non-blocking suggestions for additional robustness.

---

**NEEDS-FIX**
