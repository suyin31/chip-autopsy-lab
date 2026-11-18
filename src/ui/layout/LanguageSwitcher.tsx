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
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/primitives';

export interface LanguageSwitcherProps {
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

/**
 * Navigation `LanguageSwitcher` implementing `redesign.md` §4.10:
 * - Desktop (`>= 768px`): ghost pill height `32 px`, `16 px` globe icon + `control` `"EN"`/`"简"`/`"繁"`/`"日"`/`"한"`
 * - Mobile (`< 768px`): `44 x 44 px` globe icon button with `aria-label`
 * - Menu: width `220 px`, material, radius `24 px`, padding `8 px`, `0 ms` open via keyboard / `120 ms` fade via pointer
 * - Selecting applies instantly (`0 ms`), updates `<html lang>`, persists `localStorage["cal.locale"]`, and announces via live region
 */
export function LanguageSwitcher({
  defaultOpen = false,
  className,
}: LanguageSwitcherProps = {}): React.JSX.Element {
  const { locale, setLocale, t } = useT();

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        data-testid="language-switcher-trigger"
        aria-label={t('nav.languageAria')}
        className={cn(
          'relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-pill bg-transparent p-0 text-text-secondary shadow-none select-none',
          'md:h-8 md:w-auto md:gap-1.5 md:pl-2 md:pr-2.5',
          "md:after:absolute md:after:inset-x-0 md:after:-inset-y-1 md:after:content-['']",
          'transition-[transform,background-color,color,opacity] duration-[120ms] ease-[var(--ease-out)] active:duration-[100ms]',
          'enabled:hover:bg-white/6 enabled:hover:text-text-primary enabled:active:scale-[0.94] md:enabled:active:scale-[0.97]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          className,
        )}
      >
        <Globe
          className="size-4 shrink-0"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="max-md:hidden type-control" translate="no">
          {LOCALE_SHORT_LABELS[locale]}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        expectedWidthPx={220}
        openAnimation="pointer-fade"
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
