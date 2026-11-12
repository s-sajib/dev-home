import type { WhatsappConfig } from "../config";
import type { DB } from "../db";
import { setStatus } from "../poller";
import { upsertEvents } from "../store";
import { getSetting, setSetting } from "../chatllm";
import type { NormalizedEvent, SourceAdapter } from "../types";

/**
 * WhatsApp via WAHA (linked device). STRICTLY READ-ONLY: the only outbound calls this module can make are GETs
 * through `wahaGet`. There is no send, reaction, presence or read-receipt code anywhere in the project.
 */

/** "15551234567:12@s.whatsapp.net" / "15551234567@c.us" / "98765@lid" -> bare local part */
export function jidLocal(id: unknown): string {
  return String(id ?? "").split("@")[0]!.split(":")[0]!;
}

export interface WahaDeps {
  cfg: WhatsappConfig;
  fetchImpl?: typeof fetch;
}

export async function wahaGet(d: WahaDeps, path: string): Promise<any> {
  const res = await (d.fetchImpl ?? fetch)(`${d.cfg.wahaUrl}${path}`, {
    method: "GET",
    headers: { Accept: "application/json", ...(d.cfg.apiKey ? { "X-Api-Key": d.cfg.apiKey } : {}) },
  });
  if (!res.ok) throw new Error(`WAHA ${res.status} on ${path}`);
  return res.json();
}

export function createWhatsappAdapter(deps: WahaDeps | null): SourceAdapter {
  return {
    source: "whatsapp",
    configured: () => deps !== null,
    fetch: async () => [], // push source: events arrive through the webhook
    health: async () => {
      try {
        const s = await wahaGet(deps!, `/api/sessions/${encodeURIComponent(deps!.cfg.session)}`);
        return statusBanner(s?.status);
      } catch (err: any) {
        return { ok: false, banner: `WhatsApp gateway unreachable (${String(err?.message ?? err).slice(0, 80)}). Messages are NOT being collected.` };
      }
    },
  };
}

export function statusBanner(status: string | undefined): { ok: boolean; banner: string | null } {
  if (status === "WORKING") return { ok: true, banner: null };
  const hint = status === "SCAN_QR_CODE" ? "re-scan the QR code in WAHA (and open the Business app on your phone)" : "check the WAHA container";
  return { ok: false, banner: `WhatsApp is disconnected (${status ?? "unknown"}): ${hint}. Messages are NOT being collected.` };
}

function pick<T>(...candidates: (T | undefined | null)[]): T | undefined {
  return candidates.find((c) => c !== undefined && c !== null);
}

/** Pull mentioned JIDs / quoted participant out of whichever place the engine put them. */
export function extractContext(p: any): { mentioned: string[]; quotedParticipant: string | null } {
  const ctx = p?._data?.message?.extendedTextMessage?.contextInfo ?? p?._data?.contextInfo ?? p?._data?.message?.contextInfo ?? {};
  const mentioned = pick<string[]>(p?.mentionedIds, p?.mentionedJidList, p?._data?.mentionedJidList, ctx.mentionedJid, ctx.mentionedJidList) ?? [];
  const quotedParticipant = pick<string>(p?.replyTo?.participant, ctx.participant, p?._data?.quotedParticipant) ?? null;
  return { mentioned, quotedParticipant };
}

export interface ParseOpts {
  myIds: string[];
  chatName: string;
  /** Force the chat id (history endpoints don't always carry a usable from/to) */
  chatId?: string;
}

/** Normalise one WAHA message payload. Returns null for things we ignore (status broadcasts, empty events). */
export function parseWahaMessage(p: any, o: ParseOpts): NormalizedEvent | null {
  if (!p || !p.id) return null;
  const chatId = o.chatId ?? String(p.fromMe ? p.to : p.from);
  if (!chatId || chatId.includes("status@broadcast") || chatId.endsWith("@newsletter")) return null;
  const isGroup = chatId.endsWith("@g.us");
  const mine = new Set(o.myIds.map(jidLocal).filter(Boolean));
  const fromMe = p.fromMe === true;

  const { mentioned, quotedParticipant } = extractContext(p);
  const body0 = String(p.body ?? "");
  const body = body0 || (p.hasMedia ? `[${String(p.media?.mimetype ?? p._data?.type ?? "media").split("/")[0]}]` : "");
  if (!body) return null;

  const mentionedMe = mentioned.some((m) => mine.has(jidLocal(m))) || [...mine].some((id) => body.includes(`@${id}`));
  const quotesMe = quotedParticipant ? mine.has(jidLocal(quotedParticipant)) : false;
  const senderId = fromMe ? [...mine][0] ?? "me" : jidLocal(p.participant ?? p.from);
  const author = fromMe ? "Me" : String(p._data?.notifyName ?? p._data?.pushName ?? p.notifyName ?? senderId);

  return {
    source: "whatsapp",
    sourceId: String(p.id),
    kind: "chat",
    nativeKey: `chat:${chatId}`,
    ticketKey: null,
    title: o.chatName || (isGroup ? chatId : author),
    author,
    authorIsMe: fromMe,
    body,
    url: null,
    ts: (Number(p.timestamp) || Math.floor(Date.now() / 1000)) * 1000,
    // In a 1:1 work chat every incoming message is addressed to me.
    mentionsMe: !fromMe && (mentionedMe || quotesMe || !isGroup),
    meta: { isGroup, quotesMe, mentionedMe, chatId },
  };
}

function chatNameFor(db: DB, chatId: string): string | null {
  const r = db.query("SELECT name FROM chats WHERE chat_id = ?").get(chatId) as { name: string } | null;
  return r?.name ?? null;
}

function saveChatName(db: DB, chatId: string, name: string, isGroup: boolean) {
  db.query(
    `INSERT INTO chats (chat_id, name, is_group, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
  ).run(chatId, name, isGroup ? 1 : 0, Date.now());
}

export interface WebhookResult {
  handled: boolean;
  stored: number;
  reason?: string;
}

/** My ids = configured ids + any `me` WAHA reported in webhooks (remembered, so WA_MY_IDS is optional). */
export function getMyIds(db: DB, cfg: WhatsappConfig): string[] {
  const learned = (getSetting(db, "wa_my_ids") ?? "").split(",").filter(Boolean);
  return [...new Set([...cfg.myIds, ...learned])];
}

function rememberMe(db: DB, ids: unknown[]) {
  const have = new Set((getSetting(db, "wa_my_ids") ?? "").split(",").filter(Boolean));
  const add = ids.filter(Boolean).map(String).filter((x) => !have.has(x));
  if (add.length) setSetting(db, "wa_my_ids", [...have, ...add].join(","));
}

/** Pull older messages for one chat from WAHA (GET only) so a summary can cover more than what the webhook has seen. */
export async function backfillChat(db: DB, deps: WahaDeps, itemKey: string, n: number): Promise<number> {
  const chatId = itemKey.replace(/^chat:/, "");
  const rows = await wahaGet(deps, `/api/${encodeURIComponent(deps.cfg.session)}/chats/${encodeURIComponent(chatId)}/messages?limit=${Math.min(n, 500)}&downloadMedia=false`);
  if (!Array.isArray(rows)) return 0;
  const name = chatNameFor(db, chatId) ?? "";
  const events = rows
    .map((p) => parseWahaMessage(p, { myIds: getMyIds(db, deps.cfg), chatName: name, chatId }))
    .filter((e): e is NormalizedEvent => e !== null);
  upsertEvents(db, events);
  return events.length;
}

/** Entry point for POST /webhook/waha. Events only ever flow in; nothing is sent back. */
export async function handleWahaWebhook(db: DB, deps: WahaDeps, body: any, now = Date.now()): Promise<WebhookResult> {
  const event = String(body?.event ?? "");

  if (event === "session.status") {
    const st = statusBanner(body?.payload?.status);
    setStatus(db, { source: "whatsapp", ok: st.ok, lastPollAt: now, error: null, banner: st.banner });
    return { handled: true, stored: 0 };
  }
  if (event !== "message" && event !== "message.any") return { handled: false, stored: 0, reason: `ignored event ${event}` };

  const p = body.payload;
  rememberMe(db, [body?.me?.id, body?.me?.lid]);
  const myIds = getMyIds(db, deps.cfg);
  const chatId = String(p?.fromMe ? p?.to : p?.from);
  let name = chatNameFor(db, chatId);
  if (!name && chatId.endsWith("@g.us")) {
    try {
      const g = await wahaGet(deps, `/api/${encodeURIComponent(deps.cfg.session)}/groups/${encodeURIComponent(chatId)}`);
      name = g?.subject ?? g?.name ?? null;
      if (name) saveChatName(db, chatId, name, true);
    } catch {
      /* fall back to the id; name resolves on a later message */
    }
  }
  if (!name && !chatId.endsWith("@g.us") && p && !p.fromMe) {
    name = String(p._data?.notifyName ?? p._data?.pushName ?? "") || null;
    if (name) saveChatName(db, chatId, name, false);
  }

  const ev = parseWahaMessage(p, { myIds, chatName: name ?? "" });
  if (!ev) return { handled: true, stored: 0, reason: "ignored message" };
  upsertEvents(db, [ev]);
  setStatus(db, { source: "whatsapp", ok: true, lastPollAt: now, error: null, banner: null });
  return { handled: true, stored: 1 };
}

/** PRD: chat text older than 90 days is purged. */
export function purgeOldChats(db: DB, now = Date.now(), days = 90): number {
  const cutoff = now - days * 86_400_000;
  return db.query("DELETE FROM events WHERE source = 'whatsapp' AND ts < ?").run(cutoff).changes;
}
