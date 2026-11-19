/**
 * Theme switch cross-fade (`src/ui/theme/theme-transition.ts`, premium.md §8.8).
 *
 * A choice in the Appearance menu runs inside `document.startViewTransition()`, so the
 * root cross-fades old and new snapshots over `dur-4` `ease-in-out` (CSS in globals.css,
 * opacity only). The switch is instant when the API is missing, under reduced motion, or
 * when the resolved theme does not change. A second change during a running transition
 * calls `skipTransition()` on it, then starts the new one.
 */

export interface ViewTransitionLike {
  skipTransition(): void;
  readonly finished: Promise<unknown>;
}

export interface ViewTransitionDocumentLike {
  startViewTransition?: (update: () => void) => ViewTransitionLike;
}

export interface ThemeSwitcherOptions<P> {
  /** Document exposing `startViewTransition`, or `null` outside the browser. */
  readonly getDocument: () => ViewTransitionDocumentLike | null;
  readonly prefersReducedMotion: () => boolean;
  /** `true` when applying `preference` changes the resolved theme. */
  readonly changesResolvedTheme: (preference: P) => boolean;
  /** Writes the preference and the DOM theme synchronously. */
  readonly apply: (preference: P) => void;
  /** Optional lifecycle hook invoked right before `startViewTransition`. */
  readonly onTransitionStart?: () => void;
  /** Optional lifecycle hook invoked when the view transition settles or is skipped. */
  readonly onTransitionEnd?: () => void;
}

export interface ThemeSwitcher<P> {
  readonly switchTo: (preference: P) => void;
  /** The running transition, if any (tests). */
  readonly getRunning: () => ViewTransitionLike | null;
}

export function createThemeSwitcher<P>(
  options: ThemeSwitcherOptions<P>,
): ThemeSwitcher<P> {
  let running: ViewTransitionLike | null = null;

  const switchTo = (preference: P): void => {
    const previous = running;
    running = null;
    if (previous) {
      previous.skipTransition();
      options.onTransitionEnd?.();
    }

    const doc = options.getDocument();
    const animated =
      doc !== null &&
      typeof doc.startViewTransition === 'function' &&
      !options.prefersReducedMotion() &&
      options.changesResolvedTheme(preference);
    if (!animated) {
      options.apply(preference);
      return;
    }

    options.onTransitionStart?.();
    const transition = doc.startViewTransition!(() => options.apply(preference));
    running = transition;
    const release = (): void => {
      if (running === transition) {
        running = null;
        options.onTransitionEnd?.();
      }
    };
    transition.finished.then(release, release);
  };

  return { switchTo, getRunning: () => running };
}

/** Attribute that turns every CSS transition off while the theme attributes change. */
export const THEME_SWITCHING_ATTRIBUTE = 'data-theme-switching';

/** Attribute active during an accent View Transition (240 ms cross-fade). */
export const ACCENT_TRANSITION_ATTRIBUTE = 'data-accent-transition';

/** Attribute active during fallback CSS accent cross-fade when View Transitions are absent. */
export const ACCENT_FADING_ATTRIBUTE = 'data-accent-fading';

export interface TransitionSuppressDocumentLike {
  readonly documentElement: {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  };
  readonly body: unknown;
}

/**
 * Runs `write` with CSS transitions off and flushes style, so hover fills and colour
 * transitions jump to the new theme instead of animating per element (§8.8 "Never").
 * The attribute is removed in the same task: the flushed style already holds the new
 * colours, so turning transitions back on starts none, and the next frame recalculates
 * style once (a deferred removal cost a second full-page recalc in its own frame).
 */
export function withTransitionsSuppressed(
  doc: TransitionSuppressDocumentLike,
  write: () => void,
  flushStyle: (body: unknown) => void,
): void {
  doc.documentElement.setAttribute(THEME_SWITCHING_ATTRIBUTE, '');
  try {
    write();
    flushStyle(doc.body);
  } finally {
    doc.documentElement.removeAttribute(THEME_SWITCHING_ATTRIBUTE);
  }
}
