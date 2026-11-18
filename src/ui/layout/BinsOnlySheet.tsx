'use client';

import * as React from 'react';
import { useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { ModalSheet } from '@/ui/primitives/sheet';
import { estimateFullParseSeconds } from './parse-error-copy';

export interface BinsOnlySheetProps {
  readonly open: boolean;
  readonly bytesObserved: number;
  readonly onUseBinsOnly: () => void;
  readonly onParseEverything: () => void;
  readonly onCancel: () => void;
  readonly disablePortal?: boolean;
}

/**
 * Pre-parse sheet shown when an uncompressed STDF stream exceeds `200 MB` (`redesign.md` §3.8):
 * - Title (`title-3`): `"This file is 312 MB."`
 * - Body (`body` secondary): `"Parsing every test result may take about 21s. Bins-only mode skips parametric results and keeps the wafer maps, bins, and yield."`
 * - Primary button `"Use bins-only"` focused by default (Enter triggers bins-only)
 * - Secondary button `"Parse everything"`
 */
export function BinsOnlySheet({
  open,
  bytesObserved,
  onUseBinsOnly,
  onParseEverything,
  onCancel,
  disablePortal = false,
}: BinsOnlySheetProps): React.JSX.Element | null {
  const { t, formatFileSize, formatDuration } = useT();
  const baseId = React.useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const useBinsOnlyButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const estimatedSeconds = estimateFullParseSeconds(bytesObserved);
  const formattedSize = formatFileSize(bytesObserved);
  const formattedDuration = formatDuration(estimatedSeconds);

  return (
    <ModalSheet
      open={open}
      onClose={onCancel}
      titleId={titleId}
      descriptionId={bodyId}
      initialFocusRef={useBinsOnlyButtonRef}
      disablePortal={disablePortal}
      data-testid="bins-only-sheet"
    >
      <h2 id={titleId} className="type-title-3 text-text-primary">
        {t('binsOnly.sheetTitle', { size: formattedSize })}
      </h2>

      <p id={bodyId} className="mt-3 type-body text-text-secondary">
        {t('binsOnly.sheetBody', { seconds: formattedDuration })}
      </p>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
        <Button
          ref={useBinsOnlyButtonRef}
          variant="primary"
          size="lg"
          autoFocus
          data-testid="bins-only-confirm-button"
          onClick={onUseBinsOnly}
          className="w-full md:w-auto"
        >
          {t('binsOnly.useBinsOnly')}
        </Button>

        <Button
          variant="secondary"
          size="lg"
          data-testid="bins-only-parse-all-button"
          onClick={onParseEverything}
          className="w-full md:w-auto"
        >
          {t('binsOnly.parseAll')}
        </Button>
      </div>
    </ModalSheet>
  );
}
