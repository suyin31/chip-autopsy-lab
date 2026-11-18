import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P3 theme mechanism (A2 without the menu, premium.md §3.1): the pre-hydration
 * script sets data-theme, color-scheme, and theme-color before first paint; the
 * preference comes from localStorage["cal.theme"]; Match system follows the OS live.
 */

/** Records data-theme at the moment <body> is first inserted, i.e. before any paint. */
async function recordThemeAtBodyInsert(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __themeAtBody?: string | null };
    const observer = new MutationObserver(() => {
      if (document.body && w.__themeAtBody === undefined) {
        w.__themeAtBody = document.documentElement.getAttribute('data-theme');
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function readTheme(page: Page) {
  return page.evaluate(() => ({
    atBody: (window as unknown as { __themeAtBody?: string | null })
      .__themeAtBody,
    theme: document.documentElement.getAttribute('data-theme'),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    themeColor: Array.from(
      document.querySelectorAll('meta[name="theme-color"]'),
    ).map((m) => m.getAttribute('content')),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
}

test('Match system on a dark OS paints dark from the first frame', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await recordThemeAtBodyInsert(page);
  await page.goto('/');
  await expect(page.getByTestId('nav-wordmark')).toBeVisible();
  expect(await readTheme(page)).toEqual({
    atBody: 'dark',
    theme: 'dark',
    colorScheme: 'dark',
    themeColor: ['#000000'],
    bodyBg: 'rgb(0, 0, 0)',
  });
  expect(errors).toEqual([]);
});

test('Match system on a light OS paints light, and follows OS changes live', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await recordThemeAtBodyInsert(page);
  await page.goto('/');
  await expect(page.getByTestId('nav-wordmark')).toBeVisible();
  expect(await readTheme(page)).toMatchObject({
    atBody: 'light',
    theme: 'light',
    colorScheme: 'light',
    themeColor: ['#F6F3EE'],
    bodyBg: 'rgb(246, 243, 238)',
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await readTheme(page)).toMatchObject({
    colorScheme: 'dark',
    themeColor: ['#000000'],
    bodyBg: 'rgb(0, 0, 0)',
  });

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('localStorage "light" on a dark OS persists across reload and ignores OS changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await recordThemeAtBodyInsert(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('cal.theme', 'light'));
  await page.reload();
  await expect(page.getByTestId('nav-wordmark')).toBeVisible();
  expect(await readTheme(page)).toEqual({
    atBody: 'light',
    theme: 'light',
    colorScheme: 'light',
    themeColor: ['#F6F3EE'],
    bodyBg: 'rgb(246, 243, 238)',
  });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('cal.theme'))).toBe(
    'light',
  );
});

test('localStorage "dark" on a light OS paints dark; invalid values fall back to Match system', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await recordThemeAtBodyInsert(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('cal.theme', 'dark'));
  await page.reload();
  expect(await readTheme(page)).toMatchObject({
    atBody: 'dark',
    theme: 'dark',
    themeColor: ['#000000'],
  });

  await page.evaluate(() => localStorage.setItem('cal.theme', 'sepia'));
  await page.reload();
  expect(await readTheme(page)).toMatchObject({
    atBody: 'light',
    theme: 'light',
    themeColor: ['#F6F3EE'],
  });
});
