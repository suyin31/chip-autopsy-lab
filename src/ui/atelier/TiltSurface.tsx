'use client';

import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  motion,
  type MotionStyle,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react';

export type TiltSurfaceElement = 'div' | 'article' | 'li';

export type TiltSurfaceProps = {
  readonly children: ReactNode;
  readonly className?: string;
  readonly maxDeg?: number;
  readonly liftPx?: number;
  readonly scale?: number;
  readonly perspectivePx?: number;
  readonly glow?: boolean;
  readonly as?: TiltSurfaceElement;
  readonly disabled?: boolean;
  readonly 'data-testid'?: string;
};

export type TiltLayerProps = {
  readonly depth?: number;
  readonly className?: string;
  readonly children: ReactNode;
};

type ThemeMode = 'dark' | 'light';
type MotionStringValue = ReturnType<typeof useMotionTemplate>;

type TiltSurfaceMotionStyle = MotionStyle & {
  readonly '--tilt-depth': number;
};

type HighlightMotionStyle = MotionStyle & {
  readonly '--mx': MotionStringValue;
  readonly '--my': MotionStringValue;
};

type TiltLayerStyle = CSSProperties & {
  readonly '--tilt-factor': number;
};

const SPRING_CONFIG = {
  stiffness: 180,
  damping: 18,
  mass: 0.6,
} as const;

const DEFAULT_MAX_DEG = 13;
const DEFAULT_LIFT_PX = 6;
const DEFAULT_SCALE = 1.012;
const DEFAULT_PERSPECTIVE_PX = 1000;
const DEFAULT_LAYER_DEPTH = 0.4;
const LAYER_DEPTH_PX = 24;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const COARSE_OR_NO_HOVER_QUERY = '(hover: none), (pointer: coarse)';

const DARK_HIGHLIGHT =
  'radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,0.22), transparent 55%)';
const LIGHT_HIGHLIGHT =
  'radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,0.65), rgba(210,228,255,0.22) 26%, transparent 55%)';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const readDocumentTheme = (): ThemeMode =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

/**
 * Physically damped 3D tilt wrapper with spring-settled rotation, lift,
 * parallax child layers (`TiltLayer`), and a pointer-tracking specular sheen.
 */
export function TiltSurface({
  children,
  className,
  maxDeg = DEFAULT_MAX_DEG,
  liftPx = DEFAULT_LIFT_PX,
  scale = DEFAULT_SCALE,
  perspectivePx = DEFAULT_PERSPECTIVE_PX,
  glow = true,
  as = 'div',
  disabled = false,
  'data-testid': testId,
}: TiltSurfaceProps): ReactElement {
  const boundsRef = useRef<HTMLDivElement | null>(null);
  const cachedRectRef = useRef<DOMRect | null>(null);

  const motionReduced = useReducedMotion();
  const [mediaReduced, setMediaReduced] = useState<boolean>(false);
  const [coarseOrNoHover, setCoarseOrNoHover] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [isHovering, setIsHovering] = useState<boolean>(false);

  const isStatic =
    disabled || motionReduced === true || mediaReduced || coarseOrNoHover;

  const rawRotateX = useMotionValue(0);
  const rawRotateY = useMotionValue(0);
  const rawLift = useMotionValue(0);
  const rawScale = useMotionValue(1);
  const pointerX = useMotionValue(50);
  const pointerY = useMotionValue(50);

  const rotateX = useSpring(rawRotateX, SPRING_CONFIG);
  const rotateY = useSpring(rawRotateY, SPRING_CONFIG);
  const translateZ = useSpring(rawLift, SPRING_CONFIG);
  const surfaceScale = useSpring(rawScale, SPRING_CONFIG);

  const mx = useMotionTemplate`${pointerX}%`;
  const my = useMotionTemplate`${pointerY}%`;

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const reducedMql = window.matchMedia(REDUCED_MOTION_QUERY);
    const pointerMql = window.matchMedia(COARSE_OR_NO_HOVER_QUERY);

    const syncMedia = (): void => {
      setMediaReduced(reducedMql.matches);
      setCoarseOrNoHover(pointerMql.matches);
    };

    syncMedia();

    if (
      typeof reducedMql.addEventListener !== 'function' ||
      typeof pointerMql.addEventListener !== 'function'
    ) {
      return;
    }

    reducedMql.addEventListener('change', syncMedia);
    pointerMql.addEventListener('change', syncMedia);

    return () => {
      reducedMql.removeEventListener('change', syncMedia);
      pointerMql.removeEventListener('change', syncMedia);
    };
  }, []);

  useEffect(() => {
    if (isStatic || !glow || typeof document === 'undefined') {
      return;
    }

    setTheme(readDocumentTheme());

    if (typeof MutationObserver === 'undefined') {
      return;
    }

    const observer = new MutationObserver(() => {
      const nextTheme = readDocumentTheme();
      setTheme((prev) => (prev === nextTheme ? prev : nextTheme));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      observer.disconnect();
    };
  }, [glow, isStatic]);

  useEffect(() => {
    if (!isStatic) {
      return;
    }

    cachedRectRef.current = null;
    setIsHovering(false);
    rawRotateX.jump(0);
    rawRotateY.jump(0);
    rawLift.jump(0);
    rawScale.jump(1);
    rotateX.jump(0);
    rotateY.jump(0);
    translateZ.jump(0);
    surfaceScale.jump(1);
    pointerX.set(50);
    pointerY.set(50);
  }, [
    isStatic,
    pointerX,
    pointerY,
    rawLift,
    rawRotateX,
    rawRotateY,
    rawScale,
    rotateX,
    rotateY,
    surfaceScale,
    translateZ,
  ]);

  const refreshRect = useCallback(
    (fallbackTarget?: HTMLElement): DOMRect | null => {
      const target = boundsRef.current ?? fallbackTarget ?? null;
      if (target === null) {
        return null;
      }
      const rect = target.getBoundingClientRect();
      cachedRectRef.current = rect;
      return rect;
    },
    [],
  );

  useEffect(() => {
    if (!isHovering || isStatic || typeof window === 'undefined') {
      return;
    }

    const handleViewportChange = (): void => {
      refreshRect();
    };

    window.addEventListener('scroll', handleViewportChange, {
      passive: true,
      capture: true,
    });
    window.addEventListener('resize', handleViewportChange, {
      passive: true,
    });

    return () => {
      window.removeEventListener('scroll', handleViewportChange, {
        capture: true,
      });
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [isHovering, isStatic, refreshRect]);

  const applyPointer = useCallback(
    (clientX: number, clientY: number, rect: DOMRect): void => {
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const u = clamp((clientX - rect.left) / rect.width, 0, 1);
      const v = clamp((clientY - rect.top) / rect.height, 0, 1);
      const nx = u * 2 - 1;
      const ny = v * 2 - 1;

      rawRotateX.set(-ny * maxDeg);
      rawRotateY.set(nx * maxDeg);
      rawLift.set(liftPx);
      rawScale.set(scale);
      pointerX.set(u * 100);
      pointerY.set(v * 100);
    },
    [
      liftPx,
      maxDeg,
      pointerX,
      pointerY,
      rawLift,
      rawRotateX,
      rawRotateY,
      rawScale,
      scale,
    ],
  );

  const resetToRest = useCallback((): void => {
    cachedRectRef.current = null;
    setIsHovering(false);
    rawRotateX.set(0);
    rawRotateY.set(0);
    rawLift.set(0);
    rawScale.set(1);
  }, [rawLift, rawRotateX, rawRotateY, rawScale]);

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (event.pointerType === 'touch') {
        return;
      }
      const rect = refreshRect(event.currentTarget);
      setIsHovering(true);
      if (rect !== null) {
        applyPointer(event.clientX, event.clientY, rect);
      }
    },
    [applyPointer, refreshRect],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (event.pointerType === 'touch') {
        return;
      }
      refreshRect(event.currentTarget);
    },
    [refreshRect],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (event.pointerType === 'touch') {
        return;
      }
      const rect = cachedRectRef.current ?? refreshRect(event.currentTarget);
      if (rect === null) {
        return;
      }
      if (!isHovering) {
        setIsHovering(true);
      }
      applyPointer(event.clientX, event.clientY, rect);
    },
    [applyPointer, isHovering, refreshRect],
  );

  const handlePointerLeave = useCallback((): void => {
    resetToRest();
  }, [resetToRest]);

  const outerStyle = useMemo<CSSProperties>(
    () => ({
      perspective: `${perspectivePx}px`,
    }),
    [perspectivePx],
  );

  const surfaceStyle = useMemo<TiltSurfaceMotionStyle>(
    () => ({
      transformStyle: 'preserve-3d',
      rotateX,
      rotateY,
      z: translateZ,
      scale: surfaceScale,
      '--tilt-depth': LAYER_DEPTH_PX,
    }),
    [rotateX, rotateY, surfaceScale, translateZ],
  );

  const highlightStyle = useMemo<HighlightMotionStyle>(
    () => ({
      '--mx': mx,
      '--my': my,
      background: theme === 'light' ? LIGHT_HIGHLIGHT : DARK_HIGHLIGHT,
      opacity: isHovering ? 1 : 0,
      transition: 'opacity 160ms cubic-bezier(0.22, 1, 0.36, 1)',
    }),
    [isHovering, mx, my, theme],
  );

  if (isStatic) {
    const StaticTag = as;
    return (
      <StaticTag className={className} data-testid={testId}>
        {children}
      </StaticTag>
    );
  }

  const baseClassName =
    'relative [transform-style:preserve-3d] data-[tilting=true]:will-change-transform';
  const mergedClassName = className
    ? `${baseClassName} ${className}`
    : baseClassName;

  const surfaceProps = {
    'data-testid': testId,
    'data-tilting': isHovering ? 'true' : undefined,
    className: mergedClassName,
    style: surfaceStyle,
    onPointerEnter: handlePointerEnter,
    onPointerMove: handlePointerMove,
    onPointerLeave: handlePointerLeave,
    onPointerCancel: handlePointerLeave,
    onPointerDown: handlePointerDown,
  };

  const content = (
    <>
      {children}
      {glow ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={highlightStyle}
        />
      ) : null}
    </>
  );

  return (
    <div ref={boundsRef} style={outerStyle}>
      {as === 'article' ? (
        <motion.article {...surfaceProps}>{content}</motion.article>
      ) : as === 'li' ? (
        <motion.li {...surfaceProps}>{content}</motion.li>
      ) : (
        <motion.div {...surfaceProps}>{content}</motion.div>
      )}
    </div>
  );
}

/**
 * Recessed 3D depth layer for `TiltSurface` children, translating backward along Z
 * by `depth * --tilt-depth` (default `depth = 0.4`, `-9.6px` inside an active surface).
 */
export function TiltLayer({
  depth = DEFAULT_LAYER_DEPTH,
  className,
  children,
}: TiltLayerProps): ReactElement {
  const safeDepth = Number.isFinite(depth) ? depth : DEFAULT_LAYER_DEPTH;

  const layerStyle = useMemo<TiltLayerStyle>(
    () => ({
      '--tilt-factor': safeDepth,
      transform:
        'translateZ(calc(var(--tilt-depth, 24) * var(--tilt-factor) * -1px))',
    }),
    [safeDepth],
  );

  return (
    <div
      data-depth={String(safeDepth)}
      className={className}
      style={layerStyle}
    >
      {children}
    </div>
  );
}
