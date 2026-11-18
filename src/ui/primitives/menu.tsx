'use client';

import { Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { cn } from './cn';

export type DropdownMenuAlign = 'start' | 'center' | 'end';
export type DropdownMenuOpenSource = 'pointer' | 'keyboard';
export type DropdownMenuOpenAnimation = 'spring' | 'pointer-fade';

export interface AnchorRectLike {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

export interface AnchoredMenuPosition {
  readonly top: number;
  readonly left: number;
  readonly transformOrigin: 'top left' | 'top center' | 'top right';
}

/**
 * Computes viewport-clamped `fixed` coordinates for `DropdownMenuContent`
 * with an `8 px` screen-edge safety margin (§4.2, §4.10).
 */
export function computeAnchoredMenuPosition(options: {
  readonly triggerRect: AnchorRectLike;
  readonly menuWidth: number;
  readonly viewportWidth: number;
  readonly align: DropdownMenuAlign;
  readonly sideOffset?: number;
  readonly viewportMargin?: number;
}): AnchoredMenuPosition {
  const {
    triggerRect,
    menuWidth,
    viewportWidth,
    align,
    sideOffset = 8,
    viewportMargin = 8,
  } = options;

  let rawLeft: number;
  let transformOrigin: AnchoredMenuPosition['transformOrigin'];

  if (align === 'start') {
    rawLeft = triggerRect.left;
    transformOrigin = 'top left';
  } else if (align === 'end') {
    rawLeft = triggerRect.right - menuWidth;
    transformOrigin = 'top right';
  } else {
    rawLeft = triggerRect.left + triggerRect.width / 2 - menuWidth / 2;
    transformOrigin = 'top center';
  }

  const maxLeft = Math.max(
    viewportMargin,
    viewportWidth - menuWidth - viewportMargin,
  );
  const clampedLeft = Math.min(maxLeft, Math.max(viewportMargin, Math.round(rawLeft)));

  return {
    top: Math.round(triggerRect.bottom + sideOffset),
    left: clampedLeft,
    transformOrigin,
  };
}

export type MenuKeyAction =
  | { readonly kind: 'focus'; readonly index: number }
  | { readonly kind: 'select'; readonly index: number }
  | { readonly kind: 'close'; readonly returnFocus: boolean };

/**
 * Pure keyboard state resolver for WAI-ARIA `role="menu"` (§4.2):
 * `ArrowDown`/`ArrowUp` wrap, `Home`/`End` jump, `Enter`/` ` select, `Escape` closes & restores focus.
 */
export function resolveMenuKeyAction(
  key: string,
  currentIndex: number,
  itemCount: number,
): MenuKeyAction | null {
  if (key === 'Escape') {
    return { kind: 'close', returnFocus: true };
  }
  if (key === 'Tab') {
    return { kind: 'close', returnFocus: false };
  }
  if (itemCount <= 0) {
    return null;
  }
  if (key === 'ArrowDown') {
    const next = currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
    return { kind: 'focus', index: next };
  }
  if (key === 'ArrowUp') {
    const prev =
      currentIndex <= 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount;
    return { kind: 'focus', index: prev };
  }
  if (key === 'Home') {
    return { kind: 'focus', index: 0 };
  }
  if (key === 'End') {
    return { kind: 'focus', index: itemCount - 1 };
  }
  if (key === 'Enter' || key === ' ') {
    if (currentIndex >= 0 && currentIndex < itemCount) {
      return { kind: 'select', index: currentIndex };
    }
  }
  return null;
}

/**
 * Case-insensitive prefix/substring typeahead matcher cycling from `currentIndex + 1` (§4.2).
 */
export function matchMenuTypeahead(
  labels: readonly string[],
  query: string,
  currentIndex: number,
): number {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0 || labels.length === 0) {
    return -1;
  }
  const count = labels.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const idx = (Math.max(-1, currentIndex) + offset) % count;
    const text = (labels[idx] ?? '').trim().toLowerCase();
    if (text.startsWith(normalized)) {
      return idx;
    }
  }
  for (let offset = 1; offset <= count; offset += 1) {
    const idx = (Math.max(-1, currentIndex) + offset) % count;
    const text = (labels[idx] ?? '').trim().toLowerCase();
    if (text.includes(normalized)) {
      return idx;
    }
  }
  return -1;
}

interface DropdownMenuContextValue {
  readonly open: boolean;
  readonly openSource: DropdownMenuOpenSource;
  readonly instantClose: boolean;
  readonly triggerId: string;
  readonly contentId: string;
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly setOpenWithSource: (
    nextOpen: boolean,
    source?: DropdownMenuOpenSource,
    options?: { readonly returnFocus?: boolean; readonly instant?: boolean },
  ) => void;
}

const DropdownMenuContext =
  React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext(componentName: string): DropdownMenuContextValue {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) {
    throw new Error(`${componentName} must be used inside <DropdownMenu>.`);
  }
  return ctx;
}

export interface DropdownMenuProps {
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly children?: React.ReactNode;
}

export function DropdownMenu({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: DropdownMenuProps): React.JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const [openSource, setOpenSource] =
    React.useState<DropdownMenuOpenSource>('pointer');
  const [instantClose, setInstantClose] = React.useState(false);

  const baseId = React.useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-menu`;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpenWithSource = React.useCallback(
    (
      nextOpen: boolean,
      source: DropdownMenuOpenSource = 'pointer',
      options?: { readonly returnFocus?: boolean; readonly instant?: boolean },
    ) => {
      if (nextOpen) {
        setOpenSource(source);
        setInstantClose(false);
      } else {
        setInstantClose(options?.instant === true);
      }
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);

      if (!nextOpen && options?.returnFocus) {
        queueMicrotask(() => {
          triggerRef.current?.focus();
        });
      }
    },
    [isControlled, onOpenChange],
  );

  const value = React.useMemo<DropdownMenuContextValue>(
    () => ({
      open,
      openSource,
      instantClose,
      triggerId,
      contentId,
      triggerRef,
      setOpenWithSource,
    }),
    [open, openSource, instantClose, triggerId, contentId, setOpenWithSource],
  );

  return (
    <DropdownMenuContext.Provider value={value}>
      {children}
    </DropdownMenuContext.Provider>
  );
}

export interface DropdownMenuTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly children?: React.ReactNode;
}

export const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  DropdownMenuTriggerProps
>(function DropdownMenuTrigger(
  {
    className,
    onClick,
    onKeyDown,
    onPointerDown,
    onPointerCancel,
    type = 'button',
    ...props
  },
  forwardedRef,
) {
  const { open, triggerId, contentId, triggerRef, setOpenWithSource } =
    useDropdownMenuContext('DropdownMenuTrigger');
  const pointerOpenedRef = React.useRef(false);

  const setRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef, triggerRef],
  );

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0 || props.disabled) {
      return;
    }
    pointerOpenedRef.current = true;
    setOpenWithSource(!open, 'pointer');
  };

  const handlePointerCancel = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    onPointerCancel?.(event);
    pointerOpenedRef.current = false;
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || props.disabled) {
      return;
    }
    const isKeyboardDetail = event.detail === 0;
    if (pointerOpenedRef.current && !isKeyboardDetail) {
      pointerOpenedRef.current = false;
      return;
    }
    pointerOpenedRef.current = false;
    setOpenWithSource(!open, isKeyboardDetail ? 'keyboard' : 'pointer');
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || props.disabled) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpenWithSource(true, 'keyboard');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpenWithSource(false, 'keyboard', { returnFocus: true });
    }
  };

  return (
    <button
      ref={setRef}
      id={triggerId}
      type={type}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? contentId : undefined}
      onPointerDown={handlePointerDown}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  );
});

export interface DropdownMenuContentProps
  extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'
  > {
  readonly align?: DropdownMenuAlign;
  readonly sideOffset?: number;
  readonly expectedWidthPx?: number;
  readonly openAnimation?: DropdownMenuOpenAnimation;
}

export function DropdownMenuContent({
  align = 'center',
  sideOffset = 8,
  expectedWidthPx = 260,
  openAnimation = 'spring',
  className,
  children,
  ...props
}: DropdownMenuContentProps): React.JSX.Element | null {
  const {
    open,
    openSource,
    instantClose,
    triggerId,
    contentId,
    triggerRef,
    setOpenWithSource,
  } = useDropdownMenuContext('DropdownMenuContent');
  const shouldReduceMotion = useReducedMotion();
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const typeaheadBufRef = React.useRef('');
  const typeaheadTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [position, setPosition] = React.useState<AnchoredMenuPosition>({
    top: 56,
    left: 16,
    transformOrigin:
      align === 'start'
        ? 'top left'
        : align === 'end'
          ? 'top right'
          : 'top center',
  });

  const updatePosition = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const triggerEl = triggerRef.current;
    if (!triggerEl) {
      return;
    }
    const triggerRect = triggerEl.getBoundingClientRect();
    const measuredWidth =
      menuRef.current?.offsetWidth && menuRef.current.offsetWidth > 0
        ? menuRef.current.offsetWidth
        : expectedWidthPx;
    setPosition(
      computeAnchoredMenuPosition({
        triggerRect,
        menuWidth: measuredWidth,
        viewportWidth: window.innerWidth,
        align,
        sideOffset,
      }),
    );
  }, [align, expectedWidthPx, sideOffset, triggerRef]);

  React.useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }
    updatePosition();

    // Focus checked item or first enabled menuitem when opened
    const frame = requestAnimationFrame(() => {
      updatePosition();
      const menuEl = menuRef.current;
      if (!menuEl) {
        return;
      }
      const items = Array.from(
        menuEl.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled]):not([aria-disabled="true"]), [role="menuitemradio"]:not([disabled]):not([aria-disabled="true"])',
        ),
      );
      const checked = items.find(
        (el) => el.getAttribute('aria-checked') === 'true',
      );
      (checked ?? items[0])?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }

    const handlePointerDownOutside = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpenWithSource(false, 'pointer');
    };

    const handleViewportChange = (): void => {
      updatePosition();
    };

    window.addEventListener('pointerdown', handlePointerDownOutside, true);
    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('scroll', handleViewportChange, {
      passive: true,
      capture: true,
    });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, setOpenWithSource, triggerRef, updatePosition]);

  React.useEffect(() => {
    return () => {
      if (typeaheadTimerRef.current !== null) {
        clearTimeout(typeaheadTimerRef.current);
      }
    };
  }, []);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const menuEl = menuRef.current;
    if (!menuEl) {
      return;
    }
    const items = Array.from(
      menuEl.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]):not([aria-disabled="true"]), [role="menuitemradio"]:not([disabled]):not([aria-disabled="true"])',
      ),
    );
    const activeEl =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;
    const currentIndex = activeEl ? items.indexOf(activeEl) : -1;

    const action = resolveMenuKeyAction(event.key, currentIndex, items.length);
    if (action) {
      if (action.kind === 'focus') {
        event.preventDefault();
        items[action.index]?.focus();
        return;
      }
      if (action.kind === 'select') {
        event.preventDefault();
        items[action.index]?.click();
        return;
      }
      if (action.kind === 'close') {
        if (event.key === 'Escape') {
          event.preventDefault();
        }
        setOpenWithSource(false, 'keyboard', {
          returnFocus: action.returnFocus,
        });
        return;
      }
    }

    // Printable character typeahead (§4.2)
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      typeaheadBufRef.current += event.key;
      if (typeaheadTimerRef.current !== null) {
        clearTimeout(typeaheadTimerRef.current);
      }
      typeaheadTimerRef.current = setTimeout(() => {
        typeaheadBufRef.current = '';
      }, 500);

      const labels = items.map(
        (el) => el.dataset.typeahead ?? el.textContent ?? '',
      );
      const matchedIdx = matchMenuTypeahead(
        labels,
        typeaheadBufRef.current,
        currentIndex,
      );
      if (matchedIdx >= 0) {
        items[matchedIdx]?.focus();
      }
    }
  };

  const isInstantOpen =
    Boolean(shouldReduceMotion) ||
    (openAnimation === 'pointer-fade' && openSource === 'keyboard');

  const initialMotion = isInstantOpen
    ? { opacity: 1, scale: 1 }
    : openAnimation === 'pointer-fade'
      ? { opacity: 0, scale: 1 }
      : { opacity: 0, scale: 0.96 };

  const enterTransition = isInstantOpen
    ? { duration: 0 }
    : openAnimation === 'pointer-fade'
      ? { duration: 0.12, ease: MOTION_TOKENS.easeOutTuple }
      : SPRING_TOKENS.ui;

  const exitMotion =
    shouldReduceMotion || instantClose
      ? { opacity: 0, scale: 1, transition: { duration: 0 } }
      : openAnimation === 'pointer-fade'
        ? {
            opacity: 0,
            scale: 1,
            transition: { duration: 0.12, ease: MOTION_TOKENS.easeOutTuple },
          }
        : {
            opacity: 0,
            scale: 0.98,
            transition: { duration: 0.12, ease: MOTION_TOKENS.easeOutTuple },
          };

  const menuNode = (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          ref={menuRef}
          id={contentId}
          role="menu"
          aria-labelledby={props['aria-label'] ? undefined : triggerId}
          initial={initialMotion}
          animate={{ opacity: 1, scale: 1, transition: enterTransition }}
          exit={exitMotion}
          onKeyDown={handleMenuKeyDown}
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            transformOrigin: position.transformOrigin,
          }}
          className={cn(
            'surface-material fixed z-[var(--z-menus)] flex flex-col rounded-lg p-2 text-text-primary outline-none select-none',
            className,
          )}
          {...props}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  const [isClientMounted, setIsClientMounted] = React.useState(false);

  React.useLayoutEffect(() => {
    setIsClientMounted(true);
  }, []);

  if (!isClientMounted || typeof document === 'undefined') {
    return menuNode;
  }

  return createPortal(menuNode, document.body);
}

export interface DropdownMenuItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  readonly onSelect?: () => void;
  readonly instantClose?: boolean;
  readonly typeaheadLabel?: string;
}

export const DropdownMenuItem = React.forwardRef<
  HTMLButtonElement,
  DropdownMenuItemProps
>(function DropdownMenuItem(
  {
    className,
    onSelect,
    onClick,
    disabled,
    instantClose = false,
    typeaheadLabel,
    children,
    ...props
  },
  ref,
) {
  const { setOpenWithSource } = useDropdownMenuContext('DropdownMenuItem');

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || disabled) {
      return;
    }
    onSelect?.();
    setOpenWithSource(false, 'pointer', {
      returnFocus: true,
      instant: instantClose,
    });
  };

  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      data-typeahead={typeaheadLabel}
      tabIndex={-1}
      onPointerMove={(event) => {
        if (!disabled && document.activeElement !== event.currentTarget) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onClick={handleClick}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-left type-control text-text-primary',
        'transition-[background-color,color,transform] duration-[120ms] ease-[var(--ease-out)] active:duration-[100ms]',
        'hover:bg-surface-2 focus:bg-surface-2 enabled:active:scale-[0.99] enabled:active:bg-surface-3',
        'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export interface DropdownMenuRadioItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  readonly value: string;
  readonly checked: boolean;
  readonly onSelect?: (value: string) => void;
  readonly instantClose?: boolean;
  readonly typeaheadLabel?: string;
  readonly hideCheckIcon?: boolean;
  readonly checkAriaLabel?: string;
}

export const DropdownMenuRadioItem = React.forwardRef<
  HTMLButtonElement,
  DropdownMenuRadioItemProps
>(function DropdownMenuRadioItem(
  {
    value,
    checked,
    onSelect,
    onClick,
    disabled,
    instantClose = false,
    typeaheadLabel,
    hideCheckIcon = false,
    checkAriaLabel,
    className,
    children,
    ...props
  },
  ref,
) {
  const { setOpenWithSource } = useDropdownMenuContext('DropdownMenuRadioItem');

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || disabled) {
      return;
    }
    onSelect?.(value);
    setOpenWithSource(false, 'pointer', {
      returnFocus: true,
      instant: instantClose,
    });
  };

  return (
    <button
      ref={ref}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      data-typeahead={typeaheadLabel}
      tabIndex={-1}
      onPointerMove={(event) => {
        if (!disabled && document.activeElement !== event.currentTarget) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onClick={handleClick}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-left type-control text-text-primary',
        'transition-[background-color,color,transform] duration-[120ms] ease-[var(--ease-out)] active:duration-[100ms]',
        'hover:bg-surface-2 focus:bg-surface-2 enabled:active:scale-[0.99] enabled:active:bg-surface-3',
        'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {!hideCheckIcon ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          {checked ? (
            <>
              <Check
                className="size-4 text-text-primary"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {checkAriaLabel ? (
                <span className="sr-only">{checkAriaLabel}</span>
              ) : null}
            </>
          ) : null}
        </span>
      ) : null}
    </button>
  );
});

export function DropdownMenuLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        'px-3 py-1.5 type-footnote text-text-tertiary select-none',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      role="separator"
      className={cn('mx-2 my-1.5 h-px bg-separator', className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'ml-auto rounded-xs bg-white/8 px-1.5 py-0.5 font-sans type-caption text-text-tertiary',
        className,
      )}
      {...props}
    />
  );
}
