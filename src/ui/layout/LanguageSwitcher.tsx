'use client';

import { Globe } from 'lucide-react';
import * as React from 'react';
import {
  LOCALE_NATIVE_NAMES,
  LOCALE_SHORT_LABELS,
  type Locale,
  SUPPORTED_LOCALES,
} from '@/core/i18n';
import { useT } from '@/ui/i18n';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  resolveButtonClassName,
} from '@/ui/primitives';
import { AppearanceRadioRows, useThemeMenuState } from './ThemeToggle';

export interface LanguageSwitcherProps {
  readonly defaultOpen?: boolean;
  /** Mobile (< 1024): the globe menu also holds the Appearance group (premium §7.1). */
  readonly includeAppearance?: boolean;
  readonly className?: string;
}

/**
 * Navigation language switcher (premium §7.1, §7.12):
 * - Desktop (>= 1024): ghost button 32 h, padding 0 10 0 8, globe 16 + 6 px + `control` short label
 * - Mobile (< 1024): 44 x 44 globe icon button; the menu adds a second "Appearance" group after a
 *   `hairline` inset 12
 * - Menu 220 wide, native names with `lang`, check on the current row; selecting applies at 0 ms
 */
export function LanguageSwitcher({
  defaultOpen = false,
  includeAppearance = false,
  className,
}: LanguageSwitcherProps): React.JSX.Element {
  const { locale, setLocale, t } = useT();
  const { preference } = useThemeMenuState();
  const appearanceLabelId = React.useId();

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        data-testid="language-switcher-trigger"
        aria-label={t('nav.languageAria')}
        className={cn(
          resolveButtonClassName({ variant: 'ghost', iconSide: 'start' }),
          'transition-[transform,background-color,color,opacity] motion-safe:enabled:active:scale-[0.97]',
          'max-lg:size-11 max-lg:p-0 max-lg:after:inset-0 max-lg:motion-safe:enabled:active:scale-[0.94]',
          className,
        )}
      >
        <Globe
          className="size-4 shrink-0"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="max-lg:hidden" translate="no">
          {LOCALE_SHORT_LABELS[locale]}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        expectedWidthPx={220}
        aria-label={t('language.menuTitle')}
        data-testid="language-switcher-menu"
        className="w-[220px]"
      >
        {SUPPORTED_LOCALES.map((itemLocale: Locale) => {
          const isCurrent = itemLocale === locale;
          return (
            <DropdownMenuRadioItem
              key={itemLocale}
              value={itemLocale}
              checked={isCurrent}
              lang={itemLocale}
              instantClose
              typeaheadLabel={LOCALE_NATIVE_NAMES[itemLocale]}
              onSelect={() => {
                if (itemLocale !== locale) {
                  setLocale(itemLocale);
                }
              }}
            >
              <span lang={itemLocale} translate="no">
                {LOCALE_NATIVE_NAMES[itemLocale]}
              </span>
            </DropdownMenuRadioItem>
          );
        })}
        {includeAppearance ? (
          <>
            <DropdownMenuSeparator className="mx-3 my-1" />
            <div role="group" aria-labelledby={appearanceLabelId}>
              <DropdownMenuLabel id={appearanceLabelId} className="pt-2 pb-1">
                {t('theme.label')}
              </DropdownMenuLabel>
              <AppearanceRadioRows preference={preference} />
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
