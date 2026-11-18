'use client';

import * as React from 'react';

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

function hasDraggedFiles(event: WindowDropEventLike): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === 'Files') {
      return true;
    }
  }
  return false;
}

/**
 * Attaches window-level drag-and-drop listeners once without re-binding when
 * drag-over state toggles, reading the latest `getOnFileDrop()` via ref.
 */
export function bindWindowFileDropListeners(options: {
  readonly target: WindowDropEventTarget;
  readonly getOnFileDrop: () => (file: File) => void;
  readonly onDragActiveChange: (active: boolean) => void;
}): () => void {
  const { target, getOnFileDrop, onDragActiveChange } = options;
  let dragDepth = 0;
  let isActive = false;

  const setActive = (next: boolean): void => {
    if (isActive !== next) {
      isActive = next;
      onDragActiveChange(next);
    }
  };

  const handleDragEnter = (event: WindowDropEventLike): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepth += 1;
    setActive(true);
  };

  const handleDragOver = (event: WindowDropEventLike): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    setActive(true);
  };

  const handleDragLeave = (event: WindowDropEventLike): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setActive(false);
    }
  };

  const handleDrop = (event: WindowDropEventLike): void => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    const alreadyHandled = event.defaultPrevented === true;
    event.preventDefault();
    dragDepth = 0;
    setActive(false);

    if (alreadyHandled) {
      return;
    }
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      getOnFileDrop()(file);
    }
  };

  const resetDragState = (): void => {
    dragDepth = 0;
    setActive(false);
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

/**
 * Viewport-wide STDF file drag-and-drop wrapper (Requirement 1.1).
 *
 * Accepts dragged `.stdf`, `.std`, `.stdf.gz`, and `.gz` files anywhere across
 * the window and illuminates a subtle hairline grid overlay with `"Drop the body."`.
 */
export function FullWindowDropZone({
  disabled = false,
  onFileDrop,
  children,
}: FullWindowDropZoneProps): React.JSX.Element {
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const onFileDropRef = React.useRef(onFileDrop);
  onFileDropRef.current = onFileDrop;

  React.useEffect(() => {
    if (disabled) {
      setIsDraggingOver(false);
      return;
    }

    return bindWindowFileDropListeners({
      target: window as unknown as WindowDropEventTarget,
      getOnFileDrop: () => onFileDropRef.current,
      onDragActiveChange: setIsDraggingOver,
    });
  }, [disabled]);

  return (
    <div className="relative min-h-screen bg-bg text-text-primary">
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {isDraggingOver ? 'File drop zone active' : ''}
      </div>

      {children}

      {isDraggingOver ? (
        <div
          aria-hidden="true"
          data-testid="full-window-drop-overlay"
          className="surface-overlay pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center rounded-panel border border-accent transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(124, 242, 193, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(124, 242, 193, 0.06) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        >
          <div className="rounded-panel border border-hairline bg-panel px-8 py-6 text-center">
            <p className="heading-display text-text-primary">
              Drop the body.
            </p>
            <p className="mt-2 font-mono text-[12px] text-text-secondary">
              STDF V4 (.stdf, .std, .stdf.gz, .gz) · Local Web Worker
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
