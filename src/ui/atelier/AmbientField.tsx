'use client';

import { type CSSProperties, type ReactElement, useEffect, useRef } from 'react';

export type AmbientFieldIntensity = 'calm' | 'vivid';

export type AmbientFieldProps = {
  readonly className?: string;
  readonly intensity?: AmbientFieldIntensity;
  readonly ariaHidden?: boolean;
};

type ThemeMode = 'dark' | 'light';
type RgbTuple = readonly [number, number, number];

interface ThemePalette {
  readonly base: string;
  readonly blobs: readonly [RgbTuple, RgbTuple, RgbTuple, RgbTuple];
  readonly peakAlpha: number;
  readonly grainAlpha: number;
  readonly topBandColor: RgbTuple;
  readonly topBandAlpha: number;
  readonly vignetteColor: RgbTuple;
  readonly vignetteMidAlpha: number;
  readonly vignetteEdgeAlpha: number;
}

interface BlobSpec {
  readonly colorIndex: 0 | 1 | 2 | 3;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly ampX: number;
  readonly ampY: number;
  readonly periodX: number;
  readonly periodY: number;
  readonly phaseX: number;
  readonly phaseY: number;
  readonly radiusRatio: number;
  readonly radiusPulse: number;
  readonly radiusPeriod: number;
  readonly radiusPhase: number;
  readonly alphaWeight: number;
}

const TAU = Math.PI * 2;
const MAX_DPR = 1.5;
const FRAME_INTERVAL_MS = 33;
const GRAIN_TILE_SIZE = 160;
const TOP_BAND_HEIGHT_RATIO = 0.28;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const VIVID_ALPHA_SCALE = 1.38;
const VIVID_SPEED_SCALE = 1.22;

const PALETTES: Readonly<Record<ThemeMode, ThemePalette>> = {
  dark: {
    base: '#080B12',
    blobs: [
      [86, 108, 255],
      [52, 196, 214],
      [140, 96, 255],
      [255, 92, 124],
    ],
    peakAlpha: 0.34,
    grainAlpha: 0.04,
    topBandColor: [255, 255, 255],
    topBandAlpha: 0.06,
    vignetteColor: [4, 6, 12],
    vignetteMidAlpha: 0.42,
    vignetteEdgeAlpha: 0.78,
  },
  light: {
    base: '#F2F5F8',
    blobs: [
      [96, 124, 255],
      [120, 214, 226],
      [168, 148, 255],
      [255, 140, 160],
    ],
    peakAlpha: 0.22,
    grainAlpha: 0.03,
    topBandColor: [12, 26, 38],
    topBandAlpha: 0.035,
    vignetteColor: [255, 255, 255],
    vignetteMidAlpha: 0.4,
    vignetteEdgeAlpha: 0.76,
  },
};

const BLOB_SPECS: readonly BlobSpec[] = [
  {
    colorIndex: 0,
    anchorX: 0.22,
    anchorY: 0.24,
    ampX: 0.17,
    ampY: 0.15,
    periodX: 23.0,
    periodY: 31.0,
    phaseX: 0.3,
    phaseY: 1.1,
    radiusRatio: 0.66,
    radiusPulse: 0.06,
    radiusPeriod: 27.0,
    radiusPhase: 0.5,
    alphaWeight: 1.0,
  },
  {
    colorIndex: 1,
    anchorX: 0.78,
    anchorY: 0.28,
    ampX: 0.16,
    ampY: 0.18,
    periodX: 29.0,
    periodY: 19.5,
    phaseX: 2.1,
    phaseY: 0.7,
    radiusRatio: 0.62,
    radiusPulse: 0.05,
    radiusPeriod: 34.0,
    radiusPhase: 1.9,
    alphaWeight: 0.92,
  },
  {
    colorIndex: 2,
    anchorX: 0.34,
    anchorY: 0.74,
    ampX: 0.19,
    ampY: 0.14,
    periodX: 37.0,
    periodY: 24.5,
    phaseX: 4.2,
    phaseY: 3.0,
    radiusRatio: 0.68,
    radiusPulse: 0.05,
    radiusPeriod: 21.5,
    radiusPhase: 2.8,
    alphaWeight: 0.95,
  },
  {
    colorIndex: 3,
    anchorX: 0.74,
    anchorY: 0.72,
    ampX: 0.15,
    ampY: 0.16,
    periodX: 18.5,
    periodY: 39.0,
    phaseX: 5.1,
    phaseY: 4.4,
    radiusRatio: 0.59,
    radiusPulse: 0.04,
    radiusPeriod: 28.5,
    radiusPhase: 0.9,
    alphaWeight: 0.85,
  },
];

const ROOT_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  userSelect: 'none',
};

const CANVAS_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
  pointerEvents: 'none',
};

let cachedGrainTile: HTMLCanvasElement | null = null;

const rgba = (rgb: RgbTuple, alpha: number): string =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(4)})`;

const readDocumentTheme = (): ThemeMode => {
  if (typeof document === 'undefined') {
    return 'dark';
  }
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light') {
    return 'light';
  }
  if (attr === 'dark') {
    return 'dark';
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    return 'light';
  }
  return 'dark';
};

const getGrainTile = (): HTMLCanvasElement | null => {
  if (cachedGrainTile !== null) {
    return cachedGrainTile;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const tile = document.createElement('canvas');
  tile.width = GRAIN_TILE_SIZE;
  tile.height = GRAIN_TILE_SIZE;
  const ctx = tile.getContext('2d');
  if (ctx === null) {
    return null;
  }
  const imageData = ctx.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  const data = imageData.data;
  let seed = 0x51a7c39d;

  for (let i = 0; i < data.length; i += 4) {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const randLuma = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

    seed = (seed + 0x6d2b79f5) | 0;
    t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const randAlpha = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

    const luma = Math.floor(randLuma * 256);
    const alpha = Math.floor(randAlpha * 256);
    data[i] = luma;
    data[i + 1] = luma;
    data[i + 2] = luma;
    data[i + 3] = alpha;
  }

  ctx.putImageData(imageData, 0, 0);
  cachedGrainTile = tile;
  return tile;
};

const paintGrainLayer = (
  ctx: CanvasRenderingContext2D,
  pixelWidth: number,
  pixelHeight: number,
  palette: ThemePalette,
): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  if (pixelWidth <= 0 || pixelHeight <= 0) {
    return;
  }
  const tile = getGrainTile();
  if (tile === null) {
    return;
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern === null) {
    return;
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = palette.grainAlpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  ctx.globalAlpha = 1;
};

const paintFieldFrame = (
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  palette: ThemePalette,
  intensity: AmbientFieldIntensity,
  elapsedSeconds: number,
): void => {
  if (cssWidth <= 0 || cssHeight <= 0) {
    return;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const alphaScale = intensity === 'vivid' ? VIVID_ALPHA_SCALE : 1;
  const speedScale = intensity === 'vivid' ? VIVID_SPEED_SCALE : 1;
  const t = elapsedSeconds * speedScale;

  // 1. Soft drifting blobs composited additively on a transparent canvas
  ctx.globalCompositeOperation = 'lighter';
  for (const spec of BLOB_SPECS) {
    const cx =
      cssWidth *
      (spec.anchorX + spec.ampX * Math.sin((TAU * t) / spec.periodX + spec.phaseX));
    const cy =
      cssHeight *
      (spec.anchorY + spec.ampY * Math.cos((TAU * t) / spec.periodY + spec.phaseY));
    const radius =
      cssWidth *
      (spec.radiusRatio +
        spec.radiusPulse * Math.sin((TAU * t) / spec.radiusPeriod + spec.radiusPhase));

    if (radius <= 0) {
      continue;
    }

    const color = palette.blobs[spec.colorIndex];
    const peak = palette.peakAlpha * spec.alphaWeight * alphaScale;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, rgba(color, peak));
    gradient.addColorStop(0.26, rgba(color, peak * 0.72));
    gradient.addColorStop(0.54, rgba(color, peak * 0.32));
    gradient.addColorStop(0.78, rgba(color, peak * 0.1));
    gradient.addColorStop(1, rgba(color, 0));

    const minX = Math.max(0, cx - radius);
    const minY = Math.max(0, cy - radius);
    const maxX = Math.min(cssWidth, cx + radius);
    const maxY = Math.min(cssHeight, cy + radius);
    if (maxX > minX && maxY > minY) {
      ctx.fillStyle = gradient;
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    }
  }

  // 2. Faint horizontal light / cool-tint band across the top 28 %
  ctx.globalCompositeOperation = 'source-over';
  const bandHeight = cssHeight * TOP_BAND_HEIGHT_RATIO;
  if (bandHeight > 0) {
    const topBand = ctx.createLinearGradient(0, 0, 0, bandHeight);
    topBand.addColorStop(0, rgba(palette.topBandColor, palette.topBandAlpha));
    topBand.addColorStop(0.55, rgba(palette.topBandColor, palette.topBandAlpha * 0.32));
    topBand.addColorStop(1, rgba(palette.topBandColor, 0));
    ctx.fillStyle = topBand;
    ctx.fillRect(0, 0, cssWidth, bandHeight);
  }

  // 3. Soft edge vignette
  const centerX = cssWidth * 0.5;
  const centerY = cssHeight * 0.48;
  const innerRadius = Math.min(cssWidth, cssHeight) * 0.28;
  const outerRadius = Math.hypot(cssWidth * 0.5, cssHeight * 0.55) * 1.08;
  if (outerRadius > innerRadius) {
    const vignette = ctx.createRadialGradient(
      centerX,
      centerY,
      innerRadius,
      centerX,
      centerY,
      outerRadius,
    );
    vignette.addColorStop(0, rgba(palette.vignetteColor, 0));
    vignette.addColorStop(0.45, rgba(palette.vignetteColor, 0));
    vignette.addColorStop(0.78, rgba(palette.vignetteColor, palette.vignetteMidAlpha));
    vignette.addColorStop(1, rgba(palette.vignetteColor, palette.vignetteEdgeAlpha));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
  }
};

export function AmbientField({
  className,
  intensity = 'calm',
  ariaHidden = true,
}: AmbientFieldProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const grainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const intensityRef = useRef<AmbientFieldIntensity>(intensity);
  const repaintNowRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    intensityRef.current = intensity;
    repaintNowRef.current?.();
  }, [intensity]);

  useEffect(() => {
    const root = rootRef.current;
    const fieldCanvas = fieldCanvasRef.current;
    const grainCanvas = grainCanvasRef.current;
    if (root === null || fieldCanvas === null || grainCanvas === null) {
      return;
    }

    const fieldCtx = fieldCanvas.getContext('2d');
    const grainCtx = grainCanvas.getContext('2d');
    if (fieldCtx === null || grainCtx === null) {
      return;
    }

    const motionMedia =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(REDUCED_MOTION_QUERY)
        : null;

    let theme: ThemeMode = readDocumentTheme();
    let reducedMotion = motionMedia ? motionMedia.matches : false;
    let pageVisible = document.visibilityState === 'visible';
    let intersecting = true;

    let cssWidth = 0;
    let cssHeight = 0;
    let pixelWidth = 0;
    let pixelHeight = 0;
    let dpr = 1;

    let rafId: number | null = null;
    let accumulatedMs = 0;
    let originMs: number | null = null;
    let lastTickMs: number | null = null;
    let lastPaintMs = -Infinity;

    root.style.backgroundColor = PALETTES[theme].base;

    const getElapsedSeconds = (): number => {
      if (reducedMotion) {
        return 0;
      }
      if (originMs !== null && lastTickMs !== null) {
        return (accumulatedMs + Math.max(0, lastTickMs - originMs)) / 1000;
      }
      return accumulatedMs / 1000;
    };

    const paintCurrentField = (seconds: number): void => {
      paintFieldFrame(
        fieldCtx,
        cssWidth,
        cssHeight,
        dpr,
        PALETTES[theme],
        intensityRef.current,
        seconds,
      );
    };

    const stopLoop = (): void => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (originMs !== null && lastTickMs !== null) {
        accumulatedMs += Math.max(0, lastTickMs - originMs);
      }
      originMs = null;
      lastTickMs = null;
      lastPaintMs = -Infinity;
    };

    const tick = (now: number): void => {
      if (originMs === null) {
        originMs = now;
      }
      lastTickMs = now;

      if (now - lastPaintMs >= FRAME_INTERVAL_MS) {
        lastPaintMs = now;
        const elapsedSeconds = (accumulatedMs + Math.max(0, now - originMs)) / 1000;
        paintCurrentField(elapsedSeconds);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const canAnimate = (): boolean =>
      !reducedMotion &&
      pageVisible &&
      intersecting &&
      pixelWidth > 0 &&
      pixelHeight > 0;

    const syncPlayback = (): void => {
      if (canAnimate()) {
        if (rafId === null) {
          lastPaintMs = -Infinity;
          rafId = window.requestAnimationFrame(tick);
        }
      } else {
        stopLoop();
      }
    };

    const syncSize = (nextCssWidth: number, nextCssHeight: number): void => {
      const clampedW = Math.max(0, nextCssWidth);
      const clampedH = Math.max(0, nextCssHeight);
      const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const nextPixelW = Math.max(0, Math.round(clampedW * nextDpr));
      const nextPixelH = Math.max(0, Math.round(clampedH * nextDpr));

      if (nextPixelW === pixelWidth && nextPixelH === pixelHeight && nextDpr === dpr) {
        return;
      }

      cssWidth = clampedW;
      cssHeight = clampedH;
      dpr = nextDpr;
      pixelWidth = nextPixelW;
      pixelHeight = nextPixelH;

      fieldCanvas.width = pixelWidth;
      fieldCanvas.height = pixelHeight;
      grainCanvas.width = pixelWidth;
      grainCanvas.height = pixelHeight;

      paintGrainLayer(grainCtx, pixelWidth, pixelHeight, PALETTES[theme]);
      paintCurrentField(getElapsedSeconds());
      syncPlayback();
    };

    repaintNowRef.current = (): void => {
      if (pixelWidth > 0 && pixelHeight > 0) {
        paintCurrentField(getElapsedSeconds());
      }
    };

    const initialRect = root.getBoundingClientRect();
    syncSize(initialRect.width, initialRect.height);

    const handleVisibilityChange = (): void => {
      pageVisible = document.visibilityState === 'visible';
      syncPlayback();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleMotionChange = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        stopLoop();
        accumulatedMs = 0;
        paintCurrentField(0);
      } else {
        accumulatedMs = 0;
        syncPlayback();
      }
    };
    if (motionMedia !== null) {
      motionMedia.addEventListener('change', handleMotionChange);
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry === undefined) {
          return;
        }
        syncSize(entry.contentRect.width, entry.contentRect.height);
      });
      resizeObserver.observe(root);
    }

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (entry === undefined) {
            return;
          }
          intersecting = entry.isIntersecting;
          syncPlayback();
        },
        { threshold: 0 },
      );
      intersectionObserver.observe(root);
    }

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        const nextTheme = readDocumentTheme();
        if (nextTheme === theme) {
          return;
        }
        theme = nextTheme;
        root.style.backgroundColor = PALETTES[theme].base;
        paintGrainLayer(grainCtx, pixelWidth, pixelHeight, PALETTES[theme]);
        paintCurrentField(getElapsedSeconds());
      });
      mutationObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }

    return () => {
      stopLoop();
      repaintNowRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (motionMedia !== null) {
        motionMedia.removeEventListener('change', handleMotionChange);
      }
      if (resizeObserver !== null) {
        resizeObserver.disconnect();
      }
      if (intersectionObserver !== null) {
        intersectionObserver.disconnect();
      }
      if (mutationObserver !== null) {
        mutationObserver.disconnect();
      }
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden={ariaHidden}
      className={className}
      style={ROOT_STYLE}
    >
      <canvas ref={fieldCanvasRef} aria-hidden="true" style={CANVAS_STYLE} />
      <canvas ref={grainCanvasRef} aria-hidden="true" style={CANVAS_STYLE} />
    </div>
  );
}
