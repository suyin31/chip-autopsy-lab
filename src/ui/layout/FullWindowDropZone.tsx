'use client';

import * as React from 'react';

export interface FullWindowDropZoneProps {
  readonly disabled?: boolean;
  readonly onFileDrop: (file: File) => void;
  readonly children: React.ReactNode;
}

function hasDraggedFiles(event: DragEvent): boolean {
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
  const dragDepthRef = React.useRef(0);

  React.useEffect(() => {
    if (disabled) {
      dragDepthRef.current = 0;
      setIsDraggingOver(false);
      return;
    }

    const handleDragEnter = (event: DragEvent): void => {
      if (!hasDraggedFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingOver(true);
    };

    const handleDragOver = (event: DragEvent): void => {
      if (!hasDraggedFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      if (!isDraggingOver) {
        setIsDraggingOver(true);
      }
    };

    const handleDragLeave = (event: DragEvent): void => {
      if (!hasDraggedFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingOver(false);
      }
    };

    const handleDrop = (event: DragEvent): void => {
      if (!hasDraggedFiles(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingOver(false);

      const file = event.dataTransfer?.files?.[0];
      if (file) {
        onFileDrop(file);
      }
    };

    const resetDragState = (): void => {
      dragDepthRef.current = 0;
      setIsDraggingOver(false);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragend', resetDragState);
    window.addEventListener('blur', resetDragState);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragend', resetDragState);
      window.removeEventListener('blur', resetDragState);
    };
  }, [disabled, isDraggingOver, onFileDrop]);

  return (
    <div className="relative min-h-screen bg-bg text-text-primary">
      {children}

      {isDraggingOver ? (
        <div
          aria-hidden="true"
          className="surface-overlay pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center rounded-panel border border-accent transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(124, 242, 193, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(124, 242, 193, 0.06) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        >
          <div className="rounded-panel border border-hairline bg-panel px-8 py-6 text-center">
            <p className="heading-display text-[28px] leading-snug text-text-primary">
              Drop the body.
            </p>
            <p className="mt-2 font-mono text-[12px] text-text-secondary">
              STDF V4 (.stdf, .std, .stdf.gz, .gz) · Decoded locally in Web Worker
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
