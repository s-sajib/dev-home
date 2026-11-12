import { describe, expect, test } from "vitest";
import { createApi } from "../src/server/api";
import { autoHandleChats, chatMessages, clampN, getMode, latestSummary, setMode, summarizeChat, summaryDefault } from "../src/server/chatllm";
import { latestDraft, type Runner } from "../src/server/claude";
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { demoEvents, demoRunner, seedDemo } from "../src/server/demo";
import { rebuildItems } from "../src/server/inbox";
import { memoryStore } from "../src/server/secrets";
import { ConfigManager } from "../src/server/settings";
import { upsertEvents } from "../src/server/store";
import type { NormalizedEvent } from "../src/server/types";

const now = Date.now();
const KEY = "chat:120363@g.us";
const cfg = loadConfig({});

const manyMessages = (count: number): NormalizedEvent[] =>
  Array.from({ length: count }, (_, i) => ({
    source: "whatsapp" as const, sourceId: `bulk${i}`, kind: "chat" as const, nativeKey: KEY, ticketKey: null, title: "Acme Support Group",
    author: i % 7 === 0 ? "Me" : "Priya", authorIsMe: i % 7 === 0, body: `message number ${i}`, url: null, ts: now - (count - i) * 60_000 * 20, mentionsMe: false, meta: {},
  }));

const setup = (extra: NormalizedEvent[] = []) => {
  const db = openDb(":memory:");
  upsertEvents(db, [...demoEvents(now), ...extra]);
  rebuildItems(db, { now, staleDays: 5, replyHours: 4 });
  return db;
};

const okOut = { summary: "S", action_items: ["a"], reply_needed: true, reply_draft: "Will do.", sensitive: false };
const lineCount = (p: string) => (p.match(/^\[\d{4}-\d\d-\d\d \d\d:\d\d\]/gm) ?? []).length;

describe("summarize last N messages", () => {
  test("uses exactly the last N stored messages, oldest first", async () => {
    const db = setup(manyMessages(150));
    for (const n of [20, 50, 100]) {
      let seen = "";
      await summarizeChat({ db, cfg, run: async (p) => ((seen = p), okOut) }, KEY, n, now);
      expect(lineCount(seen)).toBe(n);
      expect(seen).toContain("message number 149");
      expect(seen).not.toContain("message number 0\n");
    }
  });

  test("custom N is clamped and falls back to the default for junk", () => {
    expect(clampN(1000, 20)).toBe(500);
    expect(clampN("abc", 20)).toBe(20);
    expect(clampN(-5, 20)).toBe(20);
    expect(clampN("37", 20)).toBe(37);
  });

  test("default is 20 and follows the config", () => {
    const db = openDb(":memory:");
    expect(summaryDefault(db, cfg)).toBe(20);
    expect(summaryDefault(db, loadConfig({ SUMMARY_MESSAGES: "100" }))).toBe(100);
  });

  test("backfills from WAHA only when fewer than N are stored", async () => {
    const db = setup();
    const asked: number[] = [];
    const backfill = async (_k: string, n: number) => void asked.push(n);
    await summarizeChat({ db, cfg, run: async () => okOut, backfill }, KEY, 200, now);
    expect(asked).toEqual([200]);
    const db2 = setup(manyMessages(60));
    const asked2: number[] = [];
    await summarizeChat({ db: db2, cfg, run: async () => okOut, backfill: async (_k, n) => void asked2.push(n) }, KEY, 20, now);
    expect(asked2).toEqual([]);
  });

  test("a failing backfill does not block the summary", async () => {
    const db = setup();
    const s = await summarizeChat({ db, cfg, run: async () => okOut, backfill: async () => { throw new Error("WAHA down"); } }, KEY, 200, now);
    expect(s.summary).toBe("S");
  });

  test("stores the summary and a copy-only draft when a reply is owed", async () => {
    const db = setup();
    await summarizeChat({ db, cfg, run: async () => okOut }, KEY, 20, now);
    expect(latestSummary(db, KEY)?.actionItems).toEqual(["a"]);
    expect(latestDraft(db, KEY)?.body).toBe("Will do.");
  });

  test("no draft is stored when no reply is owed", async () => {
    const db = setup();
    await summarizeChat({ db, cfg, run: async () => ({ ...okOut, reply_needed: false, reply_draft: "" }) }, KEY, 20, now);
    expect(latestDraft(db, KEY)).toBeNull();
  });

  test("never-mode chats cannot be summarised, even on a keypress", async () => {
    const db = setup();
    setMode(db, KEY, "never");
    await expect(summarizeChat({ db, cfg, run: async () => okOut }, KEY, 20, now)).rejects.toThrow(/Never/);
  });

  test("the prompt marks my messages as ME, redacts, and treats chat as data", async () => {
    const db = setup([{ ...manyMessages(1)[0]!, sourceId: "x", body: "mail me at dana@acme.com", authorIsMe: false, author: "Priya" }]);
    let seen = "";
    await summarizeChat({ db, cfg, run: async (p) => ((seen = p), okOut) }, KEY, 20, now);
    expect(seen).not.toContain("dana@acme.com");
    expect(seen).toContain('<data id="chat">');
  });
});

describe("auto mode", () => {
  test("handles only auto chats, after the conversation settles, once per activity", async () => {
    const db = setup();
    setMode(db, KEY, "auto"); // the other demo chat stays manual
    let calls = 0;
    const run: Runner = async () => (calls++, okOut);
    const deps = { db, cfg, run };
    expect((await autoHandleChats(deps, now)).handled).toBe(1);
    expect(calls).toBe(1);
    expect((await autoHandleChats(deps, now)).handled).toBe(0); // same activity, cached

    // new message arrives -> not handled until it has settled for a minute
    const fresh: NormalizedEvent = { ...manyMessages(1)[0]!, sourceId: "new1", body: "any news?", authorIsMe: false, ts: now - 10_000 };
    upsertEvents(db, [fresh]);
    rebuildItems(db, { now, staleDays: 5, replyHours: 4 });
    expect((await autoHandleChats(deps, now)).handled).toBe(0);
    expect((await autoHandleChats(deps, now + 120_000)).handled).toBe(1);
    expect(calls).toBe(2);
  });

  test("manual and never chats are untouched; default mode is manual", async () => {
    const db = setup();
    let calls = 0;
    await autoHandleChats({ db, cfg, run: async () => (calls++, okOut) }, now);
    expect(calls).toBe(0);
    expect(getMode(db, KEY)).toBe("manual");
  });

  test("one failing chat does not stop the others", async () => {
    const db = setup();
    setMode(db, KEY, "auto");
    setMode(db, "chat:447700900007@c.us", "auto");
    const run: Runner = async (p) => { if (p.includes("Lena")) throw new Error("boom"); return okOut; };
    const r = await autoHandleChats({ db, cfg, run }, now);
    expect(r.handled).toBe(1);
    expect(r.errors[0]).toContain("boom");
  });
});

describe("api", () => {
  const make = () => {
    const db = openDb(":memory:");
    seedDemo(db);
    rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
    const c = loadConfig({ WORK_INBOX_DEMO: "1" });
    const api = createApi({ db, cfg: c, adapters: [], run: demoRunner, settings: new ConfigManager(c, db, memoryStore(), {}) });
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await api(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined }));
      return { status: res!.status, json: (await res!.json()) as any };
    };
    return { db, call };
  };

  test("summarize endpoint returns and exposes the summary; settings persist the default N", async () => {
    const { call } = make();
    const r = await call("POST", "/api/items/chat:447700900007@c.us/summarize", { n: 50 });
    expect(r.json.summary.n).toBeLessThanOrEqual(50);
    expect(r.json.summary.replyNeeded).toBe(true);
    await call("POST", "/api/settings", { changes: { summaryDefault: 100 } });
    const inbox = (await call("GET", "/api/inbox")).json;
    expect(inbox.ui.summaryDefault).toBe(100);
    expect(inbox.items.find((i: any) => i.itemKey === "chat:447700900007@c.us").summary.summary).toContain("Lena");
  });

  test("llm-mode endpoint validates and persists", async () => {
    const { call } = make();
    expect((await call("POST", "/api/items/chat:447700900007@c.us/llm-mode", { mode: "auto" })).json.mode).toBe("auto");
    expect((await call("POST", "/api/items/chat:447700900007@c.us/llm-mode", { mode: "yolo" })).status).toBe(400);
    expect((await call("POST", "/api/items/ticket:PAY-231/llm-mode", { mode: "auto" })).status).toBe(400);
    const inbox = (await call("GET", "/api/inbox")).json;
    expect(inbox.items.find((i: any) => i.itemKey === "chat:447700900007@c.us").llmMode).toBe("auto");
  });

  test("never-mode summarize returns an error and is logged", async () => {
    const { call, db } = make();
    await call("POST", "/api/items/chat:447700900007@c.us/llm-mode", { mode: "never" });
    const r = await call("POST", "/api/items/chat:447700900007@c.us/summarize", { n: 20 });
    expect(r.status).toBe(502);
    expect((db.query("SELECT ok FROM actions_log WHERE action = 'summarize'").get() as any).ok).toBe(0);
  });
});
