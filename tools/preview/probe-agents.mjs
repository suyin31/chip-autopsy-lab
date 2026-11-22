import { spawn } from 'node:child_process';

const PORT = 3147;
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-p3',
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
  await page.goto(`http://127.0.0.1:${PORT}/agents`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Load the edge-ring demo lot and diagnose it/i }).click();
  await page.waitForTimeout(3500);
  const info = await page.evaluate(() => {
    const conv = document.querySelector('[data-testid="agent-conversation"]');
    const scroll = conv?.querySelector('div');
    const walker = document.createTreeWalker(conv, NodeFilter.SHOW_ELEMENT);
    const out = [];
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const cs = getComputedStyle(el);
      if (el.textContent && el.children.length === 0 && el.textContent.trim().length > 12) {
        const r = el.getBoundingClientRect();
        out.push({
          tag: el.tagName,
          cls: el.className.toString().slice(0, 60),
          text: el.textContent.trim().slice(0, 40),
          opacity: cs.opacity,
          display: cs.display,
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        });
      }
    }
    return { count: out.length, sample: out.slice(0, 12), convBox: conv?.getBoundingClientRect().toJSON() };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 3000));
  await page.screenshot({ path: '/workspace/work/atelier-preview/_agents-debug.png' });
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
