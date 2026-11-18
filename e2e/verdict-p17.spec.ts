import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P17 (premium.md §7.3, §7.4, §9.3): verdict headline, takeaway, and confidence chip.
 * A25 (P17 part): at 1440 x 900 the headline, takeaway, and action row take at most 5 lines, and no
 * bin code, test name, or STDF field name appears above the findings card. A26: the takeaway is at most
 * 2 lines at 1440 with no bin codes or test names, and no exclamation mark appears in the UI.
 */

async function loadDemo(page: Page, presetId: string, width = 1440, height = 900) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width, height });
  await page.goto('/?nohints=1');
  await expect(page.locator('body')).not.toContainText('!');
  await page.getByTestId(`demo-card-${presetId}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 5_000,
  });
  await expect(page.getByTestId('verdict-headline')).toBeVisible();
}

const JARGON = /[HS]BIN\s?\d|IDDQ|_LEAK|_SHORT|CONT_OPEN|\b(PRR|PTR|PIR|WCR|FAR)\b/;

test.describe('Premium P17 - verdict headline, takeaway, confidence chip', () => {
  test.use({ colorScheme: 'light' });

  test('A25 + A26: plain 2-line takeaway, 5 lines for the verdict blocks, no jargon or exclamation marks', async ({
    page,
  }) => {
    await loadDemo(page, 'edge-ring-etch');

    const takeaway = page.getByTestId('verdict-subline');
    await expect(takeaway).toHaveText(
      'Most failing dies sit in the outer 3 rings of every wafer. Final yield is 82.8%.',
    );

    const audit = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('[data-testid="autopsy-report-card"]')!;
      const top = document.querySelector<HTMLElement>('[data-testid="verdict-top-block"]')!;
      const findings = document.querySelector<HTMLElement>(
        '[data-testid="verdict-findings-list"]',
      )!;
      const takeawayEl = document.querySelector<HTMLElement>('[data-testid="verdict-subline"]')!;
      const headline = document.querySelector<HTMLElement>('[data-testid="verdict-headline"]')!;
      const lineHeight = (el: HTMLElement) => Number.parseFloat(getComputedStyle(el).lineHeight);

      // Distinct visual text lines (grouped by top) in the verdict, takeaway, and action row
      const tops: number[] = [];
      const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
      const findingsTop = findings.getBoundingClientRect().top;
      const textAboveFindings: string[] = [];
      for (const el of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
        if (el.closest('[data-testid="verdict-findings-list"]')) continue;
        if (el.getBoundingClientRect().bottom <= findingsTop && el.children.length === 0) {
          textAboveFindings.push(el.textContent ?? '');
        }
      }
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent || node.textContent.trim().length === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          if (r.height < 8 || r.width < 2 || r.top >= window.innerHeight) continue;
          if (!tops.some((t) => Math.abs(t - r.top) < 6)) tops.push(r.top);
        }
      }
      return {
        lines: tops.length,
        takeawayLines: takeawayEl.getBoundingClientRect().height / lineHeight(takeawayEl),
        takeawayWidth: takeawayEl.getBoundingClientRect().width,
        headlineLines: headline.getBoundingClientRect().height / lineHeight(headline),
        headlineWidth: headline.getBoundingClientRect().width,
        textAboveFindings: textAboveFindings.join(' '),
        bodyText: document.body.innerText,
      };
    });

    expect(audit.takeawayLines).toBeLessThanOrEqual(2.1);
    expect(audit.takeawayWidth).toBeLessThanOrEqual(520);
    expect(audit.headlineLines).toBeLessThanOrEqual(2.1);
    expect(audit.headlineWidth).toBeLessThanOrEqual(520);
    // The P17 blocks (headline 2 + takeaway 2 + action row 1) spend 5 of the 14-line A25 budget;
    // stats and findings (P18, P19) take the rest and are counted in the P35 acceptance run.
    expect(audit.lines).toBeLessThanOrEqual(5);
    expect(audit.textAboveFindings).not.toMatch(JARGON);
    expect(audit.bodyText).not.toContain('!');
  });

  test('§7.3 cause phrase: ember-ink, hover underline, selected only when it lit the dies', async ({
    page,
  }) => {
    await loadDemo(page, 'edge-ring-etch');
    const cause = page.getByTestId('autopsy-headline-button');
    const show = page.getByTestId('verdict-show-on-wafer');
    const overlay = page.getByTestId('wafer-overlay-wrapper');

    await expect(cause).toHaveCSS('color', 'rgb(217, 78, 20)');
    await expect(cause).toHaveCSS('text-decoration-line', 'none');
    await cause.hover();
    await expect(cause).toHaveCSS('text-decoration-line', 'underline');
    await expect(cause).toHaveCSS('text-underline-offset', '6px');
    await expect(cause).toHaveCSS('text-decoration-thickness', '1.5px');

    // The primary "Show on wafer" lights the verdict dies without selecting the phrase
    await expect(page.locator('button[data-variant="primary"]:visible')).toHaveCount(1);
    await show.click();
    await expect(overlay).not.toHaveAttribute('data-highlight-count', '0');
    await expect(cause).toHaveAttribute('aria-pressed', 'false');

    // Clicking the phrase takes over the lit verdict and shows the selected underline
    await cause.click();
    await expect(cause).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay).not.toHaveAttribute('data-highlight-count', '0');
    await page.mouse.move(5, 500);
    await expect(cause).toHaveCSS('text-decoration-line', 'underline');

    // A second click clears it
    await cause.click();
    await expect(cause).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
  });

  test('§7.4 confidence chip: ghost pill next to the primary and the "How this verdict was made" popover', async ({
    page,
  }) => {
    await loadDemo(page, 'edge-ring-etch');
    const chip = page.getByTestId('confidence-pill');
    const show = page.getByTestId('verdict-show-on-wafer');

    await expect(chip).toHaveText('High confidence, 0.95');
    await expect(chip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(chip).toHaveCSS('font-size', '14px');
    const [chipBox, showBox] = [await chip.boundingBox(), await show.boundingBox()];
    expect(Math.round(chipBox!.height)).toBe(28);
    expect(Math.round(showBox!.height)).toBe(40);
    expect(Math.round(chipBox!.x - (showBox!.x + showBox!.width))).toBe(16);
    expect(
      Math.abs(chipBox!.y + chipBox!.height / 2 - (showBox!.y + showBox!.height / 2)),
    ).toBeLessThanOrEqual(1);

    await chip.click();
    const popover = page.getByTestId('confidence-popover');
    await expect(popover).toBeVisible();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(popover).toContainText('How this verdict was made');
    await expect(popover).toContainText(
      'How strongly the wafer pattern matches the named class, from 0 to 1. Computed on this device.',
    );
    await expect(page.getByTestId('confidence-match')).toContainText('Match with Edge-Ring');
    await expect(page.getByTestId('confidence-match')).toContainText('0.95');
    // Measure layout boxes (the open spring scales the popover from 0.97)
    const pop = await popover.evaluate((el: HTMLElement) => ({
      width: el.offsetWidth,
      top: Number.parseFloat(el.style.top),
    }));
    expect(pop.width).toBe(320);
    expect(Math.round(pop.top - (chipBox!.y + chipBox!.height))).toBe(8);
    const ratio = await page.getByTestId('confidence-match-bar').evaluate((el) => {
      return el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width;
    });
    expect(Math.abs(ratio - 0.95)).toBeLessThanOrEqual(0.01);

    // Never orange
    const colors = await popover.evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('*')).map((el) => getComputedStyle(el).color),
    );
    for (const c of colors) {
      expect(['rgb(255, 107, 44)', 'rgb(232, 89, 30)', 'rgb(217, 78, 20)']).not.toContain(c);
    }

    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test('§7.4 site verdict: no match row; dark theme uses the dark ember-ink', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await loadDemo(page, 'site2-probe-contact');
    await expect(page.getByTestId('verdict-subline')).toHaveText(
      'Test site 2 fails 40.6% of its dies, the other sites fail 3.1%. Final yield is 89.5%.',
    );
    await expect(page.getByTestId('autopsy-headline-button')).toHaveCSS(
      'color',
      'rgb(255, 138, 87)',
    );
    await page.getByTestId('confidence-pill').click();
    await expect(page.getByTestId('confidence-popover')).toBeVisible();
    await expect(page.getByTestId('confidence-match')).toHaveCount(0);
    await context.close();
  });
});
