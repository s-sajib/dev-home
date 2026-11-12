/**
 * Block-1 spike for WhatsApp. Run on the Mac with WAHA up (docker compose -f docker-compose.waha.yml up -d):
 *   bun scripts/spike-waha.ts
 * It prints the WAHA session status, then listens on :3580 for webhook posts and saves each raw payload to
 * data/spike/. Point WHATSAPP_HOOK_URL at http://host.docker.internal:3580/ while spiking.
 * Read-only: it only issues GET requests to WAHA.
 */
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.WAHA_URL ?? "http://localhost:3000";
const session = process.env.WAHA_SESSION ?? "default";
const headers: Record<string, string> = process.env.WAHA_API_KEY ? { "X-Api-Key": process.env.WAHA_API_KEY } : {};

try {
  const res = await fetch(`${base}/api/sessions/${session}`, { headers });
  console.log("session:", res.status, JSON.stringify(await res.json()));
} catch (e: any) {
  console.log("WAHA unreachable:", e.message);
}

mkdirSync("data/spike", { recursive: true });
let n = 0;
Bun.serve({
  port: 3580,
  async fetch(req) {
    const body: any = await req.json().catch(() => null);
    const p = body?.payload ?? {};
    const ctx = p?._data?.message?.extendedTextMessage?.contextInfo ?? {};
    console.log(
      `#${++n} ${body?.event} fromMe=${p.fromMe} chat=${p.fromMe ? p.to : p.from} participant=${p.participant ?? "-"} ` +
        `mentioned=${JSON.stringify(p.mentionedIds ?? ctx.mentionedJid ?? [])} quoted=${p.replyTo?.participant ?? ctx.participant ?? "-"} me=${JSON.stringify(body?.me)}`,
    );
    writeFileSync(`data/spike/${Date.now()}-${n}.json`, JSON.stringify(body, null, 2));
    return new Response("ok");
  },
});
console.log("listening on :3580. Send yourself a group @mention, a quoted reply, and a message from your phone.");
