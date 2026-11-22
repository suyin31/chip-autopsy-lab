'use client';

import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion';

/**
 * Ambient warm-paper silicon backdrop behind the landing hero (`cause === 'first-run'` only).
 * Renders three static/stepped CSS/SVG layers (daylight wash, 24 px die lattice, baked 8 fps
 * paper grain), pauses off-screen via `IntersectionObserver`, and hides under reduced motion
 * and reduced transparency (`src/app/globals.css`).
 */
export function LandingHeroAmbient(): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotionPreference();
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    if (reduced) {
      setPaused(true);
      return;
    }
    if (typeof IntersectionObserver !== 'function') {
      setPaused(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) {
          return;
        }
        setPaused(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [reduced]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      data-testid="landing-hero-ambient"
      data-ambient-paused={paused ? 'true' : undefined}
      className="landing-ambient pointer-events-none"
    >
      <div className="landing-ambient-wash" />
      <div className="landing-ambient-grid" />
      <div className="landing-ambient-grain" />
    </div>
  );
}
