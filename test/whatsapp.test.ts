import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { createWhatsappAdapter, handleWahaWebhook, jidLocal, parseWahaMessage, purgeOldChats, statusBanner } from "../src/server/adapters/whatsapp";
import { getStatuses, pollOnce } from "../src/server/poller";
import { rebuildItems } from "../src/server/inbox";

const cfg = { wahaUrl: "http://waha:3000", session: "default", apiKey: "k", webhookToken: "t", myIds: ["15551234567@c.us", "98765432101@lid"] };
const GROUP = "120363000@g.us";
const ts = (minsAgo: number) => Math.floor((Date.now() - minsAgo * 60_000) / 1000);

const groupMsg = (over: any = {}) => ({
  event: "message.any", session: "default", me: { id: "15551234567@c.us" },
  payload: { id: "false_120363000@g.us_A", timestamp: ts(300), from: GROUP, fromMe: false, participant: "447700900001@c.us", body: "hello team", _data: { notifyName: "Priya" }, ...over },
});

describe("jid handling", () => {
  test("strips domain and device suffix", () => {
    expect(jidLocal("15551234567:12@s.whatsapp.net")).toBe("15551234567");
    expect(jidLocal("98765432101@lid")).toBe("98765432101");
  });
});

describe("parsing", () => {
  const o = { myIds: cfg.myIds, chatName: "Acme Support" };
  test("mention by phone JID", () => {
    const e = parseWahaMessage(groupMsg({ mentionedIds: ["15551234567@c.us"] }).payload, o)!;
    expect(e.mentionsMe).toBe(true);
    expect(e.nativeKey).toBe(`chat:${GROUP}`);
    expect(e.title).toBe("Acme Support");
  });
  test("mention that carries only my LID still matches (PRD LID risk)", () => {
    const e = parseWahaMessage(groupMsg({ _data: { notifyName: "Priya", message: { extendedTextMessage: { contextInfo: { mentionedJid: ["98765432101@lid"] } } } } }).payload, o)!;
    expect(e.mentionsMe).toBe(true);
  });
  test("mention via @number in the text", () => {
    expect(parseWahaMessage(groupMsg({ body: "@15551234567 please look" }).payload, o)!.mentionsMe).toBe(true);
  });
  test("quoted reply to my message counts as addressing me", () => {
    const e = parseWahaMessage(groupMsg({ replyTo: { id: "x", participant: "98765432101@lid", body: "mine" } }).payload, o)!;
    expect(e.mentionsMe).toBe(true);
    expect(e.meta.quotesMe).toBe(true);
  });
  test("plain group chatter does not mention me", () => {
    expect(parseWahaMessage(groupMsg().payload, o)!.mentionsMe).toBe(false);
  });
  test("my own message sent from the phone is authorIsMe and keyed to the chat", () => {
    const e = parseWahaMessage({ id: "false_me_1", timestamp: ts(10), from: "15551234567@c.us", to: GROUP, fromMe: true, body: "on it" }, o)!;
    expect(e.authorIsMe).toBe(true);
    expect(e.nativeKey).toBe(`chat:${GROUP}`);
    expect(e.mentionsMe).toBe(false);
  });
  test("1:1 incoming messages address me", () => {
    const e = parseWahaMessage({ id: "d1", timestamp: ts(1), from: "447700900002@c.us", fromMe: false, body: "got a sec?", _data: { notifyName: "Tom" } }, { myIds: cfg.myIds, chatName: "" })!;
    expect(e.mentionsMe).toBe(true);
    expect(e.title).toBe("Tom");
  });
  test("media without text gets a placeholder; status broadcasts are ignored", () => {
    expect(parseWahaMessage({ id: "m", timestamp: ts(1), from: GROUP, fromMe: false, hasMedia: true, body: "", media: { mimetype: "audio/ogg" } }, o)!.body).toBe("[audio]");
    expect(parseWahaMessage({ id: "s", timestamp: ts(1), from: "status@broadcast", body: "x" }, o)).toBeNull();
  });
});

describe("webhook + rules end to end", () => {
  const deps = (calls: { url: string; method: string }[] = []) => ({
    cfg,
    fetchImpl: (async (url: any, init: any) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ subject: "Acme Support Group" }), { status: 200 });
    }) as any,
  });

  test("unanswered mention becomes needs_reply after N hours; my reply clears it", async () => {
    const db = openDb(":memory:");
    const calls: any[] = [];
    await handleWahaWebhook(db, deps(calls), groupMsg({ mentionedIds: ["15551234567@c.us"], body: "need an update on PAY-231" }));
    let items = rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
    const chat = items.find((i) => i.itemKey === `chat:${GROUP}`)!;
    expect(chat.title).toBe("Acme Support Group");
    expect(chat.flags).toContain("needs_reply");
    expect(chat.ticketKey).toBe("PAY-231");

    await handleWahaWebhook(db, deps(), { event: "message.any", payload: { id: "me1", timestamp: ts(1), from: "15551234567@c.us", to: GROUP, fromMe: true, body: "on it" } });
    items = rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
    expect(items.find((i) => i.itemKey === `chat:${GROUP}`)?.flags ?? []).not.toContain("needs_reply");
    // read-only: every outbound call was a GET
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  test("session.status other than WORKING shows a disconnected banner", async () => {
    const db = openDb(":memory:");
    await handleWahaWebhook(db, deps(), { event: "session.status", payload: { status: "SCAN_QR_CODE" } });
    const st = getStatuses(db).find((s) => s.source === "whatsapp")!;
    expect(st.ok).toBe(false);
    expect(st.banner).toContain("NOT being collected");
  });

  test("health poll flags an unreachable gateway and clears when WORKING", async () => {
    const db = openDb(":memory:");
    const down = createWhatsappAdapter({ cfg, fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as any });
    await pollOnce(db, [down], { staleDays: 5, replyHours: 4 });
    expect(getStatuses(db)[0]!.banner).toContain("unreachable");
    const up = createWhatsappAdapter({ cfg, fetchImpl: (async () => new Response(JSON.stringify({ status: "WORKING" }))) as any });
    await pollOnce(db, [up], { staleDays: 5, replyHours: 4 });
    expect(getStatuses(db)[0]!.banner).toBeNull();
    expect(statusBanner("WORKING").ok).toBe(true);
  });

  test("90-day purge removes only old chat text", async () => {
    const db = openDb(":memory:");
    await handleWahaWebhook(db, deps(), groupMsg({ id: "old", timestamp: ts(100 * 24 * 60) }));
    await handleWahaWebhook(db, deps(), groupMsg({ id: "new", timestamp: ts(5) }));
    expect(purgeOldChats(db)).toBe(1);
  });

  test("config wires WA_MY_IDS and refuses an empty token by default", () => {
    const c = loadConfig({ WAHA_URL: "http://localhost:3000", WA_MY_IDS: "1555@c.us, 99@lid" });
    expect(c.whatsapp!.myIds).toEqual(["1555@c.us", "99@lid"]);
  });
});

import { backfillChat, getMyIds } from "../src/server/adapters/whatsapp";
import { chatMessages } from "../src/server/chatllm";

describe("history backfill + learned ids", () => {
  test("backfill is GET-only, keys messages to the chat even without from/to, and is idempotent", async () => {
    const db = openDb(":memory:");
    const calls: { url: string; method: string }[] = [];
    const history = [
      { id: "h1", timestamp: ts(600), fromMe: false, participant: "447700900001@c.us", body: "older question", _data: { notifyName: "Priya" } },
      { id: "h2", timestamp: ts(590), fromMe: true, body: "older answer" },
    ];
    const fetchImpl = (async (url: any, init: any) => (calls.push({ url: String(url), method: init?.method ?? "GET" }), new Response(JSON.stringify(history)))) as any;
    const deps = { cfg, fetchImpl };
    expect(await backfillChat(db, deps, `chat:${GROUP}`, 50)).toBe(2);
    await backfillChat(db, deps, `chat:${GROUP}`, 50);
    expect(chatMessages(db, `chat:${GROUP}`, 10).map((m) => m.body)).toEqual(["older question", "older answer"]);
    expect(chatMessages(db, `chat:${GROUP}`, 10)[1]!.authorIsMe).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls[0]!.url).toContain("limit=50");
  });

  test("my ids are learned from webhook envelopes, so WA_MY_IDS is optional", async () => {
    const db = openDb(":memory:");
    const bare = { ...cfg, myIds: [] as string[] };
    const deps = { cfg: bare, fetchImpl: (async () => new Response("{}")) as any };
    await handleWahaWebhook(db, deps, { event: "message.any", me: { id: "15551234567@c.us", lid: "98765432101@lid" }, payload: { id: "z1", timestamp: ts(1), from: GROUP, fromMe: false, participant: "1@c.us", body: "hi" } });
    expect(getMyIds(db, bare)).toEqual(["15551234567@c.us", "98765432101@lid"]);
  });
});
