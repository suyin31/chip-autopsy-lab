'use client';

import * as React from 'react';
import { sanitizeReportProseText } from '@/core/report';
import { Untranslated, useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { ModalSheet } from '@/ui/primitives/sheet';

export interface ErrorDetailsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly byteOffset: number;
  readonly first16BytesHex: string;
  readonly fileName?: string;
  readonly disablePortal?: boolean;
}

/**
 * Parse-error technical details sheet (`redesign.md` §3.7):
 * Displays the record/stream byte offset and the first 16 bytes formatted as hex (`mono-data`).
 */
export function ErrorDetailsSheet({
  open,
  onClose,
  byteOffset,
  first16BytesHex,
  fileName,
  disablePortal = false,
}: ErrorDetailsSheetProps): React.JSX.Element | null {
  const { t, formatInteger } = useT();
  const baseId = React.useId();
  const titleId = `${baseId}-title`;
  const dismissRef = React.useRef<HTMLButtonElement | null>(null);

  const cleanFileName = fileName ? sanitizeReportProseText(fileName) : '';
  const cleanHex = first16BytesHex.trim() || '—';
  const safeOffset =
    Number.isFinite(byteOffset) && byteOffset >= 0 ? Math.trunc(byteOffset) : 0;
  const hexOffset = `0x${safeOffset.toString(16).toUpperCase().padStart(8, '0')}`;

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      titleId={titleId}
      initialFocusRef={dismissRef}
      disablePortal={disablePortal}
      data-testid="error-details-sheet"
    >
      <h2 id={titleId} className="type-title-3 text-text-primary">
        {t('error.detailsTitle')}
      </h2>

      {cleanFileName ? (
        <p className="mt-2 truncate type-mono-data text-text-secondary">
          <Untranslated>{cleanFileName}</Untranslated>
        </p>
      ) : null}

      <dl className="mt-4 flex flex-col gap-3 rounded-lg bg-surface-1 p-4 ring-surface">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="type-mono-data text-text-tertiary">
            <Untranslated>{hexOffset}</Untranslated>
          </dt>
          <dd
            data-testid="error-details-offset"
            className="text-right type-mono-data text-text-primary"
          >
            <Untranslated>{formatInteger(safeOffset)}</Untranslated>
          </dd>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-separator pt-3">
          <dt className="type-mono-data text-text-tertiary">
            <Untranslated>00..0F</Untranslated>
          </dt>
          <dd
            data-testid="error-details-hex"
            className="break-words type-mono-data text-text-primary"
          >
            <Untranslated>{cleanHex}</Untranslated>
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex justify-end">
        <Button
          ref={dismissRef}
          variant="secondary"
          size="md"
          onClick={onClose}
          className="w-full md:w-auto"
        >
          {t('toast.dismiss')}
        </Button>
      </div>
    </ModalSheet>
  );
}
