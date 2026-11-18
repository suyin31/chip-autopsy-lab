'use client';

import { type LucideIcon, Moon, Sun, SunMoon } from 'lucide-react';
import * as React from 'react';
import type { MessageKey } from '@/core/i18n';
import { useT } from '@/ui/i18n';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  resolveButtonClassName,
  Tooltip,
} from '@/ui/primitives';
import { useThemeStore } from '@/ui/state/theme-store';
import {
  DEFAULT_THEME_PREFERENCE,
  type ResolvedTheme,
  THEME_PREFERENCES,
  type ThemePreference,
} from '@/ui/theme';

/** The icon shows the preference, not the result (premium §7.1). */
export const THEME_PREFERENCE_ICONS: Readonly<Record<ThemePreference, LucideIcon>> = {
  system: SunMoon,
  light: Sun,
  dark: Moon,
};

export const THEME_PREFERENCE_LABEL_KEYS = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
} as const satisfies Record<ThemePreference, MessageKey>;

export type ThemeAriaPreferenceKey =
  | 'theme.ariaSystemLight'
  | 'theme.ariaSystemDark'
  | (typeof THEME_PREFERENCE_LABEL_KEYS)[ThemePreference];

/** `{preference}` value of `theme.ariaLabel`: "System, currently light", "Light", or "Dark". */
export function resolveThemeAriaPreferenceKey(
  preference: ThemePreference,
  resolved: ResolvedTheme,
): ThemeAriaPreferenceKey {
  if (preference === 'system') {
    return resolved === 'dark' ? 'theme.ariaSystemDark' : 'theme.ariaSystemLight';
  }
  return THEME_PREFERENCE_LABEL_KEYS[preference];
}

function subscribeTheme(onChange: () => void): () => void {
  return useThemeStore.subscribe(onChange);
}

/** Stored preference and resolved theme; the server snapshot is the default so hydration matches. */
export function useThemeMenuState(): {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
} {
  const preference = React.useSyncExternalStore(
    subscribeTheme,
    () => useThemeStore.getState().preference,
    () => DEFAULT_THEME_PREFERENCE,
  );
  const resolved = React.useSyncExternalStore(
    subscribeTheme,
    () => useThemeStore.getState().resolved,
    () => 'light' as const,
  );
  return { preference, resolved };
}

export interface AppearanceRadioRowsProps {
  readonly preference: ThemePreference;
}

/** "Match system", "Light", "Dark" rows with a leading 16 px icon and the check on the current row (premium §7.1). */
export function AppearanceRadioRows({
  preference,
}: AppearanceRadioRowsProps): React.JSX.Element {
  const { t } = useT();
  return (
    <>
      {THEME_PREFERENCES.map((item) => {
        const Icon = THEME_PREFERENCE_ICONS[item];
        const label = t(THEME_PREFERENCE_LABEL_KEYS[item]);
        return (
          <DropdownMenuRadioItem
            key={item}
            value={item}
            checked={item === preference}
            typeaheadLabel={label}
            data-testid={`theme-option-${item}`}
            leading={
              <Icon
                className="size-4 text-text-secondary"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            }
            onSelect={() => useThemeStore.getState().setPreference(item)}
          >
            {label}
          </DropdownMenuRadioItem>
        );
      })}
    </>
  );
}

export interface ThemeToggleProps {
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

/**
 * Quiet theme toggle (premium §7.1): 32 x 32 icon button showing the preference icon in
 * `text-secondary`, tooltip "Appearance"; opens a 200 px menu with a radio group and the
 * `subhead` tertiary note under it.
 */
export function ThemeToggle({
  defaultOpen = false,
  className,
}: ThemeToggleProps): React.JSX.Element {
  const { t } = useT();
  const { preference, resolved } = useThemeMenuState();
  const [open, setOpen] = React.useState(defaultOpen);
  const Icon = THEME_PREFERENCE_ICONS[preference];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip content={t('theme.label')} disabled={open} className={className}>
        <DropdownMenuTrigger
          data-testid="theme-toggle-trigger"
          data-preference={preference}
          aria-label={t('theme.ariaLabel', {
            preference: t(resolveThemeAriaPreferenceKey(preference, resolved)),
          })}
          className={cn(
            resolveButtonClassName({ variant: 'icon' }),
            'transition-[transform,background-color,color,opacity] motion-safe:enabled:active:scale-[0.94]',
          )}
        >
          <Icon strokeWidth={1.5} aria-hidden="true" />
        </DropdownMenuTrigger>
      </Tooltip>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        expectedWidthPx={200}
        aria-label={t('theme.label')}
        data-testid="theme-menu"
        className="w-[200px]"
      >
        <div role="group" aria-label={t('theme.label')}>
          <AppearanceRadioRows preference={preference} />
        </div>
        <p className="px-3 pt-2 pb-1 type-subhead text-pretty text-text-tertiary">
          {t('theme.systemNote')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
