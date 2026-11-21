'use client';

import { FolderOpen } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type { DemoPresetId } from '@/core/demo';
import { useT } from '@/ui/i18n';
import { Button, cn } from '@/ui/primitives';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LotPicker, type RecentLotEntry } from './LotPicker';
import { ThemeToggle } from './ThemeToggle';

export interface ActiveNavLotInfo {
  readonly lotId: string;
  readonly presetId: DemoPresetId | null;
  readonly recentId: string | null;
  readonly customTitle?: string;
}

export interface NavBarProps {
  /** `null` on landing / error states (hides `LotPicker` per redesign §4.1). */
  readonly activeLot: ActiveNavLotInfo | null;
  readonly recentLots: readonly RecentLotEntry[];
  readonly onNavigateHome: () => void;
  readonly onSelectDemoPreset: (presetId: DemoPresetId) => void;
  readonly onSelectRecentLot: (recentId: string) => void;
  readonly onOpenFilePicker: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Sticky nav bar (premium §7.1):
 * - 52 px from 1024 (48 below), `material`, z 40; a 1 px `hairline` fades in (`dur-1`) after 4 px of scroll
 * - Desktop grid `1fr auto 1fr` with the page margin (32 at md, 40 from 1280); mobile `auto 1fr auto`, padding 0 16
 * - Left wordmark link to `/`; centre lot picker (absent on landing, disabled while loading);
 *   right: language, 4 px, theme toggle, 12 px, "Open file" secondary 32 h. Mobile: globe (with the
 *   Appearance group) and folder-open icon buttons, 44 x 44, gap 0
 * - Tab order: wordmark, lot picker, language, theme, Open file
 */
export function NavBar({
  activeLot,
  recentLots,
  onNavigateHome,
  onSelectDemoPreset,
  onSelectRecentLot,
  onOpenFilePicker,
  disabled = false,
  className,
}: NavBarProps): React.JSX.Element {
  const { t } = useT();
  const [isScrolled, setIsScrolled] = React.useState(false);
  const [isMobileViewport, setIsMobileViewport] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const readVerdictScrollTop = (): number =>
      document.querySelector<HTMLElement>('[data-verdict-scroll]')?.scrollTop ??
      0;

    const syncScrolled = (): void => {
      const nextScrolled = window.scrollY > 4 || readVerdictScrollTop() > 4;
      setIsScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled));
    };

    const handleCapturedScroll = (): void => {
      syncScrolled();
    };

    syncScrolled();
    window.addEventListener('scroll', syncScrolled, { passive: true });
    document.addEventListener('scroll', handleCapturedScroll, {
      passive: true,
      capture: true,
    });

    const mql = window.matchMedia('(max-width: 1023px)');
    const handleMediaChange = (): void => {
      setIsMobileViewport(mql.matches);
    };
    handleMediaChange();
    mql.addEventListener('change', handleMediaChange);

    return () => {
      window.removeEventListener('scroll', syncScrolled);
      document.removeEventListener('scroll', handleCapturedScroll, true);
      mql.removeEventListener('change', handleMediaChange);
    };
  }, [activeLot]);

  return (
    <header
      data-testid="nav-bar"
      className={cn(
        'sticky top-0 z-[var(--z-nav)] w-full bg-material [backdrop-filter:var(--material-filter)] [-webkit-backdrop-filter:var(--material-filter)]',
        className,
      )}
    >
      <nav
        aria-label={t('app.title')}
        className="mx-auto grid h-12 w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-4 lg:h-[52px] lg:grid-cols-[1fr_auto_1fr] lg:px-8 xl:px-10"
      >
        {/* Left: wordmark, a link to `/` that returns to the landing without confirmation */}
        <div className="flex min-w-0 items-center justify-self-start">
          <Link
            href="/"
            data-testid="nav-wordmark"
            title={activeLot !== null ? t('nav.home') : undefined}
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              event.preventDefault();
              onNavigateHome();
            }}
            className={cn(
              'relative inline-flex h-11 cursor-pointer items-center rounded-pill px-1 text-[15px] leading-[1.33] font-[590] tracking-[-0.01em] whitespace-nowrap text-text-primary no-underline select-none lg:h-10',
              'transition-opacity duration-[120ms] ease-[var(--ease-out)] hover:opacity-72',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
            )}
          >
            <span className="max-lg:hidden" translate="no">
              {t('nav.wordmark')}
            </span>
            <span className="lg:hidden" translate="no">
              {t('nav.wordmarkShort')}
            </span>
          </Link>
        </div>

        {/* Centre: lot picker, absent on landing */}
        <div className="flex min-w-0 items-center justify-self-center">
          {activeLot !== null ? (
            <LotPicker
              currentLotId={activeLot.lotId}
              currentPresetId={activeLot.presetId}
              currentRecentId={activeLot.recentId}
              {...(activeLot.customTitle !== undefined
                ? { currentCustomTitle: activeLot.customTitle }
                : {})}
              recentLots={recentLots}
              onSelectDemoPreset={onSelectDemoPreset}
              onSelectRecentLot={onSelectRecentLot}
              onOpenFilePicker={onOpenFilePicker}
              disabled={disabled}
            />
          ) : null}
        </div>

        {/* Right: language, 4 px, theme, 12 px, Open file (hidden on landing, which has its own) */}
        <div className="flex items-center justify-self-end">
          <Link
            href="/agents"
            data-testid="nav-agent-console"
            className={cn(
              'mr-2 inline-flex h-9 items-center rounded-pill px-3 text-[12px] leading-none text-text-secondary no-underline',
              'transition-[background-color,color] duration-[120ms] hover:bg-fill-1 hover:text-text-primary',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
            )}
          >
            {t('nav.agent')}
          </Link>

          <LanguageSwitcher includeAppearance={isMobileViewport} />

          <ThemeToggle className="ml-1 max-lg:hidden" />

          {activeLot !== null ? (
            <Button
              variant="secondary"
              size="sm"
              data-testid="nav-open-stdf"
              disabled={disabled}
              aria-label={isMobileViewport ? t('nav.openStdfAria') : undefined}
              onClick={onOpenFilePicker}
              className={cn(
                'lg:ml-3',
                'max-lg:size-11 max-lg:bg-transparent max-lg:p-0 max-lg:text-text-secondary max-lg:after:inset-0',
                'max-lg:enabled:hover:bg-fill-1 max-lg:enabled:hover:text-text-primary',
              )}
            >
              <FolderOpen
                className="size-4 shrink-0 lg:hidden"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="sr-only lg:hidden">{t('nav.openStdfAria')}</span>
              <span className="max-lg:hidden">{t('nav.openFile')}</span>
            </Button>
          ) : null}
        </div>
      </nav>

      <div
        aria-hidden="true"
        data-testid="nav-scroll-separator"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-px bg-hairline transition-opacity duration-[120ms] ease-[var(--ease-out)]',
          isScrolled ? 'opacity-100' : 'opacity-0',
        )}
      />
    </header>
  );
}
