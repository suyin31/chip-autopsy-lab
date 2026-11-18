import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P16: nav grid and scroll hairline, language switcher, Appearance menu, and lot
 * picker (premium §7.1, §7.2). Acceptance A2 (menu path), A28, A29, A35 (nav tab order).
 */

async function openSampleLot(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('lot-picker-trigger')).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByTestId('verdict-headline')).toBeVisible();
}

test('A28: nav at 1440 places wordmark, centred lot picker, language, theme icon, and Open file', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSampleLot(page);

  const nav = await page.getByTestId('nav-bar').boundingBox();
  expect(nav?.height).toBe(52);

  const wordmark = (await page.getByTestId('nav-wordmark').boundingBox())!;
  const picker = (await page.getByTestId('lot-picker-trigger').boundingBox())!;
  const lang = (await page.getByTestId('language-switcher-trigger').boundingBox())!;
  const theme = (await page.getByTestId('theme-toggle-trigger').boundingBox())!;
  const open = (await page.getByTestId('nav-open-stdf').boundingBox())!;

  expect(Math.round(wordmark.x)).toBe(40);
  expect(Math.abs(picker.x + picker.width / 2 - 720)).toBeLessThanOrEqual(1);
  expect(picker.height).toBe(32);
  expect(lang.height).toBe(32);
  expect(theme.width).toBe(32);
  expect(theme.height).toBe(32);
  expect(open.height).toBe(32);
  expect(Math.round(theme.x - (lang.x + lang.width))).toBe(4);
  expect(Math.round(open.x - (theme.x + theme.width))).toBe(12);
  expect(Math.round(1440 - (open.x + open.width))).toBe(40);

  // Theme toggle: icon only, no label text
  await expect(page.getByTestId('theme-toggle-trigger')).toHaveText('');
  await expect(page.getByTestId('theme-toggle-trigger')).toHaveAttribute(
    'aria-label',
    /^Appearance: /,
  );
  await expect(page.getByTestId('nav-open-stdf')).toHaveAccessibleName(
    'Open file',
  );

  // Appearance menu: three rows, one check, note under the group
  await page.getByTestId('theme-toggle-trigger').click();
  const menu = page.getByTestId('theme-menu');
  await expect(menu).toBeVisible();
  // Width after the open spring settles (scale 0.96 -> 1)
  await expect
    .poll(async () => Math.round((await menu.boundingBox())?.width ?? 0))
    .toBe(200);
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    'Match system',
    'Light',
    'Dark',
  ]);
  await expect(menu.locator('[aria-checked="true"]')).toHaveCount(1);
  await expect(menu).toContainText('Match system follows your device setting.');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('theme-toggle-trigger')).toBeFocused();
});

test('A2 (menu path): choosing Light on a dark OS turns the page light and persists', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const trigger = page.getByTestId('theme-toggle-trigger');
  await expect(trigger).toHaveAttribute(
    'aria-label',
    'Appearance: System, currently dark',
  );

  await trigger.click();
  await page.getByTestId('theme-option-light').click();
  await expect(page.getByTestId('theme-menu')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe('rgb(246, 243, 238)');
  await expect(trigger).toHaveAttribute('data-preference', 'light');
  await expect(trigger).toHaveAttribute('aria-label', 'Appearance: Light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('cal.theme'))).toBe(
    'light',
  );
  await trigger.click();
  await expect(page.getByTestId('theme-option-light')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page.getByTestId('theme-menu').locator('[aria-checked="true"]'),
  ).toHaveCount(1);
});

test('theme tooltip appears after 600 ms of hover', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByTestId('theme-toggle-trigger');
  await trigger.hover();
  await page.waitForTimeout(300);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveText('Appearance', {
    timeout: 1_000,
  });
});

test('A29: lot picker menu shows sample rows with thumbnails, comma meta, check, and Open file keycap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSampleLot(page);

  await page.getByTestId('lot-picker-trigger').click();
  const menu = page.getByTestId('lot-picker-menu');
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => Math.round((await menu.boundingBox())?.width ?? 0))
    .toBe(360);
  await expect(menu).toContainText('Sample lots');

  const rows = menu.locator('[data-testid^="lot-picker-row-"]');
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    const row = rows.nth(i);
    expect(Math.round((await row.boundingBox())?.height ?? 0)).toBe(56);
    const thumb = (await row
      .getByTestId('lot-picker-demo-thumb')
      .boundingBox())!;
    expect(Math.round(thumb.width)).toBe(40);
    expect(Math.round(thumb.height)).toBe(40);
    await expect(row).toContainText(/Yield \d+(\.\d)?%, 25 wafers/);
  }
  await expect(menu).not.toContainText('·');
  await expect(menu.locator('[aria-checked="true"]')).toHaveCount(1);
  await expect(page.getByTestId('lot-picker-row-edge-ring-etch')).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const openRow = page.getByTestId('lot-picker-open-file');
  await expect(openRow).toContainText('Open file…');
  await expect(openRow.locator('kbd')).toHaveText(/^(⌘O|Ctrl O)$/);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('lot-picker-trigger')).toBeFocused();
});

test('nav hairline appears only after 4 px of scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSampleLot(page);
  const hairline = page.getByTestId('nav-scroll-separator');
  await expect(hairline).toHaveCSS('opacity', '0');
  await page.mouse.move(1200, 600);
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect(hairline).toHaveCSS('opacity', '1');
});

test('A28 mobile: globe menu holds the Appearance group; 44 x 44 controls with no gap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await openSampleLot(page);

  expect((await page.getByTestId('nav-bar').boundingBox())?.height).toBe(48);
  await expect(page.getByTestId('theme-toggle-trigger')).toBeHidden();
  const globe = (await page.getByTestId('language-switcher-trigger').boundingBox())!;
  const folder = (await page.getByTestId('nav-open-stdf').boundingBox())!;
  expect([globe.width, globe.height, folder.width, folder.height]).toEqual([
    44, 44, 44, 44,
  ]);
  expect(Math.round(folder.x - (globe.x + globe.width))).toBe(0);
  expect(Math.round(390 - (folder.x + folder.width))).toBe(16);

  await page.getByTestId('language-switcher-trigger').click();
  const menu = page.getByTestId('language-switcher-menu');
  await expect(menu).toContainText('Appearance');
  await expect(menu.getByTestId('theme-option-system')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByTestId('theme-option-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
