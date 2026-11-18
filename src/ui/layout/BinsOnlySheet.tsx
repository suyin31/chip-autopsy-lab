'use client';

import * as React from 'react';
import { useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/primitives/cn';
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
 * Pre-parse sheet shown when an uncompressed STDF stream exceeds `200 MB` (premium §6.6, §7.16):
 * - Title (`title-1`): `"This file is 312 MB."`; 12 px; body; 28 px; actions
 * - Body (`body` secondary): `"Parsing every test result may take about 21s. Bins-only mode skips parametric results and keeps the wafer maps, bins, and yield."`
 * - Primary `"Use bins-only"` (`ink`, focused, Enter triggers bins-only) and secondary
 *   `"Parse everything"`: right-aligned with the primary last on desktop, stacked full width
 *   with the primary first on mobile
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
      <h2 id={titleId} className="type-title-1 text-text-primary">
        {t('binsOnly.sheetTitle', { size: formattedSize })}
      </h2>

      <p id={bodyId} className="mt-3 type-body text-text-secondary">
        {t('binsOnly.sheetBody', { seconds: formattedDuration })}
      </p>

      <div className="mt-7 flex flex-col gap-3 md:flex-row-reverse md:items-center md:justify-start">
        <Button
          ref={useBinsOnlyButtonRef}
          variant="primary"
          size="lg"
          autoFocus
          data-testid="bins-only-confirm-button"
          onClick={onUseBinsOnly}
          className={cn(
            'w-full md:w-auto',
            // premium §7.11 primary: `ink` fill, `on-ink` text (A20)
            'bg-ink text-on-ink enabled:hover:bg-[#333336] enabled:active:bg-black',
            'dark:enabled:hover:bg-white dark:enabled:active:bg-[#e8e8ed]',
          )}
        >
          {t('binsOnly.useBinsOnly')}
        </Button>

        <Button
          variant="secondary"
          size="lg"
          data-testid="bins-only-parse-all-button"
          onClick={onParseEverything}
          className={cn(
            'w-full md:w-auto',
            // premium §7.11 secondary: `fill-2`, hover `fill-3`
            'bg-fill-2 text-text-primary enabled:hover:bg-fill-3 enabled:active:bg-fill-3',
          )}
        >
          {t('binsOnly.parseAll')}
        </Button>
      </div>
    </ModalSheet>
  );
}
