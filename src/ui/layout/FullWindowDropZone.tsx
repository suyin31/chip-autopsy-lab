'use client';

import { ArrowDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { SpecimenDropTray, SpecimenSeat } from '@/ui/atelier/SpecimenDropTray';
import { useT } from '@/ui/i18n';
import { SPRING_MORPH, SPRING_MORPH_RETURN, useReducedMotionPreference } from '@/ui/motion';
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

type DropExitReason = 'drop' | 'leave';

export function FullWindowDropZone({
  disabled = false,
  onFileDrop,
  children,
}: FullWindowDropZoneProps): React.JSX.Element {
  const { t } = useT();
  const shouldReduceMotion = useReducedMotionPreference();
  const [dragKind, setDragKind] = React.useState<DragItemKind | null>(null);
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  const [listenersBound, setListenersBound] = React.useState(false);
  const exitReasonRef = React.useRef<DropExitReason>('leave');
  const recedeRef = React.useRef<HTMLDivElement | null>(null);

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
      getOnFileDrop: () => (file: File) => {
        exitReasonRef.current = 'drop';
        onFileDropRef.current(file);
      },
      onDragActiveChange: (active) => {
        if (active) {
          exitReasonRef.current = 'leave';
        } else {
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
  const receded = showOverlay && isFileDrag && !shouldReduceMotion;

  useIsomorphicLayoutEffect(() => {
    const el = recedeRef.current;
    if (!el || !receded) {
      return;
    }
    el.style.setProperty(
      '--recede-origin',
      `50% ${Math.round(window.scrollY + window.innerHeight * 0.45)}px`,
    );
  }, [receded]);

  const fade = { duration: MOTION_TOKENS.dur1Ms / 1000, ease: MOTION_TOKENS.easeOutTuple };
  const trayVariants = {
    hidden: shouldReduceMotion
      ? { opacity: 0 }
      : { opacity: 0, scale: 0.94, y: 18, rotateX: 8 },
    shown: {
      opacity: 1,
      scale: 1,
      y: 0,
      rotateX: 0,
      transition: shouldReduceMotion ? fade : SPRING_MORPH,
    },
    exit: (reason: DropExitReason) =>
      shouldReduceMotion
        ? { opacity: 0, transition: fade }
        : reason === 'drop'
          ? {
              opacity: 0,
              scale: 0.88,
              y: 10,
              transition: { ...SPRING_MORPH_RETURN, opacity: { duration: 0.2, delay: 0.06 } },
            }
          : { opacity: 0, scale: 0.97, y: 6, transition: fade },
  };
  const seatVariants = {
    hidden: shouldReduceMotion ? { opacity: 1 } : { scale: 0.84, opacity: 0.4 },
    shown: {
      scale: 1,
      opacity: 1,
      transition: shouldReduceMotion ? { duration: 0 } : { ...SPRING_MORPH, delay: 0.04 },
    },
    exit: (reason: DropExitReason) =>
      shouldReduceMotion || reason !== 'drop'
        ? { transition: { duration: 0 } }
        : { scale: 0.6, transition: SPRING_MORPH_RETURN },
  };

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

      <div
        ref={recedeRef}
        data-testid="full-window-drop-recede"
        data-receded={receded ? 'true' : undefined}
        className="at-recede"
      >
        {children}
      </div>

      <AnimatePresence initial={false} custom={exitReasonRef.current}>
        {showOverlay ? (
          <motion.div
            key="drop-overlay"
            aria-hidden="true"
            data-testid="full-window-drop-overlay"
            data-vt="overlay"
            data-drag-kind={dragKind}
            initial={{ opacity: shouldReduceMotion ? 1 : 0 }}
            animate={{ opacity: 1, transition: shouldReduceMotion ? { duration: 0 } : fade }}
            exit={{
              opacity: 0,
              transition: shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.18, ease: MOTION_TOKENS.easeOutTuple, delay: 0.06 },
            }}
            style={{
              backdropFilter: 'blur(28px) saturate(165%)',
              WebkitBackdropFilter: 'blur(28px) saturate(165%)',
            }}
            className="drag-overlay-surface pointer-events-none fixed inset-0 z-[var(--z-drag-overlay)]"
          >
            <div
              data-testid="full-window-drop-frame"
              style={{
                boxShadow: 'inset 0 0 0 1.5px var(--hairline-strong)',
                perspective: shouldReduceMotion ? undefined : '1200px',
              }}
              className="absolute inset-4 flex items-center justify-center rounded-3xl"
            >
              {isFileDrag ? (
                <motion.div
                  custom={exitReasonRef.current}
                  variants={trayVariants}
                  initial="hidden"
                  animate="shown"
                  exit="exit"
                  className="relative z-10 flex w-full max-w-[760px] flex-col items-center px-6 text-center"
                >
                  <SpecimenDropTray
                    variant="overlay"
                    armed
                    showFormatCaps
                    data-testid="full-window-drop-tray"
                    className="w-full max-w-[540px]"
                    wellClassName="flex h-[248px] items-center justify-center pb-5 sm:h-[276px]"
                  >
                    {/* Three concentric sonar radar ripples */}
                    {!shouldReduceMotion ? (
                      <>
                        <span className="at-sonar-ring size-[140px]" data-ring="1" />
                        <span className="at-sonar-ring size-[176px]" data-ring="2" />
                        <span className="at-sonar-ring size-[212px]" data-ring="3" />
                      </>
                    ) : null}
                    <motion.span
                      custom={exitReasonRef.current}
                      variants={seatVariants}
                      className="relative z-[1] inline-flex"
                    >
                      <SpecimenSeat size={148}>
                        <SpecimenSeat size={84} className="opacity-90">
                          <ArrowDown
                            className="size-5 text-text-primary"
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        </SpecimenSeat>
                      </SpecimenSeat>
                    </motion.span>
                  </SpecimenDropTray>
                  <p className="mt-8 type-display-xl text-text-primary">
                    {t('drop.headline')}
                  </p>
                  <p className="mt-2.5 type-title-3 text-text-secondary">
                    {t('drop.subline')}
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  initial={shouldReduceMotion ? { scale: 1 } : { scale: 0.98 }}
                  animate={{
                    scale: 1,
                    transition: shouldReduceMotion ? { duration: 0 } : SPRING_TOKENS.snappy,
                  }}
                  className="relative z-10 flex max-w-[760px] flex-col items-center px-6 text-center"
                >
                  <p className="type-title-2 text-text-primary">{t('drop.notFile')}</p>
                </motion.div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
