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
  overflow: 'hidden',
  pointerEvents: 'none',
  userSelect: 'none',
};

/**
 * The room light behind every atelier page: one cool zenith light from above the bench and one
 * very faint, low-saturation halo of the signal hue where the specimen sits. Both are static
 * CSS layers (`.at-field-*` in `atelier.css`): no canvas, no frame loop, nothing moves at rest.
 * `vivid` lifts the halo slightly for the workbench; `calm` is the agent console.
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
      <span className="at-field-zenith" />
      <span className="at-field-halo" />
    </div>
  );
}
