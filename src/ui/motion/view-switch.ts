/**
 * Same-document view switches (landing <-> loading <-> report, lot switch, the agent console's
 * lot install) through the native View Transitions API.
 *
 * - Feature-detected: without `document.startViewTransition`, or under reduced motion, the
 *   update runs synchronously and nothing animates.
 * - Shared elements are named only for the length of one switch, so they never collide with
 *   the theme cross-fade or the route transition. Each role (`wafer`, `verdict`, ...) is looked
 *   up inside the `[data-vt-scope]` the user activated, then the default scope, then the page;
 *   only elements on screen take part.
 * - New-only blocks tagged `data-vt-enter="1..3"` rise in with a short stagger (CSS).
 * - A switch requested while one is running waits for it to finish, then all waiting updates
 *   apply together in one switch, so a fast worker never cuts a morph short.
 * - Any pointer or wheel input during a switch skips it to the end state.
 *
 * CSS lives in `src/app/atelier.css` under `:root[data-vt-kind]`.
 */

export type ViewSwitchKind = 'open' | 'close' | 'switch' | 'agents-lot';

/** Shared roles per switch kind; each becomes `view-transition-name: cal-vt-<role>`. */
export const VIEW_SWITCH_ROLES: Readonly<Record<ViewSwitchKind, readonly string[]>> = {
  open: ['wafer', 'verdict'],
  close: ['wafer', 'verdict'],
  switch: ['wafer', 'verdict'],
  'agents-lot': ['agent-wafer', 'agent-kpi'],
};

/** Staggered rise-in slots for new-only blocks (`data-vt-enter="n"`). */
export const VIEW_SWITCH_ENTER_SLOTS = 3 as const;

/** Floating layers (palette, drop overlay) keep their own exit motion during a switch. */
export const VIEW_SWITCH_OVERLAY_SLOTS = 2 as const;

/** Activation targets older than this no longer pick the morph source. */
export const VIEW_SWITCH_ACTIVATION_TTL_MS = 1500 as const;

export interface ViewTransitionHandle {
  skipTransition(): void;
  readonly finished: Promise<unknown>;
  readonly ready?: Promise<unknown>;
  readonly updateCallbackDone?: Promise<unknown>;
}

export interface ViewSwitchElement {
  readonly style: { viewTransitionName: string };
  getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number; height: number };
  closest(selector: string): ViewSwitchElement | null;
  querySelector(selector: string): ViewSwitchElement | null;
}

export interface ViewSwitchDocument {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionHandle;
  querySelector(selector: string): ViewSwitchElement | null;
  querySelectorAll(selector: string): ArrayLike<ViewSwitchElement>;
  readonly documentElement: { dataset: Record<string, string | undefined> };
}

export interface ViewSwitcherOptions {
  readonly getDocument: () => ViewSwitchDocument | null;
  readonly prefersReducedMotion: () => boolean;
  /** Runs the queued state updates synchronously (React `flushSync` in the browser). */
  readonly flush: (run: () => void) => void;
  readonly viewport: () => { readonly width: number; readonly height: number };
  /** Element the user last pressed, if recent. */
  readonly getActivationTarget?: () => ViewSwitchElement | null;
  /** Called inside the update, after the new state is in the DOM (scroll reset). */
  readonly afterUpdate?: (kind: ViewSwitchKind) => void;
  /** Registers skip-on-input listeners for one switch; returns the cleanup. */
  readonly onInputDuringSwitch?: (skip: () => void) => () => void;
}

export interface ViewSwitcher {
  readonly run: (kind: ViewSwitchKind, update: () => void) => void;
  readonly isRunning: () => boolean;
}

function isOnScreen(el: ViewSwitchElement, vw: number, vh: number): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
}

function pickRole(
  doc: ViewSwitchDocument,
  scope: ViewSwitchElement | null,
  role: string,
  vw: number,
  vh: number,
): ViewSwitchElement | null {
  const selector = `[data-vt="${role}"]`;
  const candidates = [
    scope?.querySelector(selector) ?? null,
    doc.querySelector(`[data-vt-scope="default"] ${selector}`),
    doc.querySelector(selector),
  ];
  for (const el of candidates) {
    if (el && isOnScreen(el, vw, vh)) return el;
  }
  return null;
}

/** Names the shared, enter, and overlay elements of one side of a switch; returns them for cleanup. */
export function nameViewSwitchElements(
  doc: ViewSwitchDocument,
  kind: ViewSwitchKind,
  activation: ViewSwitchElement | null,
  viewport: { readonly width: number; readonly height: number },
  side: 'old' | 'new',
): ViewSwitchElement[] {
  const named: ViewSwitchElement[] = [];
  const { width: vw, height: vh } = viewport;
  const scope = side === 'old' ? (activation?.closest('[data-vt-scope]') ?? null) : null;
  for (const role of VIEW_SWITCH_ROLES[kind]) {
    const el = pickRole(doc, scope, role, vw, vh);
    if (el && !named.includes(el)) {
      el.style.viewTransitionName = `cal-vt-${role}`;
      named.push(el);
    }
  }
  if (side === 'new' && kind !== 'agents-lot') {
    for (let slot = 1; slot <= VIEW_SWITCH_ENTER_SLOTS; slot += 1) {
      const el = doc.querySelector(`[data-vt-enter="${slot}"]`);
      if (el && !named.includes(el) && isOnScreen(el, vw, vh)) {
        el.style.viewTransitionName = `cal-vt-enter-${slot}`;
        named.push(el);
      }
    }
  }
  const overlays = doc.querySelectorAll('[data-vt="overlay"]');
  for (let i = 0; i < Math.min(overlays.length, VIEW_SWITCH_OVERLAY_SLOTS); i += 1) {
    const el = overlays[i]!;
    if (!named.includes(el)) {
      el.style.viewTransitionName = `cal-vt-overlay-${i + 1}`;
      named.push(el);
    }
  }
  return named;
}

function clearNames(elements: readonly ViewSwitchElement[]): void {
  for (const el of elements) el.style.viewTransitionName = '';
}

export function createViewSwitcher(options: ViewSwitcherOptions): ViewSwitcher {
  let running: ViewTransitionHandle | null = null;
  let queued: { kind: ViewSwitchKind; updates: Array<() => void> } | null = null;

  const applyAll = (updates: readonly (() => void)[]): void => {
    options.flush(() => {
      for (const update of updates) update();
    });
  };

  const start = (kind: ViewSwitchKind, updates: Array<() => void>): void => {
    const doc = options.getDocument();
    if (
      doc === null ||
      typeof doc.startViewTransition !== 'function' ||
      options.prefersReducedMotion()
    ) {
      // No switch: the updates batch like any plain setState.
      for (const update of updates) update();
      return;
    }

    const root = doc.documentElement;
    const viewport = options.viewport();
    const activation = options.getActivationTarget?.() ?? null;
    root.dataset.vtKind = kind;
    const oldNamed = nameViewSwitchElements(doc, kind, activation, viewport, 'old');
    let newNamed: ViewSwitchElement[] = [];

    let handle: ViewTransitionHandle;
    try {
      handle = doc.startViewTransition(() => {
        clearNames(oldNamed);
        try {
          applyAll(updates);
          options.afterUpdate?.(kind);
        } finally {
          newNamed = nameViewSwitchElements(doc, kind, null, options.viewport(), 'new');
        }
      });
    } catch {
      clearNames(oldNamed);
      delete root.dataset.vtKind;
      for (const update of updates) update();
      return;
    }

    running = handle;
    // A skipped or aborted switch rejects these; the end state is already applied.
    handle.ready?.catch(() => undefined);
    handle.updateCallbackDone?.catch(() => undefined);
    const removeInput = options.onInputDuringSwitch?.(() => handle.skipTransition()) ?? (() => undefined);

    const settle = (): void => {
      removeInput();
      clearNames(oldNamed);
      clearNames(newNamed);
      if (running === handle) running = null;
      delete root.dataset.vtKind;
      const next = queued;
      queued = null;
      if (next) start(next.kind, next.updates);
    };
    handle.finished.then(settle, settle);
  };

  const run = (kind: ViewSwitchKind, update: () => void): void => {
    if (running !== null) {
      if (queued) {
        queued.kind = kind;
        queued.updates.push(update);
      } else {
        queued = { kind, updates: [update] };
      }
      return;
    }
    start(kind, [update]);
  };

  return { run, isRunning: () => running !== null };
}
