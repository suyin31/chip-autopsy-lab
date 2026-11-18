'use client';

import { Info } from 'lucide-react';
import * as React from 'react';
import { useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/primitives/cn';

export interface BinsOnlyNoticeProps {
  readonly onParseEverything?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Post-load bins-only notice (premium §6.6):
 * One line under the action row in `subhead` secondary with a leading 14 px info icon:
 * `"Bins-only mode. Parametric findings are hidden."` + text button `"Parse everything"`.
 */
export function BinsOnlyNotice({
  onParseEverything,
  disabled = false,
  className,
}: BinsOnlyNoticeProps): React.JSX.Element {
  const { t } = useT();

  return (
    <div
      role="status"
      data-testid="bins-only-notice"
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 type-subhead text-text-secondary',
        className,
      )}
    >
      <Info
        className="size-3.5 shrink-0"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span>{t('binsOnly.notice')}</span>
      {onParseEverything ? (
        <Button
          variant="text"
          disabled={disabled}
          data-testid="bins-only-parse-everything-inline"
          onClick={onParseEverything}
          className="type-subhead font-medium text-text-primary"
        >
          {t('binsOnly.parseAll')}
        </Button>
      ) : null}
    </div>
  );
}
