import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listDemoPresets } from '@/core/demo';
import { I18nProvider } from '@/ui/i18n';
import { BinsOnlySheet } from '@/ui/layout/BinsOnlySheet';
import { EmptyStateCard } from '@/ui/layout/EmptyStateCard';
import {
  Button,
  countPrimaryButtons,
  resolveButtonClassName,
  resolveButtonPressScale,
} from './button';
import {
  resolveTooltipDelayMs,
  TOOLTIP_DELAY_MS,
  TOOLTIP_SKIP_DELAY_WINDOW_MS,
} from './tooltip';
import {
  computeAnchoredMenuPosition,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  matchMenuTypeahead,
  resolveMenuKeyAction,
} from './menu';
import {
  resolveSegmentedKeyStep,
  SegmentedControl,
} from './segmented-control';
import {
  MENU_SURFACE_CLASS,
  POPOVER_SURFACE_CLASS,
  TOOLTIP_SURFACE_CLASS,
} from './surfaces';
import { ClinicalToaster, SONNER_TOAST_OPTIONS } from './toaster';

describe('Button, SegmentedControl, and DropdownMenu primitives (Task R3)', () => {
  it('styles Button per premium §7.11: every variant, size, state, focus-ring, and hit area', () => {
    const render = (props: Record<string, unknown>, label = 'Label') =>
      renderToStaticMarkup(React.createElement(Button, props, label));

    const primaryLg = render({ variant: 'primary', size: 'lg' }, 'Open the sample lot');
    expect(primaryLg).toContain('data-variant="primary"');
    expect(primaryLg).toContain('rounded-pill');
    expect(primaryLg).toContain('origin-center');
    expect(primaryLg).toContain('bg-ink text-on-ink');
    expect(primaryLg).toContain('h-12');
    expect(primaryLg).toContain('px-[22px]');
    expect(primaryLg).toContain('text-[15px]');
    expect(primaryLg).toContain('font-[590]');
    expect(primaryLg).toContain('tracking-[-0.01em]');
    expect(primaryLg).toContain('enabled:hover:bg-[#333336]');
    expect(primaryLg).toContain('dark:enabled:hover:bg-white');
    expect(primaryLg).toContain('enabled:active:bg-black');
    expect(primaryLg).toContain('dark:enabled:active:bg-[#e8e8ed]');
    expect(primaryLg).toContain('disabled:opacity-32');
    expect(primaryLg).toContain('focus-visible:shadow-focus-ring');
    expect(primaryLg).toContain('focus-visible:outline-none');
    expect(primaryLg).not.toContain('outline-accent');
    expect(primaryLg).not.toContain('transition-all');
    expect(primaryLg).not.toMatch(/\bfont-(bold|extrabold|black)\b/);
    // Verdict action row primary is 40 px
    expect(render({ variant: 'primary' })).toContain('h-10');

    const secondaryLg = render({ variant: 'secondary', size: 'lg' });
    expect(secondaryLg).toContain('h-12');
    expect(secondaryLg).toContain('px-5');
    expect(secondaryLg).toContain('bg-fill-2');
    expect(secondaryLg).toContain('text-text-primary');
    expect(secondaryLg).toContain('enabled:hover:bg-fill-3');
    expect(secondaryLg).toContain('disabled:opacity-32');
    expect(render({ variant: 'secondary', size: 'md' })).toContain('h-11');
    const secondaryNav = render({ variant: 'secondary', size: 'sm' });
    expect(secondaryNav).toContain('h-8');
    expect(secondaryNav).toContain('px-[14px]');
    expect(secondaryNav).toContain('after:-inset-y-1');
    expect(secondaryNav).toContain('pointer-coarse:after:-inset-y-1.5');

    const ghost = render({ variant: 'ghost', iconSide: 'start' }, 'Reset view');
    expect(ghost).toContain('h-8');
    // Optical alignment: 2px less padding on the leading icon side (8px left vs 10px right)
    expect(ghost).toContain('pl-2');
    expect(ghost).toContain('pr-2.5');
    expect(ghost).toContain('text-text-secondary');
    expect(ghost).toContain('enabled:hover:bg-fill-1');
    expect(ghost).toContain('enabled:active:bg-fill-2');
    expect(ghost).toContain('disabled:text-text-disabled');

    const text = render({ variant: 'text' }, 'Clear');
    expect(text).toContain('after:-inset-2');
    expect(text).toContain('p-0');
    expect(text).toContain('enabled:hover:text-text-primary');
    expect(text).toContain('enabled:active:opacity-64');
    expect(text).toContain('disabled:text-text-disabled');

    const icon = renderToStaticMarkup(
      React.createElement(
        Button,
        { variant: 'icon', 'aria-label': 'Select an area', 'aria-pressed': true },
        React.createElement('svg', { 'aria-hidden': 'true' }),
      ),
    );
    expect(icon).toContain('size-8');
    expect(icon).toContain('pointer-coarse:size-11');
    expect(icon).toContain('after:-inset-1');
    expect(icon).toContain('[&amp;_svg]:size-4');
    expect(icon).toContain('enabled:hover:bg-fill-1');
    expect(icon).toContain('aria-pressed:bg-fill-2');
    expect(icon).toContain('aria-pressed:text-text-primary');
    expect(icon).toContain('aria-pressed:enabled:hover:bg-fill-3');
    expect(icon).toContain('aria-pressed="true"');

    // Press scales (premium §3.12): 0.97 buttons, 0.94 icon buttons, text buttons dim instead
    expect(resolveButtonPressScale('primary')).toBe(0.97);
    expect(resolveButtonPressScale('secondary')).toBe(0.97);
    expect(resolveButtonPressScale('ghost')).toBe(0.97);
    expect(resolveButtonPressScale('icon')).toBe(0.94);
    expect(resolveButtonPressScale('text')).toBeNull();

    const disabled = render({ variant: 'secondary', disabled: true }, 'Disabled');
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).toContain('disabled:cursor-not-allowed');

    // No hover style outside `enabled:` and no box-shadow or size transitions
    for (const html of [primaryLg, secondaryLg, ghost, text, icon]) {
      expect(html).toContain('transition-[background-color,color,opacity]');
      expect(html).not.toMatch(/transition-(all|shadow)\b/);
    }
  });

  it('counts exactly one primary button on each screen (premium §7.11, A20)', () => {
    const presets = listDemoPresets();
    const withLocale = (node: React.ReactElement) =>
      renderToStaticMarkup(
        React.createElement(I18nProvider, { initialLocale: 'en' }, node),
      );
    const landing = withLocale(
      React.createElement(EmptyStateCard, {
        cause: 'first-run',
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onDownloadDemoLot: () => undefined,
        onSelectFile: () => undefined,
      }),
    );
    const parseError = withLocale(
      React.createElement(EmptyStateCard, {
        cause: 'parse-failed',
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onDownloadDemoLot: () => undefined,
        onSelectFile: () => undefined,
        parseError: {
          fileName: 'photo.png',
          error: {
            code: 'MISSING_FAR_HEADER',
            message: 'bad far',
            byteOffset: 0,
            firstBytesHex: '89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52',
          },
        },
      }),
    );
    const binsOnly = withLocale(
      React.createElement(BinsOnlySheet, {
        open: true,
        bytesObserved: 312 * 1024 * 1024,
        onUseBinsOnly: () => undefined,
        onParseEverything: () => undefined,
        onCancel: () => undefined,
        disablePortal: true,
      }),
    );

    expect(countPrimaryButtons(landing)).toBe(1);
    expect(countPrimaryButtons(parseError)).toBe(1);
    expect(countPrimaryButtons(binsOnly)).toBe(1);
    expect(
      countPrimaryButtons(
        renderToStaticMarkup(
          React.createElement(
            'div',
            null,
            React.createElement(Button, { variant: 'secondary' }, 'A'),
            React.createElement(Button, { variant: 'ghost' }, 'B'),
          ),
        ),
      ),
    ).toBe(0);
  });

  it('renders SegmentedControl (§4.12) with 32px/28px material track, roving radio semantics, and 0ms keyboard stepping', () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentedControl, {
        ariaLabel: 'Wafer color mode',
        value: 'pass-fail',
        onValueChange: () => undefined,
        options: [
          { value: 'pass-fail', label: 'Pass/Fail' },
          { value: 'hbin', label: 'HBIN' },
          { value: 'sbin', label: 'SBIN', disabled: true },
        ],
      }),
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Wafer color mode"');
    // A30 (premium §7.8): fill-2 track, 32 px, padding 2, no border; white thumb + shadow-thumb in
    // light, white 0.16 and no shadow in dark; active label text-primary
    expect(html).toContain('bg-fill-2');
    expect(html).not.toContain('surface-material');
    expect(html).toContain('rounded-pill');
    expect(html).toContain('h-8');
    expect(html).toContain('p-0.5');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('bg-white shadow-thumb dark:bg-[rgba(255,255,255,0.16)] dark:shadow-none');
    expect(html).toMatch(/aria-checked="true"[^>]*text-text-primary/);
    expect(html).toMatch(/aria-checked="false"[^>]*text-text-secondary/);
    expect(html).toContain('px-3.5');
    expect(html).toContain('[:is(:lang(zh),:lang(ja),:lang(ko))_&amp;]:px-2.5');
    expect(html).toContain('motion-safe:group-enabled:group-active:scale-[0.97]');
    expect(html).toContain('pointer-coarse:after:-inset-y-2');
    expect(html).toContain('focus-visible:shadow-focus-ring');
    expect(html).not.toContain('outline-accent');

    const items = [
      { value: 'pass-fail', disabled: false },
      { value: 'hbin', disabled: false },
      { value: 'sbin', disabled: true },
    ] as const;

    expect(resolveSegmentedKeyStep('ArrowRight', 0, items)).toEqual({
      nextIndex: 1,
      instant: true,
    });
    // Wraps past disabled item 2 back to item 0
    expect(resolveSegmentedKeyStep('ArrowRight', 1, items)).toEqual({
      nextIndex: 0,
      instant: true,
    });
    expect(resolveSegmentedKeyStep('ArrowLeft', 0, items)).toEqual({
      nextIndex: 1,
      instant: true,
    });
    expect(resolveSegmentedKeyStep('Home', 1, items)).toEqual({
      nextIndex: 0,
      instant: true,
    });
    expect(resolveSegmentedKeyStep('End', 0, items)).toEqual({
      nextIndex: 1,
      instant: true,
    });
    expect(resolveSegmentedKeyStep('Tab', 0, items)).toBeNull();
  });

  it('renders DropdownMenu (§4.2, §4.10, §5.9) with material radius-24 surface, keyboard roving, typeahead, and viewport clamping', () => {
    const openHtml = renderToStaticMarkup(
      React.createElement(
        DropdownMenu,
        { open: true, onOpenChange: () => undefined },
        React.createElement(
          DropdownMenuTrigger,
          { 'aria-label': 'Change language' },
          'EN',
        ),
        React.createElement(
          DropdownMenuContent,
          { align: 'end', className: 'w-[220px]', 'aria-label': 'Language' },
          React.createElement(DropdownMenuLabel, null, 'Language'),
          React.createElement(
            DropdownMenuRadioItem,
            { value: 'en', checked: true, lang: 'en', onSelect: () => undefined },
            'English',
          ),
          React.createElement(
            DropdownMenuRadioItem,
            { value: 'ja', checked: false, lang: 'ja', onSelect: () => undefined },
            '日本語',
          ),
          React.createElement(DropdownMenuSeparator),
          React.createElement(
            DropdownMenuItem,
            { onSelect: () => undefined },
            'Open STDF file…',
            React.createElement(DropdownMenuShortcut, null, '⌘O'),
          ),
        ),
      ),
    );

    expect(openHtml).toContain('aria-haspopup="menu"');
    expect(openHtml).toContain('aria-expanded="true"');
    expect(openHtml).toContain('role="menu"');
    // premium §7.12: material-thick + shadow-popover, r-2xl, padding 12; 40 px r-md rows on fill-1 / fill-2
    expect(openHtml).toContain('bg-material-thick');
    expect(openHtml).toContain('shadow-popover');
    expect(openHtml).toContain('rounded-2xl');
    expect(openHtml).toContain('p-3');
    expect(openHtml).toContain('min-h-10');
    expect(openHtml).toContain('rounded-md');
    expect(openHtml).toContain('hover:bg-fill-1');
    expect(openHtml).toContain('enabled:active:bg-fill-2');
    expect(openHtml).toContain('text-ink');
    expect(openHtml).toContain('bg-hairline');
    expect(openHtml).not.toContain('bg-surface-2');
    expect(openHtml).toContain('role="menuitemradio"');
    expect(openHtml).toContain('aria-checked="true"');
    expect(openHtml).toContain('lang="ja"');
    expect(openHtml).toContain('role="menuitem"');
    expect(openHtml).toContain('role="separator"');
    expect(openHtml).toContain('⌘O');

    // Keyboard action resolution
    expect(resolveMenuKeyAction('ArrowDown', 0, 3)).toEqual({
      kind: 'focus',
      index: 1,
    });
    expect(resolveMenuKeyAction('ArrowUp', 0, 3)).toEqual({
      kind: 'focus',
      index: 2,
    });
    expect(resolveMenuKeyAction('Home', 2, 3)).toEqual({
      kind: 'focus',
      index: 0,
    });
    expect(resolveMenuKeyAction('End', 0, 3)).toEqual({
      kind: 'focus',
      index: 2,
    });
    expect(resolveMenuKeyAction('Escape', 1, 3)).toEqual({
      kind: 'close',
      returnFocus: true,
    });
    expect(resolveMenuKeyAction('Enter', 1, 3)).toEqual({
      kind: 'select',
      index: 1,
    });
    expect(resolveMenuKeyAction('Tab', 1, 3)).toEqual({
      kind: 'close',
      returnFocus: false,
    });

    // Typeahead matching by title
    const labels = [
      'Edge-Ring Plasma Etch',
      'Robotic Handling Scratch',
      'Site 2 Probe Contact',
    ];
    expect(matchMenuTypeahead(labels, 'rob', 0)).toBe(1);
    expect(matchMenuTypeahead(labels, 'site', 0)).toBe(2);
    expect(matchMenuTypeahead(labels, 'zzz', 0)).toBe(-1);

    // Viewport-clamped anchor math (360px menu on 390px mobile screen stays inside 8px margin)
    const mobilePos = computeAnchoredMenuPosition({
      triggerRect: { top: 8, bottom: 40, left: 140, right: 250, width: 110 },
      menuWidth: 360,
      viewportWidth: 390,
      align: 'center',
      sideOffset: 8,
    });
    expect(mobilePos.top).toBe(48);
    expect(mobilePos.left).toBeGreaterThanOrEqual(8);
    expect(mobilePos.left + 360).toBeLessThanOrEqual(382);
  });

  it('defines menu, popover, and tooltip surfaces per premium §7.12', () => {
    for (const cls of [MENU_SURFACE_CLASS, POPOVER_SURFACE_CLASS, TOOLTIP_SURFACE_CLASS]) {
      expect(cls).toContain('bg-material-thick');
      expect(cls).toContain('shadow-popover');
      expect(cls).toContain('[backdrop-filter:var(--material-thick-filter)]');
    }
    expect(MENU_SURFACE_CLASS).toContain('rounded-2xl');
    expect(MENU_SURFACE_CLASS).toContain('p-3');
    expect(POPOVER_SURFACE_CLASS).toContain('w-[320px]');
    expect(POPOVER_SURFACE_CLASS).toContain('rounded-lg');
    expect(POPOVER_SURFACE_CLASS).toContain('p-4');
    expect(TOOLTIP_SURFACE_CLASS).toContain('max-w-[240px]');
    expect(TOOLTIP_SURFACE_CLASS).toContain('rounded-sm');
    expect(TOOLTIP_SURFACE_CLASS).toContain('px-2.5 py-1.5');
    expect(TOOLTIP_SURFACE_CLASS).toContain('type-caption text-text-primary');
  });

  it('styles ClinicalToaster (§4.13) at bottom-center with material surface, radius-16, callout/footnote sans tokens, max 3 visible, 8px gap, and 4s duration', () => {
    const html = renderToStaticMarkup(React.createElement(ClinicalToaster));
    expect(html).toBeTruthy();

    expect(SONNER_TOAST_OPTIONS.position).toBe('bottom-center');
    expect(SONNER_TOAST_OPTIONS.visibleToasts).toBe(3);
    expect(SONNER_TOAST_OPTIONS.gap).toBe(8);
    expect(SONNER_TOAST_OPTIONS.duration).toBe(4_000);
    expect(SONNER_TOAST_OPTIONS.offset).toBe(24);
    expect(SONNER_TOAST_OPTIONS.mobileOffset).toBe(16);

    const toastClass = SONNER_TOAST_OPTIONS.classNames.toast;
    expect(toastClass).toContain('surface-material');
    expect(toastClass).toContain('rounded-lg');
    expect(toastClass).toContain('w-[360px]');
    expect(toastClass).toContain('px-4');
    expect(toastClass).toContain('py-3');
    expect(toastClass).not.toContain('border-hairline');

    expect(SONNER_TOAST_OPTIONS.classNames.title).toContain('type-callout');
    expect(SONNER_TOAST_OPTIONS.classNames.description).toContain(
      'type-subhead',
    );
    expect(SONNER_TOAST_OPTIONS.classNames.description).not.toContain(
      'font-mono',
    );
  });

  it('tooltip waits 600 ms, or 0 ms within 400 ms of another closing (premium §7.12)', () => {
    expect(TOOLTIP_DELAY_MS).toBe(600);
    expect(TOOLTIP_SKIP_DELAY_WINDOW_MS).toBe(400);
    expect(resolveTooltipDelayMs(1000, Number.NEGATIVE_INFINITY)).toBe(600);
    expect(resolveTooltipDelayMs(1000, 700)).toBe(0);
    expect(resolveTooltipDelayMs(1000, 500)).toBe(600);
  });

  it('menu triggers share the Button variant classes (premium §7.1, §7.11)', () => {
    const icon = resolveButtonClassName({ variant: 'icon' });
    expect(icon).toContain('size-8');
    expect(icon).toContain('focus-visible:shadow-focus-ring');
    const ghost = resolveButtonClassName({ variant: 'ghost', iconSide: 'start' });
    expect(ghost).toContain('h-8');
    expect(ghost).toContain('pl-2 pr-2.5');
  });
});
