# Review – Task 5: Two-Layer Wafer Map & Central Selection Store

**Reviewer:** Senior Front-End Performance & ATE-Domain Reviewer  
**Date:** 2026-11-17  
**Scope:** `selection-store.ts`, `src/ui/wafer-map/*`, `LoadedLotOverview.tsx`, and their tests  
**Verdict:** see bottom line

---

## A. Derived Masks & Selection Store Correctness

### A-1 · MINOR — `overlayHighlightMask` allocates when it could reuse
**File:** [`selection-store.ts#L367-L368`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/state/selection-store.ts#L367-L368)  
When `!hasActiveFilter && highlightedDieIndices.length === 0` the code allocates a fresh `new Uint8Array(dieCount)`. This is the most common path (idle state with a loaded lot) and runs on every `deriveSelectionMasks` call, which is called by every action mutation through `recomputeWith`.  
**Fix:** Return a singleton frozen zero-length sentinel or stash a `lot`-keyed zero array in a `WeakMap` cache, avoiding the allocation on the hot idle path.

### A-2 · MINOR — `recomputeWith` recalculates masks even when inputs are identical
**File:** [`selection-store.ts#L456-L482`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/state/selection-store.ts#L456-L482)  
Every `setBrush`, `setBinFilter`, etc. calls `recomputeWith` → `deriveSelectionMasks` unconditionally, even if the input is referentially identical to the current value. For high-frequency `setBrush` calls during drag, this is unavoidable, but `setColorMode` and `setActiveTestNum` could be gated (and are), while `setBinFilter(null)` when it is already `null` recalculates unnecessarily.  
**Fix:** Short-circuit `recomputeWith` when all resolved inputs are referentially identical to the current state.

### A-3 · MINOR — Missing-coord die still included in `selectedDieMask` when no spatial filter is active
**File:** [`selection-store.ts#L262-L264`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/state/selection-store.ts#L262-L264)  
When `!hasActiveFilter`, `selectedDieMask` is filled with all `1`s, which includes dies with `hasValidCoords === 0` (i.e., `-32768` sentinel). This is semantically correct per design (Req 4.2: "retaining it in non-spatial Lot, Wafer, Site, and Bin totals"), so not a bug — but worth a doc comment to avoid future confusion. No action required beyond annotation.

---

## B. Zustand Selector Usage & Unnecessary Re-renders

### B-1 · MAJOR — `OverlayCanvas` subscribes to 5 store slices with individual selectors; every `setHoveredDieIndex` during pointer scrub fires 5 shallow-equality checks
**File:** [`OverlayCanvas.tsx#L39-L43`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/OverlayCanvas.tsx#L39-L43)  
Each `useSelectionStore((s) => s.X)` creates one subscription. During pointer scrub at 60 fps, `setHoveredDieIndex` calls `set()` on the store; Zustand notifies all 5 subscriptions, each running `Object.is()`. The overlay re-renders once per frame, which is correct, but each render invokes 5 selectors.  
**Fix:** Consolidate into one selector returning a tuple or object with `useShallow` from `zustand/react/shallow`:
```ts
const { overlayHighlightMask, overlayHighlightCount, hoveredDieIndex, brush, lot } =
  useSelectionStore(useShallow((s) => ({
    lot: s.lot,
    overlayHighlightMask: s.overlayHighlightMask,
    overlayHighlightCount: s.overlayHighlightCount,
    hoveredDieIndex: s.hoveredDieIndex,
    brush: s.brush,
  })));
```
This cuts subscription bookkeeping from 5 to 1 per component instance.

### B-2 · MINOR — `WaferMapCanvas` subscribes to `setActiveWaferIndex` action via `useSelectionStore`
**File:** [`WaferMapCanvas.tsx#L205`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L205)  
Subscribing to an action reference (`s.setActiveWaferIndex`) is stable and never causes re-render, but it creates an unnecessary subscription slot. The same store action can be called via `useSelectionStore.getState().setActiveWaferIndex` (as already done for `setHoveredDieIndex` on L281).  
**Fix:** Use `useSelectionStore.getState().setActiveWaferIndex` in the `onSelectWafer` handler instead.

### B-3 · MINOR — `WaferHighlightBanner` pulls `clearFilters` via selector subscription
**File:** [`WaferMapCanvas.tsx#L131`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L131)  
Same pattern — subscribe to an action reference when `getState()` would avoid a subscription.  
**Fix:** `useSelectionStore.getState().clearFilters()` in the click handler.

### B-4 · MAJOR — `WaferMapCanvas` uses `useSelectionStore((s) => s.hiddenBins)` which returns a new `Set` on every `toggleHiddenBin`
**File:** [`WaferMapCanvas.tsx#L204`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L204) & [`selection-store.ts#L546-L553`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/state/selection-store.ts#L546-L553)  
`toggleHiddenBin` creates `const next = new Set(...)` and calls `set({ hiddenBins: next })`. Since `Object.is(prev, next)` is always `false` for a new Set, `WaferMapCanvas` re-renders and both `BaseCanvas` and `OverlayCanvas` get new props. `BaseCanvas` is `React.memo`, but `hiddenBins` is a new Set every time — `React.memo`'s shallow comparison sees `prev !== next` and repaints the base layer even when the set contents haven't changed (e.g., toggling a bin on then off). This is functionally correct but causes an extra base repaint.  
**Fix:** In `toggleHiddenBin`, before calling `set()`, compare the new set's contents with the old and skip if identical. Alternatively, use a sorted `readonly number[]` or `ReadonlySet` with structural comparison in `React.memo`'s second argument.

---

## C. DPR Scaling & Resize Handling

### C-1 · MAJOR — Canvas CSS size not set via `style` attribute; `h-full w-full` relies on parent CSS, while `canvas.width/height` is set to pixel dimensions — potential blurry mismatch
**File:** [`BaseCanvas.tsx#L105`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/BaseCanvas.tsx#L105) & [`OverlayCanvas.tsx#L113`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/OverlayCanvas.tsx#L113)  
Both canvases use `className="block h-full w-full"` for CSS sizing without an explicit `style={{ width: cssWidth, height: cssHeight }}`. The canvas `width`/`height` attributes are set to `pixelWidth = round(css * dpr)`, but the CSS `width: 100%`/`height: 100%` resolves from the parent container (`aspect-square w-full max-w-[500px]`). If the ResizeObserver-reported `stageSizePx` and the actual CSS layout disagree by even a fractional pixel (e.g., `499.5` rounds to `500`, but CSS lays out `499.5`), the browser's internal downscale introduces sub-pixel blur.  
**Fix:** Set `style={{ width: cssWidth, height: cssHeight }}` on both `<canvas>` elements explicitly to match the integer `cssWidth`/`cssHeight` props, ensuring the CSS size exactly matches `canvas.width / dpr`.

### C-2 · MINOR — DPR read on every effect run; no `matchMedia` listener for DPR changes
**File:** [`BaseCanvas.tsx#L55-L56`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/BaseCanvas.tsx#L55-L56)  
Both `BaseCanvas` and `OverlayCanvas` read `window.devicePixelRatio` inside `useEffect`. If the user drags the window between monitors with different DPR (e.g., Retina + external), the canvas won't resize until the next prop change triggers the effect.  
**Fix:** Add `window.matchMedia(`(resolution: ${dpr}dppx)`)` listener or pass `dpr` as a prop from the parent with a central DPR-change subscription.

### C-3 · MINOR — ResizeObserver uses `contentRect.width` only; height is assumed equal via `aspect-square`
**File:** [`WaferMapCanvas.tsx#L219-L237`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L219-L237)  
`stageSizePx` drives both `cssWidth` and `cssHeight` props, relying on the parent's `aspect-square`. If the CSS `aspect-ratio` is overridden (e.g., by a future layout change), height would be wrong. Low risk given the current locked layout, but fragile.  
**Fix:** Read both `contentRect.width` and `contentRect.height` and pass them separately.

---

## D. Base Canvas Never Repainting on Hover/Selection

### D-1 · BLOCKER — `BaseCanvas` deps include `hiddenBins` (a new `Set` on every toggle) — base repaints on bin legend interaction
**File:** [`BaseCanvas.tsx#L89-L98`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/BaseCanvas.tsx#L89-L98)  
This is correct behavior — toggling a bin's visibility *should* repaint the base layer. However, `hiddenBins` is rebuilt as a new `Set` on every toggle (see B-4), and `React.memo` sees `prev !== next` even if the set contents are identical (e.g., double-toggle), so the base repaints unnecessarily.  
**Downgrade & Fix:** Reclassifying as covered by B-4 above. The base isolation from hover/selection is correctly maintained — `hoveredDieIndex`, `brush`, `binFilter`, `siteFilter`, `claimHighlight`, `overlayHighlightMask` are all excluded from `BaseCanvas` props. ✅ **Base canvas correctly never repaints on hover, brush, or claim highlight.**

---

## E. Canvas Memory Leaks on Wafer Switching

### E-1 · MAJOR — `getContext('2d')` called on every effect run without checking for existing context
**File:** [`BaseCanvas.tsx#L50`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/BaseCanvas.tsx#L50) & [`OverlayCanvas.tsx#L56`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/OverlayCanvas.tsx#L56)  
Per spec, `getContext('2d')` returns the same context object for subsequent calls on the same canvas, so this doesn't leak contexts. However, the effect runs on every prop change, and each call to `canvas.getContext('2d')` has a small overhead.  
**Fix:** Cache the context in a `useRef`:
```ts
const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
// In effect:
ctxRef.current ??= canvas.getContext('2d');
```

### E-2 · MAJOR — Canvas backing store is never zeroed out on wafer switching; large pixel buffers persist across the full component lifetime
**File:** [`BaseCanvas.tsx#L58-L63`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/BaseCanvas.tsx#L58-L63)  
When switching between wafers, `canvas.width` and `canvas.height` are only set when they differ from the current value. Since `stageSizePx` × DPR is constant for a given window, the backing store is never re-allocated — this is **good** for performance (avoids thrash). The canvas is cleared and repainted on every wafer switch via `clearRect` in `paintWaferBaseLayer`. **No actual memory leak.**  

However, if the user loads a new lot with `setLot()`, the `WaferMapCanvas` component re-renders with the new lot but the old canvas DOM node persists (React reuses it). The old backing store (up to `500px × 2 DPR = 1000 × 1000 × 4 bytes ≈ 4 MB` per canvas, `×2` = `~8 MB` total) stays allocated but is correctly repainted.  
**Assessment:** No leak. Memory is bounded at ~8 MB for the two canvases regardless of how many wafers/lots are loaded. ✅

---

## F. Keyboard & Screen-Reader Access

### F-1 · MINOR — Wafer map stage `role="group"` is not the most semantic choice
**File:** [`WaferMapCanvas.tsx#L417`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L417)  
The interactive wafer stage uses `role="group"` with `tabIndex={0}`, which is acceptable but doesn't convey the stage as an interactive graphic application. `role="application"` or `role="img"` with an `aria-roledescription="interactive wafer map"` would better communicate the custom keyboard interaction model to screen readers.  
**Fix:** Add `aria-roledescription="interactive wafer map"` to the stage div.

### F-2 · MINOR — Arrow-key die stepping readout not announced to screen readers
**File:** [`WaferMapCanvas.tsx#L290-L367`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L290-L367)  
Keyboard die stepping updates `hoveredDieIndex` via `setHoveredDieIndex`, which updates `WaferDieReadout`. However, `WaferDieReadout` doesn't have `aria-live` or `role="status"` — screen readers won't announce the die coordinates on arrow stepping.  
**Fix:** Add `role="status" aria-live="polite"` to the `<p>` in `WaferDieReadout` (similar to `WaferHighlightBanner` which correctly uses `role="status" aria-live="polite"` on L159).

### F-3 · MINOR — Both canvases set `aria-hidden="true"` ✅
**File:** [`BaseCanvas.tsx#L104`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/BaseCanvas.tsx#L104) & [`OverlayCanvas.tsx#L112`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/OverlayCanvas.tsx#L112)  
Correct per Req 14.4 — canvases are decorative to screen readers, with the `.sr-only` summary on L446-L452 providing the accessible description. ✅

### F-4 · MINOR — Wafer selector `role="radiogroup"` keyboard handling is correct ✅
**File:** [`WaferSelector.tsx#L44-L74`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferSelector.tsx#L44-L74)  
Roving `tabIndex`, `ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown`/`Home`/`End`, `aria-checked`, `aria-label` with yield info. Fully compliant with ARIA radiogroup pattern. ✅

### F-5 · MINOR — Site table rows use `<tr onClick>` without `role="button"` or keyboard activation
**File:** [`LoadedLotOverview.tsx#L287`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/layout/LoadedLotOverview.tsx#L287)  
The `<tr>` has `onClick` and `cursor-pointer` but no `tabIndex`, `role`, or `onKeyDown`. Keyboard-only users cannot activate site filtering via the table row. The inner `<button>` with `aria-pressed` on L293 is focusable, so functionality is accessible via the button — but the entire-row click target is mouse-only.  
**Fix:** Acceptable for now since the `<button>` inside provides keyboard access. Consider adding `role="row"` context or a note that the button is the accessible target.

---

## G. Wafer Geometry vs Real Wafer-Map Conventions

### G-1 · MAJOR — `POS_Y = 'U'` maps to screen `dirY = -1`, meaning increasing Y goes *up* on screen — but `ArrowDown` maps to `+dirY` which is screen-down = decreasing Y
**File:** [`wafer-geometry.ts#L213`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/wafer-geometry.ts#L213) & [`WaferMapCanvas.tsx#L311`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L311)  
Layout: `dirY = POS_Y === 'D' ? 1 : -1`. With `POS_Y = 'U'` (default, positive Y up), `dirY = -1`, so `dieCoordToCanvasRect` multiplies `(y - centerY) * -1 * diePitchPx`, mapping positive Y to lower screen Y (up). ✅ Correct.  
Arrow mapping: `ArrowDown → stepY = dirY = -1`, which steps in the -Y direction (screen up → grid up = wrong). The expected behavior is that `ArrowDown` moves the cursor *visually* downward, which is *positive* screen Y but *negative* grid Y when `POS_Y = 'U'`.  
**Wait:** Let me re-read: `ArrowDown → stepY = dirY`. With `POS_Y = 'U'`, `dirY = -1`, so `stepY = -1`, meaning the cursor steps to `curY + (-1)*dist = curY - dist` (decreasing Y). Since `POS_Y = 'U'` means "positive Y is up" and decreasing Y is visually down, `ArrowDown → curY - 1` → screen down. ✅ **This is actually correct.** Withdrawing the concern.

### G-2 · MINOR — `WF_FLAT` default is `'D'` (notch at bottom, 6 o'clock) which is the correct SEMI standard default ✅
**File:** [`wafer-geometry.ts#L302`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/wafer-geometry.ts#L302)  
Notch angle `π/2` = 6 o'clock position (bottom center) in standard math convention where angle 0 is 3 o'clock and increases counter-clockwise. This correctly places the V-notch at the bottom for `'D'`. ✅

### G-3 · MINOR — Default `POS_X = 'R'`, `POS_Y = 'U'` matches SEMI M1 standard conventions ✅
**File:** [`wafer-geometry.ts#L212-L213`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/wafer-geometry.ts#L212-L213)  
Positive X right, positive Y up is the SEMI standard. `WaferGeometry` defaults `posX: 'R'`, `posY: 'U'`. ✅

### G-4 · MINOR — Die indexing uses 0-based global indices across all wafers; `waferCoordIndex` per-wafer map resolves `(x, y)` → global die index ✅
Consistent with the design's `ColumnarDies` model. No off-by-one detected in `dieStartIndex`/`dieEndIndex` (exclusive end). ✅

---

## H. Design Token Adherence

### H-1 · MINOR — `design-language.md` says pass-die color is `#3A4A43` for Pass/Fail mode; `design.md` resolved it to `#53655D`; code uses `#53655D` ✅
**File:** [`palette.ts#L22`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/tokens/palette.ts#L22)  
The steering `design-language.md` says "starting point `#3A4A43`, tuned in LCH" and design.md resolves it. Code follows the resolved decision. ✅

### H-2 · MINOR — `border-accent/45` and `bg-accent/10` on highlight banner use alpha variants not explicitly in the design token set
**File:** [`WaferMapCanvas.tsx#L161`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L161)  
The design language specifies `#7CF2C1` as a solid token. Using `accent/45` and `accent/10` as Tailwind alpha variants is a reasonable derivation for subtle UI surfaces, not a violation. ✅

### H-3 · MINOR — `WaferDieReadout` uses `text-failure` for FAIL status but doesn't pair it with a non-color cue
**File:** [`WaferMapCanvas.tsx#L107-L109`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L107-L109)  
The readout shows `PASS` or `FAIL` text, so the text string *is* the non-color cue. ✅

---

## I. Visual Layout — Empty Bands & Wafer Selector Density

### I-1 · MAJOR — Large empty vertical bands above and below the circular wafer inside the square canvas
**File:** [`wafer-geometry.ts#L184`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/wafer-geometry.ts#L184) & [`WaferMapCanvas.tsx#L423`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L423)  
The stage container is `aspect-square` (1:1) with `max-w-[500px]`, and the padding is `max(16, round(minDim * 0.065))` ≈ `33 px` at 500 px. After subtracting `2 × 33 = 66 px` padding, the wafer radius is `~217 px` in a 500 px square. The wafer is circular but the die grid is typically wider than tall (or vice versa), leaving visible dead zones at the poles.  
More importantly, the circular wafer occupies ~60% of the square canvas area visually, with the remaining corners and top/bottom bands as dead dark space. This is especially noticeable in the screenshot.  
**Fix:** Two options:
1. **Reduce padding**: Drop `paddingCss` to `max(8, round(minDim * 0.03))` to let the wafer fill more of the square.
2. **Consider a non-square stage**: Fit the die grid bounding box + rim padding, then set the canvas aspect ratio to match — but this would complicate the stacked layout. The simpler fix is option 1.

### I-2 · MAJOR — 25-pill wafer selector is visually busy and cluttered
**File:** [`WaferSelector.tsx#L76-L153`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferSelector.tsx#L76-L153)  
25 inline pills at `min-w-[46px]` each occupy up to `25 × 46 = 1150 px` — wider than `max-w-2xl` (672 px), so they wrap to 3+ lines. Each pill shows just the wafer ID (e.g., "W01") with a tiny accent dot for the selected state. At a glance, it's hard to scan 25 near-identical pills.  
**Fix — cleaner Apple-like alternatives:**
1. **Paginated strip with arrow buttons + current/total indicator** (like Apple Photos' media scrubber): Show 10 pills at a time in a horizontal scrolling track with `←`/`→` buttons, plus a `"3 of 25"` counter. The current implementation already has `← Prev` / `Next →` buttons but renders all 25 pills too.
2. **Compact `<select>` dropdown** (like `<select>` with 25 `<option>`s styled to match the design language): Replace the radiogroup pills with a styled `<select>` for `> 10` wafers, keeping the pill strip only for lots with `≤ 10` wafers. The dropdown should show wafer ID and yield in each option.
3. **Thumbnail strip** (like a tab bar with mini wafer map previews): Each thumbnail is a ~32 px circle rendering a micro wafer silhouette. This provides at-a-glance spatial information but requires rendering 25 mini canvases.

Recommendation: **Option 1 (paginated strip)** — hide pills beyond a visible window of ~8-10, add smooth horizontal scroll with snap-to-pill, and show the current selection as `"W12 — 12 of 25, Yield 82.4%"` above. This matches the Apple Health/Fitness "day selector" pattern and reduces chrome from 25 elements to ~10 visible.

---

## J. Miscellaneous

### J-1 · MINOR — `computeWaferRenderLayout` recalculated in both `useEffect` (for `layoutRef`) and `BaseCanvas` / `OverlayCanvas` effects
**File:** [`WaferMapCanvas.tsx#L254-L264`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L254-L264)  
`layoutRef` is maintained for `hitTestWaferDie` in the pointer handler, while `BaseCanvas` and `OverlayCanvas` each compute their own layouts inside their effects. This means the layout is computed 3× per render (once in the ref update, once per canvas). The layout computation is `O(dieCount)` due to `computeWaferRadiusUnits` iterating all dies.  
**Fix:** Memoize the layout in `WaferMapCanvas` with `useMemo` and pass it as a prop to both canvases and use it for hit-testing, eliminating 2 redundant computations.

### J-2 · MINOR — `handlePointerMove` dependency array includes `safeWaferIndex` but not `lot`
**File:** [`WaferMapCanvas.tsx#L283`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L283)  
The callback captures `lot.waferCoordIndex` from the closure. When `lot` changes (new file loaded), `lot.waferCoordIndex` changes, but the dependency array only lists `[lot.waferCoordIndex, safeWaferIndex]`. Since `lot.waferCoordIndex` is an array (reference changes with lot), this is correct. ✅

### J-3 · MINOR — `WaferDieReadout` default notch label says "Notch Down" for `'D'`
**File:** [`WaferMapCanvas.tsx#L52-L60`](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/ui/wafer-map/WaferMapCanvas.tsx#L52-L60)  
The label says "Notch Down" but the SEMI standard V-notch orientation `'D'` means the flat/notch is at the **bottom** (6 o'clock). "Notch Down" is accurate but could be clearer as "Notch at 6 o'clock" for ATE engineers familiar with that convention. This is a nitpick, not a bug.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| B-1 | MAJOR | OverlayCanvas.tsx:39-43 | 5 individual selectors create 5 subscriptions; consolidate with `useShallow` |
| B-4 | MAJOR | WaferMapCanvas.tsx:204 | `hiddenBins` new Set fails shallow equality in `React.memo`, causing extra base repaints |
| C-1 | MAJOR | BaseCanvas.tsx:105, OverlayCanvas.tsx:113 | Canvas CSS size not explicitly set via `style`; potential sub-pixel blur on DPR scaling |
| E-1 | MAJOR | BaseCanvas.tsx:50, OverlayCanvas.tsx:56 | `getContext('2d')` on every effect; cache in ref |
| I-1 | MAJOR | wafer-geometry.ts:184, WaferMapCanvas.tsx:423 | Excessive padding creates large empty bands around the wafer |
| I-2 | MAJOR | WaferSelector.tsx:76-153 | 25-pill selector is visually busy; use paginated strip or compact dropdown |
| J-1 | MINOR | WaferMapCanvas.tsx:254-264 | Layout computed 3× per render; memoize and share |
| A-1 | MINOR | selection-store.ts:367-368 | Unnecessary alloc on idle path |
| A-2 | MINOR | selection-store.ts:456-482 | No short-circuit when inputs are unchanged |
| B-2 | MINOR | WaferMapCanvas.tsx:205 | Action subscribed via selector; use `getState()` |
| B-3 | MINOR | WaferMapCanvas.tsx:131 | Action subscribed via selector; use `getState()` |
| C-2 | MINOR | BaseCanvas.tsx:55-56 | No DPR-change listener for multi-monitor moves |
| C-3 | MINOR | WaferMapCanvas.tsx:219-237 | Only width read from ResizeObserver |
| F-1 | MINOR | WaferMapCanvas.tsx:417 | Add `aria-roledescription` for interactive wafer |
| F-2 | MINOR | WaferMapCanvas.tsx:290-367 | Die stepping readout not `aria-live` |
| J-3 | MINOR | WaferMapCanvas.tsx:52-60 | "Notch Down" could be more precise for ATE users |

**Blockers:** 0  
**Majors:** 6 (B-1, B-4, C-1, E-1, I-1, I-2)  
**Minors:** 10

---

NEEDS-FIX
