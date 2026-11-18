"use client";

import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { MOTION_TOKENS } from "@/ui/tokens";
import { cn } from "./cn";
import { MATERIAL_THICK_CLASS } from "./surfaces";

/** Hover delay for a `Term` in running text (premium §7.17). */
export const TERM_HOVER_DELAY_MS = 300 as const;
/** Hover delay for a `Term` inside a control, such as a segmented label (premium §5.6, §7.17). */
export const TERM_CONTROL_HOVER_DELAY_MS = 600 as const;
/** The popover closes once the pointer has left the term and the popover for this long. */
export const TERM_CLOSE_GRACE_MS = 100 as const;
const TERM_OFFSET_PX = 6;
const TERM_VIEWPORT_MARGIN_PX = 8;
const TERM_OPEN_DURATION_S = MOTION_TOKENS.durFastMs / 1000;
const TERM_CLOSE_DURATION_S = TERM_CLOSE_GRACE_MS / 1000;

export interface TermRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

export interface TermPopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: "top" | "bottom";
}

/**
 * Places the popover 6 px above the term, flipping below when it would leave the top of the
 * viewport, and shifts it horizontally to stay 8 px inside the viewport (premium §7.12, §7.17).
 */
export function computeTermPopoverPosition(
  anchor: TermRect,
  popover: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): TermPopoverPosition {
  const aboveTop = anchor.top - TERM_OFFSET_PX - popover.height;
  const fitsAbove = aboveTop >= TERM_VIEWPORT_MARGIN_PX;
  const belowTop = anchor.bottom + TERM_OFFSET_PX;
  const fitsBelow =
    belowTop + popover.height <= viewport.height - TERM_VIEWPORT_MARGIN_PX;
  const placement = fitsAbove || !fitsBelow ? "top" : "bottom";
  const centred = anchor.left + anchor.width / 2 - popover.width / 2;
  const maxLeft = viewport.width - TERM_VIEWPORT_MARGIN_PX - popover.width;
  return {
    top:
      placement === "top"
        ? Math.max(TERM_VIEWPORT_MARGIN_PX, aboveTop)
        : belowTop,
    left: Math.max(TERM_VIEWPORT_MARGIN_PX, Math.min(centred, maxLeft)),
    placement,
  };
}

export interface TermProps {
  /** Line 1 of the popover (`glossary.term.*`). */
  readonly term: string;
  /** Line 2 of the popover (`glossary.*`), also the button's accessible description. */
  readonly definition: string;
  /**
   * `button` (default): an inline `<button class="term">` in running text; opens on hover after
   * 300 ms, on keyboard focus at once, and toggles on tap.
   * `label`: a `<span class="term">` inside a control (a segmented label); opens on mouse hover
   * after 600 ms only. Pass `descriptionId` and point the control's `aria-describedby` at it.
   */
  readonly variant?: "button" | "label";
  readonly descriptionId?: string;
  /** Glossary id written to `data-term-id` for tests and analytics-free lookups. */
  readonly termId?: string;
  readonly className?: string;
  readonly "data-testid"?: string;
  readonly children: React.ReactNode;
}

/**
 * Glossary term (premium §2.3, §7.17): a dotted 1 px underline on a word that opens a short
 * definition on `material-thick` + `shadow-popover`, `r-md`, padding 12 14, max 280 wide,
 * z 55, placed on top (flips to bottom). Opacity in over `dur-1`, out over 100 ms.
 */
export function Term({
  term,
  definition,
  variant = "button",
  descriptionId,
  termId,
  className,
  "data-testid": dataTestId = "term",
  children,
}: TermProps): React.JSX.Element {
  const generatedId = React.useId();
  const descId = descriptionId ?? `${generatedId}-definition`;
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<TermPopoverPosition | null>(
    null,
  );

  const hoverDelay =
    variant === "label" ? TERM_CONTROL_HOVER_DELAY_MS : TERM_HOVER_DELAY_MS;

  const clearTimers = React.useCallback((): void => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const show = React.useCallback((): void => {
    clearTimers();
    setOpen(true);
  }, [clearTimers]);

  const hide = React.useCallback((): void => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  React.useEffect(() => {
    setMounted(true);
    return clearTimers;
  }, [clearTimers]);

  const updatePosition = React.useCallback((): void => {
    const anchor = anchorRef.current;
    const pop = popoverRef.current;
    if (!anchor || !pop) return;
    const rect = anchor.getBoundingClientRect();
    setPosition(
      computeTermPopoverPosition(
        {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
        },
        { width: pop.offsetWidth, height: pop.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, updatePosition, hide]);

  const handlePointerEnter = (event: React.PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open || openTimerRef.current !== null) return;
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      setOpen(true);
    }, hoverDelay);
  };

  const handlePointerLeave = (event: React.PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!open) return;
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, TERM_CLOSE_GRACE_MS);
  };

  const lastPointerTypeRef = React.useRef<string>("mouse");

  const popover =
    mounted && typeof document !== "undefined"
      ? createPortal(
          <>
            {/* The definition is the trigger's description (not a live region); kept outside the host text */}
            <span id={descId} hidden>
              {definition}
            </span>
            <AnimatePresence>
              {open ? (
                <motion.div
                  ref={popoverRef}
                  key="term-popover"
                  aria-hidden="true"
                  data-testid="term-popover"
                  data-placement={position?.placement ?? "top"}
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: position === null ? 0 : 1,
                    transition: {
                      duration: TERM_OPEN_DURATION_S,
                      ease: "linear",
                    },
                  }}
                  exit={{
                    opacity: 0,
                    transition: {
                      duration: TERM_CLOSE_DURATION_S,
                      ease: "linear",
                    },
                  }}
                  onPointerEnter={handlePointerEnter}
                  onPointerLeave={handlePointerLeave}
                  // React events bubble through portals; keep popover input away from the host control
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    top: `${position?.top ?? 0}px`,
                    left: `${position?.left ?? 0}px`,
                  }}
                  className={cn(
                    MATERIAL_THICK_CLASS,
                    "fixed z-[var(--z-tooltips)] w-max max-w-[min(280px,calc(100vw-16px))] rounded-md px-3.5 py-3 text-left",
                  )}
                >
                  <p className="type-subhead font-[590] text-text-primary">
                    {term}
                  </p>
                  <p className="mt-0.5 type-subhead leading-[1.45] text-pretty text-text-secondary [:is(:lang(zh),:lang(ja),:lang(ko))_&]:leading-[1.6]">
                    {definition}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </>,
          document.body,
        )
      : null;

  if (variant === "label") {
    return (
      <span
        ref={(node) => {
          anchorRef.current = node;
        }}
        data-testid={dataTestId}
        data-term-id={termId}
        data-state={open ? "open" : "closed"}
        className={cn("term", className)}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={hide}
      >
        {children}
        {popover}
      </span>
    );
  }

  return (
    <>
      <button
        ref={(node) => {
          anchorRef.current = node;
        }}
        type="button"
        data-testid={dataTestId}
        data-term-id={termId}
        data-state={open ? "open" : "closed"}
        aria-describedby={descId}
        className={cn("term", className)}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={(event) => {
          lastPointerTypeRef.current = event.pointerType;
        }}
        onFocus={(event) => {
          let keyboard = false;
          try {
            keyboard = event.currentTarget.matches(":focus-visible");
          } catch {
            keyboard = false;
          }
          if (keyboard) show();
        }}
        onBlur={hide}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.dataset.ack = String(performance.now());
          // A tap toggles; a mouse click opens at once (the hover delay is skipped)
          if (lastPointerTypeRef.current === "mouse") {
            show();
          } else if (open) {
            hide();
          } else {
            show();
          }
          lastPointerTypeRef.current = "mouse";
        }}
      >
        {children}
      </button>
      {popover}
    </>
  );
}
