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
      bg: '#F6F3EE',
      surface: '#FFFFFF',
      surfaceSunken: '#EBEBEF',
      fill1: '#EFEBE4',
      fill2: '#E6E1D8',
      fill3: 'rgba(0, 0, 0, 0.08)',
      hairline: 'rgba(32, 30, 31, 0.10)',
      hairlineStrong: 'rgba(32, 30, 31, 0.18)',
      textPrimary: '#201E1F',
      textSecondary: '#534F49',
      textTertiary: '#6D6963',
      textDisabled: 'rgba(29, 29, 31, 0.32)',
      ink: '#201E1F',
      onInk: '#FFFFFF',
      ember: '#FF6B2C',
      emberMark: '#E8591E',
      emberInk: '#D94E14',
      selection: 'rgba(29, 29, 31, 0.14)',
      barNeutral: 'rgba(0, 0, 0, 0.16)',
      themeColor: '#F6F3EE',
    });
    expect(THEME_TOKENS.dark).toMatchObject({
      bg: '#000000',
      surface: '#111113',
      surfaceSunken: '#1C1C1F',
      fill1: 'rgba(255, 255, 255, 0.05)',
      fill2: 'rgba(255, 255, 255, 0.08)',
      fill3: 'rgba(255, 255, 255, 0.12)',
      hairline: 'rgba(255, 255, 255, 0.08)',
      hairlineStrong: 'rgba(255, 255, 255, 0.16)',
      textPrimary: 'rgba(255, 255, 255, 0.92)',
      textSecondary: 'rgba(255, 255, 255, 0.64)',
      textTertiary: 'rgba(255, 255, 255, 0.56)',
      textDisabled: 'rgba(255, 255, 255, 0.28)',
      ink: '#F5F5F7',
      onInk: '#000000',
      ember: '#FF6B2C',
      emberMark: '#FF6B2C',
      emberInk: '#FF8A57',
      selection: 'rgba(255, 255, 255, 0.22)',
      barNeutral: 'rgba(255, 255, 255, 0.22)',
      themeColor: '#000000',
    });
  });

  it('locks materials, scrim, and focus ring per theme (§3.2, §3.8)', () => {
    expect(THEME_TOKENS.light.material).toEqual({
      color: 'rgba(246, 243, 238, 0.80)',
      backdropFilter: 'blur(20px) saturate(180%)',
    });
    expect(THEME_TOKENS.dark.material).toEqual({
      color: 'rgba(22, 22, 24, 0.72)',
      backdropFilter: 'blur(24px) saturate(180%)',
    });
    expect(THEME_TOKENS.light.materialThick.color).toBe(
      'rgba(255, 255, 255, 0.92)',
    );
    expect(THEME_TOKENS.dark.materialThick.color).toBe('rgba(28, 28, 30, 0.88)');
    for (const theme of THEMES) {
      expect(THEME_TOKENS[theme].materialThick.backdropFilter).toBe(
        'blur(24px) saturate(180%)',
      );
    }
    expect(THEME_TOKENS.light.scrim).toEqual({
      color: 'rgba(245, 245, 247, 0.60)',
      backdropFilter: 'blur(24px)',
    });
    expect(THEME_TOKENS.dark.scrim).toEqual({
      color: 'rgba(0, 0, 0, 0.55)',
      backdropFilter: 'blur(32px)',
    });
    expect(THEME_TOKENS.light.focusRing).toBe(
      '0 0 0 2px var(--bg), 0 0 0 4px #201E1F',
    );
    expect(THEME_TOKENS.dark.focusRing).toBe(
      '0 0 0 2px #000000, 0 0 0 4px rgba(255, 255, 255, 0.92)',
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

  it('meets every contrast ratio stated in §3.2', () => {
    const L = THEME_TOKENS.light;
    const D = THEME_TOKENS.dark;
    const cases: readonly [string, string, number][] = [
      // premium §12.1 warm paper: ink #201E1F on bg #F6F3EE is 15.0:1, on white 16.6:1
      [L.textPrimary, L.bg, 15.0],
      [L.textPrimary, L.surface, 16.6],
      [L.textSecondary, L.bg, 7.3],
      [L.textSecondary, L.surfaceSunken, 6.7],
      [L.textTertiary, L.bg, 4.9],
      [L.textTertiary, L.surface, 5.4],
      [L.textTertiary, L.surfaceSunken, 4.5],
      // §12.1 warm paper lowers ember-mark on bg from 3.3 to 3.2:1, still above the 3:1 graphics floor
      [L.emberMark, L.bg, 3.2],
      [L.emberMark, L.surface, 3.6],
      [L.emberInk, L.bg, 3.8],
      [D.textPrimary, D.bg, 17.6],
      [D.textPrimary, D.surface, 15.2],
      [D.textSecondary, D.surfaceSunken, 6.6],
      [D.textTertiary, D.surfaceSunken, 5.2],
      [D.emberMark, D.surface, 6.6],
      [D.emberInk, D.bg, 9.0],
      [WAFER_TOKENS.failDie, WAFER_TOKENS.discMid, 5.9],
    ];
    for (const [fg, bg, stated] of cases) {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(stated - ROUNDING);
    }
    // The tertiary floor itself is a hard 4.5, not a rounded value
    expect(ratio(L.textTertiary, L.surfaceSunken)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps text on ink buttons legible in both themes', () => {
    for (const theme of THEMES) {
      const t = THEME_TOKENS[theme];
      expect(ratio(t.onInk, t.ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('defines theme-dependent elevation (§3.7): soft layered shadows in light, rings in dark', () => {
    expect(THEME_TOKENS.light.shadowCard).toBe(
      '0 0 0 1px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.05)',
    );
    expect(THEME_TOKENS.light.shadowPopover).toBe(
      '0 0 0 1px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.08), 0 24px 48px rgba(0, 0, 0, 0.12)',
    );
    expect(THEME_TOKENS.dark.shadowCard).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
    );
    expect(THEME_TOKENS.dark.shadowCardHover).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.13)',
    );
    expect(THEME_TOKENS.dark.shadowPopover).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.10), 0 24px 48px rgba(0, 0, 0, 0.60)',
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
      discHi: '#2B2D33',
      discMid: '#1C1D21',
      discLo: '#121316',
      bevelTop: 'rgba(255, 255, 255, 0.38)',
      bevelBottom: 'rgba(255, 255, 255, 0.06)',
      bevelInner: 'rgba(0, 0, 0, 0.45)',
      exclusionLine: 'rgba(255, 255, 255, 0.05)',
      passTile: 'rgba(255, 255, 255, 0.06)',
      passTileHc: 'rgba(255, 255, 255, 0.34)',
      failDie: '#FF6B2C',
      failFacet: 'rgba(255, 255, 255, 0.18)',
      dimVeil: 'rgba(18, 19, 22, 0.78)',
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
    expect(formatHexColor(passTile)).toBe('#2A2B2E');
    expect(formatHexColor(passTileHc)).toBe('#696A6C');

    // Pass tile is texture only (1.19:1); the high-contrast fallback clears 3:1 (A13)
    expect(wcagContrastRatio(passTile, mid)).toBeCloseTo(1.19, 1);
    expect(wcagContrastRatio(passTile, mid)).toBeLessThan(1.5);
    expect(wcagContrastRatio(passTileHc, mid)).toBeGreaterThanOrEqual(3.0);
    expect(wcagContrastRatio(passTileHc, mid)).toBeGreaterThanOrEqual(3.1 - ROUNDING);

    // Fail die: 5.9:1 on disc-mid, 5.0:1 on a pass tile
    const fail = parseHexColor(WAFER_TOKENS.failDie);
    expect(wcagContrastRatio(fail, mid)).toBeGreaterThanOrEqual(5.9 - ROUNDING);
    expect(wcagContrastRatio(fail, passTile)).toBeGreaterThanOrEqual(5.0 - ROUNDING);
  });

  it('tints the dim veil with the disc colour so dimmed ember stays ember-hued', () => {
    const veil = parseRgbaString(WAFER_TOKENS.dimVeil);
    const disc = parseHexColor(WAFER_TOKENS.discLo);
    expect({ r: veil.r, g: veil.g, b: veil.b }).toEqual(disc);
    const dimmed = compositeRgbaOverRgb(veil, parseHexColor(WAFER_TOKENS.failDie));
    // Red stays the dominant channel (no salmon/grey shift)
    expect(dimmed.r).toBeGreaterThan(dimmed.g);
    expect(dimmed.g).toBeGreaterThan(dimmed.b);
  });
});

describe('bin palettes (premium.md §3.5)', () => {
  it('locks disc and light-page palettes with rank 0 ember', () => {
    expect(BIN_DISC_PALETTE).toEqual([
      '#FF6B2C',
      '#00ACEA',
      '#AE90F3',
      '#FD7584',
      '#B99F35',
      '#00B0C8',
      '#E87AC7',
      '#61A1FF',
    ]);
    expect(BIN_INK_PALETTE_LIGHT).toEqual([
      '#E8591E',
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

  it('keeps disc bins at 6.4-6.5:1 on disc-mid and light-page bins (ranks 1-7) >= 4.5:1 on the §12.1 warm bg', () => {
    for (const hex of BIN_DISC_PALETTE.slice(1)) {
      const r = ratio(hex, WAFER_TOKENS.discMid);
      expect(r).toBeGreaterThanOrEqual(6.4 - ROUNDING);
      expect(r).toBeLessThanOrEqual(6.5 + ROUNDING);
    }
    for (const hex of BIN_INK_PALETTE_LIGHT.slice(1)) {
      expect(ratio(hex, THEME_TOKENS.light.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('getBinColor returns ember for rank 0 and cycles ranks 1+ through 7 hues per surface', () => {
    expect(getBinColor(0, 'disc')).toBe('#FF6B2C');
    expect(getBinColor(0, 'light')).toBe('#E8591E');
    expect(getBinColor(0, 'dark')).toBe('#FF6B2C');
    expect(getBinColor(1, 'light')).toBe('#0A6FB0');
    expect(getBinColor(7, 'disc')).toBe('#61A1FF');
    expect(getBinColor(8, 'disc')).toBe('#00ACEA');
    expect(getBinColor(8, 'light')).toBe('#0A6FB0');
    expect(getBinColor(-3, 'dark')).toBe('#FF6B2C');
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

  it('meets contrast floors across all 4 accents on light paper #F6F3EE, dark surfaces, and dark silicon disc', () => {
    const L = THEME_TOKENS.light;
    const D = THEME_TOKENS.dark;
    const discMid = parseHexColor(WAFER_TOKENS.discMid);
    const passTile = compositeRgbaOverRgb(parseRgbaString(WAFER_TOKENS.passTile), discMid);

    for (const accent of ACCENT_NAMES) {
      const light = ACCENT_PALETTES[accent].light;
      const dark = ACCENT_PALETTES[accent].dark;

      // Disc failing die: theme-independent, >= 5.9:1 on disc-mid and >= 5.0:1 on pass tile
      expect(light.ember).toBe(dark.ember);
      expect(getFailDieColor(accent)).toBe(dark.ember);
      const failRgb = parseHexColor(dark.ember);
      expect(wcagContrastRatio(failRgb, discMid), `${accent} failDie on discMid`).toBeGreaterThanOrEqual(5.9 - ROUNDING);
      expect(wcagContrastRatio(failRgb, passTile), `${accent} failDie on passTile`).toBeGreaterThanOrEqual(5.0 - ROUNDING);

      // Marks: >= 3:1 on light paper #F6F3EE and white surface, >= 6.6:1 on dark surface
      expect(ratio(light.emberMark, L.bg), `${accent} light mark on bg`).toBeGreaterThanOrEqual(3.0);
      expect(ratio(light.emberMark, L.surface), `${accent} light mark on surface`).toBeGreaterThanOrEqual(3.0);
      expect(ratio(dark.emberMark, D.surface), `${accent} dark mark on surface`).toBeGreaterThanOrEqual(6.6 - ROUNDING);
      expect(ratio(dark.emberMark, D.bg), `${accent} dark mark on bg`).toBeGreaterThanOrEqual(7.3 - ROUNDING);

      // Ink: >= 4.5:1 on all dark surfaces; cobalt/jade/violet >= 4.5:1 on light paper #F6F3EE as well
      for (const darkBg of [D.bg, D.surface, D.surfaceSunken]) {
        expect(ratio(dark.emberInk, darkBg), `${accent} dark ink on ${darkBg}`).toBeGreaterThanOrEqual(4.5);
      }
      if (accent === 'ember') {
        expect(ratio(light.emberInk, L.bg)).toBeGreaterThanOrEqual(3.8 - ROUNDING);
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
