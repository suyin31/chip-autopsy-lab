import type { CSSProperties, ReactElement } from 'react';

export type AmbientFieldIntensity = 'calm' | 'vivid';
export type AmbientFieldTone = 'default' | 'excursion' | 'healthy';

export type AmbientFieldProps = {
  readonly className?: string;
  readonly intensity?: AmbientFieldIntensity;
  readonly tone?: AmbientFieldTone;
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
 * The light field behind every atelier page (UI v2/v3). All CSS, no canvas, no frame loop:
 * - a zenith light from above the bench,
 * - four large soft aurora bands (channel blue, signal hue, violet, teal) drifting on
 *   `transform` over 22-34 s cycles,
 * - a 24 px dot texture masked to the lit centre,
 * - optional `tone` shift (`excursion` warms the signal aurora band; `healthy` cools to emerald).
 */
export function AmbientField({
  className,
  intensity = 'calm',
  tone = 'default',
  ariaHidden = true,
}: AmbientFieldProps): ReactElement {
  return (
    <div
      aria-hidden={ariaHidden}
      data-testid="ambient-field"
      data-intensity={intensity}
      data-tone={tone !== 'default' ? tone : undefined}
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
