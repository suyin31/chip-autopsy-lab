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
  await expect(page.getByRole('heading', { name: 'Chip Autopsy Lab' })).toBeVisible();

  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBg).toBe('rgb(0, 0, 0)');
  expect(externalRequests).toEqual([]);
});
