'use client';

import { ArrowUpRight } from 'lucide-react';
import {
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import * as React from 'react';
import { Untranslated, useT } from '@/ui/i18n';
import { LANDING_EXAMPLE_EDGE_SHARE } from '@/ui/layout/landing-layout';
import {
  SPRING_STAGE_3D,
  STAGE_3D_MAX_TILT_DEG,
  STAGE_3D_PERSPECTIVE_PX,
  STAGE_3D_REST,
  useReducedMotionPreference,
} from '@/ui/motion';
import { Button, cn, CountUp } from '@/ui/primitives';
import { BorderBeam } from './BorderBeam';
import { ProbeTraceCanvas } from './ProbeTraceCanvas';
import { useProximityRim } from './ProximityPlate';

export interface ExplodedAutopsyStageProps {
  readonly disabled: boolean;
  readonly heroSectionRef: React.RefObject<HTMLDivElement | null>;
  readonly onOpenSample: () => void;
  /** Compact data-scale wafer plot embedded inside the multi-view telemetry deck (never a giant hero disc). */
  readonly compactDataPlot: React.ReactNode;
}

const FACT_PERCENT_SLOT = '\u0000';

const DESKTOP_3D_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

function subscribeDesktop3D(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(DESKTOP_3D_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getDesktop3DSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(DESKTOP_3D_QUERY).matches;
}

function StageScrollConnector({
  targetRef,
  progress,
}: {
  readonly targetRef: React.RefObject<HTMLDivElement | null>;
  readonly progress: MotionValue<number>;
}): null {
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ['start start', 'end start'],
  });

  React.useLayoutEffect(() => {
    const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    progress.set(clamp(scrollYProgress.get()));
    const unsub = scrollYProgress.on('change', (latest) => {
      progress.set(clamp(latest));
    });
    return () => {
      unsub();
      progress.set(0);
    };
  }, [progress, scrollYProgress]);

  return null;
}

/**
 * Dual-Plane 3D Forensic Instrument Stage (`src/ui/atelier/ExplodedAutopsyStage.tsx`, UI v3).
 *
 * Streamlined from 4 stacked cards down to a clean, authoritative dual-plane rig
 * (`perspective: 1400px`, pointer tilt capped at `±4°`, flattening to `0°` on scroll):
 * - Frameless top STDF V4 binary stream eyebrow (`FAR · MIR · PTR · PRR` + `STDF V4 · 25W · 15,825D`)
 * - Z =   0px Main Obsidian Deck: Live Bin Pareto cascade + Live 2D Canvas `IDDQ_LEAK` Probe
 *   Oscilloscope (`Cpk 0.14`) + compact 84px data wafer plot
 * - Z = +48px Bottom-Left High-Elevation `Example result` Verdict Card (`93.8%` radial ring & leader line)
 */
export function ExplodedAutopsyStage({
  disabled,
  heroSectionRef,
  onOpenSample,
  compactDataPlot,
}: ExplodedAutopsyStageProps): React.JSX.Element {
  const { t, formatPercent } = useT();
  const reduced = useReducedMotionPreference();
  const desktop3D = React.useSyncExternalStore(
    subscribeDesktop3D,
    getDesktop3DSnapshot,
    () => false,
  );
  const enableLive3D = !reduced && desktop3D;

  const sceneRef = React.useRef<HTMLDivElement | null>(null);
  const deckRef = React.useRef<HTMLButtonElement | null>(null);
  const verdictCardRef = React.useRef<HTMLDivElement | null>(null);

  useProximityRim(verdictCardRef, { reachPx: 220 });

  const [hoveredDeck, setHoveredDeck] = React.useState(false);

  // Pointer normalized [-1, 1] -> spring-smoothed 3D rig angles capped at ±4° + scroll flattening
  const pointerNX = useMotionValue(0);
  const pointerNY = useMotionValue(0);
  const scrollProgress = useMotionValue(0);

  const smoothNX = useSpring(pointerNX, SPRING_STAGE_3D);
  const smoothNY = useSpring(pointerNY, SPRING_STAGE_3D);

  const rigRotateX = useTransform(
    [smoothNY, scrollProgress],
    ([ny, sp]: number[]) => {
      const flatten = 1 - Math.min(1, Math.max(0, sp ?? 0));
      return (STAGE_3D_REST.rotateX - (ny ?? 0) * STAGE_3D_MAX_TILT_DEG) * flatten;
    },
  );
  const rigRotateY = useTransform(
    [smoothNX, scrollProgress],
    ([nx, sp]: number[]) => {
      const flatten = 1 - Math.min(1, Math.max(0, sp ?? 0));
      return (STAGE_3D_REST.rotateY + (nx ?? 0) * STAGE_3D_MAX_TILT_DEG) * flatten;
    },
  );
  const rigRotateZ = useTransform(
    scrollProgress,
    [0, 1],
    [STAGE_3D_REST.rotateZ, 0],
  );
  const rigY = useTransform(scrollProgress, [0, 1], [0, 18]);

  // Subtle parallax counter-drift for the single foreground verdict card
  const floatCardX = useTransform(smoothNX, (nx) => nx * 6);
  const floatCardY = useTransform(
    [smoothNY, scrollProgress],
    ([ny, sp]: number[]) => (ny ?? 0) * 5 - (sp ?? 0) * 12,
  );

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!enableLive3D || event.pointerType === 'touch') return;
    const el = sceneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const nx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
    pointerNX.set(Number(nx.toFixed(3)));
    pointerNY.set(Number(ny.toFixed(3)));
  };

  const handlePointerLeave = (): void => {
    pointerNX.set(0);
    pointerNY.set(0);
    setHoveredDeck(false);
  };

  const patternName = 'Edge-Ring';
  const [titleBefore = '', titleAfter = ''] = t('verdict.pattern', {
    pattern: patternName,
  }).split(patternName);
  const [factBefore = '', factAfter = ''] = t('landing.example.fact', {
    percent: FACT_PERCENT_SLOT,
  }).split(FACT_PERCENT_SLOT);

  const ringRadius = 15.5;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - LANDING_EXAMPLE_EDGE_SHARE);

  // Even on SSR / before pointer movement, desktop renders with an unmistakable architectural 3D stance
  const staticRestRigStyle: React.CSSProperties | undefined = reduced
    ? undefined
    : {
        transform: `rotateX(${STAGE_3D_REST.rotateX}deg) rotateY(${STAGE_3D_REST.rotateY}deg) rotateZ(${STAGE_3D_REST.rotateZ}deg)`,
      };

  return (
    <div
      ref={sceneRef}
      data-testid="landing-hero"
      data-vt-scope="default"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={
        reduced
          ? undefined
          : { perspective: `${STAGE_3D_PERSPECTIVE_PX}px`, perspectiveOrigin: '52% 46%' }
      }
      className="at-scene-3d relative mt-4 flex w-full flex-col items-center justify-center py-2 sm:py-4 lg:mt-0 lg:min-h-[476px]"
    >
      {enableLive3D ? (
        <StageScrollConnector targetRef={heroSectionRef} progress={scrollProgress} />
      ) : null}

      {/* Ambient chromatic light pool beneath the 3D instrument rig */}
      <div
        aria-hidden="true"
        className="at-under-glow absolute inset-x-4 inset-y-6 z-0 rounded-full"
      />

      <motion.div
        data-testid="landing-hero-stage-3d"
        style={
          enableLive3D
            ? {
                rotateX: rigRotateX,
                rotateY: rigRotateY,
                rotateZ: rigRotateZ,
                y: rigY,
                transformStyle: 'preserve-3d',
              }
            : staticRestRigStyle
        }
        className="at-rig-3d relative z-[1] w-full max-w-[560px] max-lg:!transform-none"
      >
        {/* Frameless STDF V4 Binary Record Eyebrow Ruler (unboxed from Plane 1) */}
        <div
          aria-hidden="true"
          className="pointer-events-none mb-3 hidden flex-col gap-2 border-b border-hairline px-1 pb-2.5 sm:flex"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[12px] font-[500] text-text-secondary">
              <span className="at-dot-emerald at-live-pulse size-1.5 rounded-full" />
              <span>{t('landing.privacy')}</span>
            </span>
            <span className="flex items-center gap-1">
              {(['FAR', 'MIR', 'PTR', 'PRR'] as const).map((rec) => (
                <Untranslated key={rec} className="at-keycap-badge h-5 px-1.5 text-[10px]">
                  {rec}
                </Untranslated>
              ))}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-pill bg-fill-2">
              <div className="at-bar-iris h-full w-[86%] rounded-pill" />
            </div>
            <Untranslated className="font-mono text-[11px] text-text-tertiary tabular-nums">
              STDF V4 · 25W · 15,825D
            </Untranslated>
          </div>
        </div>

        {/* PLANE 1 (Z = 0px): Main Obsidian Forensic Console Deck */}
        <motion.button
          ref={deckRef}
          type="button"
          data-testid="landing-hero-deck"
          aria-label={t('landing.primary')}
          disabled={disabled}
          onClick={onOpenSample}
          onPointerEnter={() => setHoveredDeck(true)}
          onPointerLeave={() => setHoveredDeck(false)}
          whileTap={reduced || disabled ? undefined : { scale: 0.985 }}
          style={reduced ? undefined : { transform: 'translateZ(0px)' }}
          className={cn(
            'vt-route-stage at-obsidian-well group/deck relative block w-full cursor-pointer overflow-hidden rounded-[26px] p-4 text-left sm:p-5',
            'focus-visible:shadow-focus-ring focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          data-texture="dots"
        >
          <span aria-hidden="true" className="at-scanline" />
          <BorderBeam active={hoveredDeck} dual radius={26} size={120} durationS={3.8} />

          {/* Top Deck Instrument Header */}
          <div className="relative z-[1] flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
            <span className="flex items-center gap-2">
              <span className="at-dot-signal at-live-pulse size-2 rounded-full" />
              <Untranslated className="font-mono text-[12px] font-[500] tracking-[-0.01em] text-text-primary">
                CAL-ER-2401
              </Untranslated>
              <span className="at-pill at-pill-signal h-5 px-2 text-[11px]">
                {t('demo.edgeRing.chip')}
              </span>
            </span>
            <span className="flex items-center gap-2 text-[12px] text-text-secondary tabular-nums">
              <span className="at-pill at-pill-emerald h-5 px-2 text-[11px]">
                <Untranslated>82.8%</Untranslated> {t('stats.finalYield')}
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 text-text-tertiary transition-transform duration-200 ease-[var(--ease-out)] group-hover/deck:translate-x-0.5 group-hover/deck:-translate-y-0.5 group-hover/deck:text-text-primary"
              />
            </span>
          </div>

          {/* 3-View Coordinated Forensic Readout (Pareto + Live Probe Oscilloscope + Compact Data Map) */}
          <div className="relative z-[1] mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:items-center">
            {/* View A: Bin Loss Cascade */}
            <div className="rounded-2xl bg-fill-1 p-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11.5px] font-[500] text-text-secondary">
                  {t('pareto.title')}
                </span>
                <Untranslated className="shrink-0 font-mono text-[11px] text-text-tertiary tabular-nums">
                  SBIN
                </Untranslated>
              </div>
              <div className="mt-2.5 flex flex-col gap-2">
                {[
                  { code: 'SBIN 7', pct: '91.3%', w: '91%', cls: 'at-bar-signal' },
                  { code: 'SBIN 11', pct: '5.7%', w: '9%', cls: 'at-bar-iris' },
                  { code: 'SBIN 9', pct: '1.7%', w: '4%', cls: 'bg-fill-3' },
                ].map((bar, idx) => (
                  <div key={bar.code} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between text-[11px] tabular-nums">
                      <Untranslated className="font-mono text-text-primary">{bar.code}</Untranslated>
                      <Untranslated className="text-text-secondary">{bar.pct}</Untranslated>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-pill bg-fill-2">
                      <motion.div
                        initial={reduced ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{
                          duration: 0.65,
                          delay: 0.18 + idx * 0.08,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        style={{ width: bar.w, transformOrigin: 'left' }}
                        className={cn('h-full rounded-pill', bar.cls)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* View B: Live Parametric Probe Oscilloscope (IDDQ_LEAK Cpk 0.14) */}
            <div className="rounded-2xl bg-fill-1 p-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11.5px] font-[500] text-text-secondary">
                  {t('parametric.title')}
                </span>
                <Untranslated className="shrink-0 font-mono text-[11px] whitespace-nowrap text-text-primary tabular-nums">
                  Cpk 0.14
                </Untranslated>
              </div>
              <ProbeTraceCanvas
                mode="single"
                channelIndex={1}
                height={54}
                className="mt-2"
                data-testid="landing-hero-probe-trace"
              />
              <div className="mt-1 flex items-center justify-between text-[10.5px] text-text-tertiary tabular-nums">
                <Untranslated className="truncate font-mono">IDDQ_LEAK</Untranslated>
                <Untranslated className="font-mono">HI 15 uA</Untranslated>
              </div>
            </div>

            {/* View C: Compact Data-Scale Wafer Plot (strictly data sub-view, 84px) */}
            <div className="flex flex-col items-center justify-center gap-1.5 self-stretch rounded-2xl bg-fill-1 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--hairline)]">
              <div className="relative flex items-center justify-center rounded-full p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
                {compactDataPlot}
              </div>
              <Untranslated className="font-mono text-[10.5px] text-text-tertiary tabular-nums">
                W01 · 633d
              </Untranslated>
            </div>
          </div>
        </motion.button>

        {/* PLANE 2 (Z = +48px): Floating High-Elevation `Example result` Verdict Card (Bottom Left) */}
        <motion.div
          ref={verdictCardRef}
          data-testid="landing-example-card"
          data-vt="verdict"
          style={
            enableLive3D
              ? {
                  x: floatCardX,
                  y: floatCardY,
                  z: 48,
                }
              : reduced
                ? undefined
                : { transform: 'translateZ(48px)' }
          }
          className="at-float-card relative z-[5] mt-3 w-full p-4 text-left sm:mt-4 sm:w-[348px] lg:-mt-7 lg:-ml-2 lg:w-[320px] xl:-ml-6 xl:w-[348px] max-lg:!transform-none"
        >
          {/* SVG Leader Line connecting the floating verdict card back to the obsidian deck */}
          <svg
            aria-hidden="true"
            width="54"
            height="56"
            viewBox="0 0 54 56"
            className="pointer-events-none absolute -top-[52px] right-8 hidden lg:block"
          >
            {/* Ends on the capability curve, above the test-name label, so the dot covers no text */}
            <path d="M4 54 C 16 30, 34 14, 50 3" className="at-leader" />
            <circle cx="50" cy="3" r="2.5" className="at-leader-dot" />
          </svg>

          <div className="flex items-center justify-between gap-2">
            <p
              data-testid="landing-example-eyebrow"
              className="text-[12px] leading-[1.3] font-[500] tracking-[-0.005em] text-text-tertiary"
            >
              {t('landing.example.eyebrow')}
            </p>
            <Untranslated className="at-pill at-pill-iris h-5 px-2 font-mono text-[11px] tabular-nums">
              0.95
            </Untranslated>
          </div>

          <p
            data-testid="landing-example-title"
            className="mt-1.5 text-[24px] leading-[1.14] font-[540] tracking-[-0.024em] text-text-primary [font-family:var(--font-display)] sm:text-[26px]"
          >
            {titleBefore}
            <Untranslated>{patternName}</Untranslated>
            {titleAfter}
          </p>

          <div className="mt-2.5 flex items-center gap-3">
            {/* Radial 93.8% Edge-Ring Gauge */}
            <svg
              aria-hidden="true"
              width="40"
              height="40"
              viewBox="0 0 40 40"
              className="size-10 shrink-0 -rotate-90"
            >
              <circle
                cx="20"
                cy="20"
                r={ringRadius}
                fill="none"
                stroke="var(--fill-2)"
                strokeWidth="3.5"
              />
              <motion.circle
                cx="20"
                cy="20"
                r={ringRadius}
                fill="none"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                initial={reduced ? { strokeDashoffset: ringDashOffset } : { strokeDashoffset: ringCircumference }}
                animate={{ strokeDashoffset: ringDashOffset }}
                transition={{ duration: 0.85, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="at-stroke-signal"
              />
            </svg>

            <p
              data-testid="landing-example-fact"
              className="min-w-0 flex-1 text-[14px] leading-[1.42] text-text-secondary"
            >
              {factBefore}
              <CountUp
                value={LANDING_EXAMPLE_EDGE_SHARE}
                format={formatPercent}
                data-testid="landing-example-percent"
              />
              {factAfter}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5">
            <Button
              variant="text"
              data-testid="landing-example-action"
              onClick={onOpenSample}
              disabled={disabled}
            >
              {t('landing.example.action')}
            </Button>
            <ArrowUpRight
              aria-hidden="true"
              className="size-3.5 text-text-tertiary"
              strokeWidth={1.75}
            />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
