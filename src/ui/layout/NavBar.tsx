'use client';

import { FolderOpen } from 'lucide-react';
import * as React from 'react';
import type { DemoPresetId } from '@/core/demo';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LotPicker, type RecentLotEntry } from './LotPicker';

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
 * Sticky translucent navigation bar implementing `redesign.md` §4.1:
 * - Height `52 px` desktop (`>= 768 px`) / `48 px` mobile (`< 768 px`), `position: sticky; top: 0`
 * - Material surface with no resting bottom border; `1 px` `separator` fades in (`120 ms`) when scrolled `> 4 px`
 * - 3-zone grid (`1fr auto 1fr`), side padding `40 px` desktop / `16 px` mobile
 * - Strict keyboard Tab order: wordmark -> lot picker (when loaded) -> language -> Open STDF
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

    let verdictScrollTop = 0;

    const syncScrolled = (): void => {
      const nextScrolled = window.scrollY > 4 || verdictScrollTop > 4;
      setIsScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled));
    };

    const handleCapturedScroll = (event: Event): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.hasAttribute('data-verdict-scroll')
      ) {
        verdictScrollTop = target.scrollTop;
      }
      syncScrolled();
    };

    syncScrolled();
    window.addEventListener('scroll', syncScrolled, { passive: true });
    document.addEventListener('scroll', handleCapturedScroll, {
      passive: true,
      capture: true,
    });

    const mql = window.matchMedia('(max-width: 767px)');
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
  }, []);

  return (
    <header
      data-testid="nav-bar"
      className={cn(
        'surface-material sticky top-0 z-[var(--z-nav)] w-full shadow-none',
        className,
      )}
    >
      <nav
        aria-label={t('app.title')}
        className="mx-auto grid h-12 w-full grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 md:h-[52px] md:px-10"
      >
        {/* Zone 1 (Left): Wordmark — click returns to landing without confirmation */}
        <div className="flex min-w-0 items-center justify-self-start">
          <button
            type="button"
            data-testid="nav-wordmark"
            title={activeLot !== null ? t('nav.home') : undefined}
            onClick={onNavigateHome}
            className={cn(
              'relative inline-flex h-11 cursor-pointer items-center rounded-pill px-1 text-[15px] leading-[1.29] font-[590] tracking-[-0.01em] whitespace-nowrap text-text-primary select-none md:h-10',
              'transition-[transform,color,opacity] duration-[120ms] ease-[var(--ease-out)] active:duration-[100ms] enabled:active:scale-[0.97]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <span className="max-md:hidden" translate="no">
              {t('nav.wordmark')}
            </span>
            <span className="md:hidden" translate="no">
              {t('nav.wordmarkShort')}
            </span>
          </button>
        </div>

        {/* Zone 2 (Centre): LotPicker — hidden on landing state */}
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

        {/* Zone 3 (Right): LanguageSwitcher + 8px gap + Open STDF */}
        <div className="flex items-center justify-self-end gap-2">
          <LanguageSwitcher />

          <button
            type="button"
            data-testid="nav-open-stdf"
            disabled={disabled}
            aria-disabled={disabled ? 'true' : undefined}
            aria-label={isMobileViewport ? t('nav.openStdfAria') : undefined}
            onClick={onOpenFilePicker}
            className={cn(
              'relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-pill bg-transparent p-0 whitespace-nowrap text-text-secondary shadow-none select-none',
              'md:h-8 md:w-auto md:bg-white/10 md:px-[14px] md:type-control md:text-text-primary',
              "md:after:absolute md:after:inset-x-0 md:after:-inset-y-1 md:after:content-['']",
              'transition-[transform,background-color,color,opacity] duration-[120ms] ease-[var(--ease-out)] active:duration-[100ms]',
              'enabled:hover:bg-white/6 enabled:hover:text-text-primary enabled:active:scale-[0.94]',
              'md:enabled:hover:bg-white/14 md:enabled:active:scale-[0.97] md:enabled:active:bg-white/8',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
            )}
          >
            <FolderOpen
              className="size-4 shrink-0 md:hidden"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span className="sr-only md:hidden">{t('nav.openStdfAria')}</span>
            <span className="max-md:hidden">{t('nav.openStdf')}</span>
          </button>
        </div>
      </nav>

      <div
        aria-hidden="true"
        data-testid="nav-scroll-separator"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-px bg-separator transition-opacity duration-[120ms] ease-[var(--ease-out)]',
          isScrolled ? 'opacity-100' : 'opacity-0',
        )}
      />
    </header>
  );
}
