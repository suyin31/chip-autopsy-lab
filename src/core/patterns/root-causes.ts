/**
 * Hedged, engineer-grade semiconductor fab and test-floor root-cause hypotheses
 * for the 9 WM-811K spatial defect classes and multi-site concentration anomalies
 * (`src/core/patterns/root-causes.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Every hypothesis is phrased as a candidate physical or test-hardware mechanism
 * paired with a concrete "Check next:" engineering verification action.
 *
 * Validates: Requirements 9.3, 17.4, 17.7
 */

export const WM811K_CLASSES = [
  'Center',
  'Donut',
  'Edge-Loc',
  'Edge-Ring',
  'Loc',
  'Near-full',
  'Random',
  'Scratch',
  'None',
] as const;

export type Wm811kClass = (typeof WM811K_CLASSES)[number];

export type ScoredWm811kClass = Exclude<Wm811kClass, 'None'>;

export type HypothesisTarget = ScoredWm811kClass | 'site-concentration';

export type HypothesisDomain =
  | 'fab-process'
  | 'lithography-clean'
  | 'mechanical-handling'
  | 'test-hardware';

export interface RootCauseHypothesis {
  readonly id: string;
  readonly target: HypothesisTarget;
  readonly domain: HypothesisDomain;
  /** Short, hedged candidate failure mechanism (never stated as certainty). */
  readonly mechanism: string;
  /** Concrete next engineering verification step (without leading "Check next:"). */
  readonly checkNext: string;
  /** Combined concise plain-text hypothesis (`"<mechanism> Check next: <checkNext>"`). */
  readonly summary: string;
}

function makeHypothesis(
  id: string,
  target: HypothesisTarget,
  domain: HypothesisDomain,
  mechanism: string,
  checkNext: string,
): RootCauseHypothesis {
  return {
    id,
    target,
    domain,
    mechanism,
    checkNext,
    summary: `${mechanism} Check next: ${checkNext}`,
  };
}

const PATTERN_HYPOTHESIS_CATALOG: Readonly<
  Record<ScoredWm811kClass, readonly RootCauseHypothesis[]>
> = {
  'Edge-Ring': [
    makeHypothesis(
      'hyp:edge-ring:plasma-focus-ring',
      'Edge-Ring',
      'fab-process',
      'Candidate mechanism: radial plasma etch non-uniformity or focus-ring erosion shifting sheath electric fields at the outer die rings.',
      'review RIE chamber RF hours, focus-ring replacement logs, and radial etch-rate or critical-dimension metrology.',
    ),
    makeHypothesis(
      'hyp:edge-ring:ebr-spin-coat',
      'Edge-Ring',
      'lithography-clean',
      'Candidate mechanism: photoresist spin-coat thickness roll-off or edge-bead removal (EBR) width excursion near the wafer bevel.',
      'inspect coater EBR nozzle alignment and peripheral film-thickness profiles.',
    ),
    makeHypothesis(
      'hyp:edge-ring:cmp-edge',
      'Edge-Ring',
      'fab-process',
      'Candidate mechanism: CMP retaining-ring edge pressure imbalance causing peripheral oxide thinning or metal dishing.',
      'audit CMP carrier outer-zone pressure telemetry and post-CMP peripheral thickness maps.',
    ),
  ],
  Center: [
    makeHypothesis(
      'hyp:center:plasma-gas-flow',
      'Center',
      'fab-process',
      'Candidate mechanism: center-peaked plasma etch rate or CVD showerhead gas-flow non-uniformity.',
      'verify chamber center-to-edge gas split ratios and radial film-thickness or sheet-resistance monitors.',
    ),
    makeHypothesis(
      'hyp:center:spin-chuck-thermal',
      'Center',
      'fab-process',
      'Candidate mechanism: spin-coat central dispense puddle artifact or electrostatic chuck inner-zone thermal offset.',
      'check coater dispense recipe parameters and inner-zone chuck temperature logs.',
    ),
    makeHypothesis(
      'hyp:center:cmp-center-pressure',
      'Center',
      'fab-process',
      'Candidate mechanism: CMP carrier center-membrane pressure offset producing central under-polish or over-polish.',
      'compare CMP inner-zone pressure calibration against radial dielectric thickness measurements.',
    ),
  ],
  Donut: [
    makeHypothesis(
      'hyp:donut:chuck-zone-rf',
      'Donut',
      'fab-process',
      'Candidate mechanism: mid-radius electrostatic chuck zone-boundary thermal gradient or RF standing-wave etch non-uniformity.',
      'correlate failing annulus radius with multi-zone chuck heater boundaries and radial parametric profiles.',
    ),
    makeHypothesis(
      'hyp:donut:cmp-mid-zone',
      'Donut',
      'fab-process',
      'Candidate mechanism: CMP mid-annulus carrier membrane pressure mismatch relative to center and retaining-ring zones.',
      'inspect multi-zone CMP head pressure setpoints and annular post-CMP planarization data.',
    ),
    makeHypothesis(
      'hyp:donut:cvd-spin-annulus',
      'Donut',
      'fab-process',
      'Candidate mechanism: radial CVD reactant depletion, showerhead flow non-uniformity, or spin-coat drying-front variation at mid-radius.',
      'review interlayer dielectric and metallization radial thickness maps across the lot.',
    ),
  ],
  Scratch: [
    makeHypothesis(
      'hyp:scratch:robot-blade-handling',
      'Scratch',
      'mechanical-handling',
      'Candidate mechanism: mechanical contact from a misaligned wafer-handling robot blade, vacuum end-effector, or cassette slot scoring top-metal passivation.',
      'inspect frontside optical macro scans and verify handler end-effector clearance across affected cassette slots.',
    ),
    makeHypothesis(
      'hyp:scratch:cmp-slurry-gouge',
      'Scratch',
      'fab-process',
      'Candidate mechanism: CMP slurry agglomerate or pad-conditioner debris dragging a linear micro-scratch across adjacent dies.',
      'check CMP point-of-use slurry filter differential pressure and inline post-CMP defect inspection maps.',
    ),
    makeHypothesis(
      'hyp:scratch:probe-scrub',
      'Scratch',
      'test-hardware',
      'Candidate mechanism: prober z-stage overdrive excursion or loose probe needle dragging across bond pads during stepping.',
      'examine bond-pad probe scrub marks under optical microscopy and verify prober z-overdrive calibration.',
    ),
  ],
  'Edge-Loc': [
    makeHypothesis(
      'hyp:edge-loc:clamp-aligner-contact',
      'Edge-Loc',
      'mechanical-handling',
      'Candidate mechanism: localized mechanical contact from an aligner chuck, clamp finger, or FOUP slot near the wafer edge.',
      'align cluster angle relative to the wafer notch/flat against tool clamp and transfer contact points.',
    ),
    makeHypothesis(
      'hyp:edge-loc:edge-litho-defocus',
      'Edge-Loc',
      'lithography-clean',
      'Candidate mechanism: localized lithography leveling defocus on partial edge exposure fields or EBR solvent splashback.',
      'review scanner edge-field leveling residuals and inline bevel defect inspection images.',
    ),
    makeHypothesis(
      'hyp:edge-loc:edge-cooling-asymmetry',
      'Edge-Loc',
      'fab-process',
      'Candidate mechanism: localized backside helium cooling leak or chamber exhaust port asymmetry heating a peripheral sector.',
      'check electrostatic chuck helium leak-rate logs and chamber exhaust orientation.',
    ),
  ],
  Loc: [
    makeHypothesis(
      'hyp:loc:particle-droplet-cluster',
      'Loc',
      'lithography-clean',
      'Candidate mechanism: localized particle contamination event or wet-clean drying droplet residue bridging adjacent dies.',
      'overlay inline optical defect maps by process layer to isolate the step where the cluster appeared.',
    ),
    makeHypothesis(
      'hyp:loc:chuck-hotspot-defocus',
      'Loc',
      'lithography-clean',
      'Candidate mechanism: backside chuck particle lifting a bounded interior patch out of scanner focal depth.',
      'inspect lithography scanner z-leveling focus maps at the cluster coordinates.',
    ),
    makeHypothesis(
      'hyp:loc:local-thermal-patch',
      'Loc',
      'fab-process',
      'Candidate mechanism: localized chuck contact or rapid-thermal-anneal hot spot shifting parametric margins in a bounded region.',
      'check spatial parametric gradients around the cluster for smooth thermal roll-off versus hard opens/shorts.',
    ),
  ],
  'Near-full': [
    makeHypothesis(
      'hyp:near-full:test-setup-chucking',
      'Near-full',
      'test-hardware',
      'Candidate mechanism: unpowered ATE supply rail, 1-die prober index offset, wafer mis-chucking, or incorrect test limit load rather than silicon loss.',
      'verify supply rail continuity, bond-pad probe registration on fiducial dies, and loaded test program revision before dispositioning wafers.',
    ),
    makeHypothesis(
      'hyp:near-full:catastrophic-fab-excursion',
      'Near-full',
      'fab-process',
      'Candidate mechanism: wafer-wide fab excursion such as a skipped mask/implant step, film delamination, or severe thermal runaway.',
      'audit fab lot route history, skipped-operation flags, and scribe-line WAT/PCM electrical monitors.',
    ),
  ],
  Random: [
    makeHypothesis(
      'hyp:random:baseline-point-defectivity',
      'Random',
      'fab-process',
      'Candidate mechanism: spatially uncorrelated point defects (particles, pinholes, or random oxide defects) consistent with baseline defect density, or a non-spatial test-site issue.',
      'verify test-site yield balance first, then compare fail density against historical D0 particle monitors.',
    ),
    makeHypothesis(
      'hyp:random:parametric-guardband-tail',
      'Random',
      'test-hardware',
      'Candidate mechanism: stochastic die-to-die process spread clipping a tight parametric limit without spatial clustering.',
      'inspect Cp/Cpk and measurement histograms for the dominant failing bin test.',
    ),
  ],
};

/**
 * Returns structured, hedged engineering root-cause hypotheses for a WM-811K class.
 * Returns an empty array for `'None'` per Requirement 9.3.
 */
export function getPatternRootCauseHypotheses(
  pattern: Wm811kClass,
): readonly RootCauseHypothesis[] {
  if (pattern === 'None') {
    return [];
  }
  return PATTERN_HYPOTHESIS_CATALOG[pattern];
}

/**
 * Returns formatted plain-text candidate hypothesis strings (`"<mechanism> Check next: <step>"`)
 * for `PatternClassification.candidateHypotheses`. Returns `[]` for `'None'`.
 */
export function formatPatternCandidateHypotheses(
  pattern: Wm811kClass,
): readonly string[] {
  if (pattern === 'None') {
    return [];
  }
  return PATTERN_HYPOTHESIS_CATALOG[pattern].map((h) => h.summary);
}

/**
 * Returns structured, hedged test-hardware root-cause hypotheses for a multi-site
 * concentration anomaly (Requirement 7.4 & Requirement 9.3), pointing investigation
 * to probe-card and tester-channel hardware rather than wafer fabrication.
 */
export function getSiteConcentrationHypotheses(site?: {
  readonly headNum: number;
  readonly siteNum: number;
}): readonly RootCauseHypothesis[] {
  const siteScope =
    site !== undefined
      ? `Head ${site.headNum} Site ${site.siteNum} (${site.headNum}:${site.siteNum})`
      : 'the flagged test site';

  return [
    makeHypothesis(
      'hyp:site:probe-needle-contact',
      'site-concentration',
      'test-hardware',
      `Candidate mechanism: probe-card needle contamination, oxide build-up, or needle tip planarity wear on ${siteScope} elevating contact resistance rather than wafer fabrication loss.`,
      `execute a probe-card cleaning cycle, inspect needle scrub marks and tip planarity on ${siteScope}, and review contact-resistance PTR trends.`,
    ),
    makeHypothesis(
      'hyp:site:tester-channel-pib',
      'site-concentration',
      'test-hardware',
      `Candidate mechanism: degraded ATE tester channel, pogo-pin spring contactor, or probe-interface-board (PIB) relay isolated to ${siteScope}.`,
      `run tester channel diagnostics/loopback calibration on ${siteScope} and inspect PIB relay continuity.`,
    ),
    makeHypothesis(
      'hyp:site:kelvin-decoupling',
      'site-concentration',
      'test-hardware',
      `Candidate mechanism: open Kelvin sense trace or degraded local supply decoupling capacitor on ${siteScope} probe-card routing.`,
      `compare first-pass versus retest recovery on ${siteScope} and measure per-site supply droop under load.`,
    ),
  ];
}

/**
 * Returns formatted plain-text candidate hypothesis strings for a test-site concentration anomaly.
 */
export function formatSiteConcentrationHypotheses(site?: {
  readonly headNum: number;
  readonly siteNum: number;
}): readonly string[] {
  return getSiteConcentrationHypotheses(site).map((h) => h.summary);
}
