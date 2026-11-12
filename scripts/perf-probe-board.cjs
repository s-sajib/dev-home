const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await p.goto('http://127.0.0.1:3590/'); await p.waitForSelector('[data-testid=list] .row'); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__lat = []; addEventListener('keydown', () => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push(performance.now() - t))); }, true); });
  const stat = async (label) => { await p.waitForTimeout(400); const l = (await p.evaluate(() => { const x = window.__lat.slice(); window.__lat = []; return x; })).sort((a, c) => a - c); console.log(label.padEnd(28), 'n', l.length, 'p50', Math.round(l[Math.floor(l.length * .5)]), 'p95', Math.round(l[Math.floor(l.length * .95)]), 'max', Math.round(l.at(-1))); };
  for (let i = 0; i < 20; i++) { await p.keyboard.press('2'); await p.waitForTimeout(250); await p.keyboard.press('1'); await p.waitForTimeout(250); } await stat('switch inbox<->board');
  await p.keyboard.press('2'); await p.waitForSelector('.card'); await p.waitForTimeout(800);
  console.log('cards', await p.locator('.card').count());
  for (let i = 0; i < 40; i++) { await p.keyboard.press('j'); await p.waitForTimeout(30); } await stat('board j');
  for (let i = 0; i < 40; i++) { await p.keyboard.press(i % 2 ? 'h' : 'l'); await p.waitForTimeout(30); } await stat('board h/l');
  for (let i = 0; i < 20; i++) { await p.keyboard.press(i % 2 ? ']' : '['); await p.waitForTimeout(80); } await stat('board [ ] (move card)');
  await p.keyboard.press('1'); await p.waitForTimeout(600);
  for (let i = 0; i < 40; i++) { await p.keyboard.press(['d','u'][i%2]); await p.waitForTimeout(60); } await stat('inbox d/u');
  for (let i = 0; i < 40; i++) { await p.keyboard.press('j'); await p.waitForTimeout(30); } await stat('inbox j');
  await b.close();
})();
