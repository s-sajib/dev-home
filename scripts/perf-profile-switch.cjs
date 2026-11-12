const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:3590/'); await p.waitForSelector('[data-testid=list] .row'); await p.waitForTimeout(1500);
  await p.keyboard.press('2'); await p.waitForSelector('.card'); await p.waitForTimeout(1000); await p.keyboard.press('1'); await p.waitForTimeout(800);
  const c = await ctx.newCDPSession(p);
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 200 }); await c.send('Profiler.start');
  for (let i = 0; i < 12; i++) { await p.keyboard.press('2'); await p.waitForTimeout(350); await p.keyboard.press('1'); await p.waitForTimeout(350); }
  const { profile } = await c.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n])); const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].slice(0,24)}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
  [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(String(Math.round(v / 1000)).padStart(5), 'ms', k));
  await b.close();
})();
