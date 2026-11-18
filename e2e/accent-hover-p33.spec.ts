import { expect, type Page, test } from '@playwright/test';
import { writeStdfBytes } from '../src/core/stdf/stdf-writer';

/**
 * Premium P33 (premium.md §3.4, §8.9, §1.3): accent and hover audit.
 * - A3: in the loaded view at 1440, ember-family elements outside the wafer canvases,
 *   thumbnails, legend swatches, and magnifier swatch are at most 2 per viewport (cause phrase and
 *   dominant Pareto bar); a healthy lot has 0.
 * - A4: stat numbers, finding text, legend labels, buttons, focus rings, toasts, and hints are
 *   never ember; stat numbers compute to `text-primary`.
 * - §8.9: no live `transition: all`; every `:hover` rule sits behind `@media (hover: hover)` and
 *   changes only the §8.9 properties.
 */

const TEXT_PRIMARY = { light: 'rgb(32, 30, 31)', dark: 'rgba(255, 255, 255, 0.92)' } as const;

type EmberHit = { id: string; prop: string; text: string };

/** Ember-family hits in the viewport (or inside `scope`), outside the data exclusions (A3). */
function auditEmber(page: Page, scope = 'body'): Promise<EmberHit[]> {
  return page.evaluate((scopeSelector) => {
    const EMBER = ['255,107,44', '232,89,30', '217,78,20', '255,138,87'];
    const isEmber = (value: string): boolean => {
      for (const m of value.matchAll(/rgba?\(([^)]+)\)/g)) {
        const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
        const [r, g, b] = parts;
        const a = parts.length > 3 ? parts[3]! : 1;
        if (a > 0 && EMBER.includes(`${r},${g},${b}`)) return true;
      }
      return false;
    };
    // Data exclusions per A3 (and the A4 data key): wafer canvases, thumbnails, legend swatches,
    // magnifier swatch.
    const EXCLUDE =
      'canvas, [data-legend-swatch], [data-magnifier-swatch], [data-testid="wafer-strip"] [role="option"], [data-testid="lot-picker-demo-thumb"]';
    const hasOwnText = (el: Element) =>
      Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
      );
    const hits: EmberHit[] = [];
    const hitEls: Element[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of Array.from(document.querySelectorAll<HTMLElement | SVGElement>(`${scopeSelector} *`))) {
      if (el.closest(EXCLUDE)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible' || cs.display === 'none') continue;
      let o: Element | null = el;
      let hidden = false;
      while (o) {
        if (Number(getComputedStyle(o).opacity) === 0) {
          hidden = true;
          break;
        }
        o = o.parentElement;
      }
      if (hidden) continue;
      const props: string[] = [];
      if (hasOwnText(el) && isEmber(cs.color)) props.push('color');
      if (isEmber(cs.backgroundColor)) props.push('background-color');
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        if (
          parseFloat(cs[`border${side}Width`]) > 0 &&
          cs[`border${side}Style`] !== 'none' &&
          isEmber(cs[`border${side}Color`])
        ) {
          props.push('border');
          break;
        }
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && isEmber(cs.outlineColor))
        props.push('outline');
      if (isEmber(cs.boxShadow)) props.push('box-shadow');
      if (cs.textDecorationLine !== 'none' && isEmber(cs.textDecorationColor) && hasOwnText(el))
        props.push('text-decoration');
      if (el instanceof SVGElement && (isEmber(cs.fill) || isEmber(cs.stroke))) props.push('svg');
      for (const pseudo of ['::before', '::after'] as const) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === 'none' || ps.content === 'normal') continue;
        if (isEmber(ps.backgroundColor) || isEmber(ps.boxShadow) || isEmber(ps.borderTopColor))
          props.push(pseudo);
      }
      if (props.length === 0) continue;
      // One element per accent: a nested run inside an ember element is the same use
      if (hitEls.some((h) => h.contains(el))) continue;
      hitEls.push(el);
      const tagged = el.closest('[data-testid]');
      hits.push({
        id: tagged?.getAttribute('data-testid') ?? el.tagName.toLowerCase(),
        prop: props.join('+'),
        text: (el.textContent ?? '').trim().slice(0, 40),
      });
    }
    return hits;
  }, scope);
}

/** The budgeted ember uses (§3.4): the verdict cause phrase and the dominant Pareto bar. */
const BUDGETED = ['autopsy-headline-button', 'bin-pareto-bar'];

function expectWithinBudget(hits: EmberHit[], where: string) {
  expect(hits.length, `${where}: ${JSON.stringify(hits)}`).toBeLessThanOrEqual(2);
  for (const hit of hits) expect(BUDGETED, `${where}: ${JSON.stringify(hit)}`).toContain(hit.id);
}

/**
 * §8.9 stylesheet and computed-style audit. Sonner's injected sheet is third-party and its hover
 * rules are inert here (`unstyled` toasts, `theme="light"`), so only our sheets are read.
 */
function auditTransitionsAndHover(page: Page) {
  return page.evaluate(() => {
    const ALLOWED_TRANSITION = new Set([
      'transform',
      'translate',
      'scale',
      'rotate',
      'opacity',
      'background-color',
      'color',
      'text-decoration-color',
    ]);
    // Hover may change fills, colours, opacity, transform, the cause-phrase underline, and the
    // timing of its own transition; `content` and custom properties are Tailwind plumbing.
    const ALLOWED_HOVER = new Set([
      ...ALLOWED_TRANSITION,
      'text-decoration-line',
      'transition-duration',
      'content',
    ]);
    const problems: string[] = [];
    const walk = (rules: CSSRuleList, gated: boolean) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          walk(rule.cssRules, gated || /\(hover:\s*hover\)/.test(rule.conditionText));
          continue;
        }
        if (rule instanceof CSSStyleRule) {
          const transition = `${rule.style.getPropertyValue('transition')} ${rule.style.getPropertyValue('transition-property')}`;
          if (/(^|[\s,])all([\s,]|$)/.test(transition)) problems.push(`all: ${rule.selectorText}`);
          if (rule.selectorText.includes(':hover')) {
            if (!gated) problems.push(`ungated hover: ${rule.selectorText}`);
            for (const prop of Array.from(rule.style)) {
              if (!prop.startsWith('--') && !ALLOWED_HOVER.has(prop))
                problems.push(`hover property ${prop}: ${rule.selectorText}`);
            }
          }
          if (rule.cssRules?.length) walk(rule.cssRules, gated);
          continue;
        }
        if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules, gated);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      const node = sheet.ownerNode;
      if (!sheet.href && node?.textContent?.includes('[data-sonner-toaster]')) continue;
      walk(sheet.cssRules, false);
    }
    for (const el of Array.from(document.querySelectorAll<Element>('*'))) {
      const cs = getComputedStyle(el);
      const props = cs.transitionProperty.split(',').map((p) => p.trim());
      const durations = cs.transitionDuration.split(',').map((d) => parseFloat(d));
      props.forEach((prop, i) => {
        if ((durations[i % durations.length] ?? 0) === 0) return;
        if (!ALLOWED_TRANSITION.has(prop)) {
          problems.push(`computed ${prop}: ${el.getAttribute('data-testid') ?? el.tagName}`);
        }
      });
    }
    return problems;
  });
}

async function scrollStops(page: Page): Promise<number[]> {
  const { total, vh } = await page.evaluate(() => ({
    total: document.documentElement.scrollHeight,
    vh: window.innerHeight,
  }));
  const stops: number[] = [];
  for (let y = 0; y < total - vh; y += Math.round(vh / 2)) stops.push(y);
  stops.push(Math.max(0, total - vh));
  return stops;
}

async function loadDemo(page: Page, presetId: string) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await page.getByTestId(`demo-card-${presetId}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 5_000,
  });
  await expect(page.getByTestId('bin-pareto-rows')).toBeAttached();
  await page.waitForTimeout(900); // verdict rise-in and count-up settle
}

/** A 21-column round wafer where every die passes (final yield 100 %). */
function healthyLotBytes(): number[] {
  const parts: {
    headNum: number;
    siteNum: number;
    partFlg: number;
    hardBin: number;
    softBin: number;
    xCoord: number;
    yCoord: number;
  }[] = [];
  for (let y = -10; y <= 10; y += 1) {
    for (let x = -10; x <= 10; x += 1) {
      if (x * x + y * y > 100) continue;
      parts.push({
        headNum: 1,
        siteNum: (parts.length & 1) + 1,
        partFlg: 0,
        hardBin: 1,
        softBin: 1,
        xCoord: x,
        yCoord: y,
      });
    }
  }
  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'CLEAN-LOT', partTyp: 'CAL-CLEAN', jobNam: 'SORT' },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2], cardId: 'C1' }],
    hbrs: [{ hbinNum: 1, hbinCnt: parts.length, hbinPf: 'P', hbinNam: 'PASS' }],
    sbrs: [{ sbinNum: 1, sbinCnt: parts.length, sbinPf: 'P', sbinNam: 'GOOD' }],
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
        touchdowns: [parts],
        wrr: { headNum: 1, siteGrp: 1, finishT: 1_700_000_020, partCnt: parts.length, waferId: 'W01' },
      },
    ],
    mrr: { finishT: 1_700_000_050, dispCod: '0' },
  });
  return Array.from(bytes);
}

async function dropHealthyLot(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await expect(page.getByTestId('full-window-drop-zone')).toHaveAttribute(
    'data-dropzone-ready',
    'true',
  );
  await page.evaluate((bytes) => {
    const file = new File([new Uint8Array(bytes)], 'clean-lot.stdf', {
      type: 'application/octet-stream',
    });
    const evt = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
    window.dispatchEvent(evt);
  }, healthyLotBytes());
  await expect(page.getByTestId('verdict-headline')).toHaveText('No cause of death.', {
    timeout: 10_000,
  });
  await page.waitForTimeout(900);
}

const PRESETS = ['edge-ring-etch', 'handling-scratch', 'site2-probe-contact'] as const;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Premium P33 - accent and hover audit (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    for (const preset of PRESETS) {
      test(`A3: ${preset} spends ember only on the cause phrase and dominant bar`, async ({
        page,
      }) => {
        await loadDemo(page, preset);
        const stops = await scrollStops(page);
        for (const y of stops) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await page.waitForTimeout(80);
          expectWithinBudget(await auditEmber(page), `${preset} at ${y}`);
        }
        // The verdict viewport carries the cause phrase
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(80);
        const top = await auditEmber(page);
        expect(top.map((h) => h.id)).toContain('autopsy-headline-button');

        // Evidence on: the selected cause phrase and linked bar stay inside the budget
        await page.getByTestId('autopsy-headline-button').click();
        await page.waitForTimeout(700);
        for (const y of stops) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await page.waitForTimeout(80);
          expectWithinBudget(await auditEmber(page), `${preset} evidence at ${y}`);
        }
      });
    }

    test('A3: a healthy lot shows no orange at all', async ({ page }) => {
      await dropHealthyLot(page);
      for (const y of await scrollStops(page)) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(80);
        const hits = await auditEmber(page);
        expect(hits, `healthy at ${y}`).toEqual([]);
      }
    });

    test('A4: stats, findings, legend, buttons, and focus rings never turn ember', async ({
      page,
    }) => {
      await loadDemo(page, 'edge-ring-etch');

      // Stat numbers compute to text-primary
      const statColours = await page
        .getByTestId('verdict-stat-value')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
      expect(statColours.length).toBe(3);
      for (const c of statColours) expect(c).toBe(TEXT_PRIMARY[scheme]);

      // Hover: finding rows, stat buttons, legend entries, every visible button
      const targets = page.locator(
        '[data-testid="autopsy-body-claim-button"], [data-testid="verdict-stat-button"], [data-testid="stage-legend"] button, main button',
      );
      const count = await targets.count();
      for (let i = 0; i < count; i += 1) {
        const target = targets.nth(i);
        if (!(await target.isVisible())) continue;
        await target.scrollIntoViewIfNeeded();
        await target.hover();
        await page.waitForTimeout(140);
        const id = await target.evaluate(
          (el) => el.getAttribute('data-testid') ?? el.textContent?.trim().slice(0, 30),
        );
        expectWithinBudget(await auditEmber(page), `hover ${id}`);
      }

      // Focus: Tab through the page; no focus ring, outline, or focused control is ember
      await page.mouse.move(2, 2);
      await page.evaluate(() => window.scrollTo(0, 0));
      for (let i = 0; i < 60; i += 1) {
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          return {
            id: el.getAttribute('data-testid') ?? el.tagName,
            ring: `${cs.boxShadow} ${cs.outlineStyle === 'none' ? '' : cs.outlineColor}`,
          };
        });
        if (!focus) continue;
        expect(focus.ring, `focus ${focus.id}`).not.toMatch(
          /rgba?\((255, 107, 44|232, 89, 30|217, 78, 20|255, 138, 87)/,
        );
        expectWithinBudget(await auditEmber(page), `focus ${focus.id}`);
      }
    });

    test('A4: hints and toasts are never ember', async ({ page, browser }) => {
      // Toast: download a sample from the landing page
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/?nohints=1');
      await page.getByTestId('landing-download-demos-trigger').click();
      await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('download-demo-stdf-edge-ring-etch').click(),
      ]);
      await page.mouse.move(40, 120);
      const toast = page.locator('[data-sonner-toast]');
      await expect(toast).toBeVisible();
      expect(await auditEmber(page, '[data-sonner-toaster]')).toEqual([]);

      // Hint bubble: fresh storage so the first-use hint shows
      const context = await browser.newContext({
        colorScheme: scheme,
        viewport: { width: 1440, height: 900 },
        storageState: { cookies: [], origins: [] },
      });
      const hintPage = await context.newPage();
      await hintPage.addInitScript(() => {
        window.sessionStorage.setItem('cal.sweep.v1', '1');
      });
      await hintPage.goto('/');
      await hintPage.getByTestId('demo-card-edge-ring-etch').click();
      const bubble = hintPage.getByTestId('coach-mark');
      await expect(bubble).toBeVisible({ timeout: 8_000 });
      await hintPage.waitForTimeout(300);
      expect(await auditEmber(hintPage, '[data-testid="coach-mark"]')).toEqual([]);
      await context.close();
    });

    test('§8.9: no transition: all, gated hovers, and only transform, opacity, and colour transitions', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/?nohints=1');
      await expect(page.getByTestId('demo-card-edge-ring-etch')).toBeVisible();
      expect(await auditTransitionsAndHover(page), 'landing').toEqual([]);

      await loadDemo(page, 'edge-ring-etch');
      expect(await auditTransitionsAndHover(page), 'loaded').toEqual([]);
      await page.getByTestId('autopsy-headline-button').click();
      await page.waitForTimeout(400);
      expect(await auditTransitionsAndHover(page), 'evidence').toEqual([]);
    });
  });
}
