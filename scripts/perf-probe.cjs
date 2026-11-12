// Quick probe: keypress-to-paint latency on the harsh dataset. Run with the harsh server up (CHAOS=0) on :3590.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const t0 = Date.now();
  await p.goto(process.argv[2] || 'http://127.0.0.1:3590/'); await p.waitForSelector('[data-testid=list] .row');
  const loadMs = Date.now() - t0;
  await p.waitForTimeout(2500);
  const nodes = await p.evaluate(() => document.querySelectorAll('*').length);
  const rows = await p.locator('[data-testid=list] .row').count();
  await p.evaluate(() => { window.__lat = []; window.__long = 0; new PerformanceObserver(l => l.getEntries().forEach(e => window.__long += e.duration)).observe({ entryTypes: ['longtask'] });
    addEventListener('keydown', () => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push(performance.now() - t))); }, true); });
  for (let i = 0; i < 50; i++) { await p.keyboard.press('j'); await p.waitForTimeout(30); }
  await p.waitForTimeout(500);
  const lat = (await p.evaluate(() => window.__lat)).sort((a, b) => a - b);
  const long = await p.evaluate(() => window.__long);
  const heap = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
  console.log(JSON.stringify({ rows, nodes, loadMs, p50: Math.round(lat[Math.floor(lat.length * .5)]), p95: Math.round(lat[Math.floor(lat.length * .95)]), longTaskMs: Math.round(long), heapMB: heap, errors: errs }));
  await b.close();
})();
