import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
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
import { ClinicalToaster, SONNER_TOAST_OPTIONS } from './toaster';

describe('Button, SegmentedControl, and DropdownMenu primitives (Task R3)', () => {
  it('restyles Button across §4.11 variants with pill radius, ice 2px focus rings, optical icon padding, and zero transition:all', () => {
    const primaryHtml = renderToStaticMarkup(
      React.createElement(Button, { variant: 'primary' }, 'Open STDF file'),
    );
    expect(primaryHtml).toContain('rounded-pill');
    expect(primaryHtml).toContain('bg-button-primary');
    expect(primaryHtml).toContain('text-button-primary-text');
    expect(primaryHtml).toContain('h-11');
    expect(primaryHtml).toContain('px-[22px]');
    expect(primaryHtml).toContain('text-[15px]');
    expect(primaryHtml).toContain('font-[590]');
    expect(primaryHtml).toContain('focus-visible:outline-2');
    expect(primaryHtml).toContain('focus-visible:outline-offset-2');
    expect(primaryHtml).toContain('focus-visible:outline-accent');
    expect(primaryHtml).not.toContain('transition-all');
    expect(primaryHtml).not.toMatch(/\bfont-(bold|extrabold|black)\b/);

    const secondaryNavHtml = renderToStaticMarkup(
      React.createElement(
        Button,
        { variant: 'secondary', size: 'sm' },
        'Open STDF',
      ),
    );
    expect(secondaryNavHtml).toContain('h-8');
    expect(secondaryNavHtml).toContain('px-[14px]');
    expect(secondaryNavHtml).toContain('bg-white/10');
    expect(secondaryNavHtml).toContain('text-text-primary');

    const secondaryLgHtml = renderToStaticMarkup(
      React.createElement(
        Button,
        { variant: 'secondary', size: 'lg' },
        'Parse everything',
      ),
    );
    expect(secondaryLgHtml).toContain('h-11');
    expect(secondaryLgHtml).toContain('px-5');

    const ghostHtml = renderToStaticMarkup(
      React.createElement(
        Button,
        { variant: 'ghost', iconSide: 'start' },
        'EN',
      ),
    );
    expect(ghostHtml).toContain('h-8');
    // Optical alignment: 2px less padding on leading icon side (8px left vs 10px right)
    expect(ghostHtml).toContain('pl-2');
    expect(ghostHtml).toContain('pr-2.5');
    expect(ghostHtml).toContain('text-text-secondary');

    const textHtml = renderToStaticMarkup(
      React.createElement(Button, { variant: 'text' }, 'Clear'),
    );
    expect(textHtml).toContain('after:-inset-2');
    expect(textHtml).toContain('p-0');

    const iconHtml = renderToStaticMarkup(
      React.createElement(
        Button,
        { variant: 'icon', 'aria-label': 'Change language' },
        React.createElement('svg', { 'aria-hidden': 'true' }),
      ),
    );
    expect(iconHtml).toContain('h-11');
    expect(iconHtml).toContain('w-11');
    expect(iconHtml).toContain('md:h-8');
    expect(iconHtml).toContain('md:w-8');
    expect(iconHtml).toContain('aria-label="Change language"');

    const disabledHtml = renderToStaticMarkup(
      React.createElement(
        Button,
        { variant: 'secondary', disabled: true },
        'Disabled',
      ),
    );
    expect(disabledHtml).toContain('aria-disabled="true"');
    expect(disabledHtml).toContain('disabled:opacity-40');
    expect(disabledHtml).toContain('disabled:cursor-not-allowed');
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
    expect(html).toContain('surface-material');
    expect(html).toContain('rounded-pill');
    expect(html).toContain('h-7');
    expect(html).toContain('md:h-8');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('bg-surface-3');
    expect(html).toContain('focus-visible:outline-accent');

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
    expect(openHtml).toContain('surface-material');
    expect(openHtml).toContain('rounded-2xl');
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
      'type-footnote',
    );
    expect(SONNER_TOAST_OPTIONS.classNames.description).not.toContain(
      'font-mono',
    );
  });
});
