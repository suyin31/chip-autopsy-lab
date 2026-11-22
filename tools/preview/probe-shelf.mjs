import { spawn } from 'node:child_process';

const PORT = Number(process.env.PROBE_PORT ?? 3157);
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.getByTestId('landing-open-sample-button').click();
  await page.waitForTimeout(2800);
  const info = await page.evaluate(() => {
    const shelf = document.querySelector('[data-testid="evidence-shelf"]');
    const drawer = shelf?.querySelector('.at-drawer');
    const r = drawer?.getBoundingClientRect();
    const cs = drawer ? getComputedStyle(drawer) : null;
    return {
      shelf: shelf?.getBoundingClientRect().toJSON(),
      drawer: r ? { h: r.height, w: r.width } : null,
      maxH: cs?.maxHeight,
      rows: cs?.gridTemplateRows,
      overflow: cs?.overflow,
      display: cs?.display,
      docH: document.documentElement.scrollHeight,
      hasChart: Boolean(document.querySelector('[data-testid="bin-pareto-chart"]')),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  const bottoms = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > 1200) {
        out.push({
          tag: el.tagName,
          testid: el.getAttribute('data-testid'),
          cls: (el.className ?? '').toString().slice(0, 45),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          h: Math.round(r.height),
        });
      }
    });
    return out.slice(0, 12);
  });
  const exp = await page.evaluate(() => {
    const style = document.createElement('style');
    document.head.appendChild(style);
    const res = { base: document.documentElement.scrollHeight };
    for (const [k, css] of [
      ['drawerNone', '.at-drawer{display:none!important}'],
      ['drawerContain', '.at-drawer{contain:paint!important}'],
      ['shelfNone', '[data-testid="evidence-shelf"]{display:none!important}'],
    ]) {
      style.textContent = css;
      res[k] = document.documentElement.scrollHeight;
    }
    style.remove();
    return res;
  });
  console.log('EXP', JSON.stringify(exp));
  await page.screenshot({ path: '/workspace/work/atelier-preview/_loaded-bottom.png', fullPage: true });
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
