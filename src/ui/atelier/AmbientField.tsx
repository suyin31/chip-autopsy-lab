import type { CSSProperties, ReactElement } from 'react';

export type AmbientFieldIntensity = 'calm' | 'vivid';

export type AmbientFieldProps = {
  readonly className?: string;
  readonly intensity?: AmbientFieldIntensity;
  readonly ariaHidden?: boolean;
};

const ROOT_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: -1,
  // `clip`, not `hidden`: a hidden overflow would become the sticky stage's scroll container
  // and the light would scroll away with the page.
  overflow: 'clip',
  pointerEvents: 'none',
  userSelect: 'none',
};

/**
 * The light field behind every atelier page (UI v2 §2.2.1). All CSS, no canvas, no frame loop:
 * - a zenith light from above the bench,
 * - four large soft aurora bands (channel blue, signal hue, violet, teal) drifting on
 *   `transform` over 22-34 s cycles,
 * - a 24 px dot texture masked to the lit centre.
 *
 * The stage is sticky, so the light stays behind the viewport on long pages. It sits at
 * `z-index: -1` inside the page's isolated stacking context, under every surface. Reduced motion
 * stops the drift (the light stays, static). `vivid` is the workbench; `calm` (agent console)
 * dims the bands slightly.
 */
export function AmbientField({
  className,
  intensity = 'calm',
  ariaHidden = true,
}: AmbientFieldProps): ReactElement {
  return (
    <div
      aria-hidden={ariaHidden}
      data-testid="ambient-field"
      data-intensity={intensity}
      className={className}
      style={ROOT_STYLE}
    >
      <div className="at-aurora-stage">
        <span className="at-field-zenith" />
        <span className="at-aurora-ribbon" data-band="a" />
        <span className="at-aurora-ribbon" data-band="c" />
        <span className="at-aurora-ribbon" data-band="d" />
        <span className="at-aurora-ribbon" data-band="b" />
        <span className="at-aurora-lattice" />
      </div>
    </div>
  );
}
