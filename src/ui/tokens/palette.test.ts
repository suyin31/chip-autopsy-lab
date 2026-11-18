import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FONT_WEIGHTS,
  BLUR_TOKENS_PX,
  COLOR_TOKENS,
  compositeRgbaOverRgb,
  getFailBinColor,
  LAYOUT_GRID,
  MAGMA_LUT_256,
  MOTION_TOKENS,
  parseHexColor,
  parseRgbaString,
  RADIUS_TOKENS_PX,
  rgbToCieLch,
  SECONDARY_FAIL_BIN_PALETTE,
  SPACING_SCALE_PX,
  SPRING_TOKENS,
  TYPOGRAPHY_TOKENS,
  wcagContrastRatio,
  wcagHexContrastRatio,
  Z_LAYERS,
} from './index';

describe('Chip Autopsy Lab R1 redesign tokens (§2, §6.7)', () => {
  it('locks exact colour, surface, material, and ring values from redesign §2.1', () => {
    expect(COLOR_TOKENS.bg).toBe('#000000');
    expect(COLOR_TOKENS.surface1).toBe('#0F0F10');
    expect(COLOR_TOKENS.surface2).toBe('#1A1A1C');
    expect(COLOR_TOKENS.surface3).toBe('#242426');
    expect(COLOR_TOKENS.material).toBe('rgba(22, 22, 24, 0.72)');
    expect(COLOR_TOKENS.ring).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.10)',
    );
    expect(COLOR_TOKENS.ringStrong).toBe(
      'inset 0 0 0 1px rgba(255, 255, 255, 0.16)',
    );
    expect(COLOR_TOKENS.separator).toBe('rgba(255, 255, 255, 0.08)');
    expect(COLOR_TOKENS.textPrimary).toBe('rgba(255, 255, 255, 0.92)');
    expect(COLOR_TOKENS.textSecondary).toBe('rgba(255, 255, 255, 0.56)');
    expect(COLOR_TOKENS.textTertiary).toBe('rgba(255, 255, 255, 0.48)');
    expect(COLOR_TOKENS.textDisabled).toBe('rgba(255, 255, 255, 0.28)');
    expect(COLOR_TOKENS.accent).toBe('#D6E6FF');
    expect(COLOR_TOKENS.accentSoft).toBe('rgba(214, 230, 255, 0.12)');
    expect(COLOR_TOKENS.failure).toBe('#FF6B2C');
    expect(COLOR_TOKENS.failureText).toBe('#FF8A57');
    expect(COLOR_TOKENS.passDie).toBe('#63666C');
    expect(COLOR_TOKENS.dieStreet).toBe('#000000');
    expect(COLOR_TOKENS.dimScrim).toBe('rgba(0, 0, 0, 0.62)');
    expect(COLOR_TOKENS.buttonPrimary).toBe('#F5F5F7');
    expect(COLOR_TOKENS.buttonPrimaryText).toBe('#000000');
    expect(COLOR_TOKENS.vignettePeak).toBe('#141416');
    expect(COLOR_TOKENS.waferDisc).toBe('#0B0B0C');
  });

  it('satisfies WCAG 2.2 AA >= 3:1 contrast for pass-die on #000 and #141416, failure, accent, and primary button', () => {
    expect(wcagHexContrastRatio(COLOR_TOKENS.passDie, '#000000')).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(wcagHexContrastRatio(COLOR_TOKENS.passDie, '#141416')).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(
      wcagHexContrastRatio(COLOR_TOKENS.passDie, COLOR_TOKENS.waferDisc),
    ).toBeGreaterThanOrEqual(3.0);
    expect(wcagHexContrastRatio(COLOR_TOKENS.failure, '#000000')).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(wcagHexContrastRatio(COLOR_TOKENS.accent, '#000000')).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(
      wcagHexContrastRatio(COLOR_TOKENS.failureText, '#000000'),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      wcagHexContrastRatio(COLOR_TOKENS.failureText, '#1A1A1C'),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      wcagHexContrastRatio(
        COLOR_TOKENS.buttonPrimary,
        COLOR_TOKENS.buttonPrimaryText,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('satisfies WCAG 2.2 AA >= 4.5:1 contrast for text-primary, text-secondary, and text-tertiary on #000, surface-1, and surface-2 (#1A1A1C)', () => {
    const bgRgb = parseHexColor('#000000');
    const surface1Rgb = parseHexColor('#0F0F10');
    const surface2Rgb = parseHexColor('#1A1A1C');

    for (const tier of [
      COLOR_TOKENS.textPrimary,
      COLOR_TOKENS.textSecondary,
      COLOR_TOKENS.textTertiary,
    ]) {
      const rgba = parseRgbaString(tier);
      const onBg = compositeRgbaOverRgb(rgba, bgRgb);
      const onSurface1 = compositeRgbaOverRgb(rgba, surface1Rgb);
      const onSurface2 = compositeRgbaOverRgb(rgba, surface2Rgb);

      expect(wcagContrastRatio(onBg, bgRgb)).toBeGreaterThanOrEqual(4.5);
      expect(wcagContrastRatio(onSurface1, surface1Rgb)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(wcagContrastRatio(onSurface2, surface2Rgb)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('assigns rank 0 fail bin to #FF6B2C and keeps secondary fail-bin colours >= 3:1 across dark surfaces', () => {
    expect(getFailBinColor(0)).toBe('#FF6B2C');
    expect(SECONDARY_FAIL_BIN_PALETTE).toEqual([
      '#00ACEA',
      '#AE90F3',
      '#FD7584',
      '#B99F35',
      '#00B0C8',
      '#E87AC7',
      '#61A1FF',
    ]);

    for (let i = 0; i < SECONDARY_FAIL_BIN_PALETTE.length; i += 1) {
      const hex = SECONDARY_FAIL_BIN_PALETTE[i];
      expect(getFailBinColor(i + 1)).toBe(hex);
      expect(wcagHexContrastRatio(hex, '#000000')).toBeGreaterThanOrEqual(3.0);
      expect(wcagHexContrastRatio(hex, '#0F0F10')).toBeGreaterThanOrEqual(3.0);
      expect(wcagHexContrastRatio(hex, '#1A1A1C')).toBeGreaterThanOrEqual(3.0);
      expect(hex).not.toBe(COLOR_TOKENS.failure);
      expect(hex).not.toBe(COLOR_TOKENS.accent);
      expect(hex).not.toBe(COLOR_TOKENS.passDie);
    }
  });

  it('keeps the secondary fail-bin palette at equal CIE L* (66 +/- 1) so no bin reads brighter than another', () => {
    for (const hex of SECONDARY_FAIL_BIN_PALETTE) {
      const { l } = rgbToCieLch(parseHexColor(hex));
      expect(Math.abs(l - 66)).toBeLessThanOrEqual(1);
    }
  });

  it('locks §2.2–§2.6 typography, spacing, concentric radii, blur, z-layers, springs, and magma LUT', () => {
    expect(MAGMA_LUT_256).toHaveLength(256);
    expect(MAGMA_LUT_256[0]).toBe('#000004');
    expect(MAGMA_LUT_256[255]).toBe('#FCFDBF');

    // §2.2 Typography roles & weights (never >= 700)
    expect(ALLOWED_FONT_WEIGHTS).toEqual([300, 400, 500, 590, 600]);
    for (const weight of ALLOWED_FONT_WEIGHTS) {
      expect(weight).toBeLessThan(700);
    }
    expect(TYPOGRAPHY_TOKENS.displayXl.desktop).toEqual({
      sizePx: 80,
      lineHeight: 1.05,
      weight: 600,
      trackingEm: -0.035,
      opsz: 32,
    });
    expect(TYPOGRAPHY_TOKENS.displayXl.mobile).toEqual({
      sizePx: 48,
      lineHeight: 1.06,
      weight: 600,
      trackingEm: -0.03,
      opsz: 32,
    });
    expect(TYPOGRAPHY_TOKENS.displayL.desktop).toEqual({
      sizePx: 48,
      lineHeight: 1.08,
      weight: 600,
      trackingEm: -0.022,
      opsz: 32,
    });
    expect(TYPOGRAPHY_TOKENS.displayL.mobile).toEqual({
      sizePx: 32,
      lineHeight: 1.12,
      weight: 600,
      trackingEm: -0.018,
      opsz: 32,
    });
    expect(TYPOGRAPHY_TOKENS.stat.desktop).toEqual({
      sizePx: 40,
      lineHeight: 1.0,
      weight: 300,
      trackingEm: -0.02,
      opsz: 32,
    });
    expect(TYPOGRAPHY_TOKENS.headline.desktop.weight).toBe(590);
    expect(TYPOGRAPHY_TOKENS.body.desktop.sizePx).toBe(17);
    expect(TYPOGRAPHY_TOKENS.monoData.desktop.sizePx).toBe(13);

    // §2.3 Spacing, layout, concentric radii
    expect(SPACING_SCALE_PX).toEqual([
      2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72, 96, 128,
    ]);
    expect(LAYOUT_GRID.desktop).toEqual({
      columns: 12,
      gutterPx: 24,
      marginPx: 40,
      maxContentWidthPx: 1360,
    });
    expect(LAYOUT_GRID.mobile).toEqual({
      columns: 4,
      gutterPx: 12,
      marginPx: 16,
      contentWidthPx: 358,
    });
    // premium.md §3.9 concentric radii
    expect(RADIUS_TOKENS_PX).toEqual({
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 20,
      '2xl': 24,
      '3xl': 28,
      pill: 999,
    });
    // Findings card (20) = finding row (16) + padding 4; section card (24) - 12 inset = Pareto row (12)
    expect(RADIUS_TOKENS_PX.xl - 4).toBe(RADIUS_TOKENS_PX.lg);
    expect(RADIUS_TOKENS_PX['2xl'] - 12).toBe(RADIUS_TOKENS_PX.md);

    // §2.4 Blur bounds
    expect(BLUR_TOKENS_PX).toEqual({
      material: 24,
      heavy: 32,
      animatedMax: 8,
    });

    // §2.5 Z-layers strictly ordered
    expect(Z_LAYERS).toEqual({
      content: 0,
      canvasBase: 1,
      canvasFail: 2,
      canvasOverlay: 3,
      stageHud: 10,
      magnifier: 20,
      selectionPopover: 30,
      hints: 35,
      nav: 40,
      menus: 50,
      tooltips: 55,
      sheets: 60,
      toasts: 70,
      dragOverlay: 80,
    });

    // §2.6 Motion springs, easings, durations, deceleration
    // premium.md §3.12: duration-based UI springs, never bounce
    expect(SPRING_TOKENS.ui).toEqual({
      type: 'spring',
      duration: 0.35,
      bounce: 0,
    });
    expect(SPRING_TOKENS.snappy).toEqual({
      type: 'spring',
      duration: 0.22,
      bounce: 0,
    });
    expect(SPRING_TOKENS.sheen).toEqual({
      stiffness: 120,
      damping: 22,
      mass: 1,
    });
    expect(SPRING_TOKENS.camera).toEqual({
      stiffness: 170,
      damping: 26,
      mass: 1,
    });
    expect(SPRING_TOKENS.throw).toEqual({
      stiffness: 260,
      damping: 22,
      mass: 1,
    });
    expect(MOTION_TOKENS.easeOut).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(MOTION_TOKENS.easeOutExpo).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(MOTION_TOKENS.durInstantMs).toBe(0);
    expect(MOTION_TOKENS.durFastMs).toBe(120);
    expect(MOTION_TOKENS.durBaseMs).toBe(160);
    expect(MOTION_TOKENS.decelPerMs).toBe(0.998);
    expect(MOTION_TOKENS.easeInOut).toBe('cubic-bezier(0.45, 0, 0.25, 1)');
    expect([
      MOTION_TOKENS.dur0Ms,
      MOTION_TOKENS.dur1Ms,
      MOTION_TOKENS.dur2Ms,
      MOTION_TOKENS.dur3Ms,
      MOTION_TOKENS.dur4Ms,
    ]).toEqual([0, 120, 160, 240, 280]);
    expect(MOTION_TOKENS.pressScale).toEqual({
      button: 0.97,
      card: 0.985,
      row: 0.985,
      icon: 0.94,
      thumbnail: 0.94,
    });
  });

  it('defines matching @theme CSS variables and §6.7 CJK :lang() overrides in globals.css with self-hosted fonts', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const globalsCss = fs.readFileSync(
      path.join(repoRoot, 'src/app/globals.css'),
      'utf8',
    );
    expect(globalsCss).toContain('@theme');
    expect(globalsCss).toContain('--color-surface-1: #0f0f10;');
    expect(globalsCss).toContain('--color-surface-2: #1a1a1c;');
    expect(globalsCss).toContain('--color-surface-3: #242426;');
    expect(globalsCss).toContain('--color-separator: rgba(255, 255, 255, 0.08);');
    // Without data-theme the legacy R-series text tiers stay in force until P3
    expect(globalsCss).toMatch(
      /:root:not\(\[data-theme\]\) \{\s*--text-secondary: rgba\(255, 255, 255, 0\.56\);\s*--text-tertiary: rgba\(255, 255, 255, 0\.48\);/,
    );
    expect(globalsCss).toContain('--color-accent: #d6e6ff;');
    expect(globalsCss).toContain('--color-accent-soft: rgba(214, 230, 255, 0.12);');
    expect(globalsCss).toContain('--color-failure: #ff6b2c;');
    expect(globalsCss).toContain('--color-failure-text: #ff8a57;');
    expect(globalsCss).toContain('--color-pass-die: #63666c;');

    // §6.7 CJK font stacks and :lang() typography overrides
    expect(globalsCss).toContain(':root[lang="zh-CN"]');
    expect(globalsCss).toContain(':root[lang="zh-TW"]');
    expect(globalsCss).toContain(':root[lang="ja"]');
    expect(globalsCss).toContain(':root[lang="ko"]');
    expect(globalsCss).toContain('--font-cjk');
    expect(globalsCss).toContain('line-break: strict');
    expect(globalsCss).toContain('word-break: keep-all');

    const layoutTsx = fs.readFileSync(
      path.join(repoRoot, 'src/app/layout.tsx'),
      'utf8',
    );
    expect(layoutTsx).toContain("from 'next/font/local'");
    expect(layoutTsx).toContain('--font-inter');
    expect(layoutTsx).toContain('--font-geist-mono');
    expect(layoutTsx).not.toContain('fonts.googleapis.com');
    expect(layoutTsx).not.toContain('fonts.gstatic.com');
  });
});
