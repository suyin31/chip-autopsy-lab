import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_NAMES,
  ACCENT_PALETTES,
  BIN_DISC_PALETTE,
  BIN_INK_PALETTE_LIGHT,
  compositeRgbaOverRgb,
  formatHexColor,
  getAccentTokens,
  getBinColor,
  getFailBinColor,
  getFailDieColor,
  parseHexColor,
  parseRgbaString,
  THEME_TOKENS,
  WAFER_TOKENS,
  wcagContrastRatio,
  type AccentName,
  type RgbTuple,
  type ThemeName,
  type ThemeTokens,
} from './index';

/** Resolves a `#hex` or `rgba()` token to the opaque colour it shows over `bg`. */
function resolveOver(token: string, bg: RgbTuple): RgbTuple {
  return token.startsWith('#')
    ? parseHexColor(token)
    : compositeRgbaOverRgb(parseRgbaString(token), bg);
}

function ratio(fg: string, bgHex: string): number {
  const bg = parseHexColor(bgHex);
  return wcagContrastRatio(resolveOver(fg, bg), bg);
}

/** premium.md states ratios to one decimal; allow the rounding half-step. */
const ROUNDING = 0.05;

const THEMES: readonly ThemeName[] = ['light', 'dark'];

describe('premium UI colour tokens (premium.md §3.2)', () => {
  it('locks the light and dark surface, fill, text, and ink values', () => {
    expect(THEME_TOKENS.light).toMatchObject({
      bg: '#F2F5F8',
      surface: '#FFFFFF',
      surfaceSunken: '#E3EAF0',
      fill1: '#E9EFF4',
      fill2: '#DFE8EF',
      fill3: 'rgba(0, 0, 0, 0.08)',
      hairline: 'rgba(10, 21, 30, 0.10)',
      hairlineStrong: 'rgba(10, 21, 30, 0.20)',
      textPrimary: '#0A151E',
      textSecondary: '#3C4E5A',
      textTertiary: '#556771',
      textDisabled: 'rgba(10, 21, 30, 0.32)',
      ink: '#0A151E',
      onInk: '#FFFFFF',
      ember: '#C0203A',
      emberMark: '#C0203A',
      emberInk: '#A81530',
      selection: 'rgba(10, 21, 30, 0.14)',
      barNeutral: 'rgba(10, 21, 30, 0.14)',
      themeColor: '#F2F5F8',
    });
    expect(THEME_TOKENS.dark).toMatchObject({
      bg: '#080B12',
      surface: '#0E131D',
      surfaceSunken: '#131A26',
      fill1: 'rgba(255, 255, 255, 0.05)',
      fill2: 'rgba(255, 255, 255, 0.08)',
      fill3: 'rgba(255, 255, 255, 0.12)',
      hairline: 'rgba(255, 255, 255, 0.08)',
      hairlineStrong: 'rgba(255, 255, 255, 0.16)',
      textPrimary: 'rgba(233, 240, 250, 0.94)',
      textSecondary: 'rgba(196, 210, 228, 0.68)',
      textTertiary: 'rgba(178, 194, 214, 0.66)',
      textDisabled: 'rgba(255, 255, 255, 0.26)',
      ink: '#EDF3FB',
      onInk: '#070A10',
      ember: '#FF5C7C',
      emberMark: '#FF5C7C',
      emberInk: '#FF87A0',
      selection: 'rgba(255, 255, 255, 0.22)',
      barNeutral: 'rgba(255, 255, 255, 0.20)',
      themeColor: '#080B12',
    });
  });

  it('locks materials, scrim, and focus ring per theme (§3.2, §3.8)', () => {
    expect(THEME_TOKENS.light.material).toEqual({
      color: 'rgba(244, 247, 250, 0.66)',
      backdropFilter: 'blur(28px) saturate(150%)',
    });
    expect(THEME_TOKENS.dark.material).toEqual({
      color: 'rgba(10, 15, 24, 0.64)',
      backdropFilter: 'blur(28px) saturate(170%)',
    });
    expect(THEME_TOKENS.light.materialThick.color).toBe(
      'rgba(255, 255, 255, 0.86)',
    );
    expect(THEME_TOKENS.dark.materialThick.color).toBe('rgba(16, 22, 34, 0.86)');
    expect(THEME_TOKENS.light.materialThick.backdropFilter).toBe(
      'blur(30px) saturate(150%)',
    );
    expect(THEME_TOKENS.dark.materialThick.backdropFilter).toBe(
      'blur(30px) saturate(170%)',
    );
    expect(THEME_TOKENS.light.scrim).toEqual({
      color: 'rgba(240, 244, 248, 0.60)',
      backdropFilter: 'blur(30px)',
    });
    expect(THEME_TOKENS.dark.scrim).toEqual({
      color: 'rgba(4, 7, 12, 0.62)',
      backdropFilter: 'blur(32px)',
    });
    expect(THEME_TOKENS.light.focusRing).toBe(
      '0 0 0 2px var(--bg), 0 0 0 4px #0A151E',
    );
    expect(THEME_TOKENS.dark.focusRing).toBe(
      '0 0 0 2px #080B12, 0 0 0 4px rgba(233, 240, 250, 0.92)',
    );
  });

  it('keeps text-tertiary >= 4.5:1 on bg, surface, and surface-sunken in both themes', () => {
    for (const theme of THEMES) {
      const t = THEME_TOKENS[theme];
      for (const bg of [t.bg, t.surface, t.surfaceSunken]) {
        expect(ratio(t.textTertiary, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('meets the contrast floors of the atelier palette (§3.2)', () => {
    const L = THEME_TOKENS.light;
    const D = THEME_TOKENS.dark;
    // Text tiers: WCAG AA body floors on every surface they are drawn on.
    const textCases: readonly [string, string][] = [
      [L.textPrimary, L.bg],
      [L.textPrimary, L.surface],
      [L.textSecondary, L.bg],
      [L.textSecondary, L.surfaceSunken],
      [L.textTertiary, L.bg],
      [L.textTertiary, L.surface],
      [L.textTertiary, L.surfaceSunken],
      [D.textPrimary, D.bg],
      [D.textPrimary, D.surface],
      [D.textSecondary, D.surfaceSunken],
      [D.textTertiary, D.surfaceSunken],
    ];
    for (const [fg, bg] of textCases) {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
    // Graphics floors: the signal hue clears 3:1 on the page and on the disc.
    for (const [fg, bg] of [
      [L.emberMark, L.bg],
      [L.emberMark, L.surface],
      [L.emberInk, L.bg],
      [D.emberMark, D.surface],
      [D.emberInk, D.bg],
    ] as const) {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3.0);
    }
    // The failing-die signal stays >= 5:1 on the dark silicon disc.
    expect(ratio(WAFER_TOKENS.failDie, WAFER_TOKENS.discMid)).toBeGreaterThanOrEqual(5.0);
  });

  it('keeps text on ink buttons legible in both themes', () => {
    for (const theme of THEMES) {
      const t = THEME_TOKENS[theme];
      expect(ratio(t.onInk, t.ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('defines theme-dependent elevation (§3.7): soft layered shadows in light, rings in dark', () => {
    expect(THEME_TOKENS.light.shadowCard).toBe(
      '0 0 0 1px rgba(10, 21, 30, 0.05), 0 1px 2px rgba(10, 21, 30, 0.04), 0 14px 34px -18px rgba(10, 21, 30, 0.28)',
    );
    expect(THEME_TOKENS.light.shadowPopover).toBe(
      '0 0 0 1px rgba(10, 21, 30, 0.07), 0 10px 24px -10px rgba(10, 21, 30, 0.20), 0 32px 64px -24px rgba(10, 21, 30, 0.30)',
    );
    expect(THEME_TOKENS.dark.shadowCard).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.075)',
    );
    expect(THEME_TOKENS.dark.shadowCardHover).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.14)',
    );
    expect(THEME_TOKENS.dark.shadowPopover).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.10), 0 28px 56px rgba(0, 0, 0, 0.62)',
    );
    expect(THEME_TOKENS.dark.shadowThumb).toBe('none');
    for (const key of ['shadowCard', 'shadowCardHover', 'shadowChevron'] as const) {
      expect(THEME_TOKENS.dark[key].startsWith('inset ')).toBe(true);
      expect(THEME_TOKENS.light[key]).not.toContain('inset');
    }
  });
});

describe('wafer tokens (premium.md §3.3)', () => {
  it('locks the disc body, film, bevel, and die values', () => {
    expect(WAFER_TOKENS).toMatchObject({
      discHi: '#2A3146',
      discMid: '#1A2033',
      discLo: '#10141F',
      bevelTop: 'rgba(255, 255, 255, 0.38)',
      bevelBottom: 'rgba(255, 255, 255, 0.06)',
      bevelInner: 'rgba(0, 0, 0, 0.45)',
      exclusionLine: 'rgba(255, 255, 255, 0.05)',
      passTile: 'rgba(255, 255, 255, 0.06)',
      passTileHc: 'rgba(255, 255, 255, 0.34)',
      failDie: '#FF5C7C',
      failFacet: 'rgba(255, 255, 255, 0.18)',
      dimVeil: 'rgba(16, 20, 31, 0.78)',
      evidenceRim: 'rgba(255, 255, 255, 0.90)',
    });
    expect(WAFER_TOKENS.film).toEqual([
      'rgba(120, 150, 255, 0.06)',
      'rgba(180, 120, 255, 0.05)',
      'rgba(90, 220, 200, 0.04)',
      'rgba(255, 190, 120, 0.04)',
    ]);
    expect(WAFER_TOKENS.selectionRect.radiusPx).toBe(4);
    expect(WAFER_TOKENS.pinnedStroke).toMatchObject({ inner: '#FFFFFF', outer: '#000000' });
  });

  it('composites the pass tiles to the stated colours and ratios on disc-mid', () => {
    const mid = parseHexColor(WAFER_TOKENS.discMid);
    const passTile = compositeRgbaOverRgb(parseRgbaString(WAFER_TOKENS.passTile), mid);
    const passTileHc = compositeRgbaOverRgb(
      parseRgbaString(WAFER_TOKENS.passTileHc),
      mid,
    );
    expect(formatHexColor(passTile)).toBe('#282D3F');
    expect(formatHexColor(passTileHc)).toBe('#686C78');

    // Pass tile is texture only (1.19:1); the high-contrast fallback clears 3:1 (A13)
    expect(wcagContrastRatio(passTile, mid)).toBeCloseTo(1.18, 1);
    expect(wcagContrastRatio(passTile, mid)).toBeLessThan(1.5);
    expect(wcagContrastRatio(passTileHc, mid)).toBeGreaterThanOrEqual(3.0);
    expect(wcagContrastRatio(passTileHc, mid)).toBeGreaterThanOrEqual(3.1 - ROUNDING);

    // Fail die: 5.4:1 on disc-mid, 4.6:1 on a pass tile (still far above the 3:1 graphics floor)
    const fail = parseHexColor(WAFER_TOKENS.failDie);
    expect(wcagContrastRatio(fail, mid)).toBeGreaterThanOrEqual(5.0 - ROUNDING);
    expect(wcagContrastRatio(fail, passTile)).toBeGreaterThanOrEqual(4.5 - ROUNDING);
  });

  it('tints the dim veil with the disc colour so dimmed ember stays ember-hued', () => {
    const veil = parseRgbaString(WAFER_TOKENS.dimVeil);
    const disc = parseHexColor(WAFER_TOKENS.discLo);
    expect({ r: veil.r, g: veil.g, b: veil.b }).toEqual(disc);
    const dimmed = compositeRgbaOverRgb(veil, parseHexColor(WAFER_TOKENS.failDie));
    // Red stays the dominant channel under the veil (the failure signal never turns grey or violet)
    expect(dimmed.r).toBeGreaterThan(dimmed.g);
    expect(dimmed.r).toBeGreaterThan(dimmed.b);
  });
});

describe('bin palettes (premium.md §3.5)', () => {
  it('locks disc and light-page palettes with rank 0 ember', () => {
    expect(BIN_DISC_PALETTE).toEqual([
      '#FF5C7C',
      '#00ACEA',
      '#AE90F3',
      '#FD7584',
      '#B99F35',
      '#00B0C8',
      '#E87AC7',
      '#61A1FF',
    ]);
    expect(BIN_INK_PALETTE_LIGHT).toEqual([
      '#C0203A',
      '#0A6FB0',
      '#7353C9',
      '#C23A55',
      '#7A6510',
      '#007A8C',
      '#A63E8C',
      '#2D63CC',
    ]);
    expect(BIN_INK_PALETTE_LIGHT[0]).toBe(THEME_TOKENS.light.emberMark);
    expect(THEME_TOKENS.dark.binInk).toEqual(BIN_DISC_PALETTE);
    expect(THEME_TOKENS.light.binInk).toEqual(BIN_INK_PALETTE_LIGHT);
  });

  it('keeps disc bins at >= 6:1 on disc-mid and light-page bins (ranks 1-7) >= 4.5:1 on the cool pearl bg', () => {
    for (const hex of BIN_DISC_PALETTE.slice(1)) {
      expect(ratio(hex, WAFER_TOKENS.discMid)).toBeGreaterThanOrEqual(6.0);
    }
    for (const hex of BIN_INK_PALETTE_LIGHT.slice(1)) {
      expect(ratio(hex, THEME_TOKENS.light.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('getBinColor returns ember for rank 0 and cycles ranks 1+ through 7 hues per surface', () => {
    expect(getBinColor(0, 'disc')).toBe('#FF5C7C');
    expect(getBinColor(0, 'light')).toBe('#C0203A');
    expect(getBinColor(0, 'dark')).toBe('#FF5C7C');
    expect(getBinColor(1, 'light')).toBe('#0A6FB0');
    expect(getBinColor(7, 'disc')).toBe('#61A1FF');
    expect(getBinColor(8, 'disc')).toBe('#00ACEA');
    expect(getBinColor(8, 'light')).toBe('#0A6FB0');
    expect(getBinColor(-3, 'dark')).toBe('#FF5C7C');
  });
});

describe('globals.css theme variables (premium.md §3.1)', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const css = fs.readFileSync(path.join(repoRoot, 'src/app/globals.css'), 'utf8');

  function block(selectorPattern: RegExp): Map<string, string> {
    const match = selectorPattern.exec(css);
    expect(match, `missing block ${selectorPattern}`).not.toBeNull();
    const body = match?.[1] ?? '';
    const vars = new Map<string, string>();
    for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
      vars.set(m[1], m[2].trim().toLowerCase());
    }
    return vars;
  }

  function expectedVars(t: ThemeTokens): Record<string, string> {
    const out: Record<string, string> = {
      '--bg': t.bg,
      '--surface': t.surface,
      '--surface-sunken': t.surfaceSunken,
      '--fill-1': t.fill1,
      '--fill-2': t.fill2,
      '--fill-3': t.fill3,
      '--material': t.material.color,
      '--material-filter': t.material.backdropFilter,
      '--material-thick': t.materialThick.color,
      '--material-thick-filter': t.materialThick.backdropFilter,
      '--scrim': t.scrim.color,
      '--scrim-filter': t.scrim.backdropFilter,
      '--hairline': t.hairline,
      '--hairline-strong': t.hairlineStrong,
      '--text-primary': t.textPrimary,
      '--text-secondary': t.textSecondary,
      '--text-tertiary': t.textTertiary,
      '--text-disabled': t.textDisabled,
      '--ink': t.ink,
      '--on-ink': t.onInk,
      '--ember': t.ember,
      '--ember-mark': t.emberMark,
      '--ember-ink': t.emberInk,
      '--ember-soft': t.emberSoft,
      '--focus-ring': t.focusRing,
      '--selection': t.selection,
      '--bar-neutral': t.barNeutral,
      '--elevation-card': t.shadowCard,
      '--elevation-card-hover': t.shadowCardHover,
      '--elevation-popover': t.shadowPopover,
      '--elevation-thumb': t.shadowThumb,
      '--elevation-chevron': t.shadowChevron,
    };
    t.binInk.forEach((hex, i) => {
      out[`--bin-ink-${i}`] = hex;
    });
    return Object.fromEntries(
      Object.entries(out).map(([k, v]) => [k, v.toLowerCase()]),
    );
  }

  it('mirrors THEME_TOKENS under :root[data-theme="light"] and :root[data-theme="dark"]', () => {
    const light = block(/:root\[data-theme="light"\] \{([^}]*)\}/);
    const dark = block(/:root,\s*:root\[data-theme="dark"\] \{([^}]*)\}/);
    expect(Object.fromEntries(light)).toEqual(expectedVars(THEME_TOKENS.light));
    expect(Object.fromEntries(dark)).toEqual(expectedVars(THEME_TOKENS.dark));
  });

  it('maps the theme variables in @theme inline and uses the data-theme dark variant', () => {
    expect(css).toContain(
      '@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));',
    );
    const inline = block(/@theme inline \{([^}]*)\}/);
    for (const name of [
      'bg',
      'surface',
      'surface-sunken',
      'fill-1',
      'fill-2',
      'fill-3',
      'material',
      'material-thick',
      'scrim',
      'hairline',
      'hairline-strong',
      'text-primary',
      'text-secondary',
      'text-tertiary',
      'text-disabled',
      'ink',
      'on-ink',
      'ember',
      'ember-mark',
      'ember-ink',
      'ember-soft',
      'bar-neutral',
    ]) {
      expect(inline.get(`--color-${name}`)).toBe(`var(--${name})`);
    }
    for (const name of ['card', 'card-hover', 'popover', 'thumb', 'chevron']) {
      expect(inline.get(`--shadow-${name}`)).toBe(`var(--elevation-${name})`);
    }
  });

  it('defines premium radii, z-layers, and motion durations', () => {
    for (const decl of [
      '--radius-xs: 4px;',
      '--radius-sm: 8px;',
      '--radius-md: 12px;',
      '--radius-lg: 16px;',
      '--radius-xl: 20px;',
      '--radius-2xl: 24px;',
      '--radius-3xl: 28px;',
      '--radius-pill: 999px;',
      '--z-hints: 35;',
      '--z-tooltips: 55;',
      '--dur-0: 0ms;',
      '--dur-1: 120ms;',
      '--dur-2: 160ms;',
      '--dur-3: 240ms;',
      '--dur-4: 280ms;',
      '--ease-in-out: cubic-bezier(0.45, 0, 0.25, 1);',
    ]) {
      expect(css).toContain(decl);
    }
  });

  it('samples spring-ui for CSS without overshoot (bounce 0)', () => {
    const match = /--ease-spring-ui: linear\(([^)]*)\);/.exec(css);
    expect(match).not.toBeNull();
    const points = (match?.[1] ?? '').split(',').map((v) => Number(v.trim()));
    expect(points[0]).toBe(0);
    expect(points[points.length - 1]).toBe(1);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]).toBeLessThanOrEqual(1);
      expect(points[i]).toBeGreaterThanOrEqual(points[i - 1]);
    }
  });

  it('mirrors ACCENT_PALETTES under :root[data-accent] for both light and dark themes', () => {
    for (const accent of ACCENT_NAMES) {
      if (accent === 'ember') continue;
      const darkBlock = block(
        new RegExp(
          `:root\\[data-accent="${accent}"\\],\\s*:root\\[data-theme="dark"\\]\\[data-accent="${accent}"\\]\\s*\\{([^}]*)\\}`,
        ),
      );
      const lightBlock = block(
        new RegExp(
          `:root\\[data-theme="light"\\]\\[data-accent="${accent}"\\]\\s*\\{([^}]*)\\}`,
        ),
      );
      const darkTokens = getAccentTokens(accent, 'dark');
      const lightTokens = getAccentTokens(accent, 'light');
      expect(Object.fromEntries(darkBlock)).toEqual({
        '--ember': darkTokens.ember.toLowerCase(),
        '--ember-mark': darkTokens.emberMark.toLowerCase(),
        '--ember-ink': darkTokens.emberInk.toLowerCase(),
        '--ember-soft': darkTokens.emberSoft.toLowerCase(),
        '--bin-ink-0': darkTokens.emberMark.toLowerCase(),
      });
      expect(Object.fromEntries(lightBlock)).toEqual({
        '--ember': lightTokens.ember.toLowerCase(),
        '--ember-mark': lightTokens.emberMark.toLowerCase(),
        '--ember-ink': lightTokens.emberInk.toLowerCase(),
        '--ember-soft': lightTokens.emberSoft.toLowerCase(),
        '--bin-ink-0': lightTokens.emberMark.toLowerCase(),
      });
    }
  });
});

describe('user-selectable accent palettes (data-accent)', () => {
  it('defines ember, cobalt, jade, and violet with ember matching THEME_TOKENS', () => {
    expect(ACCENT_NAMES).toEqual(['ember', 'cobalt', 'jade', 'violet']);
    expect(ACCENT_PALETTES.ember.light).toEqual({
      ember: THEME_TOKENS.light.ember,
      emberMark: THEME_TOKENS.light.emberMark,
      emberInk: THEME_TOKENS.light.emberInk,
      emberSoft: THEME_TOKENS.light.emberSoft,
    });
    expect(ACCENT_PALETTES.ember.dark).toEqual({
      ember: THEME_TOKENS.dark.ember,
      emberMark: THEME_TOKENS.dark.emberMark,
      emberInk: THEME_TOKENS.dark.emberInk,
      emberSoft: THEME_TOKENS.dark.emberSoft,
    });
  });

  it('meets contrast floors across all 4 accents on the pearl bg, dark surfaces, and the silicon disc', () => {
    const L = THEME_TOKENS.light;
    const D = THEME_TOKENS.dark;
    const discMid = parseHexColor(WAFER_TOKENS.discMid);
    const passTile = compositeRgbaOverRgb(parseRgbaString(WAFER_TOKENS.passTile), discMid);

    for (const accent of ACCENT_NAMES) {
      const light = ACCENT_PALETTES[accent].light;
      const dark = ACCENT_PALETTES[accent].dark;

      // Disc failing die: the disc is always the dark silicon one, so it reads the dark accent
      expect(getFailDieColor(accent)).toBe(dark.ember);
      const failRgb = parseHexColor(dark.ember);
      expect(wcagContrastRatio(failRgb, discMid), `${accent} failDie on discMid`).toBeGreaterThanOrEqual(5.0 - ROUNDING);
      expect(wcagContrastRatio(failRgb, passTile), `${accent} failDie on passTile`).toBeGreaterThanOrEqual(4.5 - ROUNDING);

      // Marks: >= 3:1 on the pearl bg and white surface, >= 4.5:1 on the dark surface
      expect(ratio(light.emberMark, L.bg), `${accent} light mark on bg`).toBeGreaterThanOrEqual(3.0);
      expect(ratio(light.emberMark, L.surface), `${accent} light mark on surface`).toBeGreaterThanOrEqual(3.0);
      expect(ratio(dark.emberMark, D.surface), `${accent} dark mark on surface`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(dark.emberMark, D.bg), `${accent} dark mark on bg`).toBeGreaterThanOrEqual(4.5);

      // Ink: >= 4.5:1 on all dark surfaces; cobalt/jade/violet >= 4.5:1 on light paper #F6F3EE as well
      for (const darkBg of [D.bg, D.surface, D.surfaceSunken]) {
        expect(ratio(dark.emberInk, darkBg), `${accent} dark ink on ${darkBg}`).toBeGreaterThanOrEqual(4.5);
      }
      if (accent === 'ember') {
        expect(ratio(light.emberInk, L.bg)).toBeGreaterThanOrEqual(3.0);
      } else {
        expect(ratio(light.emberInk, L.bg), `${accent} light ink on #F6F3EE`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(light.emberInk, L.surface), `${accent} light ink on #FFFFFF`).toBeGreaterThanOrEqual(4.5);
      }

      // Soft tint parses cleanly as a translucent rgba()
      const softLight = parseRgbaString(light.emberSoft);
      const softDark = parseRgbaString(dark.emberSoft);
      expect(softLight.a).toBeGreaterThan(0);
      expect(softLight.a).toBeLessThanOrEqual(0.25);
      expect(softDark.a).toBeGreaterThan(0);
      expect(softDark.a).toBeLessThanOrEqual(0.25);
    }
  });

  it('routes rank-0 bin colours through the active accent while keeping secondary ranks unchanged', () => {
    const nonDefault: readonly AccentName[] = ['cobalt', 'jade', 'violet'];
    for (const accent of nonDefault) {
      expect(getBinColor(0, 'disc', accent)).toBe(ACCENT_PALETTES[accent].dark.ember);
      expect(getBinColor(0, 'light', accent)).toBe(ACCENT_PALETTES[accent].light.emberMark);
      expect(getBinColor(0, 'dark', accent)).toBe(ACCENT_PALETTES[accent].dark.emberMark);
      expect(getFailBinColor(0, accent)).toBe(ACCENT_PALETTES[accent].dark.ember);

      // Secondary ranks stay invariant
      expect(getBinColor(1, 'disc', accent)).toBe(BIN_DISC_PALETTE[1]);
      expect(getBinColor(1, 'light', accent)).toBe(BIN_INK_PALETTE_LIGHT[1]);
      expect(getFailBinColor(1, accent)).toBe(BIN_DISC_PALETTE[1]);
    }
  });
});
