'use client';

import { ChevronDown } from 'lucide-react';
import { animate, motion } from 'motion/react';
import * as React from 'react';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { cn } from './cn';

/**
 * Disclosure motion (premium §8.6): finding rows, Possible causes, "Show all N bins",
 * "Show all N wafers", and "Show N more findings".
 * - Chevron `rotate(0 -> 180deg)` on `spring-snappy` (0 ms under reduced motion).
 * - New content mounts in flow in the same frame and fades `opacity 0 -> 1`, `translateY(-4px -> 0)`
 *   over `dur-1` `ease-out`, starting 40 ms after the click. Siblings below glide with
 *   `layout="position"` on `spring-ui`. The fade waits until no gliding sibling's text overlaps the
 *   new content's text, so no two visible text boxes overlap at any frame (A31).
 * - Close: content `opacity -> 0` over 100 ms, then unmounts and the siblings glide up.
 */

/** Container whose following text boxes a revealing body must not overlap. */
export const DISCLOSURE_SCOPE_ATTR = 'data-disclosure-scope' as const;
/** Set on content that is mounted but not yet faded in; its text is invisible. */
export const DISCLOSURE_PENDING_ATTR = 'data-disclosure-pending' as const;
export const DISCLOSURE_REVEAL_DELAY_MS = 40 as const;
export const DISCLOSURE_CLOSE_MS = 100 as const;
/** Upper bound on the wait for the siblings to clear (the `spring-ui` glide settles by then). */
export const DISCLOSURE_REVEAL_MAX_WAIT_MS = 600 as const;
export const DISCLOSURE_REDUCED_FADE_MS = 120 as const;
export const DISCLOSURE_REVEAL_OFFSET_PX = -4 as const;

export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** True when two rectangles share a positive area (touching edges do not count). */
export function rectsIntersect(a: RectLike, b: RectLike): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
  );
}

/** True when any rectangle of `a` intersects any rectangle of `b`. */
export function anyRectsIntersect(
  a: readonly RectLike[],
  b: readonly RectLike[],
): boolean {
  for (const ra of a) {
    for (const rb of b) {
      if (rectsIntersect(ra, rb)) return true;
    }
  }
  return false;
}

/** Whether the reveal may start: at least 40 ms after mount and clear of siblings, or the wait ran out. */
export function shouldStartDisclosureReveal(
  elapsedMs: number,
  overlapping: boolean,
): boolean {
  if (elapsedMs < DISCLOSURE_REVEAL_DELAY_MS) return false;
  return !overlapping || elapsedMs >= DISCLOSURE_REVEAL_MAX_WAIT_MS;
}

/** Rendered rectangles of every non-blank text node under `root`. */
function collectTextRects(root: Node): DOMRect[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || node.nodeValue.trim() === '') continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) rects.push(rect);
  }
  return rects;
}

/** Text rectangles inside `scope` that follow `el` in document order, excluding pending content. */
function collectFollowingTextRects(scope: Element, el: Element): DOMRect[] {
  const rects: DOMRect[] = [];
  const visit = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (child === el || child.contains(el)) {
        if (child !== el) visit(child);
        continue;
      }
      if (!(el.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        continue;
      }
      if (child.getAttribute(DISCLOSURE_PENDING_ATTR) === 'true') continue;
      rects.push(...collectTextRects(child));
    }
  };
  visit(scope);
  return rects;
}

function isOverlappingFollowers(el: Element): boolean {
  const scope = el.closest(`[${DISCLOSURE_SCOPE_ATTR}]`);
  if (!scope) return false;
  const own = collectTextRects(el);
  if (own.length === 0) return false;
  return anyRectsIntersect(own, collectFollowingTextRects(scope, el));
}

export interface DisclosureRevealProps {
  readonly ref: React.RefCallback<HTMLElement>;
  readonly initial: false | { opacity: number; y?: number };
  readonly animate: {
    opacity: number;
    y?: number;
    transition: Record<string, unknown>;
  };
  readonly exit: { opacity: number; transition: Record<string, unknown> };
  readonly [DISCLOSURE_PENDING_ATTR]?: 'true';
}

/**
 * Motion props for content revealed by a disclosure. `revealOnMount` is read once at mount: content
 * present from the first render (or mounting for another reason, such as a lot change) shows at once.
 */
export function useDisclosureReveal(
  revealOnMount: boolean,
  reduced: boolean,
): DisclosureRevealProps {
  const [reveal] = React.useState(revealOnMount);
  const [started, setStarted] = React.useState(!revealOnMount);
  const nodeRef = React.useRef<HTMLElement | null>(null);
  const ref = React.useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  React.useEffect(() => {
    if (started) return;
    if (reduced || typeof requestAnimationFrame !== 'function') {
      setStarted(true);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (): void => {
      const el = nodeRef.current;
      const elapsed = performance.now() - t0;
      const overlapping =
        el !== null && elapsed >= DISCLOSURE_REVEAL_DELAY_MS
          ? isOverlappingFollowers(el)
          : true;
      if (el === null || shouldStartDisclosureReveal(elapsed, overlapping)) {
        setStarted(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, reduced]);

  const exit = {
    opacity: 0,
    transition: reduced
      ? { duration: 0 }
      : {
          duration: DISCLOSURE_CLOSE_MS / 1000,
          ease: MOTION_TOKENS.easeOutTuple,
        },
  };

  if (reduced) {
    return {
      ref,
      initial: reveal ? { opacity: 0 } : false,
      animate: {
        opacity: started ? 1 : 0,
        transition: { duration: DISCLOSURE_REDUCED_FADE_MS / 1000, ease: 'linear' },
      },
      exit,
    };
  }

  return {
    ref,
    initial: reveal ? { opacity: 0, y: DISCLOSURE_REVEAL_OFFSET_PX } : false,
    animate: {
      opacity: started ? 1 : 0,
      y: started ? 0 : DISCLOSURE_REVEAL_OFFSET_PX,
      transition: {
        duration: MOTION_TOKENS.dur1Ms / 1000,
        ease: MOTION_TOKENS.easeOutTuple,
      },
    },
    exit,
    ...(started ? {} : { [DISCLOSURE_PENDING_ATTR]: 'true' as const }),
  };
}

/** Marks list rows that only show while a "Show all" list is expanded. */
export const DISCLOSURE_EXTRA_ATTR = 'data-disclosure-extra' as const;

export interface DisclosureListState {
  readonly expanded: boolean;
  /** Changes on every open and close, as the `layoutDependency` of the gliding rows and button. */
  readonly layoutEpoch: number;
  /** True only while rendering the rows an open adds; pass it as their `revealOnMount`. */
  readonly revealNewRows: boolean;
  readonly listRef: React.RefObject<HTMLUListElement | null>;
  readonly toggle: () => void;
}

/**
 * "Show all" / "Show fewer" list state (premium §8.6). Open: the rows mount and fade in, the rows
 * after them and the toggle glide. Close: the extra rows (`data-disclosure-extra="true"`) fade out
 * over 100 ms, then unmount and the toggle glides up. Toggling during the close fades them back in
 * from their current opacity.
 */
export function useDisclosureList(reduced: boolean): DisclosureListState {
  const [expanded, setExpanded] = React.useState(false);
  const [layoutEpoch, setLayoutEpoch] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const revealNewRowsRef = React.useRef(false);
  const closingRef = React.useRef<{
    readonly timer: ReturnType<typeof setTimeout>;
    readonly elements: readonly HTMLElement[];
  } | null>(null);

  React.useEffect(() => {
    revealNewRowsRef.current = false;
  });

  React.useEffect(
    () => () => {
      if (closingRef.current) clearTimeout(closingRef.current.timer);
    },
    [],
  );

  const toggle = React.useCallback((): void => {
    const closing = closingRef.current;
    if (closing) {
      clearTimeout(closing.timer);
      closingRef.current = null;
      for (const el of closing.elements) {
        animate(
          el,
          { opacity: 1 },
          { duration: MOTION_TOKENS.dur1Ms / 1000, ease: MOTION_TOKENS.easeOutTuple },
        );
      }
      return;
    }
    if (!expanded) {
      revealNewRowsRef.current = true;
      setExpanded(true);
      setLayoutEpoch((n) => n + 1);
      return;
    }
    const elements = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(
        `[${DISCLOSURE_EXTRA_ATTR}="true"]`,
      ) ?? [],
    );
    const collapse = (): void => {
      closingRef.current = null;
      setExpanded(false);
      setLayoutEpoch((n) => n + 1);
    };
    if (reduced || elements.length === 0) {
      collapse();
      return;
    }
    for (const el of elements) {
      animate(
        el,
        { opacity: 0 },
        { duration: DISCLOSURE_CLOSE_MS / 1000, ease: MOTION_TOKENS.easeOutTuple },
      );
    }
    closingRef.current = {
      timer: setTimeout(collapse, DISCLOSURE_CLOSE_MS),
      elements,
    };
  }, [expanded, reduced]);

  return {
    expanded,
    layoutEpoch,
    revealNewRows: revealNewRowsRef.current,
    listRef,
    toggle,
  };
}

/** `layout="position"` glide transition for disclosure siblings (instant under reduced motion). */
export function disclosureLayoutTransition(
  reduced: boolean,
): typeof SPRING_TOKENS.ui | { duration: number } {
  return reduced ? { duration: 0 } : SPRING_TOKENS.ui;
}

export interface DisclosureListItemProps {
  readonly revealOnMount: boolean;
  readonly reduced: boolean;
  readonly layoutEpoch: number;
  /** Row only shows while the list is expanded; it fades out on close. */
  readonly extra: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
  readonly 'data-active'?: 'true';
}

/** A row of a "Show all" list (premium §8.6): glides on open and close only, never on data changes. */
export function DisclosureListItem({
  revealOnMount,
  reduced,
  layoutEpoch,
  extra,
  className,
  children,
  ...rest
}: DisclosureListItemProps): React.JSX.Element {
  const reveal = useDisclosureReveal(revealOnMount, reduced);
  return (
    <motion.li
      {...reveal}
      {...rest}
      {...{ [DISCLOSURE_EXTRA_ATTR]: extra ? 'true' : undefined }}
      layout="position"
      layoutDependency={layoutEpoch}
      transition={disclosureLayoutTransition(reduced)}
      className={className}
    >
      {children}
    </motion.li>
  );
}

/** The "Show all" / "Show fewer" toggle wrapper, gliding with the rows above it. */
export function DisclosureGlide({
  reduced,
  layoutEpoch,
  className,
  children,
}: {
  readonly reduced: boolean;
  readonly layoutEpoch: number;
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <motion.div
      layout="position"
      layoutDependency={layoutEpoch}
      transition={disclosureLayoutTransition(reduced)}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export interface DisclosureChevronProps {
  readonly open: boolean;
  readonly reduced: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** 12 px chevron-down that rotates 0 -> 180deg on `spring-snappy`; 0 ms under reduced motion. */
export function DisclosureChevron({
  open,
  reduced,
  className,
  'data-testid': dataTestId,
}: DisclosureChevronProps): React.JSX.Element {
  return (
    <motion.span
      aria-hidden="true"
      data-testid={dataTestId}
      data-open={open ? 'true' : 'false'}
      initial={false}
      animate={{ rotate: open ? 180 : 0 }}
      transition={reduced ? { duration: 0 } : SPRING_TOKENS.snappy}
      className={cn('inline-flex size-3 shrink-0 items-center justify-center', className)}
    >
      <ChevronDown className="size-3" strokeWidth={1.5} />
    </motion.span>
  );
}
