import { expect, type Page, test } from '@playwright/test';

/**
 * Task 19 Accessibility & Copy Pass E2E Verification (`e2e/a11y-t19.spec.ts`):
 * - Requirements 14.1, 14.2, 14.3, 14.4, 17.4; `premium.md` §3.2, §5.3, §7.7, §9;
 *   `logs/visual-acceptance.md` Task 19 visual defect fixes.
 *
 * Covers:
 * 1. Full keyboard path: landing -> report -> wafer stage -> Pareto -> Cmd/Ctrl-K palette -> clear.
 *    Verifies `:focus-visible` ring token on light (`#201E1F`) and dark (`rgba(255, 255, 255, 0.92)`),
 *    and stage `::after` 2 px inset ink ring (zero outer rectangle).
 * 2. Visually hidden screen-reader tables (`wafer-sr-table`, `bin-pareto-sr-table`,
 *    `stacked-heatmap-sr-table`, `parametric-histogram-sr-table`) with captions, scopes, and row counts > 0.
 * 3. `aria-live="polite"` announcements across parse completion, claim/narration transitions
 *    (mocked 200 verified + 503 fallback), filter updates/clears, wafer selection, and die pinning.
 * 4. Computed-style WCAG 2.2 AA contrast audit in both light and dark themes across landing
 *    and loaded report, plus non-colour cues on pass/fail/bin/limit marks.
 * 5. Task 19 visual defect fixes: warm paper nav material (`rgba(246, 243, 238, 0.8)`),
 *    skip hint outside the wafer disc during sweep and hidden after, and clinical copy (no `!`).
 */

interface ContrastViolation {
  readonly selector: string;
  readonly text: string;
  readonly fg: string;
  readonly bg: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly ratio: number;
  readonly required: number;
}

/**
 * Evaluates WCAG 2.2 AA text contrast across all visible text-bearing elements on the page
 * using computed styles (alpha-compositing foreground and ancestor background colors down to
 * the document body background). No external axe package required.
 */
async function auditVisibleTextContrast(page: Page): Promise<{
  readonly checkedCount: number;
  readonly violations: readonly ContrastViolation[];
}> {
  return page.evaluate(() => {
    interface Rgba {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    const parseColor = (raw: string): Rgba | null => {
      const m = raw.match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/,
      );
      if (!m) return null;
      return {
        r: Number(m[1]),
        g: Number(m[2]),
        b: Number(m[3]),
        a: m[4] === undefined ? 1 : Number(m[4]),
      };
    };

    const composite = (fg: Rgba, bg: Rgba): Rgba => {
      const a = fg.a + bg.a * (1 - fg.a);
      if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };

    const channelLum = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };

    const luminance = (c: Rgba): number =>
      0.2126 * channelLum(c.r) +
      0.7152 * channelLum(c.g) +
      0.0722 * channelLum(c.b);

    const contrastRatio = (c1: Rgba, c2: Rgba): number => {
      const l1 = luminance(c1);
      const l2 = luminance(c2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const bodyBg =
      parseColor(getComputedStyle(document.body).backgroundColor) ?? {
        r: 246,
        g: 243,
        b: 238,
        a: 1,
      };

    const resolveEffectiveBg = (el: HTMLElement): Rgba => {
      const layers: Rgba[] = [];
      let cur: HTMLElement | null = el;
      while (cur && cur !== document.documentElement) {
        const bg = parseColor(getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0) {
          layers.push(bg);
          if (bg.a >= 0.999) break;
        }
        cur = cur.parentElement;
      }
      let acc: Rgba = { ...bodyBg, a: 1 };
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        acc = composite(layers[i]!, acc);
      }
      return acc;
    };

    const isHiddenOrDisabled = (el: HTMLElement): boolean => {
      let cur: HTMLElement | null = el;
      while (cur && cur !== document.body) {
        if (
          cur.hidden ||
          cur.getAttribute('aria-hidden') === 'true' ||
          cur.getAttribute('aria-disabled') === 'true' ||
          cur.matches(':disabled') ||
          cur.classList.contains('sr-only')
        ) {
          return true;
        }
        const cs = getComputedStyle(cur);
        if (
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          Number(cs.opacity) < 0.05
        ) {
          return true;
        }
        // Inactive or hidden legend entries intentionally use disabled/line-through styling
        if (cs.textDecorationLine.includes('line-through')) {
          return true;
        }
        cur = cur.parentElement;
      }
      const rect = el.getBoundingClientRect();
      return rect.width <= 1 || rect.height <= 1;
    };

    let checkedCount = 0;
    const violations: ContrastViolation[] = [];

    const all = document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, p, a, button, span, th, td, label, li, kbd',
    );
    for (const el of all) {
      // Only audit elements with direct non-whitespace text nodes
      let directText = '';
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          directText += node.textContent ?? '';
        }
      }
      const trimmed = directText.trim();
      if (!trimmed) continue;
      if (isHiddenOrDisabled(el)) continue;

      const cs = getComputedStyle(el);
      const fgRaw = parseColor(cs.color);
      if (!fgRaw) continue;
      const bg = resolveEffectiveBg(el);
      const fg = composite(fgRaw, bg);
      const ratio = contrastRatio(fg, bg);
      const fontSize = Number.parseFloat(cs.fontSize) || 14;
      const fontWeight = Number.parseInt(cs.fontWeight, 10) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 600);
      const required = isLarge ? 3.0 : 4.5;
      checkedCount += 1;

      if (ratio + 0.02 < required) {
        const tid = el.getAttribute('data-testid');
        violations.push({
          selector: tid ? `[data-testid="${tid}"]` : el.tagName.toLowerCase(),
          text: trimmed.slice(0, 48),
          fg: cs.color,
          bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          fontSize,
          fontWeight,
          ratio: Number(ratio.toFixed(2)),
          required,
        });
      }
    }

    return { checkedCount, violations };
  });
}

async function openLanding(
  page: Page,
  theme: 'light' | 'dark',
  opts: { readonly skipSweep?: boolean; readonly narrate?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ t, skip }) => {
      window.localStorage.setItem('cal.theme', t);
      if (skip) {
        window.sessionStorage.setItem('cal.sweep.v1', '1');
      }
    },
    { t: theme, skip: opts.skipSweep ?? true },
  );
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(opts.narrate ? '/?nohints=1&narrate=1' : '/?nohints=1');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.getByTestId('landing-headline')).toBeVisible();
}

test.describe('Task 19 - Accessibility, keyboard operability, contrast, and copy pass', () => {
  test('1. Keyboard path through landing -> report -> stage -> Pareto -> Cmd/Ctrl-K palette with focus-ring token', async ({
    page,
  }) => {
    await openLanding(page, 'light');

    // Tab through landing controls until landing-open-sample-button receives keyboard focus
    const openSampleBtn = page.getByTestId('landing-open-sample-button');
    let focusedSample = false;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      if (await openSampleBtn.evaluate((el) => document.activeElement === el)) {
        focusedSample = true;
        break;
      }
    }
    expect(focusedSample, 'Tab reaches landing-open-sample-button').toBe(true);

    // Light theme focus-ring token uses warm ink #201E1F (rgb(32, 30, 31))
    const sampleRing = await openSampleBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { boxShadow: cs.boxShadow, outlineStyle: cs.outlineStyle };
    });
    expect(sampleRing.boxShadow).toContain('rgb(32, 30, 31)');
    expect(sampleRing.boxShadow).toContain('4px');

    // Activate via Enter -> loads sample lot report
    await page.keyboard.press('Enter');
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 8_000 });
    await expect(page.getByTestId('verdict-headline')).toBeVisible();

    // Parse-complete polite live announcement includes verdict, lot ID, and formatted yield
    const appLive = page.getByTestId('app-live-region');
    await expect(appLive).toHaveAttribute('aria-live', 'polite');
    await expect(appLive).toContainText(/Edge-Ring/);
    await expect(appLive).toContainText(/%/);

    // Keyboard activation of verdict cause phrase -> lights evidence & updates autopsy-live-region
    const causeBtn = page.getByTestId('autopsy-headline-button');
    await causeBtn.focus();
    await page.keyboard.press('Enter');
    await expect(causeBtn).toHaveAttribute('aria-pressed', 'true');
    const autopsyLive = page.getByTestId('autopsy-live-region');
    await expect(autopsyLive).toHaveAttribute('aria-live', 'polite');
    await expect(autopsyLive).toContainText(/dies/);

    // Keyboard focus on wafer-stage uses ONLY its ::after inset 2 px ink ring (no outer box-shadow)
    await page
      .getByTestId('stage-mode-segmented')
      .getByRole('radio', { checked: true })
      .focus();
    let stageFocused = false;
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Shift+Tab');
      if (await stage.evaluate((el) => document.activeElement === el)) {
        stageFocused = true;
        break;
      }
    }
    expect(stageFocused, 'Shift+Tab reaches wafer-stage').toBe(true);
    const stageFocusRing = await stage.evaluate((el) => {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      return {
        boxShadow: cs.boxShadow,
        afterOutlineWidth: after.outlineWidth,
        afterOutlineColor: after.outlineColor,
        afterRadius: after.borderTopLeftRadius,
      };
    });
    // Tailwind ring utilities leave transparent zero-size shadows; any visible outer shadow is a fail
    expect(stageFocusRing.boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?/g, '').trim() || 'none').toBe('none');
    expect(stageFocusRing.afterOutlineWidth).toBe('2px');
    expect(stageFocusRing.afterOutlineColor).toBe('rgb(32, 30, 31)');
    expect(stageFocusRing.afterRadius).toBe('28px');

    // Keyboard die stepping, pinning, zoom, and reset on the wafer stage
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    const stageLive = page.getByTestId('stage-live-region');
    await expect(stageLive).toHaveAttribute('aria-live', 'polite');
    await expect(stageLive).toContainText(/Die at X .* Y .*: .*, SBIN/);
    const selectionLive = page.getByTestId('selection-live-region');
    await expect(selectionLive).toHaveAttribute('aria-live', 'polite');

    await page.keyboard.press('+');
    await expect(page.getByTestId('stage-reset-view')).toBeVisible();
    await page.keyboard.press('0');
    await expect(page.getByTestId('stage-reset-view')).toBeHidden();

    // Keyboard wafer switch via wafer strip announces the newly selected wafer
    const activeWaferOption = page
      .getByTestId('wafer-strip')
      .locator('[role="option"][aria-selected="true"]');
    await activeWaferOption.focus();
    await page.keyboard.press('ArrowRight');
    await expect(selectionLive).toContainText(/Wafer W02, .* tested, .* failed\./);

    // Keyboard Bin Pareto selection toggles filter and updates selection-live-region
    const firstParetoRow = page.getByTestId('bin-pareto-row').first();
    await firstParetoRow.focus();
    await page.keyboard.press('Enter');
    await expect(firstParetoRow).toHaveAttribute('aria-pressed', 'true');
    await expect(selectionLive).toContainText(/Filter updated: .* selected\./);
    // Toggle off via keyboard
    await page.keyboard.press('Enter');
    await expect(selectionLive).toContainText(/Filters cleared\. Showing all/);

    // Command palette via Ctrl+K: ARIA dialog + listbox, filter apply + Escape clear
    await page.keyboard.press('Control+k');
    const paletteDialog = page.getByTestId('command-palette');
    await expect(paletteDialog).toBeVisible();
    await expect(paletteDialog).toHaveAttribute('role', 'dialog');
    await expect(page.getByTestId('command-palette-list')).toHaveAttribute(
      'role',
      'listbox',
    );
    await page.getByTestId('command-palette-input').fill('only bin 7');
    await page.keyboard.press('Enter');
    await expect(paletteDialog).toHaveCount(0);
    await expect(page.getByTestId('dsl-filter-chip').first()).toBeVisible();
    await expect(selectionLive).toContainText(/Filter updated: .* selected\./);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dsl-filter-chip')).toHaveCount(0);
    await expect(selectionLive).toContainText(/Filters cleared\. Showing all/);
  });

  test('2. Screen-reader tables for wafer canvas, Pareto, stacked heatmap, and parametric histogram', async ({
    page,
  }) => {
    await openLanding(page, 'light');
    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('wafer-stage')).toHaveAttribute(
      'data-sweep',
      'done',
      { timeout: 8_000 },
    );

    const tableIds = [
      'wafer-sr-table',
      'bin-pareto-sr-table',
      'stacked-heatmap-sr-table',
      'parametric-histogram-sr-table',
    ] as const;

    for (const id of tableIds) {
      const table = page.getByTestId(id);
      await expect(table, `${id} attached`).toHaveCount(1);
      const audit = await table.evaluate((el) => {
        const caption = el.querySelector('caption')?.textContent?.trim() ?? '';
        const colHeaders = el.querySelectorAll('thead th[scope="col"]').length;
        const rowHeaders = el.querySelectorAll('tbody th[scope="row"]').length;
        const rows = el.querySelectorAll('tbody tr').length;
        const srEl = el.closest('.sr-only') as HTMLElement | null;
        const cs = srEl ? getComputedStyle(srEl) : getComputedStyle(el);
        const visuallyHidden =
          srEl !== null &&
          cs.position === 'absolute' &&
          Number.parseFloat(cs.width) <= 1 &&
          Number.parseFloat(cs.height) <= 1;
        return { caption, colHeaders, rowHeaders, rows, visuallyHidden };
      });
      expect(audit.visuallyHidden, `${id} is visually hidden (sr-only)`).toBe(true);
      expect(audit.caption.length, `${id} has caption`).toBeGreaterThan(0);
      expect(audit.colHeaders, `${id} has col headers`).toBeGreaterThanOrEqual(2);
      expect(audit.rows, `${id} has data rows`).toBeGreaterThan(0);
      expect(audit.rowHeaders, `${id} has row headers`).toBe(audit.rows);
    }

    // Non-colour cues check: legend swatches paired with text + counts, histogram limits have LO/HI text
    await page.getByTestId('stage-mode-segmented').getByRole('radio', { name: 'Soft bins' }).click();
    const legendLabels = await page
      .getByTestId('stage-legend')
      .locator('[data-legend-label]')
      .allTextContents();
    expect(legendLabels.some((label) => /SBIN \d+/.test(label))).toBe(true);

    const hist = page.getByTestId('parametric-histogram');
    await expect(hist).toContainText(/LO /);
    await expect(hist).toContainText(/HI /);
  });

  test('3. aria-live announces verified LLM narration and deterministic fallback transitions', async ({
    page,
  }) => {
    // 3a: Verified LLM narration
    await page.route('**/api/autopsy/narrate', async (route) => {
      const payload = route.request().postDataJSON() as {
        readonly outboundFacts: ReadonlyArray<{
          readonly factId: string;
          readonly kind: string;
          readonly dieCount: number;
        }>;
      };
      const spatialFact = payload.outboundFacts.find(
        (f) => f.kind === 'spatial-pattern',
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          claims: spatialFact
            ? [
                {
                  id: 'claim:primary-evidence',
                  text: `Verified narration: ${spatialFact.dieCount} failing dies form the outer ring.`,
                  citedFactIds: [spatialFact.factId],
                },
              ]
            : [],
        }),
      });
    });

    await openLanding(page, 'light', { narrate: true });
    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('autopsy-report-card')).toHaveAttribute(
      'data-narration-status',
      'verified',
      { timeout: 5_000 },
    );
    await expect(page.getByTestId('autopsy-live-region')).toContainText(
      'AI summary verified against cited engine facts.',
    );

    // 3b: 503 fallback on lot switch announces built-in template summary
    await page.unroute('**/api/autopsy/narrate');
    await page.route('**/api/autopsy/narrate', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'LLM narrator not configured' }),
      });
    });
    await page.getByTestId('lot-picker-trigger').click();
    await page.getByTestId('lot-picker-row-handling-scratch').click();
    await expect(page.getByTestId('autopsy-report-card')).toHaveAttribute(
      'data-narration-status',
      'fallback',
      { timeout: 5_000 },
    );
    await expect(page.getByTestId('autopsy-live-region')).toContainText(
      'Showing built-in template summary.',
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`4. WCAG 2.2 AA computed-style contrast audit and clinical copy on ${theme} theme`, async ({
      page,
    }) => {
      await openLanding(page, theme);

      // Landing contrast + clinical copy (no exclamation marks)
      const landingContrast = await auditVisibleTextContrast(page);
      expect(landingContrast.checkedCount).toBeGreaterThan(10);
      expect(
        landingContrast.violations,
        `landing ${theme} contrast violations`,
      ).toEqual([]);
      expect(
        await page.evaluate(() => /[!！]/.test(document.body.innerText)),
      ).toBe(false);

      // Dark theme focus ring check
      if (theme === 'dark') {
        const openBtn = page.getByTestId('landing-open-sample-button');
        await openBtn.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const darkRing = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          return active ? getComputedStyle(active).boxShadow : '';
        });
        expect(darkRing).toContain('rgba(255, 255, 255, 0.92)');
      }

      // Loaded report contrast + clinical copy
      await page.getByTestId('demo-card-edge-ring-etch').click();
      await expect(page.getByTestId('wafer-stage')).toHaveAttribute(
        'data-sweep',
        'done',
        { timeout: 8_000 },
      );
      await expect(page.getByTestId('verdict-headline')).toBeVisible();
      // Wait for verdict rise-in blocks to reach opacity 1 so every block is audited
      await page.waitForFunction(() => {
        const blocks = document.querySelectorAll<HTMLElement>(
          '[data-verdict-rise-block]',
        );
        return (
          blocks.length === 6 &&
          Array.from(blocks).every((el) => getComputedStyle(el).opacity === '1')
        );
      });

      const reportContrast = await auditVisibleTextContrast(page);
      expect(reportContrast.checkedCount).toBeGreaterThan(30);
      expect(
        reportContrast.violations,
        `report ${theme} contrast violations`,
      ).toEqual([]);
      expect(
        await page.evaluate(() => /[!！]/.test(document.body.innerText)),
      ).toBe(false);
    });
  }

  test('5. Task 19 visual defect fixes: warm paper nav bar and non-overlapping probe-sweep skip hint', async ({
    page,
  }) => {
    await openLanding(page, 'light', { skipSweep: false });

    // Nav bar uses warm paper material rgba(246, 243, 238, 0.8), not cold white rgba(250, 250, 252, 0.8)
    const navBg = await page
      .getByTestId('nav-bar')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(navBg).toBe('rgba(246, 243, 238, 0.8)');

    // During first-session probe sweep, skip hint is visible above the wafer stage (never overlapping disc)
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'running', {
      timeout: 8_000,
    });
    const skipHint = page.getByTestId('probe-sweep-skip-hint');
    await expect(skipHint).toBeVisible();

    const boxes = await page.evaluate(() => {
      const hint = document
        .querySelector<HTMLElement>('[data-testid="probe-sweep-skip-hint"]')!
        .getBoundingClientRect();
      const stageRect = document
        .querySelector<HTMLElement>('[data-testid="wafer-stage"]')!
        .getBoundingClientRect();
      return {
        hintBottom: hint.bottom,
        stageTop: stageRect.top,
      };
    });
    expect(boxes.hintBottom).toBeLessThanOrEqual(boxes.stageTop + 1);

    // Once sweep completes, skip hint is hidden
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 8_000 });
    await expect(skipHint).toBeHidden();
  });
});
