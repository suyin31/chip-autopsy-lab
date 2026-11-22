import { spawn } from 'node:child_process';

const PORT = 3149;
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  await page.goto(`http://127.0.0.1:${PORT}/agents`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Load the edge-ring demo lot and diagnose it/i }).click();
  const allow = page.getByRole('button', { name: /Allow for this session/i });
  await allow.first().waitFor({ state: 'visible', timeout: 10000 });
  await allow.first().click();
  for (let t = 0; t < 5; t += 1) {
    await page.waitForTimeout(2600);
    const info = await page.evaluate(() => {
      const conv = document.querySelector('[data-testid="agent-conversation"]');
      const answers = [...document.querySelectorAll('[data-testid="agent-answer-copy"]')].map((n) =>
        (n.textContent ?? '').slice(0, 120),
      );
      const consent = document.querySelector('[data-testid="agent-consent-card"]');
      const status = conv ? (conv.innerText ?? '').slice(0, 300) : 'none';
      return {
        answers,
        consent: Boolean(consent),
        status,
        scrollY: conv ? conv.scrollTop : 0,
        scrollH: conv ? conv.scrollHeight : 0,
      };
    });
    console.log(t, JSON.stringify(info));
  }
  await page.screenshot({ path: '/workspace/work/atelier-preview/_agents-after.png' });
  console.log(logs.slice(-8).join('\n'));
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
