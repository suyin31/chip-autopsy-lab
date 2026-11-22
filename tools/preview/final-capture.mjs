import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 3151);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = '/workspace/work/atelier-fusion-preview';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-p4',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer(url, ms = 90000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('server did not start');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const report = [];

async function setThemeByReload(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('cal.theme', t);
  }, theme);
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(800);
}

async function setThemeInPlace(page, theme) {
  // Switch through the app's own appearance menu so route state (the agent conversation) survives.
  const current = await page.evaluate(() => document.documentElement.dataset.theme);
  if (current === theme) return;
  await page.getByTestId('theme-toggle-trigger').click();
  await sleep(400);
  await page.getByTestId(`theme-option-${theme}`).click();
  await sleep(800);
}

async function shoot(page, name) {
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const metrics = await page.evaluate(() => ({
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    h: document.documentElement.scrollHeight,
    theme: document.documentElement.dataset.theme,
  }));
  report.push({ name, ...metrics });
}

try {
  await waitForServer(BASE);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('cal.hints.v1', '["h-show","h-hover","h-strip"]');
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // Landing, light and dark
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await setThemeByReload(page, 'light');
  await shoot(page, 'home-light');
  await setThemeByReload(page, 'dark');
  await shoot(page, 'home-dark');

  // Loaded lot, dark then light
  await page.getByTestId('landing-open-sample-button').click();
  await sleep(2800);
  await shoot(page, 'home-loaded-dark');
  await setThemeByReload(page, 'light');
  await page.getByTestId('landing-open-sample-button').click();
  await sleep(2800);
  await shoot(page, 'home-loaded-light');

  // Agent console with the network's answer and cited dies (dark, then light)
  await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
  await setThemeByReload(page, 'dark');
  await page.getByRole('button', { name: /Load the edge-ring demo lot and diagnose it/i }).click();
  const allow = page.getByRole('button', { name: /Allow for this session/i });
  try {
    await allow.first().waitFor({ state: 'visible', timeout: 9000 });
    await allow.first().click();
  } catch {
    /* no consent needed */
  }
  await page.waitForFunction(() => (document.body.innerText ?? '').includes('Diagnosed the lot'), {
    timeout: 25000,
  });
  await sleep(2500);
  await shoot(page, 'agents-stage-dark');
  await setThemeInPlace(page, 'light');
  await shoot(page, 'agents-stage-light');

  // Mobile
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mpage = await mobile.newPage();
  mpage.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await mpage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await sleep(1200);
  await mpage.screenshot({ path: path.join(OUT, 'mobile-390.png') });
  report.push({
    name: 'mobile-390',
    ...(await mpage.evaluate(() => ({
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h: document.documentElement.scrollHeight,
      theme: document.documentElement.dataset.theme,
    }))),
  });
  await mpage.getByTestId('landing-open-sample-button').click();
  await sleep(2200);
  await mpage.screenshot({ path: path.join(OUT, 'mobile-390-loaded.png') });
  report.push({
    name: 'mobile-390-loaded',
    ...(await mpage.evaluate(() => ({
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h: document.documentElement.scrollHeight,
    }))),
  });
  await mobile.close();

  await ctx.close();
  await browser.close();
  console.log(JSON.stringify({ report, errors }, null, 1));
} finally {
  server.kill('SIGTERM');
}
