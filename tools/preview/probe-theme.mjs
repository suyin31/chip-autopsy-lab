import { spawn } from 'node:child_process';

const PORT = 3141;
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
    NEXT_DIST_DIR: '.next-preview',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function wait(url) {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 400));
  }
  throw new Error('no server');
}

try {
  await wait(`http://127.0.0.1:${PORT}`);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  console.log(
    'initial',
    await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      accent: document.documentElement.getAttribute('data-accent'),
      stored: localStorage.getItem('cal.theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      heroBg: getComputedStyle(document.querySelector('.at-page')).backgroundColor,
    })),
  );

  await page.evaluate(() => localStorage.setItem('cal.theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  console.log(
    'after reload dark',
    await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      stored: localStorage.getItem('cal.theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      navText: getComputedStyle(document.querySelector('[data-testid="nav-wordmark"]')).color,
      h1: getComputedStyle(document.querySelector('[data-testid="landing-headline"]')).color,
    })),
  );

  await page.getByTestId('landing-open-sample-button').click();
  await page.waitForTimeout(2200);
  console.log(
    'loaded',
    await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      statBg: getComputedStyle(document.querySelector('[data-testid="verdict-stat-item"]')).backgroundColor,
      headline: getComputedStyle(document.querySelector('[data-testid="verdict-headline"]')).color,
      pages: document.querySelectorAll('.at-page').length,
      canvases: document.querySelectorAll('canvas').length,
    })),
  );
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
