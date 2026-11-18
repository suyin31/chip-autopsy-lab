import { expect, test } from '@playwright/test';

test('renders dark clinical scaffold with self-hosted fonts and zero third-party requests', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      externalRequests.push(req.url());
    }
  });

  await page.goto('/');
  await expect(page.getByTestId('nav-wordmark')).toBeVisible();
  await expect(page.getByTestId('nav-wordmark')).toContainText('Chip Autopsy Lab');

  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe('rgb(0, 0, 0)');
  expect(externalRequests).toEqual([]);
});

test('NavBar R3 acceptance: 52px desktop / 48px mobile, language reload persistence, ice 2px focus rings, and Tab order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const navBar = page.getByTestId('nav-bar');
  await expect(navBar).toBeVisible();
  const desktopBox = await navBar.boundingBox();
  expect(desktopBox?.height).toBe(52);

  // Switch language to Japanese, assert <html lang="ja">, reload, and assert persistence
  await page.getByTestId('language-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: '日本語' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  // Switch back to English
  await page.getByTestId('language-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // Load demo lot via one-click card so LotPicker is visible, then verify Tab order and 2px ice focus rings
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('lot-picker-trigger')).toBeVisible({
    timeout: 5_000,
  });

  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  const expectedOrder = [
    'nav-wordmark',
    'lot-picker-trigger',
    'language-switcher-trigger',
    'nav-open-stdf',
  ];

  for (const testId of expectedOrder) {
    await page.keyboard.press('Tab');
    const focused = page.getByTestId(testId);
    await expect(focused).toBeFocused();

    const focusOutline = await focused.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
      };
    });
    expect(focusOutline.outlineWidth).toBe('2px');
    expect(focusOutline.outlineColor).toBe('rgb(214, 230, 255)');
  }

  // Mobile 390x844: 48px height and two 44x44 icon buttons
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await navBar.boundingBox();
  expect(mobileBox?.height).toBe(48);

  const langBox = await page.getByTestId('language-switcher-trigger').boundingBox();
  const openBox = await page.getByTestId('nav-open-stdf').boundingBox();
  expect(langBox?.width).toBe(44);
  expect(langBox?.height).toBe(44);
  expect(openBox?.width).toBe(44);
  expect(openBox?.height).toBe(44);
});
