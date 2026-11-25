import { describe, expect, it, vi } from 'vitest';
import {
  createViewSwitcher,
  type ViewSwitchDocument,
  type ViewSwitchElement,
  type ViewTransitionHandle,
} from './view-switch';

function fakeEl(attrs: Record<string, string>, onScreen = true): ViewSwitchElement & { attrs: Record<string, string> } {
  const rect = onScreen
    ? { top: 10, bottom: 110, left: 10, right: 110, width: 100, height: 100 }
    : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  return {
    attrs,
    style: { viewTransitionName: '' },
    getBoundingClientRect: () => rect,
    closest: () => null,
    querySelector: () => null,
  };
}

function fakeDoc(
  elements: ReadonlyArray<ReturnType<typeof fakeEl>>,
  withApi: boolean,
): { doc: ViewSwitchDocument; finish: () => void; seenNames: string[] } {
  let resolveFinished: () => void = () => undefined;
  const seenNames: string[] = [];
  const match = (selector: string) =>
    elements.filter((el) => {
      const m = /\[(data-vt(?:-enter)?)="([^"]+)"\]$/.exec(selector);
      return m !== null && el.attrs[m[1]!] === m[2];
    });
  const doc: ViewSwitchDocument = {
    documentElement: { dataset: {} },
    querySelector: (selector) => (selector.includes('data-vt-scope') ? null : (match(selector)[0] ?? null)),
    querySelectorAll: (selector) => match(selector),
    ...(withApi
      ? {
          startViewTransition: (update: () => void | Promise<void>): ViewTransitionHandle => {
            seenNames.push(...elements.map((el) => el.style.viewTransitionName).filter(Boolean));
            void update();
            seenNames.push(...elements.map((el) => el.style.viewTransitionName).filter(Boolean));
            return {
              skipTransition: () => resolveFinished(),
              finished: new Promise<void>((resolve) => {
                resolveFinished = resolve;
              }),
            };
          },
        }
      : {}),
  };
  return { doc, finish: () => resolveFinished(), seenNames };
}

const baseOptions = {
  prefersReducedMotion: () => false,
  flush: (run: () => void) => run(),
  viewport: () => ({ width: 1440, height: 900 }),
};

describe('createViewSwitcher', () => {
  it('runs the update directly without the View Transitions API', () => {
    const { doc } = fakeDoc([], false);
    const update = vi.fn();
    createViewSwitcher({ ...baseOptions, getDocument: () => doc }).run('open', update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(doc.documentElement.dataset.vtKind).toBeUndefined();
  });

  it('runs the update directly under reduced motion', () => {
    const start = vi.fn();
    const { doc } = fakeDoc([], true);
    const update = vi.fn();
    createViewSwitcher({
      ...baseOptions,
      prefersReducedMotion: () => true,
      getDocument: () => ({ ...doc, startViewTransition: start }),
    }).run('open', update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('names on-screen shared roles for one switch and clears them after', async () => {
    const wafer = fakeEl({ 'data-vt': 'wafer' });
    const hidden = fakeEl({ 'data-vt': 'verdict' }, false);
    const enter = fakeEl({ 'data-vt-enter': '1' });
    const { doc, finish, seenNames } = fakeDoc([wafer, hidden, enter], true);
    const switcher = createViewSwitcher({ ...baseOptions, getDocument: () => doc });
    switcher.run('open', () => undefined);
    expect(doc.documentElement.dataset.vtKind).toBe('open');
    expect(seenNames).toContain('cal-vt-wafer');
    expect(seenNames).toContain('cal-vt-enter-1');
    expect(seenNames).not.toContain('cal-vt-verdict');
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(wafer.style.viewTransitionName).toBe('');
    expect(enter.style.viewTransitionName).toBe('');
    expect(doc.documentElement.dataset.vtKind).toBeUndefined();
    expect(switcher.isRunning()).toBe(false);
  });

  it('queues updates requested mid-switch and applies them together afterwards', async () => {
    const { doc, finish } = fakeDoc([], true);
    const switcher = createViewSwitcher({ ...baseOptions, getDocument: () => doc });
    const order: string[] = [];
    switcher.run('open', () => order.push('a'));
    switcher.run('switch', () => order.push('b'));
    switcher.run('switch', () => order.push('c'));
    expect(order).toEqual(['a']);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
