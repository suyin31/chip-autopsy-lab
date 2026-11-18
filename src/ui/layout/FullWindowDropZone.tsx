'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useT } from '@/ui/i18n';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';

export type DragItemKind = 'file' | 'non-file';

export interface FullWindowDropZoneProps {
  readonly disabled?: boolean;
  readonly onFileDrop: (file: File) => void;
  readonly children: React.ReactNode;
}

export interface WindowDropEventLike {
  readonly defaultPrevented?: boolean;
  readonly dataTransfer?: {
    readonly types?: ArrayLike<string>;
    readonly files?: ArrayLike<File>;
    dropEffect?: string;
  } | null;
  preventDefault(): void;
}

export interface WindowDropEventTarget {
  addEventListener(
    type: string,
    listener: (event: WindowDropEventLike) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: WindowDropEventLike) => void,
  ): void;
}

function classifyDraggedTypes(event: WindowDropEventLike): DragItemKind | null {
  const types = event.dataTransfer?.types;
  if (!types || types.length === 0) {
    return null;
  }
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === 'Files') {
      return 'file';
    }
  }
  return 'non-file';
}

/**
 * Attaches window-level drag-and-drop listeners once without re-binding when
 * drag-over state toggles, reading the latest `getOnFileDrop()` via ref.
 * Distinguishes file drags (`'file'`) from non-file drags (`'non-file'`, e.g. text/links)
 * per `redesign.md` §3.2.
 */
export function bindWindowFileDropListeners(options: {
  readonly target: WindowDropEventTarget;
  readonly getOnFileDrop: () => (file: File) => void;
  readonly onDragActiveChange: (active: boolean) => void;
  readonly onDragKindChange?: (kind: DragItemKind | null) => void;
}): () => void {
  const { target, getOnFileDrop, onDragActiveChange, onDragKindChange } =
    options;
  let dragDepth = 0;
  let activeKind: DragItemKind | null = null;

  const setKind = (next: DragItemKind | null): void => {
    if (activeKind !== next) {
      const wasActive = activeKind !== null;
      const isNextActive = next !== null;
      activeKind = next;
      if (wasActive !== isNextActive) {
        onDragActiveChange(isNextActive);
      }
      onDragKindChange?.(next);
    }
  };

  const handleDragEnter = (event: WindowDropEventLike): void => {
    const kind = classifyDraggedTypes(event);
    if (kind === null) {
      return;
    }
    event.preventDefault();
    dragDepth += 1;
    setKind(kind);
  };

  const handleDragOver = (event: WindowDropEventLike): void => {
    const kind = classifyDraggedTypes(event);
    if (kind === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = kind === 'file' ? 'copy' : 'none';
    }
    setKind(kind);
  };

  const handleDragLeave = (event: WindowDropEventLike): void => {
    if (activeKind === null && classifyDraggedTypes(event) === null) {
      return;
    }
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setKind(null);
    }
  };

  const handleDrop = (event: WindowDropEventLike): void => {
    const kind = classifyDraggedTypes(event);
    if (kind === null && activeKind === null) {
      return;
    }
    const alreadyHandled = event.defaultPrevented === true;
    event.preventDefault();
    dragDepth = 0;
    setKind(null);

    if (alreadyHandled || kind !== 'file') {
      return;
    }
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      getOnFileDrop()(file);
    }
  };

  const resetDragState = (): void => {
    dragDepth = 0;
    setKind(null);
  };

  target.addEventListener('dragenter', handleDragEnter);
  target.addEventListener('dragover', handleDragOver);
  target.addEventListener('dragleave', handleDragLeave);
  target.addEventListener('drop', handleDrop);
  target.addEventListener('dragend', resetDragState);
  target.addEventListener('blur', resetDragState);

  return () => {
    target.removeEventListener('dragenter', handleDragEnter);
    target.removeEventListener('dragover', handleDragOver);
    target.removeEventListener('dragleave', handleDragLeave);
    target.removeEventListener('drop', handleDrop);
    target.removeEventListener('dragend', resetDragState);
    target.removeEventListener('blur', resetDragState);
  };
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Viewport-wide STDF file drag-and-drop wrapper (premium §6.5):
 * - Full viewport `scrim` at `z-index: 80`, not shown on touch devices
 * - Frame `inset: 16px`, `r-3xl`, `inset 0 0 0 1.5px hairline-strong` for every drag kind; no dot grid
 * - `"Drop the body."` (`display-xl`); 12 px; `"Release to open. STDF, STD, or gzip."` (`title-3`
 *   secondary), or `"Only files can be opened here."` when dragging text/links
 */
export function FullWindowDropZone({
  disabled = false,
  onFileDrop,
  children,
}: FullWindowDropZoneProps): React.JSX.Element {
  const { t } = useT();
  const shouldReduceMotion = useReducedMotion();
  const [dragKind, setDragKind] = React.useState<DragItemKind | null>(null);
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  const [listenersBound, setListenersBound] = React.useState(false);

  const onFileDropRef = React.useRef(onFileDrop);
  onFileDropRef.current = onFileDrop;

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const mql = window.matchMedia('(hover: none) and (pointer: coarse)');
    const sync = (): void => setIsTouchDevice(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined' || disabled || isTouchDevice) {
      setDragKind(null);
      setListenersBound(false);
      return;
    }

    const unbind = bindWindowFileDropListeners({
      target: window as unknown as WindowDropEventTarget,
      getOnFileDrop: () => onFileDropRef.current,
      onDragActiveChange: (active) => {
        if (!active) {
          setDragKind(null);
        }
      },
      onDragKindChange: setDragKind,
    });
    setListenersBound(true);

    return () => {
      unbind();
      setListenersBound(false);
    };
  }, [disabled, isTouchDevice]);

  const showOverlay = dragKind !== null && !isTouchDevice;
  const isFileDrag = dragKind === 'file';

  return (
    <div
      data-testid="full-window-drop-zone"
      data-dropzone-ready={listenersBound ? 'true' : undefined}
      className="relative min-h-screen bg-bg text-text-primary"
    >
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {showOverlay
          ? isFileDrag
            ? `${t('drop.headline')} ${t('drop.subline')}`
            : t('drop.notFile')
          : ''}
      </div>

      {children}

      <AnimatePresence initial={false}>
        {showOverlay ? (
          <motion.div
            aria-hidden="true"
            data-testid="full-window-drop-overlay"
            data-drag-kind={dragKind}
            initial={{ opacity: shouldReduceMotion ? 1 : 0 }}
            animate={{
              opacity: 1,
              transition: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.12, ease: MOTION_TOKENS.easeOutTuple },
            }}
            exit={{
              opacity: 0,
              transition: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.12, ease: MOTION_TOKENS.easeOutTuple },
            }}
            className="drag-overlay-surface pointer-events-none fixed inset-0 z-[var(--z-drag-overlay)]"
          >
            {/* Frame: inset 16 px, r-3xl, 1.5 px inset hairline-strong for file and non-file drags */}
            <div
              data-testid="full-window-drop-frame"
              style={{
                boxShadow: 'inset 0 0 0 1.5px var(--hairline-strong)',
              }}
              className="absolute inset-4 flex items-center justify-center rounded-3xl"
            >

              <motion.div
                initial={shouldReduceMotion ? { scale: 1 } : { scale: 0.98 }}
                animate={{
                  scale: 1,
                  transition: shouldReduceMotion
                    ? { duration: 0 }
                    : SPRING_TOKENS.snappy,
                }}
                className="relative z-10 flex max-w-[760px] flex-col items-center px-6 text-center"
              >
                {isFileDrag ? (
                  <>
                    <p className="type-display-xl text-text-primary">
                      {t('drop.headline')}
                    </p>
                    <p className="mt-3 type-title-3 text-text-secondary">
                      {t('drop.subline')}
                    </p>
                  </>
                ) : (
                  <p className="type-title-2 text-text-primary">
                    {t('drop.notFile')}
                  </p>
                )}
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
