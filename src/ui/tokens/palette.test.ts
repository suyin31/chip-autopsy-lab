import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COLOR_TOKENS,
  compositeRgbaOverRgb,
  getFailBinColor,
  HEADING_WEIGHT_BOUNDS,
  MAGMA_LUT_256,
  MOTION_TOKENS,
  parseHexColor,
  parseRgbaString,
  rgbToCieLch,
  SECONDARY_FAIL_BIN_PALETTE,
  wcagContrastRatio,
  wcagHexContrastRatio,
} from './index';

describe('Chip Autopsy Lab locked design tokens', () => {
  it('locks exact hex and rgba values from design-language.md and design.md', () => {
    expect(COLOR_TOKENS.bg).toBe('#0A0A0B');
    expect(COLOR_TOKENS.panel).toBe('#111113');
    expect(COLOR_TOKENS.hairline).toBe('rgba(255, 255, 255, 0.08)');
    expect(COLOR_TOKENS.raised).toBe('rgba(255, 255, 255, 0.04)');
    expect(COLOR_TOKENS.overlay).toBe('rgba(255, 255, 255, 0.08)');
    expect(COLOR_TOKENS.textPrimary).toBe('rgba(255, 255, 255, 0.92)');
    expect(COLOR_TOKENS.textSecondary).toBe('rgba(255, 255, 255, 0.64)');
    expect(COLOR_TOKENS.textTertiary).toBe('rgba(255, 255, 255, 0.48)');
    expect(COLOR_TOKENS.accent).toBe('#7CF2C1');
    expect(COLOR_TOKENS.failure).toBe('#FF7A1A');
    expect(COLOR_TOKENS.passDie).toBe('#53655D');
  });

  it('satisfies WCAG 2.2 AA >= 3:1 contrast for pass die #53655D, failure #FF7A1A, and accent #7CF2C1', () => {
    expect(wcagHexContrastRatio(COLOR_TOKENS.passDie, COLOR_TOKENS.bg)).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(
      wcagHexContrastRatio(COLOR_TOKENS.passDie, COLOR_TOKENS.panel),
    ).toBeGreaterThanOrEqual(3.0);
    expect(
      wcagHexContrastRatio(COLOR_TOKENS.accent, COLOR_TOKENS.passDie),
    ).toBeGreaterThanOrEqual(3.0);
    expect(wcagHexContrastRatio(COLOR_TOKENS.failure, COLOR_TOKENS.bg)).toBeGreaterThanOrEqual(
      3.0,
    );
    expect(
      wcagHexContrastRatio(COLOR_TOKENS.accent, COLOR_TOKENS.accentForeground),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('satisfies WCAG 2.2 AA >= 4.5:1 contrast for all three informative text tiers on bg and panel', () => {
    const bgRgb = parseHexColor(COLOR_TOKENS.bg);
    const panelRgb = parseHexColor(COLOR_TOKENS.panel);

    for (const tier of [
      COLOR_TOKENS.textPrimary,
      COLOR_TOKENS.textSecondary,
      COLOR_TOKENS.textTertiary,
    ]) {
      const rgba = parseRgbaString(tier);
      const onBg = compositeRgbaOverRgb(rgba, bgRgb);
      const onPanel = compositeRgbaOverRgb(rgba, panelRgb);

      expect(wcagContrastRatio(onBg, bgRgb)).toBeGreaterThanOrEqual(4.5);
      expect(wcagContrastRatio(onPanel, panelRgb)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps secondary LCH fail-bin colours >= 3:1 on dark surfaces and outside accent/failure hue bands', () => {
    expect(getFailBinColor(0)).toBe('#FF7A1A');

    for (let i = 0; i < SECONDARY_FAIL_BIN_PALETTE.length; i += 1) {
      const hex = SECONDARY_FAIL_BIN_PALETTE[i];
      expect(getFailBinColor(i + 1)).toBe(hex);
      expect(wcagHexContrastRatio(hex, COLOR_TOKENS.bg)).toBeGreaterThanOrEqual(3.0);
      expect(wcagHexContrastRatio(hex, COLOR_TOKENS.panel)).toBeGreaterThanOrEqual(3.0);

      const { h } = rgbToCieLch(parseHexColor(hex));
      // Must exclude [125, 200] (#7CF2C1) and [40, 72] (#FF7A1A)
      expect(h < 125 || h > 200).toBe(true);
      expect(h < 40 || h > 72).toBe(true);
    }
  });

  it('exposes a 256-entry magma LUT and enforces heading weight & motion ceilings', () => {
    expect(MAGMA_LUT_256).toHaveLength(256);
    expect(MAGMA_LUT_256[0]).toBe('#000004');
    expect(MAGMA_LUT_256[255]).toBe('#FCFDBF');
    expect(HEADING_WEIGHT_BOUNDS.default).toBeGreaterThanOrEqual(510);
    expect(HEADING_WEIGHT_BOUNDS.default).toBeLessThanOrEqual(590);
    expect(HEADING_WEIGHT_BOUNDS.max).toBeLessThan(HEADING_WEIGHT_BOUNDS.forbiddenBoldMin);
    expect(MOTION_TOKENS.keyboardActionMs).toBe(0);
    expect(MOTION_TOKENS.panelSpringMaxMs).toBeLessThanOrEqual(400);
  });

  it('defines matching @theme CSS variables in globals.css and self-hosts Inter + Geist Mono via next/font', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const globalsCss = fs.readFileSync(
      path.join(repoRoot, 'src/app/globals.css'),
      'utf8',
    );
    expect(globalsCss).toContain('@theme');
    expect(globalsCss).toContain('--color-bg: #0a0a0b;');
    expect(globalsCss).toContain('--color-panel: #111113;');
    expect(globalsCss).toContain('--color-hairline: rgba(255, 255, 255, 0.08);');
    expect(globalsCss).toContain('--color-raised: rgba(255, 255, 255, 0.04);');
    expect(globalsCss).toContain('--color-overlay: rgba(255, 255, 255, 0.08);');
    expect(globalsCss).toContain('--color-text-primary: rgba(255, 255, 255, 0.92);');
    expect(globalsCss).toContain('--color-text-secondary: rgba(255, 255, 255, 0.64);');
    expect(globalsCss).toContain('--color-text-tertiary: rgba(255, 255, 255, 0.48);');
    expect(globalsCss).toContain('--color-accent: #7cf2c1;');
    expect(globalsCss).toContain('--color-failure: #ff7a1a;');
    expect(globalsCss).toContain('--color-pass-die: #53655d;');

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
