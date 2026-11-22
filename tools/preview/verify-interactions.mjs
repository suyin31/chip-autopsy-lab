import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 3165);
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-p7',
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const checks = [];

try {
  await wait(BASE);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

  // Lot switching from the header (batch switch).
  await page.getByTestId('agent-console-header').getByTestId('agent-lot-trigger').click();
  await sleep(500);
  const options = await page.getByTestId(/agent-lot-option-/).count();
  checks.push({ check: 'lot switcher lists sample lots', options });

  // STDF drop surface exists on the empty console.
  checks.push({
    check: 'stdf drop zone present',
    present: (await page.getByTestId('agent-stdf-dropzone').count()) > 0,
  });

  // Run the first starter and approve the consent moment.
  await page.getByRole('button', { name: /Load the edge-ring demo lot and diagnose it/i }).click();
  const allow = page.getByRole('button', { name: /Allow for this session/i });
  await allow.first().waitFor({ state: 'visible', timeout: 12000 });
  checks.push({ check: 'consent card blocks the page change', visible: true });
  await allow.first().click();
  await page.waitForFunction(() => (document.body.innerText ?? '').includes('Diagnosed the lot'), {
    timeout: 30000,
  });
  await sleep(1500);

  const state = await page.evaluate(() => ({
    citedDots: document.querySelectorAll('[data-testid="agent-wafer-stage"] .agent-wafer-cited').length,
    kpiYield: document.querySelector('[data-testid="agent-kpi-yield"]')?.textContent ?? '',
    citedLabel: document.body.innerText.includes('cited'),
  }));
  checks.push({ check: 'answer cites dies on the wafer', ...state });

  // Workbench: the evidence shelf opens without layout mistakes.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByTestId('landing-open-sample-button').click();
  await sleep(2500);
  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.getByTestId('evidence-shelf').getByRole('button').first().click();
  await sleep(900);
  const after = await page.evaluate(() => document.documentElement.scrollHeight);
  checks.push({ check: 'evidence shelf opens', before, after, grew: after > before });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  checks.push({ check: 'no horizontal overflow with shelf open', overflow });

  await browser.close();
  console.log(JSON.stringify({ checks, errors }, null, 1));
} finally {
  server.kill('SIGTERM');
}
