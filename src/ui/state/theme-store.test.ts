import { describe, expect, it } from 'vitest';
import { createThemeStore, useThemeStore } from './theme-store';

describe('theme store slice (premium.md §3.1)', () => {
  it('starts on the default "system" preference, resolving light without an OS dark scheme', () => {
    const state = createThemeStore().getState();
    expect(state.preference).toBe('system');
    expect(state.resolved).toBe('light');
    // Node has no window: the shared store uses the same defaults.
    expect(useThemeStore.getState().resolved).toBe('light');
  });

  it('follows OS changes only while on system', () => {
    const store = createThemeStore({ systemPrefersDark: true });
    expect(store.getState().resolved).toBe('dark');
    store.getState().setSystemPrefersDark(false);
    expect(store.getState().resolved).toBe('light');

    store.getState().setPreference('dark');
    expect(store.getState().resolved).toBe('dark');
    store.getState().setSystemPrefersDark(true);
    store.getState().setSystemPrefersDark(false);
    expect(store.getState().resolved).toBe('dark');
    expect(store.getState().systemPrefersDark).toBe(false);

    store.getState().setPreference('system');
    expect(store.getState().resolved).toBe('light');
  });

  it('notifies only on real changes and rejects invalid preferences', () => {
    const store = createThemeStore({ preference: 'light' });
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.getState().setPreference('light');
    store.getState().setSystemPrefersDark(false);
    expect(calls).toBe(0);
    store.getState().setSystemPrefersDark(true);
    expect(calls).toBe(1);
    expect(store.getState().resolved).toBe('light');
    store.getState().setPreference('bogus' as never);
    expect(store.getState().preference).toBe('system');
    expect(store.getState().resolved).toBe('dark');
  });

  it('tracks accent independently of light/dark/system and rejects invalid accents', () => {
    const store = createThemeStore({ preference: 'light', accent: 'cobalt' });
    expect(store.getState().accent).toBe('cobalt');
    expect(store.getState().resolved).toBe('light');

    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.getState().setAccent('cobalt');
    expect(calls).toBe(0);

    store.getState().setAccent('jade');
    expect(calls).toBe(1);
    expect(store.getState().accent).toBe('jade');
    expect(store.getState().resolved).toBe('light');

    store.getState().setPreference('dark');
    expect(store.getState().resolved).toBe('dark');
    expect(store.getState().accent).toBe('jade');

    store.getState().setAccent('bogus' as never);
    expect(store.getState().accent).toBe('ember');
  });
});
