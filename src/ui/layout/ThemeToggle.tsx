'use client';

import { type LucideIcon, Moon, Sun, SunMoon } from 'lucide-react';
import * as React from 'react';
import type { MessageKey } from '@/core/i18n';
import { useT } from '@/ui/i18n';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuRadioSwatch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  resolveButtonClassName,
  Tooltip,
} from '@/ui/primitives';
import { useThemeStore } from '@/ui/state/theme-store';
import {
  ACCENT_PREFERENCES,
  type AccentPreference,
  DEFAULT_ACCENT_PREFERENCE,
  DEFAULT_THEME_PREFERENCE,
  type ResolvedTheme,
  switchAccentPreference,
  switchThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
} from '@/ui/theme';
import { getAccentTokens } from '@/ui/tokens';

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

export const ACCENT_LABEL_KEYS = {
  ember: 'accent.ember',
  cobalt: 'accent.cobalt',
  jade: 'accent.jade',
  violet: 'accent.violet',
} as const satisfies Record<AccentPreference, MessageKey>;

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

/** Stored preference, resolved theme, and accent; server snapshot uses defaults so hydration matches. */
export function useThemeMenuState(): {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly accent: AccentPreference;
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
  const accent = React.useSyncExternalStore(
    subscribeTheme,
    () => useThemeStore.getState().accent,
    () => DEFAULT_ACCENT_PREFERENCE,
  );
  return { preference, resolved, accent };
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
            onSelect={() => switchThemePreference(item)}
          >
            {label}
          </DropdownMenuRadioItem>
        );
      })}
    </>
  );
}

export interface AccentSwatchGroupProps {
  readonly accent: AccentPreference;
  readonly resolved: ResolvedTheme;
  readonly labelId: string;
}

/**
 * Accent colour swatch group: 4 circular 20 px swatches (Ember, Cobalt, Jade, Violet)
 * with radio semantics, 2 px ink focus/selected ring, and Left/Right + Up/Down keyboard stepping.
 */
export function AccentSwatchGroup({
  accent,
  resolved,
  labelId,
}: AccentSwatchGroupProps): React.JSX.Element {
  const { t } = useT();
  const swatchRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const handleGroupKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
      return;
    }
    const active =
      typeof document !== 'undefined' ? document.activeElement : null;
    const idx = swatchRefs.current.findIndex((el) => el === active);
    if (idx < 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const count = ACCENT_PREFERENCES.length;
    const nextIdx =
      event.key === 'ArrowRight'
        ? (idx + 1) % count
        : (idx - 1 + count) % count;
    swatchRefs.current[nextIdx]?.focus();
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-testid="accent-swatch-group"
      onKeyDown={handleGroupKeyDown}
    >
      <DropdownMenuLabel id={labelId} className="pt-1.5 pb-1">
        {t('accent.label')}
      </DropdownMenuLabel>
      <div className="flex items-center gap-4 px-3 pt-1.5 pb-2">
        {ACCENT_PREFERENCES.map((item, index) => {
          const label = t(ACCENT_LABEL_KEYS[item]);
          const swatchColor = getAccentTokens(item, resolved).emberMark;
          return (
            <DropdownMenuRadioSwatch
              key={item}
              ref={(node) => {
                swatchRefs.current[index] = node;
              }}
              value={item}
              checked={item === accent}
              label={label}
              color={swatchColor}
              data-testid={`accent-option-${item}`}
              data-accent-option={item}
              onSelect={() => switchAccentPreference(item)}
            />
          );
        })}
      </div>
    </div>
  );
}

export interface ThemeToggleProps {
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

/**
 * Quiet theme & accent popover toggle (premium §7.1): 32 x 32 icon button showing the
 * preference icon in `text-secondary`, tooltip "Appearance"; opens a 200 px popover menu
 * with Appearance (Match system / Light / Dark) and Colour (Ember / Cobalt / Jade / Violet).
 */
export function ThemeToggle({
  defaultOpen = false,
  className,
}: ThemeToggleProps): React.JSX.Element {
  const { t } = useT();
  const { preference, resolved, accent } = useThemeMenuState();
  const [open, setOpen] = React.useState(defaultOpen);
  const appearanceLabelId = React.useId();
  const accentLabelId = React.useId();
  const Icon = THEME_PREFERENCE_ICONS[preference];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip content={t('theme.label')} disabled={open} className={className}>
        <DropdownMenuTrigger
          data-testid="theme-toggle-trigger"
          data-preference={preference}
          data-accent={accent}
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
        <div role="group" aria-labelledby={appearanceLabelId}>
          <DropdownMenuLabel id={appearanceLabelId} className="pt-1 pb-1">
            {t('theme.label')}
          </DropdownMenuLabel>
          <AppearanceRadioRows preference={preference} />
        </div>
        <p className="px-3 pt-1.5 pb-1.5 type-subhead text-pretty text-text-tertiary">
          {t('theme.systemNote')}
        </p>
        <DropdownMenuSeparator className="mx-3 my-1" />
        <AccentSwatchGroup
          accent={accent}
          resolved={resolved}
          labelId={accentLabelId}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
