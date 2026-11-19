import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listDemoPresets } from '@/core/demo';
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from '@/core/i18n';
import {
  I18nProvider,
  LOCALE_INIT_SCRIPT,
  persistAndApplyLocale,
  readClientInitialLocale,
} from '@/ui/i18n';
import { ingestDemoPreset } from '@/workers';
import { AppShell } from './AppShell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LoadedLotOverview } from './LoadedLotOverview';
import { LotPicker, type RecentLotEntry } from './LotPicker';
import { NavBar } from './NavBar';
import { resolveThemeAriaPreferenceKey, ThemeToggle } from './ThemeToggle';

function extractFocusableTestIds(html: string): string[] {
  const matches = html.matchAll(/<(?:button|a)\b[^>]*data-testid="([^"]+)"/g);
  return Array.from(matches, (m) => m[1]!);
}

function extractButtonTestIds(html: string): string[] {
  const matches = html.matchAll(/<button\b[^>]*data-testid="([^"]+)"/g);
  return Array.from(matches, (m) => m[1]!);
}

describe('NavBar, LotPicker, LanguageSwitcher, and legacy chrome removal (Task R3)', () => {
  it('renders LanguageSwitcher (§4.10) with localized aria-label, short label, and native-name lang attributes in menu', () => {
    const closedHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'ja' },
        React.createElement(LanguageSwitcher),
      ),
    );
    expect(closedHtml).toContain('data-testid="language-switcher-trigger"');
    expect(closedHtml).toContain('>日<');
    // Premium §7.1: ghost 32 h with padding 0 10 0 8 on desktop, 44 x 44 icon below 1024, focus-ring token
    expect(closedHtml).toContain('h-8');
    expect(closedHtml).toContain('pl-2 pr-2.5');
    expect(closedHtml).toContain('max-lg:size-11');
    expect(closedHtml).toContain('focus-visible:shadow-focus-ring');
    expect(closedHtml).not.toContain('outline-accent');

    const openHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'zh-TW' },
        React.createElement(LanguageSwitcher, { defaultOpen: true }),
      ),
    );
    expect(openHtml).toContain('w-[220px]');
    for (const code of SUPPORTED_LOCALES) {
      expect(openHtml).toContain(`lang="${code}"`);
    }
    expect(openHtml).toContain('English');
    expect(openHtml).toContain('简体中文');
    expect(openHtml).toContain('繁體中文');
    expect(openHtml).toContain('日本語');
    expect(openHtml).toContain('한국어');
    expect(openHtml).toContain('aria-checked="true"');
    // Desktop: no Appearance group in the language menu
    expect(openHtml).not.toContain('theme-option-system');

    // Mobile: the globe menu holds a second "Appearance" group after an inset-12 hairline (§7.1)
    const mobileHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(LanguageSwitcher, {
          defaultOpen: true,
          includeAppearance: true,
        }),
      ),
    );
    expect(mobileHtml).toMatch(/role="separator" class="[^"]*\bmx-3 my-1\b/);
    expect(mobileHtml).toContain('>Appearance<');
    for (const option of ['system', 'light', 'dark']) {
      expect(mobileHtml).toContain(`data-testid="theme-option-${option}"`);
    }
    expect(mobileHtml).toContain('Match system');
    expect(mobileHtml).toContain('>Colour<');
    for (const accent of ['ember', 'cobalt', 'jade', 'violet']) {
      expect(mobileHtml).toContain(`data-testid="accent-option-${accent}"`);
    }
  });

  it('renders the quiet theme & accent popover toggle (§7.1): 32 x 32 icon button, 200 px menu with Appearance + Colour radio groups', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(ThemeToggle, { defaultOpen: true }),
      ),
    );
    const trigger = html.match(/<button\b[^>]*data-testid="theme-toggle-trigger"[^>]*>/)?.[0] ?? '';
    expect(trigger).toContain('size-8');
    expect(trigger).toContain('aria-label="Appearance: System, currently light"');
    expect(trigger).toContain('data-preference="system"');
    expect(trigger).toContain('data-accent="ember"');
    expect(trigger).toContain('text-text-secondary');
    expect(html).toContain('w-[200px]');
    // 3 appearance radio rows + 4 accent radio swatches
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(7);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html).toMatch(/data-testid="theme-option-system"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="theme-option-system"/);
    expect(html).toMatch(/data-testid="accent-option-ember"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="accent-option-ember"/);
    expect(html).toContain('Match system');
    expect(html).toContain('>Light<');
    expect(html).toContain('>Dark<');
    expect(html).toContain('Match system follows your device setting.');
    expect(html).toContain('type-subhead');
    expect(html).toContain('>Colour<');
    for (const [id, name] of [
      ['ember', 'Ember'],
      ['cobalt', 'Cobalt'],
      ['jade', 'Jade'],
      ['violet', 'Violet'],
    ]) {
      const swatch = html.match(new RegExp(`<button\\b[^>]*data-testid="accent-option-${id}"[^>]*>`))?.[0] ?? '';
      expect(swatch).toContain('size-5');
      expect(swatch).toContain('rounded-full');
      expect(swatch).toContain(`aria-label="${name}"`);
    }
  });

  it('builds the Appearance aria-label from the preference, not the result', () => {
    expect(resolveThemeAriaPreferenceKey('system', 'light')).toBe('theme.ariaSystemLight');
    expect(resolveThemeAriaPreferenceKey('system', 'dark')).toBe('theme.ariaSystemDark');
    expect(resolveThemeAriaPreferenceKey('light', 'light')).toBe('theme.light');
    expect(resolveThemeAriaPreferenceKey('dark', 'dark')).toBe('theme.dark');
  });

  it('renders LotPicker (§4.2) pill trigger, 360px menu with 40px demo thumbnails, yield meta, recent files, and shortcut cap', () => {
    const recentFiles: readonly RecentLotEntry[] = [
      {
        id: 'file:probe-sort-01.stdf:9856614',
        fileName: 'probe-sort-01.stdf',
        byteSize: 9_856_614,
        lotId: 'LOT-9921',
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(LotPicker, {
          currentLotId: 'CAL-ER-2401',
          currentPresetId: 'edge-ring-etch',
          currentRecentId: null,
          recentLots: recentFiles,
          onSelectDemoPreset: () => undefined,
          onSelectRecentLot: () => undefined,
          onOpenFilePicker: () => undefined,
          defaultOpen: true,
        }),
      ),
    );

    expect(html).toContain('data-testid="lot-picker-trigger"');
    expect(html).toContain('aria-label="Choose lot, current lot CAL-ER-2401"');
    expect(html).toContain('CAL-ER-2401');
    expect(html).toContain('Edge-Ring Plasma Etch');
    // Premium §7.2 trigger: fill-2 pill, hover and open fill-3, max 420, title hidden < 1024, tertiary chevron
    const trigger = html.match(/<button\b[^>]*data-testid="lot-picker-trigger"[^>]*>/)?.[0] ?? '';
    expect(trigger).toContain('bg-fill-2');
    expect(trigger).toContain('enabled:hover:bg-fill-3');
    expect(trigger).toContain('aria-expanded:bg-fill-3');
    expect(trigger).toContain('max-w-[min(420px,calc(100vw-164px))]');
    expect(trigger).toContain('focus-visible:shadow-focus-ring');
    expect(html).toContain('hidden min-w-0 truncate');
    expect(html).toContain('lg:inline');
    expect(html).toContain('text-text-tertiary group-disabled:text-text-disabled');

    // Menu: 360 wide, "Sample lots" with 3 x 40 px thumbnails, comma meta, check, "Recent files", "Open file…" keycap
    expect(html).toContain('w-[360px]');
    expect(html).toContain('Sample lots');
    expect(html).toContain('Robotic Handling Scratch');
    expect(html).toContain('Site 2 Probe Contact');
    expect(html.match(/data-testid="lot-picker-demo-thumb"/g)).toHaveLength(3);
    expect(html).toMatch(/Yield 8\d\.\d%, 25 wafers/);
    expect(html).not.toContain('·');
    expect(html).toContain('grid-cols-[40px_minmax(0,1fr)_16px]');
    expect(html).toMatch(/data-testid="lot-picker-row-edge-ring-etch"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="lot-picker-row-edge-ring-etch"/);
    expect(html).toContain('Recent files');
    expect(html).toContain('probe-sort-01.stdf');
    expect(html).toContain('9.4 MB');
    expect(html).toContain('Open file…');
    expect(html).toMatch(/<kbd[^>]*bg-fill-2[^>]*text-text-secondary/);
  });

  it('enforces NavBar (§4.1) 52px/48px heights, 3-zone grid, scroll separator, ice 2px focus rings, and strict Tab order', () => {
    const landingNavHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(NavBar, {
          activeLot: null,
          recentLots: [],
          onNavigateHome: () => undefined,
          onSelectDemoPreset: () => undefined,
          onSelectRecentLot: () => undefined,
          onOpenFilePicker: () => undefined,
        }),
      ),
    );

    expect(landingNavHtml).toContain('h-12');
    expect(landingNavHtml).toContain('lg:h-[52px]');
    expect(landingNavHtml).toContain('grid-cols-[auto_1fr_auto]');
    expect(landingNavHtml).toContain('lg:grid-cols-[1fr_auto_1fr]');
    expect(landingNavHtml).toContain('lg:px-8 xl:px-10');
    expect(landingNavHtml).toContain('bg-material');
    expect(landingNavHtml).toContain('bg-hairline');
    expect(landingNavHtml).toContain('data-testid="nav-scroll-separator"');
    expect(landingNavHtml).toContain('opacity-0');
    expect(landingNavHtml).toContain('Chip Autopsy Lab');
    expect(landingNavHtml).toContain('Autopsy Lab');
    // Lot picker and duplicate Open STDF hidden on landing state (§4.1 + visual-acceptance (b))
    expect(landingNavHtml).not.toContain('data-testid="lot-picker-trigger"');
    expect(landingNavHtml).not.toContain('data-testid="nav-open-stdf"');
    expect(landingNavHtml).toMatch(/<a\b[^>]*href="\/"[^>]*data-testid="nav-wordmark"|<a\b[^>]*data-testid="nav-wordmark"[^>]*href="\/"/);
    expect(extractButtonTestIds(landingNavHtml)).toEqual([
      'language-switcher-trigger',
      'theme-toggle-trigger',
    ]);

    const loadedNavHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(NavBar, {
          activeLot: {
            lotId: 'CAL-ER-2401',
            presetId: 'edge-ring-etch',
            recentId: null,
          },
          recentLots: [],
          onNavigateHome: () => undefined,
          onSelectDemoPreset: () => undefined,
          onSelectRecentLot: () => undefined,
          onOpenFilePicker: () => undefined,
        }),
      ),
    );

    // Exact Tab order when loaded (A35): wordmark -> lot picker -> language -> theme -> Open file
    expect(extractFocusableTestIds(loadedNavHtml)).toEqual([
      'nav-wordmark',
      'lot-picker-trigger',
      'language-switcher-trigger',
      'theme-toggle-trigger',
      'nav-open-stdf',
    ]);
    expect(loadedNavHtml).toContain('>Open file<');

    // visual-acceptance (a)/(h): nav Open file uses 14px type-control directly (never uncompiled md:type-control)
    expect(loadedNavHtml).not.toContain('md:type-control');
    expect(loadedNavHtml).toMatch(
      /<button\b(?=[^>]*data-testid="nav-open-stdf")[^>]*\btype-control\b/,
    );

    // Every nav control uses the focus-ring token and stays in Tab order (zero tabindex="-1")
    const controlTags = Array.from(
      loadedNavHtml.matchAll(/<(?:button|a)\b[^>]*>/g),
      (m) => m[0],
    );
    expect(controlTags).toHaveLength(5);
    for (const tag of controlTags) {
      expect(tag).toContain('focus-visible:shadow-focus-ring');
      expect(tag).not.toContain('outline-accent');
      expect(tag).not.toContain('tabindex="-1"');
    }

    // Spacing: language, 4 px, theme (desktop only), 12 px, Open file secondary 32 h
    expect(loadedNavHtml).toContain('ml-1 max-lg:hidden');
    expect(controlTags[4]).toContain('lg:ml-3');
    expect(controlTags[4]).toContain('data-variant="secondary"');
    expect(controlTags[4]).toContain('h-8');

    // Mobile: globe and folder-open render as 44 x 44 icon buttons
    expect(controlTags[2]).toContain('max-lg:size-11');
    expect(controlTags[4]).toContain('max-lg:size-11');

    // Language switch updates <html lang> and survives full reload via LOCALE_INIT_SCRIPT
    const storageMap = new Map<string, string>();
    const docEl = {
      lang: 'en',
      dataLocale: 'en',
      getAttribute(name: string): string | null {
        if (name === 'lang') return docEl.lang;
        if (name === 'data-locale') return docEl.dataLocale;
        return null;
      },
      setAttribute(name: string, value: string): void {
        if (name === 'lang') docEl.lang = value;
        if (name === 'data-locale') docEl.dataLocale = value;
      },
    };
    const storage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, v);
      },
    };

    persistAndApplyLocale('ko', { storage, documentElement: docEl });
    expect(docEl.lang).toBe('ko');
    expect(storageMap.get(LOCALE_STORAGE_KEY)).toBe('ko');

    // Simulate reload: reset DOM to SSR default lang="en", run pre-hydration script, mount provider
    docEl.lang = 'en';
    docEl.dataLocale = '';
    new Function('localStorage', 'navigator', 'document', LOCALE_INIT_SCRIPT)(
      storage,
      { languages: ['en-US'], language: 'en-US' },
      { documentElement: docEl },
    );
    expect(docEl.lang).toBe('ko');
    const reloadedLocale = readClientInitialLocale({
      documentElement: docEl,
      storage,
      navigatorLanguages: ['en-US'],
    });
    expect(reloadedLocale).toBe('ko');

    const reloadedSwitcherHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: reloadedLocale },
        React.createElement(LanguageSwitcher),
      ),
    );
    expect(reloadedSwitcherHtml).toContain('>한<');
  });

  it('removes the old header, Browser Sandbox badge, second toolbar row, native select, and footer byte counter', async () => {
    const shellHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(AppShell),
      ),
    );

    expect(shellHtml).toContain('data-testid="nav-bar"');
    expect(shellHtml).not.toContain('Browser Sandbox');
    expect(shellHtml).not.toContain('Local-First Workbench');
    expect(shellHtml).not.toContain('0 bytes ingested');
    expect(shellHtml).not.toContain('Zero server STDF uploads');

    const edgeRes = await ingestDemoPreset('edge-ring-etch');
    expect(edgeRes.kind).toBe('ok');
    if (edgeRes.kind !== 'ok') return;

    const overviewHtml = renderToStaticMarkup(
      React.createElement(LoadedLotOverview, {
        data: edgeRes,
        presets: listDemoPresets(),
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
      }),
    );

    expect(overviewHtml).not.toContain('data-testid="lot-header-bar"');
    expect(overviewHtml).not.toContain('id="cal-preset-switcher"');
  });
});
