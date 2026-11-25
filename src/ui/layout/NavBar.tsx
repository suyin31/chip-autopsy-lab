'use client';

import { Bot, FolderOpen, Search } from 'lucide-react';
import { motion, useScroll } from 'motion/react';
import Link from 'next/link';
import * as React from 'react';
import type { DemoPresetId } from '@/core/demo';
import { useT } from '@/ui/i18n';
import { useReducedMotionPreference } from '@/ui/motion';
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
  /** Opens the command palette from the visible search pill; the pill is the morph origin. */
  readonly onOpenCommandPalette?: (origin: HTMLElement) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Visible ⌘K pill (UI plan §4 D): a shallow well holding a search glyph, a plain label, and the
 * shortcut on a keycap. Clicking it grows the command palette out of the pill itself.
 */
function CommandSearchPill({
  disabled,
  onOpen,
}: {
  readonly disabled: boolean;
  readonly onOpen: (origin: HTMLElement) => void;
}): React.JSX.Element {
  const { t } = useT();
  const [modKey, setModKey] = React.useState('Ctrl');
  React.useEffect(() => {
    if (/mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)) {
      setModKey('⌘');
    }
  }, []);
  return (
    <button
      type="button"
      data-testid="nav-command-pill"
      aria-label={t('palette.ariaLabel')}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      disabled={disabled}
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(
        'at-well relative mr-2 inline-flex h-8 cursor-pointer items-center gap-2 rounded-pill pr-1 pl-3 type-control text-text-tertiary select-none max-sm:hidden',
        "after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
        'transition-[color,scale] duration-[120ms] ease-[var(--ease-out)] [@media(hover:hover)]:enabled:hover:text-text-primary',
        'motion-safe:enabled:active:scale-[0.97]',
        'focus-visible:shadow-focus-ring focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <Search className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="max-xl:hidden">{t('palette.placeholder')}</span>
      <kbd
        aria-hidden="true"
        className="inline-flex h-6 min-w-6 items-center justify-center rounded-pill bg-surface px-1.5 text-[12px] leading-none font-[500] text-text-secondary shadow-[var(--elev-keycap)] dark:bg-fill-2"
      >
        {modKey}K
      </kbd>
    </button>
  );
}

function NavScrollProgress(): React.JSX.Element {
  const { scrollYProgress } = useScroll();
  return (
    <motion.div
      aria-hidden="true"
      data-testid="nav-scroll-progress"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] origin-left bg-text-tertiary/35"
      style={{ scaleX: scrollYProgress }}
    />
  );
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
  onOpenCommandPalette,
  disabled = false,
  className,
}: NavBarProps): React.JSX.Element {
  const { t } = useT();
  const prefersReduced = useReducedMotionPreference();
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
              'relative inline-flex h-11 cursor-pointer items-center gap-2 rounded-pill px-1 text-[15px] leading-[1.33] font-[560] tracking-[-0.03em] whitespace-nowrap text-text-primary no-underline select-none [font-family:var(--font-display)] lg:h-10',
              'transition-opacity duration-[120ms] ease-[var(--ease-out)] hover:opacity-72',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-[15px] shrink-0 text-ember"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
            >
              <circle cx="8" cy="8" r="6.4" />
              <circle cx="8" cy="8" r="2.2" strokeOpacity={0.55} />
              <path d="M8 0.6v2.2M8 13.2v2.2M0.6 8h2.2M13.2 8h2.2" strokeOpacity={0.7} />
            </svg>
            <span className="max-lg:hidden" translate="no">
              {t('nav.wordmark')}
            </span>
            <span className="max-sm:hidden lg:hidden" translate="no">
              {t('nav.wordmarkShort')}
            </span>
            {/* Below 640 the lot pill needs the room; the reticle carries the mark instead. */}
            <span className="sr-only sm:hidden">{t('nav.wordmark')}</span>
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
          {activeLot !== null && onOpenCommandPalette ? (
            <CommandSearchPill disabled={disabled} onOpen={onOpenCommandPalette} />
          ) : null}
          <Link
            href="/agents"
            data-testid="nav-agent-console"
            className={cn(
              'mr-2 inline-flex h-9 items-center rounded-pill px-3 type-control whitespace-nowrap text-text-secondary no-underline',
              'max-sm:size-11 max-sm:justify-center max-sm:px-0',
              'transition-[background-color,color] duration-[120ms] ease-[var(--ease-out)] hover:bg-fill-1 hover:text-text-primary',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
            )}
          >
            <Bot className="size-4 sm:hidden" strokeWidth={1.6} aria-hidden="true" />
            <span className="max-sm:sr-only">{t('nav.agent')}</span>
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
                'max-lg:size-11 max-lg:bg-transparent max-lg:p-0 max-lg:text-text-secondary max-lg:not-focus-visible:shadow-none max-lg:after:inset-0',
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
      {activeLot !== null && !prefersReduced ? <NavScrollProgress /> : null}
    </header>
  );
}
