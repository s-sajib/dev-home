// Inclusive-time profile of 12 view switches (use against a DEV build so names are readable).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const p = await ctx.newPage();
  await p.goto(process.argv[2]); await p.waitForSelector('[data-testid=list] .row'); await p.waitForTimeout(2500);
  await p.keyboard.press('2'); await p.waitForSelector('.card'); await p.waitForTimeout(1500); await p.keyboard.press('1'); await p.waitForTimeout(1000);
  const c = await ctx.newCDPSession(p);
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 250 }); await c.send('Profiler.start');
  for (let i = 0; i < 10; i++) { await p.keyboard.press('2'); await p.waitForTimeout(450); await p.keyboard.press('1'); await p.waitForTimeout(450); }
  const { profile } = await c.send('Profiler.stop');
  const nodes = new Map(profile.nodes.map(n => [n.id, { ...n, self: 0, total: 0 }]));
  const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { nodes.get(id).self += dt[i] || 0; });
  const total = (n) => { n.total = n.self + (n.children || []).reduce((a, id) => a + total(nodes.get(id)), 0); return n.total; };
  const root = profile.nodes[0]; total(nodes.get(root.id));
  const agg = new Map(); for (const n of nodes.values()) { const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].slice(0, 22)}:${n.callFrame.lineNumber}`; if (!agg.has(k)) agg.set(k, 0); agg.set(k, agg.get(k) + n.total); }
  [...agg.entries()].filter(([k]) => !/idle|program|root/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 22).forEach(([k, v]) => console.log(String(Math.round(v / 1000)).padStart(5), 'ms', k));
  await b.close();
})();
