import { expect, test } from '@playwright/test';

/**
 * Premium P2 token acceptance (A1 at token level, premium.md §3.2): the data-theme
 * attribute switches the page variables. Task P3 sets the attribute; here it is forced.
 */
test('data-theme switches page tokens: light #F5F5F7 / #1D1D1F, dark #000000, unset keeps legacy dark', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('nav-wordmark')).toBeVisible();

  const read = () =>
    page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const bar = document.createElement('div');
      bar.style.backgroundColor = 'var(--bar-neutral)';
      document.body.appendChild(bar);
      const barNeutral = getComputedStyle(bar).backgroundColor;
      bar.remove();
      const probe = document.createElement('div');
      probe.className = 'bg-surface text-text-tertiary shadow-card rounded-2xl';
      document.body.appendChild(probe);
      const p = getComputedStyle(probe);
      const result = {
        bodyBg: body.backgroundColor,
        bodyColor: body.color,
        surface: p.backgroundColor,
        tertiary: p.color,
        shadow: p.boxShadow,
        radius: p.borderTopLeftRadius,
        barNeutral,
      };
      probe.remove();
      return result;
    });

  const unset = await read();
  expect(unset.bodyBg).toBe('rgb(0, 0, 0)');
  expect(unset.tertiary).toBe('rgba(255, 255, 255, 0.48)');
  expect(unset.radius).toBe('24px');

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  const light = await read();
  expect(light.bodyBg).toBe('rgb(245, 245, 247)');
  expect(light.bodyColor).toBe('rgb(29, 29, 31)');
  expect(light.surface).toBe('rgb(255, 255, 255)');
  expect(light.tertiary).toBe('rgb(106, 106, 112)');
  expect(light.shadow).toContain('rgba(0, 0, 0, 0.05) 0px 8px 24px 0px');
  expect(light.barNeutral).toBe('rgba(0, 0, 0, 0.16)');

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const dark = await read();
  expect(dark.bodyBg).toBe('rgb(0, 0, 0)');
  expect(dark.surface).toBe('rgb(17, 17, 19)');
  expect(dark.tertiary).toBe('rgba(255, 255, 255, 0.56)');
  expect(dark.shadow).toContain('inset');
  expect(dark.barNeutral).toBe('rgba(255, 255, 255, 0.22)');
});
