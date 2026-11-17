# Task 7 Review — Engine Facts, Verdict Precedence, Template Report, Autopsy Report Card

**Reviewer:** Senior Product Test Engineer + Apple-grade UI Review  
**Scope:** `src/core/report/*`, `src/ui/report/*`, wiring in `src/ui/layout/LoadedLotOverview.tsx`  
**Date:** 2026-11-17  
**Spec refs:** `design.md` Section 3.5, `requirements.md` §10, `tasks.md` Task 7

---

## BLOCKER

### B-1 · Tier 3 missing `Random`/`None` guard on `primarySpatial.pattern`

**File:** [`src/core/report/verdict-precedence.ts`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/report/verdict-precedence.ts#L261-L295)  
**Lines:** 261–295

`design.md` Section 3.5 Tier 3 specifies:

> Triggered when `wafers.length >= 2` and $W_{\text{exc}}$ exists **while the stacked map classified as `Random` or `None`**.

The code at line 262 checks only `lot.wafers.length >= 2` and `excursions.length > 0`. It **does not** guard on `primarySpatial.pattern === 'Random' || primarySpatial.pattern === 'None'`. This means a lot with a valid stacked `Edge-Ring` (Tier 2) pattern could be overridden by a Tier 3 single-wafer excursion, violating the precedence hierarchy.

**Fix:** Add `&& !isStructuredWm811kPattern(primarySpatial.pattern)` (or equivalently `&& (primarySpatial.pattern === 'Random' || primarySpatial.pattern === 'None')`) as a guard before entering the Tier 3 excursion search:
```typescript
if (
  lot.wafers.length >= 2 &&
  (primarySpatial.pattern === 'Random' || primarySpatial.pattern === 'None')
) {
```

---

### B-2 · Property 10 fast-check broad arbiter test failing

**File:** [`src/core/report/autopsy-report.prop.test.ts`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/report/autopsy-report.prop.test.ts#L504-L519)  
**Lines:** 504–519

The main Property 10 fast-check test (`"enforces headline template, non-empty claim-to-die resolution, metric grounding, and determinism across arbitrary LotModels"`) fails at run 75. The shrunk counterexample is a 1-die passing lot with a parametric test whose `loLimit = -999.999...` and `hiLimit = 0` produce valid two-sided limits where the single die value `1.4e-45` is out of spec, triggering a parametric capability fact. The metric-grounding assertion at line 488 (`matchesMetric`) fails because a numeric literal extracted from the parametric claim summary doesn't match any cited metric within tolerance.

**Root cause:** Likely edge case in `formatScaledParametricValue` for near-zero values with extreme `loLimit`, or the `tolerance` calculation via `compute2DpTolerance` being too tight for the display-rounded number. The `maskIdentifiersAndExtractNumbers` regex may also be extracting a stray number from the limit formatting.

**Fix:** Debug with the exact shrunk counterexample seed (`-852411520, path "74:0:..."`). Either widen `compute2DpTolerance` for extreme-magnitude scaled values, or fix `maskIdentifiersAndExtractNumbers` to mask `LO`/`HI` limit substrings before extraction. This test must pass green.

---

## MAJOR

### M-1 · `resolveSingleWaferBadgeLabel` called inline in render loop without memoization

**File:** [`src/ui/report/AutopsyReportCard.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/report/AutopsyReportCard.tsx#L455-L468)  
**Lines:** 455–468 and 520–524

`resolveSingleWaferBadgeLabel(claim, lot, factsById)` is called **inline** inside the JSX `.map()` for every `evidenceClaim` and every hypothesis `linkedClaim` on **every render**. Each call iterates the full `resolvedDieIndices` array. While the headline variant is correctly memoized (line 400–408), the body claims are not. With 2–4 body claims and typical ~500–2000 cited dies each, this is O(N×claims) per render. It won't freeze the UI for small lots but violates the design intent of "report computed off main thread or memoized" and will degrade for future lots.

**Fix:** Hoist a `useMemo` that pre-computes `waferLabelByClaim: Map<string, string | null>` for all body claims, keyed on the report and factsById references:
```typescript
const waferLabelByClaimId = React.useMemo(() => {
  const map = new Map<string, string | null>();
  for (const { claim } of evidenceClaims) {
    map.set(claim.claimId, resolveSingleWaferBadgeLabel(claim, lot, factsById));
  }
  return map;
}, [evidenceClaims, lot, factsById]);
```

---

### M-2 · No `aria-live` region for verdict/claim announcement in the report card

**File:** [`src/ui/report/AutopsyReportCard.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/report/AutopsyReportCard.tsx)  
**Requirement:** 14.4 — "announce … primary cause-of-death verdicts … through polite ARIA live regions"

The `AutopsyReportCard` and `LoadedLotOverview` contain **zero** `aria-live` attributes. While `AppShell.tsx:302` and `WaferMapCanvas.tsx` have live regions for parse/wafer state, the verdict card itself — which Req 14.4 explicitly names — does not announce the cause-of-death when the report appears or when a claim highlight toggles on/off. Screen reader users will not hear the verdict upon load.

**Fix:** Add a visually-hidden `aria-live="polite"` region inside `AutopsyReportCard` that renders the headline text (e.g., `"Cause of death: Edge-Ring failure …"`) when the report is first mounted and updates when the active claim changes:
```tsx
<div className="sr-only" aria-live="polite" aria-atomic="true">
  {report.causeOfDeathHeadline.text}
  {effectiveActiveClaimId
    ? ` Highlighted claim: ${effectiveActiveClaimId}`
    : ''}
</div>
```

---

### M-3 · `ClaimInlineButton` body variant lacks `data-testid` for E2E targeting

**File:** [`src/ui/report/ClaimInlineButton.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/report/ClaimInlineButton.tsx#L137-L195)  
**Lines:** 137–195

The headline variant has `data-testid="autopsy-headline-button"` (line 64) but the body claim button at line 138 has no `data-testid`. Playwright E2E tests in Task 8 will need to target individual body claims. The only selector available is `data-claim-id` which is present, but the absence of a consistent `data-testid` pattern differs from the headline and from the hypotheses toggle (`data-testid="autopsy-hypotheses-toggle"`) making test selectors fragile.

**Fix:** Add `data-testid="autopsy-body-claim-button"` to the body variant `<button>` at line 138.

---

## MINOR

### m-1 · Hypotheses disclosure panel rendered via conditional `{hypothesesOpen ? <div> : null}` instead of hidden attribute

**File:** [`src/ui/report/AutopsyReportCard.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/report/AutopsyReportCard.tsx#L498-L549)  
**Lines:** 498–549

The `aria-controls={hypothesesPanelId}` on the toggle button references `hypothesesPanelId`, but when `hypothesesOpen === false` the panel `<div id={hypothesesPanelId}>` doesn't exist in the DOM. This violates the ARIA spec for `aria-controls`: the referenced element should be present (albeit hidden) so assistive tech can resolve the relationship. This is a WCAG advisory, not a strict failure.

**Fix:** Render the panel always with `hidden` attribute (or `aria-hidden="true"` + `className="hidden"`) when closed, instead of conditional rendering:
```tsx
<div
  id={hypothesesPanelId}
  role="region"
  hidden={!hypothesesOpen}
  ...
>
```

---

### m-2 · `NarrationBadge` "LLM Verified" variant uses `accent` color without non-color cue

**File:** [`src/ui/report/NarrationBadge.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/report/NarrationBadge.tsx#L16-L18)  
**Lines:** 16–18

The two badge states differ by color variant (`accent` vs `neutral`) but the text labels are distinct ("LLM Verified · Fact-Cited" vs "Template · Offline") which does pair color with text. This is acceptable for Req 14.2 — noted as minor since the "LLM Verified" branch is exercised only when the LLM narrator is active, which is not yet wired in Task 7. No action needed now.

---

### m-3 · `LoadedLotOverview` site-row `onClick` handler accesses the global singleton `useSelectionStore.getState()` instead of a potentially injected store

**File:** [`src/ui/layout/LoadedLotOverview.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/LoadedLotOverview.tsx#L299-L302)  
**Lines:** 299–302 and 311–314

`LoadedLotOverview` calls `useSelectionStore.getState().toggleSiteFilter(...)` directly, hardcoding the global singleton store. This makes the component untestable with an injected store (unlike `AutopsyReportCard` which accepts `store` as an optional prop). Not blocking but inconsistent with the injection pattern used for the report card.

**Fix:** Accept an optional `store` prop on `LoadedLotOverview` mirroring `AutopsyReportCard`, falling back to `useSelectionStore`.

---

### m-4 · Headline font size uses `text-[24px]` / `sm:text-[28px]` raw sizes instead of design token reference

**File:** [`src/ui/report/ClaimInlineButton.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/report/ClaimInlineButton.tsx#L76)  
**Line:** 76

The `heading-display` class is applied but then overridden by arbitrary `text-[24px]` / `sm:text-[28px]`. If `heading-display` already defines the correct size from the token system, the arbitrary sizes fight the token. If it doesn't, the display size lacks a central reference. Minor design language hygiene.

**Fix:** Either define the correct size in the `heading-display` utility or document the override intent.

---

### m-5 · Warning list in `LoadedLotOverview` renders unsanitized `w.detail` via JSX text node

**File:** [`src/ui/layout/LoadedLotOverview.tsx`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/LoadedLotOverview.tsx#L380)  
**Line:** 380

`{w.detail}` is rendered as a React text node — which React auto-escapes. This is safe against XSS (Req 2.4). However, the other report-related prose in `engine-facts.ts` explicitly calls `sanitizeReportProseText()` to strip `<>` and control chars. `w.detail` comes from `ParseWarning.detail` which originates from STDF binary strings that are **not** run through `sanitizeReportProseText`. Strictly fine because React escapes, but inconsistent with the defensive posture elsewhere.

**Fix:** Apply `sanitizeReportProseText(w.detail)` for consistency with the report prose defense-in-depth pattern.

---

## Positive Observations

1. **Precedence tiers 0–5 correctly ordered** (except B-1 Tier 3 guard): Tier 0 → 1 → 2 → 4 → 5 flow is correct. Tier 1 `excessFailShare >= 0.50` override of structured spatial is correctly implemented.
2. **Every claim cites facts resolving to non-empty die sets**: The `createGroundedClaim` function in `template-report.ts:135-215` throws if any cited factId is missing, if the union resolves to zero dies, or if citedFactIds is empty — excellent referential integrity enforcement.
3. **Copy is hedged, clinical, and trustworthy**: Hypotheses use "Candidate mechanism:" framing throughout. `FORBIDDEN_HORROR_TERMS_REGEX` enforced in tests. No overclaiming observed in any claim template.
4. **Click-to-highlight correctness**: `toggleReportClaimInStore` properly toggles on/off, writes cited die mask, and the wafer-switching logic in `resolveClaimWaferTarget` is well-reasoned (wafer-ref → single-wafer inference → best-evidence wafer fallback). Tests verify overlay paints `#7CF2C1` strokes and that second click clears.
5. **Report computed memoized**: `factsById`, `evidenceClaims/hypotheses`, `hasFailures`, `headlineWaferLabel`, and `handleToggleClaim` are all `useMemo`/`useCallback` gated (5 hooks). Report generation runs in the Worker (`autopsy.worker.ts`), not on main thread.
6. **Number formatting**: `formatGroupedInt`, `formatRatioPct1`, `formatFixed2`, `formatScaledParametricValue` all match Req 17.4 exactly (1dp %, 2dp scores, digit-grouped ints, SI prefixes).
7. **XSS defense**: `sanitizeReportProseText` strips `<>` and control chars from STDF strings. `ClaimInlineButton` renders all text via React text nodes. Test confirms `<script>` and `<img>` are escaped.
8. **DOM order**: Test confirms `autopsy-report-card` precedes `wafer-base-canvas` in DOM order (Req 10.1 "top of workspace").
9. **Tests are meaningful, not tautological**: Property 10 tests exercise 200+ arbitrary lots, targeted tier scenarios with SBIN/HBIN fallback, all 3 demo presets, threshold arbitration, tie-breaking, SI formatting, and independently re-derive expected dominant bins. The UI integration test drives a real render → store → overlay canvas pipeline.

---

## Test Results

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| `autopsy-report.prop.test.ts` | 7 | 6 | 1 (B-2) |
| `autopsy-report-card.test.ts` | 4 | 4 | 0 |
| **Total** | **11** | **10** | **1** |

---

## Verdict

**NEEDS-FIX** — 2 blockers (B-1 Tier 3 missing `Random`/`None` guard per design spec, B-2 Property 10 fast-check failing), 3 majors (M-1 render-loop memoization gap, M-2 missing aria-live for verdict announcement, M-3 missing data-testid on body claims).
