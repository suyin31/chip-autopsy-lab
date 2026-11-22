import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_HOVER_LIFT_PX,
  computeOrderedGlowSchedule,
  computeProbeLightOpacity,
  computeProbeSweepFraction,
  computeStaggerDelayMs,
  computeVerdictRiseSchedule,
  evaluateGlowSequenceFrame,
  EVIDENCE_DIE_FADE_MS,
  EVIDENCE_STAGGER_MAX_MS,
  EVIDENCE_STAGGER_WINDOW_MS,
  GLOW_DIE_FADE_DURATION_MS,
  GLOW_EXIT_DURATION_MS,
  GLOW_STAGGER_WINDOW_MS,
  GLOW_TOTAL_DURATION_MS,
  hasSeenSessionReveal,
  markSessionRevealSeen,
  MOTION_TOKENS,
  PANEL_ENTER_OFFSET_Y_PX,
  PANEL_SPRING_MAX_MS,
  PROBE_SWEEP_BUDGET_MS,
  PROBE_SWEEP_FAIL_FADE_MS,
  PROBE_SWEEP_REVEAL_MS,
  PROBE_SWEEP_SESSION_KEY,
  PROBE_SWEEP_TOTAL_MAX_MS,
  readPrefersReducedMotionSync,
  REDUCED_MOTION_FADE_MS,
  resolveInitialRevealMode,
  resolvePanelEnterMotion,
  resolvePopoverMotion,
  resolvePressScale,
  resolveSpringTransition,
  resolveViewMorphTransition,
  sampleStatCountUp,
  sampleTypeOnFrame,
  SCRIM_ENTER_DURATION_MS,
  type SessionStorageLike,
  SPRING_PHYSICS_EQUIVALENTS,
  SPRING_TOKENS,
  THUMB_DIM_OPACITY,
  THUMB_HOVER_SCALE,
  TYPE_ON_DEFAULT_MS,
  TYPE_ON_MAX_MS,
  useReducedMotionPreference,
  useSessionOnceGuard,
  useTypeOn,
  type UseTypeOnOptions,
  type UseTypeOnResult,
  VERDICT_REVEAL_SETTLE_MS,
  VERDICT_RISE_BLOCK_ORDER,
  VERDICT_RISE_OFFSET_PX,
  VERDICT_RISE_STAGGER_MS,
  VIEW_SWITCH_MAX_MS,
  WAFER_MORPH_LAYOUT_ID,
  WORKSPACE_LAYOUT_GROUP_ID,
} from './index';
import { PANEL_ENTER_MS, PANEL_ENTER_SCALE } from './tokens';

function createMemorySessionStorage(
  initial: Record<string, string> = {},
): SessionStorageLike & { readonly store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

describe('Task 18 Motion Core (`src/ui/motion/`)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('1. Motion tokens & physics bounds (`tokens.ts`)', () => {
    it('enforces exact Task 18 ceiling bounds and critically-damped UI springs (bounce === 0)', () => {
      expect(WAFER_MORPH_LAYOUT_ID).toBe('cal-wafer-disc-morph');
      expect(WORKSPACE_LAYOUT_GROUP_ID).toBe('cal-workspace-layout');

      expect(VIEW_SWITCH_MAX_MS).toBeLessThanOrEqual(450);
      expect(PANEL_SPRING_MAX_MS).toBeLessThanOrEqual(400);
      expect(PROBE_SWEEP_BUDGET_MS).toBe(3000);
      expect(PROBE_SWEEP_TOTAL_MAX_MS).toBeLessThanOrEqual(1200);
      expect(
        PROBE_SWEEP_REVEAL_MS + PROBE_SWEEP_FAIL_FADE_MS,
      ).toBeLessThanOrEqual(PROBE_SWEEP_TOTAL_MAX_MS);

      expect(TYPE_ON_DEFAULT_MS).toBe(480);
      expect(TYPE_ON_MAX_MS).toBeLessThanOrEqual(1500);
      expect(TYPE_ON_DEFAULT_MS).toBeLessThanOrEqual(TYPE_ON_MAX_MS);

      expect(EVIDENCE_STAGGER_WINDOW_MS).toBe(420);
      expect(EVIDENCE_DIE_FADE_MS).toBe(180);
      expect(EVIDENCE_STAGGER_MAX_MS).toBeLessThanOrEqual(600);
      expect(
        EVIDENCE_STAGGER_WINDOW_MS + EVIDENCE_DIE_FADE_MS,
      ).toBeLessThanOrEqual(EVIDENCE_STAGGER_MAX_MS);

      expect(GLOW_STAGGER_WINDOW_MS).toBe(EVIDENCE_STAGGER_WINDOW_MS);
      expect(GLOW_DIE_FADE_DURATION_MS).toBe(EVIDENCE_DIE_FADE_MS);
      expect(GLOW_TOTAL_DURATION_MS).toBe(EVIDENCE_STAGGER_MAX_MS);
      expect(GLOW_EXIT_DURATION_MS).toBe(160);
      expect(SCRIM_ENTER_DURATION_MS).toBe(200);

      expect(PANEL_ENTER_OFFSET_Y_PX).toBe(16);
      expect(PANEL_ENTER_SCALE).toBe(0.985);
      expect(PANEL_ENTER_MS).toBe(420);
      expect(CARD_HOVER_LIFT_PX).toBe(-2);
      expect(THUMB_HOVER_SCALE).toBe(1.06);
      expect(THUMB_DIM_OPACITY).toBe(0.32);

      // No UI spring ever bounces (premium §1.3 item 6, §3.12)
      expect(SPRING_TOKENS.ui).toEqual({
        type: 'spring',
        duration: 0.35,
        bounce: 0,
      });
      expect(SPRING_TOKENS.snappy).toEqual({
        type: 'spring',
        duration: 0.22,
        bounce: 0,
      });
      expect(SPRING_TOKENS.ui.duration * 1000).toBeLessThan(VIEW_SWITCH_MAX_MS);
      expect(SPRING_TOKENS.ui.duration * 1000).toBeLessThanOrEqual(
        PANEL_SPRING_MAX_MS,
      );
      expect(SPRING_TOKENS.snappy.duration * 1000).toBeLessThanOrEqual(
        PANEL_SPRING_MAX_MS,
      );

      expect(SPRING_PHYSICS_EQUIVALENTS.ui).toEqual({
        stiffness: 320,
        damping: 36,
        mass: 1,
      });
      expect(SPRING_PHYSICS_EQUIVALENTS.snappy).toEqual({
        stiffness: 810,
        damping: 57,
        mass: 1,
      });
    });

    it('resolves tactile press scales in normal motion and collapses to 1 under reduced motion', () => {
      expect(resolvePressScale('button', false)).toBe(0.97);
      expect(resolvePressScale('card', false)).toBe(0.985);
      expect(resolvePressScale('row', false)).toBe(0.985);
      expect(resolvePressScale('icon', false)).toBe(0.94);
      expect(resolvePressScale('thumbnail', false)).toBe(0.94);

      expect(resolvePressScale('button', true)).toBe(1);
      expect(resolvePressScale('card', true)).toBe(1);
      expect(resolvePressScale('row', true)).toBe(1);
      expect(resolvePressScale('icon', true)).toBe(1);
      expect(resolvePressScale('thumbnail', true)).toBe(1);
    });

    it('resolves UI/snappy springs, view morphs, panel enter motion, and popover motion across normal, instant, and reduced-motion paths', () => {
      expect(resolveSpringTransition('ui', false)).toEqual(SPRING_TOKENS.ui);
      expect(resolveSpringTransition('snappy', false)).toEqual(
        SPRING_TOKENS.snappy,
      );
      expect(resolveSpringTransition('ui', true)).toEqual({ duration: 0 });
      expect(resolveSpringTransition('snappy', true)).toEqual({ duration: 0 });
      expect(resolveSpringTransition('snappy', false, true)).toEqual({
        duration: 0,
      });

      expect(resolveViewMorphTransition(false)).toEqual(SPRING_TOKENS.ui);
      expect(resolveViewMorphTransition(true)).toEqual({ duration: 0 });

      const panelNormal = resolvePanelEnterMotion(false, 2, 60);
      expect(panelNormal).toEqual({
        initial: { opacity: 0, y: 16, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: {
          duration: 0.42,
          ease: MOTION_TOKENS.easeOutTuple,
          delay: 0.12,
        },
      });

      const panelReduced = resolvePanelEnterMotion(true, 2, 60);
      expect(panelReduced).toEqual({
        initial: false,
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0 },
      });

      // Popover pointer open (normal motion)
      const popNormal = resolvePopoverMotion({ reducedMotion: false });
      expect(popNormal).toEqual({
        initial: { opacity: 0, scale: 0.97 },
        animate: {
          opacity: 1,
          scale: 1,
          transition: SPRING_TOKENS.ui,
        },
        exit: {
          opacity: 0,
          transition: {
            duration: MOTION_TOKENS.dur2Ms / 1000,
            ease: MOTION_TOKENS.easeOutTuple,
          },
        },
      });

      // Popover custom scaleFrom (e.g. 0.96 for magnifier / selection popover)
      const popCustomScale = resolvePopoverMotion({
        reducedMotion: false,
        scaleFrom: 0.96,
      });
      expect(popCustomScale.initial).toEqual({ opacity: 0, scale: 0.96 });

      // Popover keyboard/instant open (0 ms)
      const popInstant = resolvePopoverMotion({
        reducedMotion: false,
        instant: true,
      });
      expect(popInstant).toEqual({
        initial: { opacity: 1, scale: 1 },
        animate: { opacity: 1, scale: 1, transition: { duration: 0 } },
        exit: { opacity: 0, transition: { duration: 0 } },
      });

      // Popover reduced-motion open (120 ms opacity-only, scale: 1)
      const popReduced = resolvePopoverMotion({ reducedMotion: true });
      expect(popReduced).toEqual({
        initial: { opacity: 0, scale: 1 },
        animate: {
          opacity: 1,
          scale: 1,
          transition: { duration: 0.12, ease: 'linear' },
        },
        exit: {
          opacity: 0,
          transition: { duration: 0.12, ease: 'linear' },
        },
      });
    });
  });

  describe('2. Session-once guard, stagger math, and reveal re-exports (`reveal.ts`)', () => {
    it('reads and writes sessionStorage["cal.sweep.v1"] safely across memory, null, and throwing storage', () => {
      const storage = createMemorySessionStorage();
      expect(hasSeenSessionReveal(PROBE_SWEEP_SESSION_KEY, storage)).toBe(
        false,
      );

      markSessionRevealSeen(PROBE_SWEEP_SESSION_KEY, storage);
      expect(storage.store.get('cal.sweep.v1')).toBe('1');
      expect(hasSeenSessionReveal(PROBE_SWEEP_SESSION_KEY, storage)).toBe(true);

      // Custom key
      expect(hasSeenSessionReveal('cal.custom.v1', storage)).toBe(false);
      markSessionRevealSeen('cal.custom.v1', storage);
      expect(hasSeenSessionReveal('cal.custom.v1', storage)).toBe(true);

      // Explicit null storage (or SSR without window)
      expect(hasSeenSessionReveal(PROBE_SWEEP_SESSION_KEY, null)).toBe(false);
      expect(() =>
        markSessionRevealSeen(PROBE_SWEEP_SESSION_KEY, null),
      ).not.toThrow();

      // Throwing storage (e.g. sandboxed iframe SecurityError / QuotaExceededError)
      const throwingStorage: SessionStorageLike = {
        getItem() {
          throw new Error('SecurityError');
        },
        setItem() {
          throw new Error('QuotaExceededError');
        },
      };
      expect(
        hasSeenSessionReveal(PROBE_SWEEP_SESSION_KEY, throwingStorage),
      ).toBe(false);
      expect(() =>
        markSessionRevealSeen(PROBE_SWEEP_SESSION_KEY, throwingStorage),
      ).not.toThrow();
    });

    it('computes stagger delays within [0, maxWindowMs] and returns 0 under reducedMotion or total <= 1', () => {
      expect(computeStaggerDelayMs(0, 1, 420, false)).toBe(0);
      expect(computeStaggerDelayMs(0, 0, 420, false)).toBe(0);
      expect(computeStaggerDelayMs(3, 10, 420, true)).toBe(0);

      expect(computeStaggerDelayMs(0, 5, 420, false)).toBe(0);
      expect(computeStaggerDelayMs(2, 5, 420, false)).toBeCloseTo(210, 6);
      expect(computeStaggerDelayMs(4, 5, 420, false)).toBeCloseTo(420, 6);

      // Clamps out-of-range indices cleanly to [0, total - 1]
      expect(computeStaggerDelayMs(-4, 5, 420, false)).toBe(0);
      expect(computeStaggerDelayMs(99, 5, 420, false)).toBeCloseTo(420, 6);
    });

    it('re-exports probe-sweep, verdict-rise, and ordered-glow symbols from reveal.ts', () => {
      expect(REDUCED_MOTION_FADE_MS).toBe(120);
      expect(VERDICT_RISE_STAGGER_MS).toBe(60);
      expect(VERDICT_RISE_OFFSET_PX).toBe(12);
      expect(VERDICT_REVEAL_SETTLE_MS).toBe(780);
      expect(VERDICT_RISE_BLOCK_ORDER).toEqual([
        'headline',
        'subline',
        'confidence',
        'stats',
        'findings',
        'causes',
      ]);
      expect(typeof computeProbeSweepFraction).toBe('function');
      expect(typeof computeProbeLightOpacity).toBe('function');
      expect(typeof resolveInitialRevealMode).toBe('function');
      expect(typeof computeVerdictRiseSchedule).toBe('function');
      expect(typeof sampleStatCountUp).toBe('function');
      expect(typeof readPrefersReducedMotionSync).toBe('function');
      expect(typeof computeOrderedGlowSchedule).toBe('function');
      expect(typeof evaluateGlowSequenceFrame).toBe('function');
    });
  });

  describe('3. Codepoint-safe cause-of-death type-on sampler (`sampleTypeOnFrame`)', () => {
    it('progresses monotonically from 0 to totalCount over durationMs and settles at >= durationMs', () => {
      const headline = 'Cause of death: Edge-Ring failure.';
      const expectedCodepoints = Array.from(headline).length;

      const atZero = sampleTypeOnFrame({
        text: headline,
        elapsedMs: 0,
        durationMs: 480,
      });
      expect(atZero).toEqual({
        visibleText: '',
        visibleCount: 0,
        totalCount: expectedCodepoints,
        progress: 0,
        settled: false,
      });

      let prevCount = 0;
      let prevProgress = 0;
      for (let t = 20; t < 480; t += 20) {
        const frame = sampleTypeOnFrame({
          text: headline,
          elapsedMs: t,
          durationMs: 480,
        });
        expect(frame.settled).toBe(false);
        expect(frame.progress).toBeGreaterThanOrEqual(prevProgress);
        expect(frame.progress).toBeLessThan(1);
        expect(frame.visibleCount).toBeGreaterThanOrEqual(prevCount);
        expect(frame.visibleCount).toBeLessThanOrEqual(expectedCodepoints);
        expect(headline.startsWith(frame.visibleText)).toBe(true);
        prevCount = frame.visibleCount;
        prevProgress = frame.progress;
      }

      const atEnd = sampleTypeOnFrame({
        text: headline,
        elapsedMs: 480,
        durationMs: 480,
      });
      expect(atEnd).toEqual({
        visibleText: headline,
        visibleCount: expectedCodepoints,
        totalCount: expectedCodepoints,
        progress: 1,
        settled: true,
      });
    });

    it('never splits UTF-16 surrogate pairs or CJK characters and clamps durationMs to [1, TYPE_ON_MAX_MS]', () => {
      const cjkAndAstral = '死因：🧪 Edge-Ring 𠀋 故障。';
      const codepoints = Array.from(cjkAndAstral);
      expect(cjkAndAstral.length).toBeGreaterThan(codepoints.length);

      for (let t = 0; t <= 600; t += 30) {
        const frame = sampleTypeOnFrame({
          text: cjkAndAstral,
          elapsedMs: t,
          durationMs: 600,
        });
        expect(frame.totalCount).toBe(codepoints.length);
        expect(Array.from(frame.visibleText)).toHaveLength(frame.visibleCount);
        // No lone surrogate halves (U+D800..U+DFFF)
        expect(frame.visibleText).not.toMatch(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
        );
      }

      // Clamped ceiling: durationMs > TYPE_ON_MAX_MS (1500) must still settle at 1500 ms
      const clampedToMax = sampleTypeOnFrame({
        text: cjkAndAstral,
        elapsedMs: TYPE_ON_MAX_MS,
        durationMs: 9000,
      });
      expect(clampedToMax.settled).toBe(true);
      expect(clampedToMax.progress).toBe(1);
      expect(clampedToMax.visibleText).toBe(cjkAndAstral);

      // Reduced motion and skipped paths settle at frame 0
      expect(
        sampleTypeOnFrame({
          text: cjkAndAstral,
          elapsedMs: 0,
          durationMs: 480,
          reducedMotion: true,
        }),
      ).toEqual({
        visibleText: cjkAndAstral,
        visibleCount: codepoints.length,
        totalCount: codepoints.length,
        progress: 1,
        settled: true,
      });

      expect(
        sampleTypeOnFrame({
          text: cjkAndAstral,
          elapsedMs: 10,
          durationMs: 480,
          skipped: true,
        }),
      ).toEqual({
        visibleText: cjkAndAstral,
        visibleCount: codepoints.length,
        totalCount: codepoints.length,
        progress: 1,
        settled: true,
      });
    });
  });

  describe('4. SSR & client hooks (`useTypeOn`, `useReducedMotionPreference`, `useSessionOnceGuard`)', () => {
    function TypeOnProbe(props: {
      readonly options: UseTypeOnOptions;
      readonly onCapture?: (result: UseTypeOnResult) => void;
    }): React.ReactElement {
      const typeOn = useTypeOn(props.options);
      const reducedPref = useReducedMotionPreference();
      const sessionGuard = useSessionOnceGuard();
      props.onCapture?.(typeOn);
      return React.createElement(
        'h1',
        {
          'data-testid': 'verdict-headline',
          'data-typeon-settled': typeOn.settled ? 'true' : 'false',
          'data-typeon-progress': typeOn.progress.toFixed(2),
          'data-typeon-count': String(typeOn.visibleCount),
          'data-typeon-text': typeOn.visibleText,
          'data-reduced-pref': reducedPref ? 'true' : 'false',
          'data-session-seen': sessionGuard.seen ? 'true' : 'false',
        },
        props.options.text,
      );
    }

    it('renders full settled text during SSR (`typeof window === "undefined"`) while preserving DOM text children', () => {
      const text = 'Cause of death: Edge-Ring failure.';
      const captured: UseTypeOnResult[] = [];
      const html = renderToStaticMarkup(
        React.createElement(TypeOnProbe, {
          options: {
            text,
            durationMs: TYPE_ON_DEFAULT_MS,
            enabled: true,
            completed: false,
            reducedMotion: false,
            playKey: 'lot-1',
          },
          onCapture: (res) => {
            captured.push(res);
          },
        }),
      );

      expect(html).toContain('data-typeon-settled="true"');
      expect(html).toContain('data-typeon-progress="1.00"');
      expect(html).toContain(`data-typeon-count="${Array.from(text).length}"`);
      expect(html).toContain(`data-typeon-text="${text}"`);
      expect(html).toContain(`>${text}</h1>`);
      expect(captured).toHaveLength(1);
      expect(typeof captured[0]?.skip).toBe('function');
    });

    it('starts unsettled at frame 0 on a normal-motion client window and settles immediately when reducedMotion or completed is true', () => {
      const memoryStorage = createMemorySessionStorage();
      let mediaReduceMatches = false;

      vi.stubGlobal('window', {
        sessionStorage: memoryStorage,
        matchMedia: (query: string) => ({
          matches:
            query.includes('prefers-reduced-motion') && mediaReduceMatches,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => undefined,
        setTimeout: () => 1,
        clearTimeout: () => undefined,
      });

      const text = 'Cause of death: Scratch failure.';

      // 1. Normal client frame 0 (enabled: true, completed: false, reducedMotion: false)
      const normalFrame0Html = renderToStaticMarkup(
        React.createElement(TypeOnProbe, {
          options: {
            text,
            durationMs: TYPE_ON_DEFAULT_MS,
            enabled: true,
            completed: false,
            reducedMotion: false,
            playKey: 'scratch-1',
          },
        }),
      );
      expect(normalFrame0Html).toContain('data-typeon-settled="false"');
      expect(normalFrame0Html).toContain('data-typeon-progress="0.00"');
      expect(normalFrame0Html).toContain('data-typeon-count="0"');
      expect(normalFrame0Html).toContain('data-session-seen="false"');
      expect(normalFrame0Html).toContain(`>${text}</h1>`);

      // 2. Client with completed: true (user interrupted via pointer/key) -> instant settled at frame 0
      const completedHtml = renderToStaticMarkup(
        React.createElement(TypeOnProbe, {
          options: {
            text,
            durationMs: TYPE_ON_DEFAULT_MS,
            enabled: true,
            completed: true,
            reducedMotion: false,
            playKey: 'scratch-1',
          },
        }),
      );
      expect(completedHtml).toContain('data-typeon-settled="true"');
      expect(completedHtml).toContain('data-typeon-progress="1.00"');
      expect(completedHtml).toContain(
        `data-typeon-count="${Array.from(text).length}"`,
      );

      // 3. Client with prefers-reduced-motion: reduce via matchMedia -> instant settled at frame 0
      mediaReduceMatches = true;
      markSessionRevealSeen(PROBE_SWEEP_SESSION_KEY);
      const reducedClientHtml = renderToStaticMarkup(
        React.createElement(TypeOnProbe, {
          options: {
            text,
            durationMs: TYPE_ON_DEFAULT_MS,
            enabled: true,
            completed: false,
            playKey: 'scratch-2',
          },
        }),
      );
      expect(reducedClientHtml).toContain('data-reduced-pref="true"');
      expect(reducedClientHtml).toContain('data-session-seen="true"');
      expect(reducedClientHtml).toContain('data-typeon-settled="true"');
      expect(reducedClientHtml).toContain('data-typeon-progress="1.00"');
    });
  });
});
