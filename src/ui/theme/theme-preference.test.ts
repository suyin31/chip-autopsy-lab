import { describe, expect, it } from 'vitest';
import {
  ACCENT_INIT_SCRIPT,
  ACCENT_PREFERENCES,
  ACCENT_STORAGE_KEY,
  applyAccent,
  applyResolvedTheme,
  DEFAULT_ACCENT_PREFERENCE,
  DEFAULT_THEME_PREFERENCE,
  isAccentPreference,
  parseAccentPreference,
  parseThemePreference,
  readStoredAccentPreference,
  readStoredThemePreference,
  resolveTheme,
  THEME_COLOR_META,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  type AccentDocumentLike,
  type ThemeDocumentLike,
  writeStoredAccentPreference,
  writeStoredThemePreference,
} from './index';

interface FakeMeta {
  attrs: Map<string, string>;
  setAttribute(name: string, value: string): void;
}

function createFakeDocument(withMeta = false) {
  const attrs = new Map<string, string>();
  const headChildren: FakeMeta[] = [];
  const makeMeta = (): FakeMeta => {
    const m: FakeMeta = {
      attrs: new Map(),
      setAttribute(name, value) {
        m.attrs.set(name, value);
      },
    };
    return m;
  };
  if (withMeta) {
    const m = makeMeta();
    m.setAttribute('name', 'theme-color');
    m.setAttribute('content', '#123456');
    headChildren.push(m);
  }
  const doc = {
    documentElement: {
      attrs,
      style: { colorScheme: '' },
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    },
    head: {
      appendChild(node: unknown) {
        headChildren.push(node as FakeMeta);
        return node;
      },
    },
    querySelector(selector: string) {
      expect(selector).toBe('meta[name="theme-color"]');
      return (
        headChildren.find((m) => m.attrs.get('name') === 'theme-color') ?? null
      );
    },
    createElement(tag: string) {
      expect(tag).toBe('meta');
      return makeMeta();
    },
  };
  return { doc, attrs, headChildren };
}

function runScript(options: {
  stored?: string | null;
  prefersDark?: boolean;
  throwOnStorage?: boolean;
  noMatchMedia?: boolean;
}) {
  const fake = createFakeDocument();
  const localStorage = {
    getItem(key: string) {
      if (options.throwOnStorage) throw new Error('SecurityError');
      expect(key).toBe(THEME_STORAGE_KEY);
      return options.stored ?? null;
    },
  };
  const window = options.noMatchMedia
    ? {}
    : {
        matchMedia: (query: string) => ({
          matches:
            query === '(prefers-color-scheme: dark)' && !!options.prefersDark,
        }),
      };
  new Function('localStorage', 'window', 'document', THEME_INIT_SCRIPT)(
    localStorage,
    window,
    fake.doc,
  );
  return {
    theme: fake.attrs.get('data-theme'),
    colorScheme: fake.doc.documentElement.style.colorScheme,
    themeColor: fake.headChildren[0]?.attrs.get('content'),
    metaCount: fake.headChildren.length,
  };
}

describe('theme preference (premium.md §3.1)', () => {
  it('defaults to "system" stored under cal.theme', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
    expect(THEME_STORAGE_KEY).toBe('cal.theme');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference('dark')).toBe('dark');
  });

  it('resolves system through the OS scheme, light when the OS has no dark preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('theme-color meta values are #F6F3EE light and #000000 dark', () => {
    expect(THEME_COLOR_META).toEqual({ light: '#F6F3EE', dark: '#000000' });
  });

  it('reads and writes storage, tolerating storage errors', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(readStoredThemePreference(storage)).toBe('system');
    writeStoredThemePreference(storage, 'light');
    expect(map.get('cal.theme')).toBe('light');
    expect(readStoredThemePreference(storage)).toBe('light');
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readStoredThemePreference(broken)).toBe('system');
    expect(() => writeStoredThemePreference(broken, 'dark')).not.toThrow();
    expect(readStoredThemePreference(null)).toBe('system');
  });

  it('applyResolvedTheme writes data-theme, color-scheme, and one theme-color meta', () => {
    const fake = createFakeDocument();
    const doc = fake.doc as unknown as ThemeDocumentLike;
    applyResolvedTheme('dark', doc);
    expect(fake.attrs.get('data-theme')).toBe('dark');
    expect(fake.doc.documentElement.style.colorScheme).toBe('dark');
    expect(fake.headChildren).toHaveLength(1);
    expect(fake.headChildren[0]?.attrs.get('content')).toBe('#000000');
    applyResolvedTheme('light', doc);
    expect(fake.attrs.get('data-theme')).toBe('light');
    expect(fake.headChildren).toHaveLength(1);
    expect(fake.headChildren[0]?.attrs.get('content')).toBe('#F6F3EE');

    const existing = createFakeDocument(true);
    applyResolvedTheme('light', existing.doc as unknown as ThemeDocumentLike);
    expect(existing.headChildren).toHaveLength(1);
    expect(existing.headChildren[0]?.attrs.get('content')).toBe('#F6F3EE');
    expect(() => applyResolvedTheme('light', null)).not.toThrow();
  });
});

describe('THEME_INIT_SCRIPT (pre-hydration)', () => {
  it('system preference follows the OS scheme', () => {
    expect(runScript({ prefersDark: true })).toEqual({
      theme: 'dark',
      colorScheme: 'dark',
      themeColor: '#000000',
      metaCount: 1,
    });
    expect(runScript({ prefersDark: false })).toEqual({
      theme: 'light',
      colorScheme: 'light',
      themeColor: '#F6F3EE',
      metaCount: 1,
    });
    expect(runScript({ stored: 'system', prefersDark: true }).theme).toBe(
      'dark',
    );
  });

  it('stored light or dark overrides the OS', () => {
    expect(runScript({ stored: 'light', prefersDark: true }).theme).toBe(
      'light',
    );
    expect(runScript({ stored: 'dark', prefersDark: false }).theme).toBe(
      'dark',
    );
  });

  it('falls back to the default on invalid values, storage errors, or no matchMedia', () => {
    expect(runScript({ stored: 'sepia', prefersDark: true }).theme).toBe(
      'dark',
    );
    expect(runScript({ throwOnStorage: true, prefersDark: true }).theme).toBe(
      'dark',
    );
    expect(runScript({ noMatchMedia: true }).theme).toBe('light');
  });

  it('agrees with resolveTheme for every preference and OS scheme', () => {
    for (const stored of ['system', 'light', 'dark', null, 'x']) {
      for (const prefersDark of [true, false]) {
        expect(runScript({ stored, prefersDark }).theme).toBe(
          resolveTheme(parseThemePreference(stored), prefersDark),
        );
      }
    }
  });
});

function runAccentScript(options: {
  stored?: string | null;
  throwOnStorage?: boolean;
}) {
  const attrs = new Map<string, string>();
  const doc = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    },
  };
  const localStorage = {
    getItem(key: string) {
      if (options.throwOnStorage) throw new Error('SecurityError');
      expect(key).toBe(ACCENT_STORAGE_KEY);
      return options.stored ?? null;
    },
  };
  new Function('localStorage', 'document', ACCENT_INIT_SCRIPT)(
    localStorage,
    doc,
  );
  return attrs.get('data-accent');
}

describe('accent preference and ACCENT_INIT_SCRIPT (pre-hydration)', () => {
  it('defaults to "ember" stored under cal.accent and validates all 4 swatches', () => {
    expect(ACCENT_STORAGE_KEY).toBe('cal.accent');
    expect(DEFAULT_ACCENT_PREFERENCE).toBe('ember');
    expect(ACCENT_PREFERENCES).toEqual(['ember', 'cobalt', 'jade', 'violet']);
    for (const accent of ACCENT_PREFERENCES) {
      expect(isAccentPreference(accent)).toBe(true);
      expect(parseAccentPreference(accent)).toBe(accent);
    }
    expect(isAccentPreference('crimson')).toBe(false);
    expect(parseAccentPreference('crimson')).toBe('ember');
    expect(parseAccentPreference(null)).toBe('ember');
  });

  it('reads, writes, and applies accent while tolerating storage errors', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    expect(readStoredAccentPreference(storage)).toBe('ember');
    writeStoredAccentPreference(storage, 'cobalt');
    expect(map.get('cal.accent')).toBe('cobalt');
    expect(readStoredAccentPreference(storage)).toBe('cobalt');

    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readStoredAccentPreference(broken)).toBe('ember');
    expect(() => writeStoredAccentPreference(broken, 'jade')).not.toThrow();

    const attrs = new Map<string, string>();
    const doc: AccentDocumentLike = {
      documentElement: {
        setAttribute: (name, value) => void attrs.set(name, value),
      },
    };
    applyAccent('violet', doc);
    expect(attrs.get('data-accent')).toBe('violet');
    expect(() => applyAccent('violet', null)).not.toThrow();
  });

  it('pre-hydration script sets data-accent for valid values and falls back to ember on invalid/error', () => {
    for (const accent of ACCENT_PREFERENCES) {
      expect(runAccentScript({ stored: accent })).toBe(accent);
    }
    expect(runAccentScript({ stored: null })).toBe('ember');
    expect(runAccentScript({ stored: 'magenta' })).toBe('ember');
    expect(runAccentScript({ throwOnStorage: true })).toBe('ember');
  });
});
