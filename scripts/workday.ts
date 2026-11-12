/**
 * A day with Work Inbox, on mock data. Records a video of a user working only from this app, with Claude Code
 * (a real `claude -p` session) driving the board through the MCP protocol in the middle of the day.
 *
 *   bun scripts/workday.ts            -> shots/workday.webm (+ .mp4 when ffmpeg is available)
 *
 * The overlay (cursor, key presses, captions, terminal) is injected into the page only for the recording.
 */
import { chromium, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3580;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "shots";
const FAST = process.env.FAST === "1"; // quick dry runs while iterating
const sleep = (ms: number) => new Promise((r) => setTimeout(r, FAST ? ms / 4 : ms));

// ───────────────────────── overlay (recording only) ─────────────────────────
const OVERLAY = `(() => {
  if (window.__overlay) return; window.__overlay = true;
  const boot = () => {
  const css = document.createElement('style');
  css.textContent = \`
    #__cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px #0008)}
    .__rip{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #c8adf2;animation:__rip .5s ease-out forwards}
    @keyframes __rip{to{transform:scale(3.2);opacity:0}}
    #__keys{position:fixed;left:236px;bottom:18px;z-index:2147483646;display:flex;gap:6px;pointer-events:none}
    .__key{font:600 14px ui-monospace,Menlo,monospace;color:#1b1a18;background:#f4f1ea;border-radius:8px;padding:5px 10px;box-shadow:0 2px 0 #b9b2a6,0 6px 16px #0006;animation:__k 1.1s ease-out forwards}
    @keyframes __k{0%{transform:translateY(6px);opacity:0}12%{transform:none;opacity:1}80%{opacity:1}100%{opacity:0}}
    #__cap{position:fixed;left:50%;top:62px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;display:flex;gap:12px;align-items:baseline;max-width:880px;padding:9px 18px;border-radius:14px;background:#12110fe6;color:#eee8de;font:500 15px "Schibsted Grotesk",system-ui,sans-serif;box-shadow:0 10px 40px #000a,inset 0 0 0 .5px #ffeed82e;backdrop-filter:blur(14px);opacity:0;transition:opacity .35s}
    #__cap.on{opacity:1} #__cap b{font:500 12px ui-monospace,Menlo,monospace;color:#f2a85c;letter-spacing:.04em} #__cap span{color:#b9b2a6;font-size:13px}
    #__title{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#12110f;color:#eee8de;text-align:center;font-family:"Schibsted Grotesk",system-ui,sans-serif;transition:opacity .8s}
    #__title h1{font-size:54px;letter-spacing:-.03em;margin:0 0 10px;font-weight:650} #__title p{font:400 16px ui-monospace,Menlo,monospace;color:#918a7e;margin:0}
    #__title i{display:block;width:54px;height:54px;border-radius:15px;margin:0 auto 24px;background:linear-gradient(100deg,#a993f5,#d39be8 38%,#f2a9cf 70%,#f6b98f)}
    #__term{position:fixed;right:24px;bottom:24px;width:560px;max-height:340px;z-index:2147483645;pointer-events:none;border-radius:12px;background:#0d0c0bf2;color:#d8d2c6;font:12.5px/1.5 ui-monospace,Menlo,monospace;box-shadow:0 20px 60px #000c,inset 0 0 0 .5px #ffeed82e;opacity:0;transform:translateY(12px);transition:all .4s;overflow:hidden}
    #__term.on{opacity:1;transform:none} #__term header{padding:8px 14px;background:#1a1815;color:#918a7e;font-size:11px;display:flex;gap:6px;align-items:center}
    #__term header i{width:9px;height:9px;border-radius:50%;background:#3a3631} #__term pre{margin:0;padding:12px 14px;white-space:pre-wrap;word-break:break-word;max-height:290px;overflow:hidden}
    #__term .p{color:#c8adf2} #__term .t{color:#6fe0a0} #__term .d{color:#918a7e}
  \`;
  document.documentElement.appendChild(css);
  const cur = document.createElement('div'); cur.id='__cur';
  cur.innerHTML='<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 7.5-6 1.6-2.6 5.9z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const keys = document.createElement('div'); keys.id='__keys';
  const cap = document.createElement('div'); cap.id='__cap';
  const term = document.createElement('div'); term.id='__term'; term.innerHTML='<header><i></i><i></i><i></i>&nbsp; terminal · claude code</header><pre></pre>';
  document.body.append(cur, keys, cap, term);
  addEventListener('mousemove', e => { cur.style.transform = 'translate('+e.clientX+'px,'+e.clientY+'px)'; }, true);
  addEventListener('mousedown', e => { const r=document.createElement('div'); r.className='__rip'; r.style.left=e.clientX+'px'; r.style.top=e.clientY+'px'; document.body.appendChild(r); setTimeout(()=>r.remove(),600); }, true);
  const names = {' ':'Space','Meta':'⌘','Enter':'↵','Escape':'Esc','ArrowDown':'↓','ArrowUp':'↑','Shift':'⇧','Control':'Ctrl','Alt':'⌥'};
  addEventListener('keydown', e => { if (e.repeat) return; const k=document.createElement('div'); k.className='__key'; k.textContent=names[e.key]||e.key; keys.appendChild(k); setTimeout(()=>k.remove(),1150); if (keys.children.length>4) keys.firstChild.remove(); }, true);
  window.__cap = (time, text, sub) => { cap.innerHTML = '<b>'+time+'</b>'+text+(sub?'<span>'+sub+'</span>':''); cap.classList.add('on'); };
  window.__capOff = () => cap.classList.remove('on');
  window.__title = (h, p) => { let t=document.getElementById('__title'); if(!t){t=document.createElement('div'); t.id='__title'; document.body.appendChild(t);} t.style.opacity=1; t.innerHTML='<div><i></i><h1>'+h+'</h1><p>'+p+'</p></div>'; };
  window.__titleOff = () => { const t=document.getElementById('__title'); if(t){t.style.opacity=0; setTimeout(()=>t.remove(),900);} };
  window.__term = (html, show=true) => { term.querySelector('pre').innerHTML = html; term.classList.toggle('on', show); };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;

// ───────────────────────── helpers ─────────────────────────
let page: Page;
let mx = 700, my = 400;

async function glide(x: number, y: number) {
  const dist = Math.hypot(x - mx, y - my);
  const steps = Math.max(8, Math.min(46, Math.round(dist / 14)));
  await page.mouse.move(x, y, { steps: FAST ? 4 : steps });
  mx = x; my = y;
}
async function center(l: Locator) {
  await l.scrollIntoViewIfNeeded();
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 28) };
}
const over = async (l: Locator) => { const c = await center(l); await glide(c.x, c.y); await sleep(250); };
const tap = async (l: Locator) => { const c = await center(l); await glide(c.x, c.y); await sleep(180); await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(350); };
const key = async (k: string, after = 500) => { await page.keyboard.press(k); await sleep(after); };
const type = async (t: string) => { await page.keyboard.type(t, { delay: FAST ? 5 : 55 }); await sleep(300); };
const cap = (time: string, text: string, sub = "") => page.evaluate(([a, b, c]) => (window as any).__cap(a, b, c), [time, text, sub] as const);
const row = (t: string) => page.locator(`[data-testid=list] .row:has-text("${t}")`);

async function drag(card: Locator, target: Locator) {
  const a = await center(card);
  const b = await target.boundingBox();
  await glide(a.x, a.y); await sleep(200);
  await page.mouse.down(); await sleep(150);
  await page.mouse.move(a.x + 12, a.y + 6, { steps: 4 });
  await glide(b!.x + b!.width / 2, b!.y + 90);
  await sleep(250);
  await page.mouse.up(); await sleep(900);
}

// ───────────────────────── the day ─────────────────────────
async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = Bun.spawn(["bun", "src/server/index.ts"], { env: { ...process.env, WORK_INBOX_DEMO: "1", PORT: String(PORT) }, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/inbox`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", recordVideo: { dir: join(OUT, "video-tmp"), size: { width: 1440, height: 900 } }, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(OVERLAY);
  page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector(".row");
  await page.evaluate(() => (window as any).__title("A day with Work Inbox", "mock data · Claude Code for coding, this app for comms"));
  await sleep(3200);
  await page.evaluate(() => (window as any).__titleOff());
  await sleep(1200);

  // 09:02 ─ triage
  await cap("09:02", "Morning. One screen: what needs me?", "Jira, GitHub, WhatsApp and Reminders, already linked");
  await over(row("Follow up on PAY-231")); await sleep(1400);
  await key("j", 700); await key("j", 700);
  await cap("09:04", "One ticket, one card", "its Jira comment and the PR review request merged by ticket key");
  await tap(row("PAY-231 Retry")); await sleep(2200);
  await over(page.locator(".rel").getByText("Acme Support Group")); await sleep(500);
  await cap("09:06", "It links straight to the client chat", "relationships between objects are clickable");
  await tap(page.locator('.rel [data-key="chat:120363@g.us"]')); await sleep(1800);

  // 09:08 ─ client chat
  await cap("09:08", "Client group pinged me at 8:50: demo at 3pm", "chats read like a conversation; I never send from here");
  await over(page.locator(".bubble.mention")); await sleep(2200);
  await tap(page.getByTestId("summary").getByRole("button", { name: /action item/ })); await sleep(2200);
  await key("y", 900);
  await cap("09:10", "Draft copied. I paste it into WhatsApp on my phone", "read-only by design: the app has no send button");
  await sleep(2600);
  await key("a", 800);

  // 09:20 ─ Lena DM, manual Claude
  await tap(row("Lena Park")); await sleep(1200);
  await cap("09:20", "Lena is blocked on my review", "Claude only reads this chat when I ask (mode: Manual)");
  await tap(page.getByRole("button", { name: "Summarise options" })); await sleep(900);
  await tap(page.getByRole("dialog", { name: "Summarise options" }).getByRole("radio", { name: "50" })); await sleep(700);
  await key("Escape", 500);
  await tap(page.locator(".split-btn > button").first()); await sleep(900);
  await page.getByTestId("summary").waitFor();
  await cap("09:21", "Summary, action items and a reply draft", "for just the last 50 messages");
  await sleep(2600);
  await key("y", 800);
  await key("b", 1000);

  // 09:35 ─ Jira
  await tap(row("API-77")); await sleep(1200);
  await cap("09:35", "Lena asked a question on API-77", "a Jira comment, written without leaving the app");
  await key("m", 900);
  await type("Opaque cursor. I'll confirm the format with mobile today.");
  await key("Meta+Enter", 1500);
  await sleep(1200);
  await tap(row("WEB-402")); await sleep(1000);
  await cap("09:40", "Start the cookie copy ticket", "moving a ticket asks for confirmation; nothing hits Jira until I press Enter");
  await key("t", 1000); await key("1", 1100); await key("Enter", 1500);

  // 09:50 ─ settings (fast refresh for the board)
  await cap("09:50", "Everything is configurable", "board should refresh quickly while Claude Code works, so I set it to 5 seconds");
  await key(",", 900);
  await tap(page.locator(".snav button", { hasText: "General" })); await sleep(500);
  const refresh = page.locator(".field", { hasText: "Screen refresh" }).locator("input");
  await tap(refresh); await refresh.fill(""); await type("5"); await key("Tab", 900);
  await sleep(1000);
  await tap(page.getByRole("button", { name: "Back to inbox" })); await sleep(800);

  // 10:00 ─ board
  await key("2", 1200);
  await cap("10:00", "Same objects, now as a pipeline", "WEB-402 moved itself to In Progress when I moved the ticket");
  await sleep(2400);
  await drag(page.locator('.card:has-text("PAY-231")'), page.locator('.col[data-col="Merged"] .cards'));
  await cap("10:05", "PR got merged: drag the card to Merged", "a hand-placed card is pinned, so automation never fights me");
  await sleep(1800);
  await drag(page.locator('.card:has-text("Stage smoke test")'), page.locator('.col[data-col="Ready for Release"] .cards'));
  await tap(page.getByLabel("Add card to Decision Needed")); await sleep(300);
  await type("Rollback plan for webhook retries"); await key("Enter", 1200);
  await page.locator('.card:has-text("Rollback plan")').dblclick(); await sleep(900);
  await page.getByTestId("drawer").getByPlaceholder("Notes…").fill("Feature flag off + replay queue. Ask infra if the DLQ is big enough.");
  await sleep(1400);
  await key("Escape", 900);

  // 11:00 ─ Claude Code works the board through MCP
  await cap("11:00", "Heads down. Claude Code takes over the coding side", "it reads and updates my board through the app's protocol (MCP)");
  const mcpConfig = join(tmpdir(), "workday-mcp.json");
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { "work-inbox": { command: "bun", args: ["src/mcp/server.ts"], env: { WORK_INBOX_URL: BASE } } } }));
  const prompt = "You are my coding agent. Use ONLY the work-inbox tools. 1) board_get, find the Jira card in 'In Progress' and move it to 'PR Review' (I just opened the PR). 2) Read the last 10 messages of the chat 'chat:120363@g.us' with chat_messages, then draft a short friendly reply with draft_save telling the client the retry fix is merged and deploying to stage, so it will be live before their 3pm demo. 3) Add a board card 'Verify retries on stage' in 'Deployed Stage' with a one-line note. Finish with one short sentence.";
  const shown = (l: string, cls = "") => `<span class="${cls}">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
  let lines: string[] = [shown("$ ", "p") + shown("claude -p \"You are my coding agent. Use ONLY the work-inbox tools…\"", "d")];
  const render = () => page.evaluate((h) => (window as any).__term(h, true), lines.join("\n")).catch(() => undefined);
  await render(); await sleep(1500);
  const claude = Bun.spawn(["claude", "-p", prompt, "--mcp-config", mcpConfig, "--strict-mcp-config", "--allowedTools", "mcp__work-inbox__board_get", "mcp__work-inbox__board_move_card", "mcp__work-inbox__board_add_card", "mcp__work-inbox__chat_messages", "mcp__work-inbox__draft_save", "mcp__work-inbox__inbox_list", "--output-format", "stream-json", "--verbose", "--no-session-persistence"], { stdout: "pipe", stderr: "ignore", env: process.env });
  let final = "";
  const reader = (async () => {
    const dec = new TextDecoder(); let buf = "";
    for await (const chunk of claude.stdout as any) {
      buf += dec.decode(chunk);
      let i; while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const ev = JSON.parse(line);
          if (ev.type === "assistant") for (const b of ev.message?.content ?? []) if (b.type === "tool_use") { lines.push(shown("● ", "t") + shown(String(b.name).replace("mcp__work-inbox__", "") + " " + JSON.stringify(b.input).slice(0, 70), "d")); await render(); }
          if (ev.type === "result") { final = String(ev.result ?? ""); lines.push(shown("✓ " + final.slice(0, 220), "t")); await render(); }
        } catch { /* not json */ }
      }
    }
  })();
  const t0 = Date.now();
  while (claude.exitCode === null && Date.now() - t0 < 170_000) { await sleep(1000); if ((Date.now() - t0) / 1000 === 20) await cap("11:01", "I keep working while it runs", "the board updates live (5s refresh)"); }
  if (claude.exitCode === null) claude.kill();
  await reader.catch(() => undefined); await sleep(6500); // let the 5s refresh catch up
  await cap("11:03", "Claude Code moved my card and added a verification card", "all from the terminal, on the same board I see");
  await sleep(3500);
  await page.evaluate(() => (window as any).__term("", false));

  // 11:05 ─ read the draft Claude Code left
  await key("1", 1000);
  await tap(row("Acme Support Group")); await sleep(1500);
  await cap("11:05", "Claude Code left a draft for the client chat", "it read the conversation first. I read it, copy it, and send it from my phone");
  await sleep(3000);
  await key("y", 1500);

  // 11:30 ─ evening, light theme
  await cap("18:30", "End of day. Theme follows me", "Settings → General → Theme", );
  await key(",", 800);
  await tap(page.locator(".snav button", { hasText: "General" })); await sleep(400);
  await page.locator(".field", { hasText: "Theme" }).locator("select").selectOption("light"); await sleep(2200);
  await tap(page.getByRole("button", { name: "Back to inbox" })); await sleep(2600);
  await page.evaluate(() => (window as any).__capOff());
  await page.evaluate(() => (window as any).__title("That was the day", "Jira · GitHub · WhatsApp · Reminders · one inbox, one board"));
  await sleep(3200);

  const video = page.video()!;
  await ctx.close(); await browser.close();
  const path = await video.path();
  const webm = join(OUT, "workday.webm");
  renameSync(path, webm);
  server.kill();
  if (Bun.which("ffmpeg")) {
    const r = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-crf", "24", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(OUT, "workday.mp4")]);
    console.log(r.exitCode === 0 ? "wrote shots/workday.mp4" : "ffmpeg failed");
  }
  console.log("wrote", webm, readdirSync(OUT).filter((f) => f.startsWith("workday")));
}
main().catch((e) => { console.error(e); process.exit(1); });
