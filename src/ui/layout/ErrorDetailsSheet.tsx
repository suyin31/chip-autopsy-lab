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

      <dl className="mt-5 flex flex-col gap-3 rounded-md bg-surface-1 p-4 ring-surface">
        {cleanFileName ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-footnote text-text-secondary">File</dt>
            <dd className="min-w-0 truncate text-right type-mono-data text-text-primary">
              <Untranslated>{cleanFileName}</Untranslated>
            </dd>
          </div>
        ) : null}

        <div className="flex items-baseline justify-between gap-4">
          <dt className="type-footnote text-text-secondary">Offset</dt>
          <dd className="text-right type-mono-data text-text-primary">
            <Untranslated>{formatInteger(byteOffset)}</Untranslated>
          </dd>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-separator pt-3">
          <dt className="type-footnote text-text-secondary">Hex (0..15)</dt>
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
          size="lg"
          onClick={onClose}
          className="w-full md:w-auto"
        >
          {t('toast.dismiss')}
        </Button>
      </div>
    </ModalSheet>
  );
}
