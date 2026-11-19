# Task 18 Parallel Implementation Contract: Reveal Motion Moments & Fluid View/Interaction Motion

References: `.kiro/steering/*.md`, `.kiro/specs/chip-autopsy-lab/requirements.md` (Req 1.11, 10.1, 14.5, 17.5), `design.md` (§3.8), `premium.md` (§3.12, §8.1–§8.17, §11.4, §11.5), and `tasks.md` (Task 18).
**Strict Parallelism Rule**: Never edit files owned by the other coder. Package `motion` v12 (`motion/react`) is already installed; **do NOT install any new packages**. All animations must be compositor-only (`transform` and `opacity`, plus `background-color`/`color`/`text-decoration-color` for hover fills; **never `transition: all`**, never animate `width`, `height`, `top`, `left`, `box-shadow`, or `filter`). Hover effects must stay gated behind `@media (hover: hover)`.

---

## 1. Exact Motion Tokens & Physics Specs (`premium.md` §3.12, §8, Req 17.5)

| Token / Curve | Exact Value | Physics / Easing Equivalent | Usage |
|---|---|---|---|
| `spring-ui` | `{ type: 'spring', duration: 0.35, bounce: 0 }` | `stiffness: 320, damping: 36, mass: 1` ($\zeta = 1.0$) | Landing $\to$ report wafer morph (`< 450 ms`), verdict 6-block rise, disclosure sibling `layout="position"` glide, popovers/menus, sheets, toasts, coach marks |
| `spring-snappy` | `{ type: 'spring', duration: 0.22, bounce: 0 }` | `stiffness: 810, damping: 57, mass: 1` ($\zeta = 1.0$) | Segmented control sliding thumb (`layoutId`), press-scale release, disclosure chevron rotation (`0 -> 180deg`), hover magnifier & selection popover enter |
| `spring-camera` | `{ stiffness: 170, damping: 26, mass: 1 }` | Critically damped ($\zeta = 1.0$), rAF integrator | Wafer wheel zoom, double-click zoom/reset, claim evidence bbox camera framing (`scale` in `[1, 4]`) |
| `spring-throw` | `{ stiffness: 260, damping: 22, mass: 1 }` | Under-damped ($\zeta \approx 0.68$), rAF integrator | Rubber-band return after flick/pinch past pan or scale bounds only |
| `spring-sheen` | `{ stiffness: 120, damping: 22, mass: 1 }` | Critically damped ($\zeta \approx 1.0$), rAF follower | Pointer-follow silicon sheen (`0.05 D` stage, `0.03 D` landing card, `rotate(dx * 3deg)`) |
| `ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Tuple `[0.22, 1, 0.36, 1]` | Hover fills (`120 ms`), press in (`80 ms`), card lift (`240 ms`), fail ignite (`280 ms`), evidence die fade (`180 ms`), wafer cross-fade (`160 ms`) |
| `ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | $1 - 2^{-10t}$ / quartic $1 - (1-t)^4$ | Ref-driven stat count-up (`600 ms` initial reveal, `300 ms` filter update) |
| `ease-in-out` | `cubic-bezier(0.45, 0, 0.25, 1)` | Tuple `[0.45, 0, 0.25, 1]` | `document.startViewTransition()` root theme cross-fade (`280 ms` `dur-4`) only |
| Durations | `dur-0: 0ms`, `dur-1: 120ms`, `dur-2: 160ms`, `dur-3: 240ms`, `dur-4: 280ms` | Ceilings: view morph `< 450ms`, panel springs `<= 400ms`, evidence `<= 600ms`, collapse `<= 800ms`, sweep `<= 1200ms` (`~3s` total budget), type-on `<= 1500ms` | Standard UI vs. signature reveal moments |
| `press-scale` | `button: 0.97`, `card: 0.985`, `row: 0.985`, `icon: 0.94`, `thumbnail: 0.94` | `80 ms` `ease-out` on `pointerdown`; release on `spring-snappy` (`1` under reduced motion) | Tactile press feedback |

---

## 2. Per-Element Motion & View-Switch Specifications

1. **Landing $\to$ Report View Switch & Lot Switcher (`< 450 ms`, zero blank flash)**:
   - **Shared-Element Wafer Morph (`WAFER_MORPH_LAYOUT_ID = 'cal-wafer-disc-morph'`)**: Wrap `<main>` workspace content in `<LayoutGroup id="cal-workspace-layout">` inside `AppShell.tsx`. Render an `aria-hidden="true"` `pointer-events-none absolute inset-0 rounded-full` `<motion.div layoutId={reduced ? undefined : WAFER_MORPH_LAYOUT_ID} transition={resolveViewMorphTransition(reduced)} data-testid="wafer-shared-morph" />` inside:
     - `EmptyStateCard.tsx` (`LandingWaferDisc` when `enableSharedMorph` is true for the active/clicked demo card; `DemoLotCardButton` updates `onSelectPreset(presetId)` on `pointerdown` so any clicked card owns the `layoutId` before the view switch).
     - `IngestProgressPanel.tsx` (`LoadingDisc`, `[data-testid="ingest-loading-disc"]`), bridging worker parse at frame 0 with zero blank flash.
     - `LoadedLotOverview.tsx` (inside a `<div className="relative h-full w-full">` child of `stage-column` wrapping `WaferMapCanvas`—**never** alter `stage-column`'s own classes or put a transform on `stage-column`, `verdict-wafer-hero-grid`, or `wafer-camera-wrapper` so `position: sticky` and `headline.top === 136` in P12 stay exact). Set `data-morph-state="morphing" -> "settled"` on completion (with a `420 ms` safety timer so it settles `< 450 ms` even when entering without a prior card).
   - **Content Cross-Fade / Rise**: Verdict column rises in 6 staggered blocks (`headline`, `subline`, `confidence`, `stats`, `findings`, `causes`; `opacity: 0 -> 1`, `translateY(12px -> 0)`, `60 ms` stagger on `spring-ui`, settled `<= 650 ms`).
2. **Skippable Probe-Sweep Load (`~3 s` budget, `<= 1.2 s` sweep + `280 ms` ignite, once per session, Req 1.11)**:
   - Guarded by `sessionStorage["cal.sweep.v1"]`. First session load runs `mode: 'sweep'` (`data-sweep="running"`): dies draw in `PRR` order as pass tiles (`p(t) = min(parseProgress, t / 900ms)`) with `probe-light` (`120 ms` fade-in, `160 ms` fade-out), then `FailCanvas` ignites `opacity: 0 -> 1` in `280 ms` (`dur-4`) `ease-out` (`data-sweep="ignite" -> "done"`). Later loads in the session skip `running` to `ignite` (`280 ms`).
   - Any key, click, or wheel mid-sweep jumps to `data-sweep="done"` on the next frame, hides `[data-testid="probe-sweep-skip-hint"]`, and writes `sessionStorage["cal.sweep.v1"] = "1"`.
3. **Cause-of-Death Type-On (`<= 1.5 s`, Req 10.1, 17.5)**:
   - `VerdictHero.tsx` calls `useTypeOn({ text: verdict.fullHeadline, durationMs: TYPE_ON_DEFAULT_MS (480), enabled: revealed, completed, reducedMotion: reduced, playKey: measureKey })`.
   - Writes `data-typeon-settled={typeOn.settled ? 'true' : 'false'}`, `data-typeon-progress={typeOn.progress.toFixed(2)}`, `data-typeon-count={String(typeOn.visibleCount)}`, and `data-typeon-text={typeOn.visibleText}` onto `<h1 data-testid="verdict-headline">` while keeping the full DOM text children mounted in flow so SSR (`autopsy-report-card.test.ts`), line-height step-down measurement, and `TreeWalker` audits (`verdict-p17.spec.ts`) never reflow. Any pointer/key interrupt in the verdict column (`completed = true`) or reduced motion finishes it at `0 ms`.
4. **Claim Evidence Light-Up Stagger (`<= 600 ms`, Req 10.4, 17.5)**:
   - `dim-veil` fades `0 -> 1` over `200 ms` `ease-out`; evidence dies stagger over `420 ms` (`rank / (n - 1) * 420 ms`) + `180 ms` per-die `ease-out` fade (`<= 600 ms` total) in pattern order (`'polar-cw'` clockwise from 12 o'clock for `Edge-Ring`/`Donut`/`Center`; `'principal-axis'` for `Scratch`; `'centroid-distance'` otherwise). Camera frames the evidence bbox on `spring-camera` unless user-zoomed. Non-evidence strip thumbnails dim to `opacity: 0.32` over `160 ms`.
5. **Panels, Findings, Popovers, Palette, Wafer Thumbnails, Cards, Buttons & Segmented Control**:
   - **Findings & disclosures**: chevron rotates `0 -> 180deg` on `spring-snappy`; body mounts in flow, waits `40 ms` for overlap clearance (A31), fades `opacity: 0 -> 1`, `translateY(-4px -> 0)` in `120 ms` `ease-out` (closes in `100 ms`); siblings glide via `layout="position"` on `spring-ui`.
   - **Popovers & menus**: pointer open `opacity: 0 -> 1`, `scale(0.97 -> 1)` from trigger origin on `spring-ui`, exit `opacity -> 0` in `160 ms` (`dur-2`); keyboard open/close `0 ms`. Magnifier & selection popover enter `scale(0.96 -> 1)` on `spring-snappy`, exit `120 ms`. Tooltips/Terms enter `120 ms`, exit `100 ms`.
   - **Command Palette (`Cmd-K` / `Ctrl-K`)**: `0 ms` (`dur-0`) instant open and focus; row hover `120 ms` `ease-out`.
   - **Wafer thumbnails**: hover `scale(1.06)` over `160 ms` `ease-out`, press `scale(0.94)`; click cross-fades stage canvas over `160 ms` (`dur-2`); keyboard arrow scrub swaps at `0 ms`.
   - **Cards, buttons, segmented control**: Demo card hover lifts `translateY(-2px)` over `240 ms` (`dur-3`, leave `160 ms`) while `::before` cross-fades `shadow-card` opacity; card press `scale(0.985)`. Buttons press `scale(0.97)` (`0.94` icon) in `80 ms` `ease-out`, release on `spring-snappy`. `SegmentedControl` indicator thumb slides via `layoutId` on `spring-snappy` (`0 ms` on keyboard arrow/Home/End or reduced motion).
6. **Full `prefers-reduced-motion: reduce` (Req 14.5, `premium.md` §8.16)**:
   - No probe sweep (`data-sweep="done"` immediately, `120 ms` base fade), no type-on (`data-typeon-settled="true"` at frame 0), no verdict stagger (`delayMs: 0, initialY: 0`, final stat numbers immediately), no evidence stagger (`settled` on frame 1, single camera jump), no wafer morph (`layoutId` disabled, `duration: 0`), no disclosure glide, `0 ms` wafer/theme switch, no sheen follow, no card lift, and no press scale (`scale(1)`).

---

## 3. Exact Exported Signatures from `src/ui/motion/` (CORE Coder)

Re-export all symbols below from `src/ui/motion/index.ts`:

```typescript
// src/ui/motion/tokens.ts
import { MOTION_TOKENS, SPRING_PHYSICS_EQUIVALENTS, SPRING_TOKENS } from '@/ui/tokens';
export { MOTION_TOKENS, SPRING_PHYSICS_EQUIVALENTS, SPRING_TOKENS };

export const WAFER_MORPH_LAYOUT_ID = 'cal-wafer-disc-morph' as const;
export const WORKSPACE_LAYOUT_GROUP_ID = 'cal-workspace-layout' as const;
export const VIEW_SWITCH_MAX_MS = 450 as const;
export const PANEL_SPRING_MAX_MS = 400 as const;
export const PROBE_SWEEP_BUDGET_MS = 3000 as const;
export const TYPE_ON_DEFAULT_MS = 480 as const;
export const TYPE_ON_MAX_MS = 1500 as const;
export const EVIDENCE_STAGGER_MAX_MS = 600 as const;
export const EVIDENCE_STAGGER_WINDOW_MS = 420 as const;
export const EVIDENCE_DIE_FADE_MS = 180 as const;
export const PANEL_ENTER_OFFSET_Y_PX = 8 as const;
export const CARD_HOVER_LIFT_PX = -2 as const;
export const THUMB_HOVER_SCALE = 1.06 as const;
export const THUMB_DIM_OPACITY = 0.32 as const;

export type PressScaleKind = keyof typeof MOTION_TOKENS.pressScale;

export function resolvePressScale(kind: PressScaleKind, reducedMotion: boolean): number;
export function resolveSpringTransition(
  kind: 'ui' | 'snappy',
  reducedMotion: boolean,
  instant?: boolean,
): (typeof SPRING_TOKENS)['ui' | 'snappy'] | { readonly duration: 0 };
export function resolveViewMorphTransition(
  reducedMotion: boolean,
): typeof SPRING_TOKENS.ui | { readonly duration: 0 };
export function resolvePanelEnterMotion(
  reducedMotion: boolean,
  index?: number,
  staggerMs?: number,
): {
  readonly initial: false | { readonly opacity: number; readonly y: number };
  readonly animate: { readonly opacity: 1; readonly y: 0 };
  readonly transition: Record<string, unknown>;
};
export function resolvePopoverMotion(options: {
  readonly reducedMotion: boolean;
  readonly instant?: boolean;
  readonly scaleFrom?: number;
}): {
  readonly initial: { readonly opacity: number; readonly scale: number };
  readonly animate: { readonly opacity: 1; readonly scale: 1; readonly transition: Record<string, unknown> };
  readonly exit: { readonly opacity: 0; readonly transition: Record<string, unknown> };
};

// src/ui/motion/reveal.ts
export {
  PROBE_SWEEP_SESSION_KEY, PROBE_SWEEP_REVEAL_MS, PROBE_SWEEP_FAIL_FADE_MS, PROBE_SWEEP_TOTAL_MAX_MS,
  REDUCED_MOTION_FADE_MS, VERDICT_RISE_STAGGER_MS, VERDICT_RISE_OFFSET_PX, VERDICT_REVEAL_SETTLE_MS,
  VERDICT_RISE_BLOCK_ORDER, computeProbeSweepFraction, computeProbeLightOpacity, resolveInitialRevealMode,
  computeVerdictRiseSchedule, sampleStatCountUp, readPrefersReducedMotionSync,
  type InitialRevealMode, type InitialRevealPlan, type VerdictRiseBlockId, type VerdictRiseStepSpec,
} from '@/ui/wafer-map/probe-sweep';
export {
  GLOW_STAGGER_WINDOW_MS, GLOW_DIE_FADE_DURATION_MS, GLOW_TOTAL_DURATION_MS, GLOW_EXIT_DURATION_MS,
  SCRIM_ENTER_DURATION_MS, computeOrderedGlowSchedule, evaluateGlowSequenceFrame,
  type GlowOrderMode, type OrderedGlowSchedule, type GlowSequenceFrameState,
} from '@/ui/wafer-map/linked-interactions';

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function hasSeenSessionReveal(key?: string, storage?: SessionStorageLike | null): boolean;
export function markSessionRevealSeen(key?: string, storage?: SessionStorageLike | null): void;

export interface TypeOnSampleInput {
  readonly text: string;
  readonly elapsedMs: number;
  readonly durationMs?: number;
  readonly reducedMotion?: boolean;
  readonly skipped?: boolean;
}
export interface TypeOnFrameState {
  readonly visibleText: string;
  readonly visibleCount: number;
  readonly totalCount: number;
  readonly progress: number;
  readonly settled: boolean;
}
/** Codepoint-safe (`Array.from(text)`) ease-out type-on sampler clamped to `[1, TYPE_ON_MAX_MS]`. */
export function sampleTypeOnFrame(input: TypeOnSampleInput): TypeOnFrameState;

/** Returns `0` when `reducedMotion || total <= 1`, else `(clampedIndex / (total - 1)) * maxWindowMs`. */
export function computeStaggerDelayMs(
  index: number,
  total: number,
  maxWindowMs?: number,
  reducedMotion?: boolean,
): number;

// src/ui/motion/hooks.ts ('use client')
export interface UseTypeOnOptions {
  readonly text: string;
  readonly durationMs?: number;
  readonly enabled?: boolean;
  readonly completed?: boolean;
  readonly reducedMotion?: boolean;
  readonly playKey?: string;
}
export interface UseTypeOnResult extends TypeOnFrameState {
  readonly skip: () => void;
}
/** Combines Motion's `useReducedMotion()` with synchronous `matchMedia('(prefers-reduced-motion: reduce)')`. */
export function useReducedMotionPreference(): boolean;
export function useSessionOnceGuard(key?: string): { readonly seen: boolean; readonly markSeen: () => void };
/** SSR-safe rAF type-on hook: returns full settled text on server/SSR and under reducedMotion/completed. */
export function useTypeOn(options: UseTypeOnOptions): UseTypeOnResult;
```

---

## 4. Strict File Ownership & Verification Checklists

| Owner | File Paths | Responsibility |
|---|---|---|
| **CORE** | `src/ui/motion/tokens.ts`, `src/ui/motion/reveal.ts`, `src/ui/motion/hooks.ts`, `src/ui/motion/index.ts`, `src/ui/motion/motion.test.ts` | All motion tokens, transition resolvers, session-once guard, `sampleTypeOnFrame`, `computeStaggerDelayMs`, `useReducedMotionPreference`, `useSessionOnceGuard`, `useTypeOn`, and comprehensive unit tests in `src/ui/motion/motion.test.ts` |
| **UI** | `src/ui/layout/AppShell.tsx`, `src/ui/layout/EmptyStateCard.tsx`, `src/ui/layout/IngestProgressPanel.tsx`, `src/ui/layout/LoadedLotOverview.tsx`, `src/ui/report/VerdictHero.tsx`, `src/ui/report/AutopsyReportCard.tsx`, `e2e/motion-t18.spec.ts` | Wire `<LayoutGroup id={WORKSPACE_LAYOUT_GROUP_ID}>` and shared `WAFER_MORPH_LAYOUT_ID` morph (`data-testid="wafer-shared-morph"`, `data-morph-state`) across landing card $\to$ loading disc $\to$ stage without blank flash or breaking `stage-column` sticky positioning; wire `useTypeOn` metadata attributes on `[data-testid="verdict-headline"]`; write `e2e/motion-t18.spec.ts` |

### CORE Coder Checklist
- [ ] Implement `src/ui/motion/{tokens,reveal,hooks,index}.ts` matching §3 signatures with zero new dependencies.
- [ ] Unit-test (`src/ui/motion/motion.test.ts`): token bounds (`VIEW_SWITCH_MAX_MS <= 450`, `TYPE_ON_MAX_MS <= 1500`, `EVIDENCE_STAGGER_MAX_MS <= 600`, `bounce === 0` on UI springs), `resolvePressScale` / `resolveSpringTransition` / `resolvePopoverMotion` normal vs. reduced-motion paths, `hasSeenSessionReveal` / `markSessionRevealSeen`, `sampleTypeOnFrame` monotonic codepoint progression & CJK/surrogate safety, `computeStaggerDelayMs`, and `useTypeOn` SSR/reduced/skip behavior.

### UI Coder Checklist
- [ ] Wire shared-element wafer morph (`data-testid="wafer-shared-morph"`, `data-morph-state="morphing" | "settled"`) and `data-testid="workspace-view-shell"` (`data-view-status`) across `AppShell.tsx`, `EmptyStateCard.tsx`, `IngestProgressPanel.tsx`, and `LoadedLotOverview.tsx` (`< 450 ms`, disabled under reduced motion).
- [ ] Wire `useTypeOn` in `VerdictHero.tsx` & `AutopsyReportCard.tsx` (`data-typeon-settled`, `data-typeon-progress`, `data-typeon-count`, `data-typeon-text` on `[data-testid="verdict-headline"]`) while keeping full DOM text children intact for SSR and `TreeWalker` tests.
- [ ] Create `e2e/motion-t18.spec.ts` verifying: (1) Landing $\to$ report view switch & lot switcher complete with `data-morph-state="settled"` in `< 450 ms` and zero blank frames; (2) skippable once-per-session probe sweep (`cal.sweep.v1`) and mid-sweep key skip; (3) cause-of-death type-on (`<= 1.5 s`) and 6-block verdict rise; (4) claim evidence stagger (`<= 600 ms`), finding expansion, thumbnail dim (`0.32`), segmented thumb slide, popover spring, and `0 ms` `Cmd-K` palette; (5) full `prefers-reduced-motion: reduce` instant path with zero transforms and zero console/page errors.
