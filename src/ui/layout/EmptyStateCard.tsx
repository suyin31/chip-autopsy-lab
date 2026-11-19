'use client';

import { Download } from 'lucide-react';
import { animate, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import {
  DEMO_DIES_PER_WAFER,
  DEMO_WAFER_COUNT,
  type DemoPresetId,
  type DemoPresetMeta,
  getDemoPresetPreview,
  getDemoStdfFileName,
} from '@/core/demo';
import { isCjkLocale, type MessageKey } from '@/core/i18n';
import type { ParseFatalError } from '@/core/stdf';
import { Untranslated, useT } from '@/ui/i18n';
import {
  resolvePressScale,
  resolveViewMorphTransition,
  useReducedMotionPreference,
  WAFER_MORPH_LAYOUT_ID,
} from '@/ui/motion';
import {
  Button,
  cn,
  CountUp,
  renderAccentPhrase,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives';
import { MOTION_TOKENS, SPRING_TOKENS, WAFER_TOKENS } from '@/ui/tokens';
import {
  buildWaferDiscMaskImage,
  computeSheenEllipseRestStyle,
  computeStageDiscLayerRects,
  type StageLayerRect,
} from '@/ui/wafer-map/stage-layers';
import {
  canSheenFollow,
  computeSheenTarget,
  createSheenFollower,
  readSheenFollowEnvironment,
  SHEEN_CARD_AMPLITUDE_D,
  SHEEN_REST,
} from '@/ui/wafer-map/sheen-motion';
import { usePrefersMoreContrast } from '@/ui/wafer-map/use-prefers-more-contrast';
import {
  computeLandingCardWaferRadiusPx,
  paintLandingCardWafer,
  resolveCanvasPixelSize,
} from '@/ui/wafer-map/wafer-geometry';
import { ErrorDetailsSheet } from './ErrorDetailsSheet';
import {
  computeLandingReticleTickLines,
  LANDING_EXAMPLE_EDGE_SHARE,
  LANDING_HERO_WAFER_SIZE_DEFAULT,
  LANDING_RETICLE_GAP_PX,
  LANDING_WAFER_SIZE_DEFAULT,
  resolveLandingHeroWaferSize,
  resolveLandingWaferSize,
} from './landing-layout';
import { renderWithUntranslatedTokens } from '@/ui/report/render-untranslated';
import { resolveParseErrorViewModel } from './parse-error-copy';

export type EmptyStateCause = 'first-run' | 'parse-failed' | 'no-results';

export interface EmptyStateCardProps {
  readonly cause?: EmptyStateCause;
  readonly presets: readonly DemoPresetMeta[];
  readonly selectedPresetId: DemoPresetId;
  readonly onSelectPreset: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot: (presetId: DemoPresetId) => void;
  readonly onDownloadDemoLot?: (presetId: DemoPresetId) => void;
  readonly downloadingPresetId?: DemoPresetId | null;
  readonly onSelectFile: (file: File) => void;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
  ) => Promise<ImageBitmap | null>;
  readonly parseError?: {
    readonly error: ParseFatalError;
    readonly fileName?: string;
  } | null;
  readonly activeFilterSummary?: string;
  readonly onClearFilters?: () => void;
  readonly disabled?: boolean;
}

const DEMO_CARD_COPY_KEYS = {
  'edge-ring-etch': {
    title: 'demo.edgeRing.title',
    description: 'demo.edgeRing.description',
    chip: 'demo.edgeRing.chip',
  },
  'handling-scratch': {
    title: 'demo.scratch.title',
    description: 'demo.scratch.description',
    chip: 'demo.scratch.chip',
  },
  'site2-probe-contact': {
    title: 'demo.site2.title',
    description: 'demo.site2.description',
    chip: 'demo.site2.chip',
  },
} as const satisfies Record<
  DemoPresetId,
  {
    readonly title: MessageKey;
    readonly description: MessageKey;
    readonly chip: MessageKey;
  }
>;

function subscribeViewportWidth(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/** A viewport-dependent size (premium §6.1, §11.1); `fallback` on the server and first paint. */
function useViewportSize(
  resolve: (viewportWidth: number) => number,
  fallback: number,
): number {
  return React.useSyncExternalStore(
    subscribeViewportWidth,
    () => resolve(window.innerWidth),
    () => fallback,
  );
}

function subscribeNever(): () => void {
  return () => {};
}

/** False on the server and during hydration, true after; the server snapshot sizes for 1440. */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function layerStyle(rect: StageLayerRect): React.CSSProperties {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

/**
 * Premium §8.11 landing variant: while the wafer's button (card or hero) is hovered by a mouse
 * or pen, the sheen ellipse follows the pointer at 0.03 D on `spring-sheen`; it returns to rest
 * on leave. Native listeners and one `transform` write per moving frame, no React render.
 */
function useLandingSheenFollow(
  frameRef: React.RefObject<HTMLDivElement | null>,
  sheenRef: React.RefObject<HTMLDivElement | null>,
  ellipseRef: React.RefObject<HTMLDivElement | null>,
): void {
  React.useEffect(() => {
    const frame = frameRef.current;
    const host: HTMLElement | null = frame?.closest('button') ?? frame;
    if (!host) {
      return;
    }
    const follower = createSheenFollower({
      write: (transform) => {
        if (ellipseRef.current) {
          ellipseRef.current.style.transform = transform;
        }
      },
      requestFrame: (cb) => window.requestAnimationFrame(cb),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
    });
    const onMove = (event: PointerEvent): void => {
      const sheen = sheenRef.current;
      const env = readSheenFollowEnvironment();
      const disabled = host instanceof HTMLButtonElement && host.disabled;
      if (!sheen || disabled || !canSheenFollow(event.pointerType, env)) {
        if (env.reducedMotion || env.reducedTransparency) {
          follower.snapToRest();
        }
        return;
      }
      const r = sheen.getBoundingClientRect();
      follower.setTarget(
        computeSheenTarget(
          event.clientX,
          event.clientY,
          r.left + r.width / 2,
          r.top + r.height / 2,
          r.width / 2,
          SHEEN_CARD_AMPLITUDE_D,
        ),
      );
    };
    const onLeave = (): void => follower.setTarget(SHEEN_REST);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      follower.dispose();
    };
  }, [frameRef, sheenRef, ellipseRef]);
}

interface LandingWaferDiscProps {
  readonly presetId: DemoPresetId;
  readonly size: number;
  /** Test ID for a layer (`undefined` is the canvas). */
  readonly testId: (
    part?: 'frame' | 'contact' | 'ambient' | 'halo' | 'sheen' | 'sheen-ellipse',
  ) => string;
  /**
   * Hero wafer (premium §11.1): full §5 disc material with the thin film and the stage shadows
   * (light ambient + contact, dark halo). Card wafers keep the §5.3 thumbnail rules.
   */
  readonly hero?: boolean;
  /** Enables the shared-element wafer morph (`WAFER_MORPH_LAYOUT_ID`) on the active demo card. */
  readonly enableSharedMorph?: boolean;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
  ) => Promise<ImageBitmap | null>;
}

function LandingWaferDisc({
  presetId,
  size,
  testId,
  hero = false,
  enableSharedMorph = false,
  renderWorkerThumbnail,
}: LandingWaferDiscProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const sheenRef = React.useRef<HTMLDivElement | null>(null);
  const sheenEllipseRef = React.useRef<HTMLDivElement | null>(null);
  useLandingSheenFollow(frameRef, sheenRef, sheenEllipseRef);
  const preview = React.useMemo(
    () => getDemoPresetPreview(presetId),
    [presetId],
  );
  const highContrast = usePrefersMoreContrast();

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const dpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dims = resolveCanvasPixelSize(size, size, dpr);
    if (canvas.width !== dims.pixelWidth) {
      canvas.width = dims.pixelWidth;
    }
    if (canvas.height !== dims.pixelHeight) {
      canvas.height = dims.pixelHeight;
    }
    paintLandingCardWafer(ctx, {
      wafer: preview.wafer,
      dies: preview.dies,
      cssSize: size,
      dpr: dims.dpr,
      highContrast,
      thinFilm: hero,
    });

    // The worker thumbnail mirrors the card rules (no thin film), so the hero stays on the main-thread paint
    if (!renderWorkerThumbnail || hero) {
      return;
    }
    let cancelled = false;
    void renderWorkerThumbnail(
      presetId,
      size,
      dims.dpr,
      highContrast,
    )
      .then((bitmap) => {
        if (!bitmap) {
          return;
        }
        if (cancelled || !canvasRef.current) {
          bitmap.close();
          return;
        }
        const liveCtx = canvasRef.current.getContext('2d');
        if (liveCtx) {
          liveCtx.setTransform(1, 0, 0, 1, 0, 0);
          liveCtx.clearRect(
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height,
          );
          liveCtx.drawImage(
            bitmap,
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height,
          );
        }
        bitmap.close();
      })
      .catch(() => {
        // Synchronous preview already rendered on canvas.
      });

    return () => {
      cancelled = true;
    };
  }, [presetId, preview, renderWorkerThumbnail, highContrast, size, hero]);

  const center = size / 2;
  const layers = computeStageDiscLayerRects(
    center,
    center,
    computeLandingCardWaferRadiusPx(size),
  );
  const discMaskImage = buildWaferDiscMaskImage(preview.wafer.geometry.wfFlat);

  // premium §6.1: 152 / 140 / 120 / 112 px card disc with its contact shadow (light); §11.1: the
  // 320 / 280 / 240 / 220 px hero disc with the stage shadows (light ambient + contact, dark halo);
  // both with the §5.2 step 6 sheen at rest, masked to the notch-cut disc
  return (
    <div
      ref={frameRef}
      data-testid={testId('frame')}
      style={{ width: `${size}px`, height: `${size}px` }}
      className="relative shrink-0"
    >
      {enableSharedMorph ? (
        <motion.div
          aria-hidden="true"
          data-testid="wafer-shared-morph"
          data-morph-state="ready"
          layoutId={reduced ? undefined : WAFER_MORPH_LAYOUT_ID}
          transition={resolveViewMorphTransition(reduced)}
          className="pointer-events-none absolute inset-0 rounded-full"
        />
      ) : null}
      {hero ? (
        <div
          aria-hidden="true"
          data-testid={testId('ambient')}
          style={{
            ...layerStyle(layers.ambient),
            backgroundImage: WAFER_TOKENS.ambientShadow,
          }}
          className="pointer-events-none absolute dark:hidden"
        />
      ) : null}
      <div
        aria-hidden="true"
        data-testid={testId('contact')}
        style={{
          ...layerStyle(layers.contact),
          backgroundImage: WAFER_TOKENS.contactShadow,
        }}
        className="pointer-events-none absolute dark:hidden"
      />
      {hero ? (
        <div
          aria-hidden="true"
          data-testid={testId('halo')}
          style={{
            ...layerStyle(layers.halo),
            backgroundImage: WAFER_TOKENS.halo,
          }}
          className="pointer-events-none absolute hidden dark:block"
        />
      ) : null}
      <canvas
        ref={canvasRef}
        data-testid={testId()}
        aria-hidden="true"
        style={{ width: `${size}px`, height: `${size}px` }}
        className="pointer-events-none relative block select-none"
      />
      <div
        ref={sheenRef}
        aria-hidden="true"
        data-testid={testId('sheen')}
        style={{
          ...layerStyle(layers.sheen),
          maskImage: discMaskImage,
          WebkitMaskImage: discMaskImage,
          maskSize: '100% 100%',
          WebkitMaskSize: '100% 100%',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        }}
        className="wafer-sheen pointer-events-none absolute overflow-hidden rounded-full mix-blend-screen"
      >
        <div
          ref={sheenEllipseRef}
          data-testid={testId('sheen-ellipse')}
          style={{
            ...computeSheenEllipseRestStyle(),
            backgroundImage: WAFER_TOKENS.sheen,
          }}
          className="absolute mix-blend-screen"
        />
      </div>
    </div>
  );
}

interface DemoLotCardButtonProps {
  readonly presetId: DemoPresetId;
  readonly isSelected: boolean;
  readonly disabled: boolean;
  readonly onSelectPreset: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot: (presetId: DemoPresetId) => void;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
  ) => Promise<ImageBitmap | null>;
}

function DemoLotCardButton({
  presetId,
  isSelected,
  disabled,
  onSelectPreset,
  onLoadDemoLot,
  renderWorkerThumbnail,
}: DemoLotCardButtonProps): React.JSX.Element {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const reduced = Boolean(shouldReduceMotion);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const pressedRef = React.useRef(false);
  const descId = React.useId();

  const size = useViewportSize(
    resolveLandingWaferSize,
    LANDING_WAFER_SIZE_DEFAULT,
  );
  const keys = DEMO_CARD_COPY_KEYS[presetId];
  const title = t(keys.title);
  const chip = t(keys.chip);
  const description = t(keys.description);
  const meta = t('landing.cardMeta', {
    wafers: formatInteger(DEMO_WAFER_COUNT),
    dies: formatInteger(DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER),
  });

  const releasePress = React.useCallback((): void => {
    if (!pressedRef.current) {
      return;
    }
    pressedRef.current = false;
    const el = buttonRef.current;
    if (el && !reduced) {
      animate(el, { scale: 1 }, SPRING_TOKENS.snappy);
    }
  }, [reduced]);

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (event.button !== 0 || disabled) {
      return;
    }
    onSelectPreset(presetId);
    if (reduced || !buttonRef.current) {
      return;
    }
    pressedRef.current = true;
    animate(
      buttonRef.current,
      { scale: resolvePressScale('card', reduced) },
      { duration: 0.08, ease: MOTION_TOKENS.easeOutTuple },
    );
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={`demo-card-${presetId}`}
      aria-label={t('demo.openAria', { title })}
      aria-describedby={descId}
      onPointerDown={handlePointerDown}
      onPointerUp={releasePress}
      onPointerLeave={releasePress}
      onPointerCancel={releasePress}
      onClick={() => onLoadDemoLot(presetId)}
      className={cn(
        // premium §11.2 sample card: a `fill-1` tile holding only the disc, with the text below
        // it on the page bg; mobile 300 px carousel item, sm full-width stack, 3-up from 1024
        'group relative flex w-[300px] shrink-0 snap-start cursor-pointer flex-col text-left select-none sm:w-full',
        // §8.9 hover lift -2 px (the tile cross-fades its `shadow-card`)
        'transition-[translate] duration-[160ms] ease-[var(--ease-out)] [@media(hover:hover)]:enabled:hover:duration-[240ms]',
        '[@media(hover:hover)]:motion-safe:enabled:hover:-translate-y-0.5',
        'rounded-2xl focus-visible:shadow-focus-ring focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <div
        data-testid={`demo-tile-${presetId}`}
        className={cn(
          // `r-2xl`, no shadow at rest; `shadow-card` on hover through a pseudo-element's opacity
          'relative flex w-full items-center justify-center rounded-2xl bg-fill-1 py-10',
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:opacity-0 before:shadow-card before:content-['']",
          'before:transition-opacity before:duration-[160ms] before:ease-[var(--ease-out)]',
          '[@media(hover:hover)]:group-enabled:group-hover:before:opacity-100 [@media(hover:hover)]:group-enabled:group-hover:before:duration-[240ms]',
        )}
      >
        <LandingWaferDisc
          presetId={presetId}
          size={size}
          enableSharedMorph={isSelected}
          testId={(part) =>
            part ? `landing-demo-wafer-${part}-${presetId}` : `landing-demo-wafer-${presetId}`
          }
          {...(renderWorkerThumbnail !== undefined
            ? { renderWorkerThumbnail }
            : {})}
        />
        {/* §11.2 pattern chip, bottom-left: `caption`, `fill-2`, pill, 24 h */}
        <span
          data-testid={`demo-chip-${presetId}`}
          className="absolute bottom-4 left-4 inline-flex h-6 items-center rounded-pill bg-fill-2 px-2.5 type-caption text-text-secondary"
        >
          {chip}
        </span>
      </div>

      <div
        id={descId}
        data-testid={`demo-caption-${presetId}`}
        className="mt-4 flex w-full min-w-0 flex-col"
      >
        <span className="truncate type-headline text-text-primary">{title}</span>
        <span className="mt-1 truncate type-callout text-text-secondary lg:max-xl:line-clamp-2 lg:max-xl:whitespace-normal">
          {description}
        </span>
        <span className="mt-2 truncate type-subhead text-text-tertiary">
          {meta}
        </span>
      </div>
    </button>
  );
}

const RETICLE_LABELS = [
  { angleDeg: 0, text: '0°' },
  { angleDeg: 90, text: '90°' },
  { angleDeg: 180, text: '180°' },
  { angleDeg: 270, text: '270°' },
] as const;

/** Label slots outside the reticle circle: 8 px gap + one 16 px mono line above / below, 40 px at the sides. */
const RETICLE_LABEL_SLOT_Y = 24;
const RETICLE_LABEL_SLOT_X = 40;
const RETICLE_LABEL_GAP = 8;

interface LandingHeroProps {
  readonly disabled: boolean;
  readonly onOpenSample: () => void;
}

/** Placeholder that splits the example fact around its counting percent (premium §11.5). */
const FACT_PERCENT_SLOT = '\u0000';

/**
 * Landing hero row (premium §11.1): the `edge-ring-etch` W01 wafer inside a probe-station
 * reticle (hairline circle at D + 32, 72 ticks, 0° / 90° / 180° / 270° mono labels), and the
 * "Example result" card to its right from 1024 (below it under 1024). The wafer and the card's
 * text button both open the sample lot.
 */
function LandingHero({
  disabled,
  onOpenSample,
}: LandingHeroProps): React.JSX.Element {
  const { t, formatPercent } = useT();
  const size = useViewportSize(
    resolveLandingHeroWaferSize,
    LANDING_HERO_WAFER_SIZE_DEFAULT,
  );
  const hydrated = useHydrated();
  const reticleD = size + LANDING_RETICLE_GAP_PX * 2;
  const reticleR = reticleD / 2;
  const frameW = reticleD + RETICLE_LABEL_SLOT_X * 2;
  const frameH = reticleD + RETICLE_LABEL_SLOT_Y * 2;
  const cx = frameW / 2;
  const cy = frameH / 2;
  const tickLines = React.useMemo(
    () => computeLandingReticleTickLines(cx, cy, reticleR),
    [cx, cy, reticleR],
  );
  const sampleLabel = t('landing.primary');
  const patternName = 'Edge-Ring';
  const [titleBefore = '', titleAfter = ''] = t('verdict.pattern', {
    pattern: patternName,
  }).split(patternName);
  const [factBefore = '', factAfter = ''] = t('landing.example.fact', {
    percent: FACT_PERCENT_SLOT,
  }).split(FACT_PERCENT_SLOT);

  return (
    <div
      data-testid="landing-hero"
      // Before hydration the frame has the 1440 size; clip it so narrow screens never scroll sideways
      className={`mt-14 flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-center lg:gap-14${hydrated ? '' : ' overflow-x-clip'}`}
    >
      <div
        data-testid="landing-hero-frame"
        style={{ width: `${frameW}px`, height: `${frameH}px` }}
        className="relative shrink-0"
      >
        <svg
          aria-hidden="true"
          data-testid="landing-reticle"
          width={frameW}
          height={frameH}
          viewBox={`0 0 ${frameW} ${frameH}`}
          className="pointer-events-none absolute inset-0 overflow-visible"
        >
          <circle
            cx={cx}
            cy={cy}
            r={reticleR - 0.5}
            fill="none"
            strokeWidth={1}
            className="stroke-hairline"
          />
          {tickLines.map((tick) => (
            <line
              key={tick.angleDeg}
              data-reticle-tick=""
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              strokeWidth={1}
              className="stroke-hairline-strong"
            />
          ))}
        </svg>

        {RETICLE_LABELS.map((label) => {
          const offset = reticleR + RETICLE_LABEL_GAP;
          const style: React.CSSProperties =
            label.angleDeg === 0
              ? { left: `${cx}px`, bottom: `${cy + offset}px`, transform: 'translateX(-50%)' }
              : label.angleDeg === 180
                ? { left: `${cx}px`, top: `${cy + offset}px`, transform: 'translateX(-50%)' }
                : label.angleDeg === 90
                  ? { left: `${cx + offset}px`, top: `${cy}px`, transform: 'translateY(-50%)' }
                  : { right: `${cx + offset}px`, top: `${cy}px`, transform: 'translateY(-50%)' };
          return (
            <span
              key={label.angleDeg}
              aria-hidden="true"
              data-testid={`landing-reticle-label-${label.angleDeg}`}
              style={style}
              className="pointer-events-none absolute type-mono-note whitespace-nowrap text-text-tertiary"
            >
              {label.text}
            </span>
          );
        })}

        <button
          type="button"
          data-testid="landing-hero-wafer"
          aria-label={sampleLabel}
          disabled={disabled}
          onClick={onOpenSample}
          style={{
            left: `${cx - reticleR}px`,
            top: `${cy - reticleR}px`,
            width: `${reticleD}px`,
            height: `${reticleD}px`,
          }}
          className={cn(
            'absolute flex cursor-pointer items-center justify-center rounded-full bg-transparent',
            'focus-visible:shadow-focus-ring focus-visible:outline-none',
            'disabled:cursor-not-allowed',
          )}
        >
          <LandingWaferDisc
            presetId="edge-ring-etch"
            size={size}
            hero
            testId={(part) =>
              part ? `landing-hero-disc-${part}` : 'landing-hero-disc'
            }
          />
        </button>
      </div>

      {/* §11.1 result card: `surface`, `r-2xl`, `shadow-card`, padding 24, width 280 */}
      <div
        data-testid="landing-example-card"
        className="w-[280px] shrink-0 rounded-2xl bg-surface p-6 text-left shadow-card"
      >
        {/* §12.4 eyebrow: 6 px ember dot, then a mono 12/16 uppercase note */}
        <p
          data-testid="landing-example-eyebrow"
          className="flex items-center gap-2 type-mono-note type-eyebrow text-text-tertiary"
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-ember"
          />
          {t('landing.example.eyebrow')}
        </p>
        <p
          data-testid="landing-example-title"
          className="mt-3 type-title-2 text-ember-ink"
        >
          {titleBefore}
          <Untranslated>{patternName}</Untranslated>
          {titleAfter}
        </p>
        <p
          data-testid="landing-example-fact"
          className="mt-2 type-body text-text-secondary"
        >
          {factBefore}
          {/* §11.5: the percent counts up; the words around it stay still */}
          <CountUp
            value={LANDING_EXAMPLE_EDGE_SHARE}
            format={formatPercent}
            data-testid="landing-example-percent"
          />
          {factAfter}
        </p>
        <Button
          variant="text"
          data-testid="landing-example-action"
          onClick={onOpenSample}
          disabled={disabled}
          className="mt-4"
        >
          {t('landing.example.action')}
          <span aria-hidden="true">→</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * Landing, parse error, and no-results views (`src/ui/layout/EmptyStateCard.tsx`):
 * - `first-run`: premium §6.1 hero ("Drop the body.", subline, primary "Open the sample lot",
 *   secondary "Open file", hint), "Sample lots" cards with 152 / 140 / 120 / 112 px discs, and
 *   the footer line with "Download sample files"
 * - `parse-failed`: premium §6.4 / §9.6 error view (`title-1`, `redesign.md` §3.7 copy) with
 *   primary "Open another file", secondary "Open the sample lot", and "Show details", keeping
 *   the cards below
 */
export function EmptyStateCard({
  cause = 'first-run',
  presets,
  selectedPresetId,
  onSelectPreset,
  onLoadDemoLot,
  onDownloadDemoLot,
  downloadingPresetId = null,
  onSelectFile,
  renderWorkerThumbnail,
  parseError = null,
  activeFilterSummary,
  onClearFilters,
  disabled = false,
}: EmptyStateCardProps): React.JSX.Element {
  const { locale, t } = useT();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const sampleHeadingId = React.useId();

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      onSelectFile(file);
    }
  };

  const errorVm = React.useMemo(
    () =>
      cause === 'parse-failed' && parseError
        ? resolveParseErrorViewModel(parseError.error, locale)
        : null,
    [cause, locale, parseError],
  );

  return (
    <div
      data-testid={
        cause === 'parse-failed' ? 'parse-error-view' : 'landing-view'
      }
      className="flex flex-col pb-12 sm:mx-auto sm:w-full sm:max-w-[640px] lg:max-w-none lg:pb-6"
    >
      <label htmlFor="cal-file-picker" className="sr-only">
        {t('nav.openStdfAria')}
      </label>
      <input
        id="cal-file-picker"
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
        accept=".stdf,.std,.stdf.gz,.gz,application/gzip,application/octet-stream"
        onChange={handleFileInputChange}
        disabled={disabled}
        className="sr-only"
        aria-label={t('nav.openStdfAria')}
      />

      {cause === 'no-results' ? (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="pt-12 text-left md:mx-auto md:max-w-[640px] md:pt-32 md:text-center"
        >
          <h1 className="type-title-2 text-text-primary">
            {t('empty.noResults.title')}
          </h1>
          <p className="mt-3 type-body text-pretty text-text-secondary">
            {activeFilterSummary
              ? t('empty.noResults.bodyFilter', { filter: activeFilterSummary })
              : t('empty.noResults.body')}
          </p>
          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-center">
            {onClearFilters ? (
              <Button
                variant="primary"
                size="lg"
                onClick={onClearFilters}
                disabled={disabled}
                className="w-full md:w-auto"
              >
                {t('empty.noResults.clear')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              onClick={() => onLoadDemoLot(selectedPresetId)}
              disabled={disabled}
              className="w-full md:w-auto"
            >
              {t('landing.primary')}
            </Button>
          </div>
        </div>
      ) : cause === 'parse-failed' && errorVm ? (
        /* premium §6.4 parse error: replaces the landing hero, cards stay below; centred at
           top y = 164 from 1024, left-aligned at y = 96 below; no icon, no red, no orange */
        <div
          role="alert"
          data-error-code={errorVm.uiCode}
          className="pt-12 text-left lg:mx-auto lg:max-w-[880px] lg:pt-[112px] lg:text-center"
        >
          <h1
            data-testid="parse-error-title"
            className="type-title-1 text-text-primary"
          >
            {errorVm.title}
          </h1>

          <p
            data-testid="parse-error-body"
            className="mt-3 max-w-[560px] type-body text-text-secondary lg:mx-auto"
          >
            {renderWithUntranslatedTokens(
              errorVm.body,
              errorVm.untranslatedTokens,
            )}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-center">
            <Button
              variant="primary"
              size="lg"
              data-testid="parse-error-open-another"
              aria-controls="cal-file-picker"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="w-full sm:w-auto"
            >
              {t('error.openAnother')}
            </Button>

            <Button
              variant="secondary"
              size="lg"
              data-testid="parse-error-load-demo"
              onClick={() => onLoadDemoLot('edge-ring-etch')}
              disabled={disabled}
              className="h-11 w-full sm:h-12 sm:w-auto"
            >
              {t('landing.primary')}
            </Button>
          </div>

          <div className="mt-4 flex lg:justify-center">
            <Button
              variant="text"
              data-testid="parse-error-show-details"
              onClick={() => setDetailsOpen(true)}
              disabled={disabled}
            >
              {t('error.showDetails')}
            </Button>
          </div>

          <ErrorDetailsSheet
            open={detailsOpen}
            onClose={() => setDetailsOpen(false)}
            byteOffset={errorVm.byteOffset}
            first16BytesHex={errorVm.first16BytesHex}
            {...(parseError?.fileName !== undefined
              ? { fileName: parseError.fileName }
              : {})}
          />
        </div>
      ) : (
        /* premium §6.1 hero: headline top y = 140 (1440), 116 (1280), 104 (1024), 88 (390); centred from 1024, left-aligned below */
        <div className="pt-10 text-left lg:mx-auto lg:max-w-[880px] lg:pt-[52px] lg:text-center xl:pt-16 min-[90rem]:pt-[88px]">
          <h1
            data-testid="landing-headline"
            className="landing-headline type-display-xl text-text-primary"
          >
            {renderAccentPhrase(
              t('landing.headline'),
              t('landing.headlineAccent'),
              !isCjkLocale(locale),
            )}
          </h1>

          <p
            data-testid="landing-subline"
            className="landing-subline mt-4 line-clamp-3 type-title-3 text-text-secondary lg:mx-auto min-[90rem]:mt-5"
          >
            {t('landing.subline')}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-center min-[90rem]:mt-8">
            <Button
              variant="primary"
              size="lg"
              data-testid="landing-open-sample-button"
              onClick={() => onLoadDemoLot('edge-ring-etch')}
              disabled={disabled}
              className="w-full sm:w-auto"
            >
              {t('landing.primary')}
            </Button>

            <Button
              variant="secondary"
              size="lg"
              data-testid="landing-open-stdf-button"
              aria-controls="cal-file-picker"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="h-11 w-full sm:h-12 sm:w-auto"
            >
              {t('landing.secondary')}
            </Button>
          </div>

          <p
            data-testid="landing-hint"
            className="mt-3 type-subhead text-text-tertiary"
          >
            <span className="sm:hidden">{t('landing.hintShort')}</span>
            <span className="max-sm:hidden">{t('landing.hint')}</span>
          </p>
        </div>
      )}

      {/* premium §11.1: hint line, 56 px, hero row, 72 px, "Sample lots" */}
      {cause === 'first-run' ? (
        <LandingHero
          disabled={disabled}
          onOpenSample={() => onLoadDemoLot('edge-ring-etch')}
        />
      ) : null}

      {/* premium §6.1 sample cards: mobile scroll-snap carousel (46 px peek), sm stacked rows, 3-up grid from 1024 */}
      {cause !== 'no-results' ? (
        <>
          <section
            aria-labelledby={sampleHeadingId}
            className={cn(
              // premium §12.5: landing sections >= 72 px apart
              'mt-[72px]',
            )}
          >
            {/* premium §12.4 eyebrow: 6 px ember dot, then a mono 12/16 uppercase note */}
            <h2
              id={sampleHeadingId}
              data-testid="landing-sample-heading"
              className="flex items-center gap-2 type-mono-note type-eyebrow text-text-primary"
            >
              <span
                aria-hidden="true"
                data-testid="landing-eyebrow-dot"
                className="size-1.5 shrink-0 rounded-full bg-ember"
              />
              {t('landing.demoHeading')}
            </h2>

            <div
              data-testid="landing-demo-cards"
              className={cn(
                '-mx-4 mt-1 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-2 pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                '-mb-6 sm:mx-0 sm:mt-4 sm:mb-0 sm:flex-col sm:gap-4 sm:overflow-visible sm:p-0 sm:snap-none',
                'lg:grid lg:grid-cols-3 lg:gap-6',
              )}
            >
              {presets.map((preset) => (
                <DemoLotCardButton
                  key={preset.id}
                  presetId={preset.id}
                  isSelected={preset.id === selectedPresetId}
                  disabled={disabled}
                  onSelectPreset={onSelectPreset}
                  onLoadDemoLot={onLoadDemoLot}
                  {...(renderWorkerThumbnail !== undefined
                    ? { renderWorkerThumbnail }
                    : {})}
                />
              ))}
            </div>
          </section>

          {/* premium §6.1 footer line: privacy left (subhead tertiary), "Download sample files" text button right */}
          <footer className="mt-[72px] flex flex-wrap items-center justify-between gap-4">
            <p
              data-testid="landing-privacy"
              className="type-subhead text-text-tertiary"
            >
              {t('landing.privacy')}
            </p>

            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="landing-download-demos-trigger"
                disabled={disabled}
                className={cn(
                  // premium §7.11 text button: `text-secondary`, hover `text-primary`, pressed 0.64, ::after +8 px
                  'relative cursor-pointer rounded-pill bg-transparent p-0 type-control text-text-secondary shadow-none select-none',
                  "after:absolute after:-inset-2 after:content-['']",
                  'transition-[color,opacity] duration-[120ms] ease-[var(--ease-out)] [@media(hover:hover)]:enabled:hover:text-text-primary enabled:active:opacity-64',
                  'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  'disabled:cursor-not-allowed disabled:text-text-disabled',
                )}
              >
                {t('landing.downloadDemos')}
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                sideOffset={8}
                expectedWidthPx={260}
                data-testid="landing-download-demos-menu"
                className="w-[260px]"
              >
                {presets.map((preset) => {
                  const fileName = getDemoStdfFileName(preset.id);
                  const isExporting = downloadingPresetId === preset.id;
                  return (
                    <DropdownMenuItem
                      key={preset.id}
                      data-testid={`download-demo-stdf-${preset.id}`}
                      aria-label={`Download ${fileName}`}
                      typeaheadLabel={fileName}
                      disabled={disabled || downloadingPresetId !== null}
                      onSelect={() => onDownloadDemoLot?.(preset.id)}
                    >
                      <Untranslated className="truncate type-mono-data text-text-primary">
                        {isExporting ? `${fileName}…` : fileName}
                      </Untranslated>
                      <Download
                        className="size-3.5 shrink-0 text-text-secondary"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </footer>
        </>
      ) : null}
    </div>
  );
}
