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
    expect(closedHtml).toContain('focus-visible:outline-2');
    expect(closedHtml).toContain('focus-visible:outline-accent');

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
    // Lot title hidden < 1024px (§4.2)
    expect(html).toContain('hidden lg:inline');

    // Open menu: width 360px, Demo lots section, 3 x 40px thumbnails, Yield meta, Recent section, Open STDF file…
    expect(html).toContain('w-[360px]');
    expect(html).toContain('Demo lots');
    expect(html).toContain('Robotic Handling Scratch');
    expect(html).toContain('Site 2 Probe Contact');
    expect(html.match(/data-testid="lot-picker-demo-thumb"/g)).toHaveLength(3);
    expect(html).toContain('Yield 8');
    expect(html).toContain('Recent');
    expect(html).toContain('probe-sort-01.stdf');
    expect(html).toContain('9.4 MB');
    expect(html).toContain('Open STDF file…');
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
    expect(landingNavHtml).toContain('md:h-[52px]');
    expect(landingNavHtml).toContain('grid-cols-[1fr_auto_1fr]');
    expect(landingNavHtml).toContain('data-testid="nav-scroll-separator"');
    expect(landingNavHtml).toContain('opacity-0');
    expect(landingNavHtml).toContain('Chip Autopsy Lab');
    expect(landingNavHtml).toContain('Autopsy Lab');
    // Lot picker hidden on landing state (§4.1)
    expect(landingNavHtml).not.toContain('data-testid="lot-picker-trigger"');
    expect(extractButtonTestIds(landingNavHtml)).toEqual([
      'nav-wordmark',
      'language-switcher-trigger',
      'nav-open-stdf',
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

    // Exact Tab order when loaded: wordmark -> lot picker -> language -> Open STDF
    expect(extractButtonTestIds(loadedNavHtml)).toEqual([
      'nav-wordmark',
      'lot-picker-trigger',
      'language-switcher-trigger',
      'nav-open-stdf',
    ]);

    // Every nav button has ice 2px focus ring and remains in Tab order (zero tabindex="-1")
    const buttonTags = Array.from(
      loadedNavHtml.matchAll(/<button\b[^>]*>/g),
      (m) => m[0],
    );
    expect(buttonTags).toHaveLength(4);
    for (const tag of buttonTags) {
      expect(tag).toContain('focus-visible:outline-2');
      expect(tag).toContain('focus-visible:outline-offset-2');
      expect(tag).toContain('focus-visible:outline-accent');
      expect(tag).not.toContain('tabindex="-1"');
    }

    // Mobile 390px: both right-zone controls render as 44x44 icon buttons (h-11 w-11)
    expect(buttonTags[2]).toContain('h-11');
    expect(buttonTags[2]).toContain('w-11');
    expect(buttonTags[3]).toContain('h-11');
    expect(buttonTags[3]).toContain('w-11');

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
