// CPU profile of 40 keypresses on the harsh dataset: top self-time functions.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(process.argv[2] || 'http://127.0.0.1:3590/'); await p.waitForSelector('[data-testid=list] .row'); await p.waitForTimeout(2500);
  const c = await ctx.newCDPSession(p);
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 200 }); await c.send('Profiler.start');
  for (let i = 0; i < 40; i++) { await p.keyboard.press('j'); await p.waitForTimeout(30); }
  const { profile } = await c.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas; const total = dt.reduce((a, b) => a + b, 0);
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].slice(0,28)}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log('total ms', Math.round(total / 1000));
  top.forEach(([k, v]) => console.log(String(Math.round(v / 1000)).padStart(5), 'ms', k));
  await b.close();
})();
