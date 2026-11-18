import { describe, expect, it, vi } from 'vitest';
import {
  createThemeSwitcher,
  THEME_SWITCHING_ATTRIBUTE,
  type ViewTransitionLike,
  withTransitionsSuppressed,
} from './theme-transition';

type Pref = 'system' | 'light' | 'dark';

function setup(opts: { supported?: boolean; reduced?: boolean; changes?: boolean } = {}) {
  const log: string[] = [];
  const transitions: Array<ViewTransitionLike & { finish: () => void; skip: ReturnType<typeof vi.fn> }> = [];
  const doc = {
    startViewTransition:
      opts.supported === false
        ? undefined
        : (update: () => void) => {
            update();
            let finish!: () => void;
            const finished = new Promise<void>((resolve) => {
              finish = resolve;
            });
            const skip = vi.fn(() => log.push('skip'));
            const t = { skipTransition: skip, finished, finish, skip };
            transitions.push(t);
            log.push('start');
            return t;
          },
  };
  const switcher = createThemeSwitcher<Pref>({
    getDocument: () => doc,
    prefersReducedMotion: () => opts.reduced === true,
    changesResolvedTheme: () => opts.changes !== false,
    apply: (p) => log.push(`apply:${p}`),
  });
  return { switcher, log, transitions };
}

describe('createThemeSwitcher (premium §8.8)', () => {
  it('runs the change inside a view transition', () => {
    const { switcher, log } = setup();
    switcher.switchTo('light');
    expect(log).toEqual(['apply:light', 'start']);
    expect(switcher.getRunning()).not.toBeNull();
  });

  it('skips the running transition before starting the next one', () => {
    const { switcher, log, transitions } = setup();
    switcher.switchTo('light');
    switcher.switchTo('dark');
    expect(transitions[0]!.skip).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['apply:light', 'start', 'skip', 'apply:dark', 'start']);
    expect(switcher.getRunning()).toBe(transitions[1]);
  });

  it('clears the running transition when it finishes', async () => {
    const { switcher, transitions } = setup();
    switcher.switchTo('light');
    transitions[0]!.finish();
    await transitions[0]!.finished;
    await Promise.resolve();
    expect(switcher.getRunning()).toBeNull();
  });

  it.each([
    ['unsupported', { supported: false }],
    ['reduced motion', { reduced: true }],
    ['no resolved change', { changes: false }],
  ])('switches instantly when %s', (_label, opts) => {
    const { switcher, log } = setup(opts);
    switcher.switchTo('dark');
    expect(log).toEqual(['apply:dark']);
    expect(switcher.getRunning()).toBeNull();
  });
});

describe('withTransitionsSuppressed', () => {
  it('sets the attribute around the write and the style flush, then removes it', () => {
    const attrs = new Set<string>();
    const order: string[] = [];
    const doc = {
      documentElement: {
        setAttribute: (n: string) => attrs.add(n),
        removeAttribute: (n: string) => attrs.delete(n),
      },
      body: {},
    };
    withTransitionsSuppressed(
      doc,
      () => order.push(`write:${attrs.has(THEME_SWITCHING_ATTRIBUTE)}`),
      () => order.push(`flush:${attrs.has(THEME_SWITCHING_ATTRIBUTE)}`),
    );
    expect(order).toEqual(['write:true', 'flush:true']);
    expect(attrs.has(THEME_SWITCHING_ATTRIBUTE)).toBe(false);
  });
});
