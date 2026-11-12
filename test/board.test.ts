import { describe, expect, test } from "vitest";
import { createApi, guardRequest } from "../src/server/api";
import { addCard, autoColumn, cardFromEvent, getBoard, moveCard, parseStatusMap, PIPELINE_A, PIPELINE_B, removeCard, syncBoard, updateCard } from "../src/server/board";
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { demoEvents, demoRunner, seedDemo } from "../src/server/demo";
import { rebuildItems } from "../src/server/inbox";
import { memoryStore } from "../src/server/secrets";
import { ConfigManager, validate, FIELDS } from "../src/server/settings";
import { upsertEvents } from "../src/server/store";
import type { NormalizedEvent } from "../src/server/types";

const cfg = loadConfig({});
const now = Date.now();
const base = { source: "jira" as const, authorIsMe: false, author: "x", body: "", url: null, ts: now, mentionsMe: false, ticketKey: "T-1", title: "T-1 thing" };
const ticket = (status: string, extra: Record<string, unknown> = {}): NormalizedEvent => ({ ...base, sourceId: "i", kind: "ticket", nativeKey: "ticket:T-1", meta: { status, assignedToMe: true, ...extra } });
const pr = (meta: Record<string, unknown>): NormalizedEvent => ({ ...base, source: "github", sourceId: "p", kind: "pr", nativeKey: "pr:o/r#1", meta: { mine: true, ...meta } });
const rr = (): NormalizedEvent => ({ ...base, source: "github", sourceId: "r", kind: "review_request", nativeKey: "pr:o/r#1", meta: { open: true } });

describe("auto placement", () => {
  test("columns default to a pipeline that includes both deployment variants' stages", () => {
    expect(cfg.boardColumns).toEqual(PIPELINE_B);
    expect(PIPELINE_A).not.toContain("Ready for Release");
  });
  test("Jira status maps to a column, unmapped falls to null", () => {
    expect(autoColumn([ticket("In Progress")], cfg)).toBe("In Progress");
    expect(autoColumn([ticket("Backlog")], cfg)).toBe("Pending");
    expect(autoColumn([ticket("Some Custom Status")], cfg)).toBeNull();
  });
  test("an open PR pulls an in-progress ticket to PR Review; merged goes to Merged", () => {
    expect(autoColumn([ticket("In Progress"), pr({ merged: false })], cfg)).toBe("PR Review");
    expect(autoColumn([ticket("In Progress"), pr({ merged: true })], cfg)).toBe("Merged");
    expect(autoColumn([ticket("To Do")], cfg)).toBe("To Do");
  });
  test("Decision Needed always wins, even over an open PR", () => {
    expect(autoColumn([ticket("Blocked"), pr({ merged: false })], cfg)).toBe("Decision Needed");
  });
  test("a standalone review request lands in PR Review", () => {
    expect(autoColumn([rr()], cfg)).toBe("PR Review");
  });
  test("status map is case-insensitive and ignores junk lines", () => {
    const m = parseStatusMap(["Ready For QA = PR Review", "no equals sign", " Done=Merged "]);
    expect(m.get("ready for qa")).toBe("PR Review");
    expect(m.get("done")).toBe("Merged");
    expect(m.size).toBe(2);
  });
});

describe("sync", () => {
  const seeded = () => {
    const db = openDb(":memory:");
    upsertEvents(db, demoEvents(now));
    return db;
  };
  test("creates cards for my work, not for chats, other people's tickets or reminders", () => {
    const db = seeded();
    syncBoard(db, cfg, now);
    const titles = getBoard(db, cfg, now).cards.map((c) => c.title);
    expect(titles.some((t) => t.includes("PAY-231"))).toBe(true);
    expect(titles.some((t) => t.includes("Acme Support Group"))).toBe(false);
    expect(titles.some((t) => t.includes("Follow up on PAY-231"))).toBe(false);
  });
  test("is idempotent", () => {
    const db = seeded();
    syncBoard(db, cfg, now);
    const n = getBoard(db, cfg, now).cards.length;
    expect(syncBoard(db, cfg, now)).toEqual({ created: 0, moved: 0 });
    expect(getBoard(db, cfg, now).cards.length).toBe(n);
  });
  test("demo tickets land where the rules say", () => {
    const db = seeded();
    syncBoard(db, cfg, now);
    const col = (k: string) => getBoard(db, cfg, now).cards.find((c) => c.itemKey === k)?.col;
    expect(col("ticket:PAY-231")).toBe("PR Review"); // In Progress + open PR
    expect(col("ticket:OPS-88")).toBe("Decision Needed"); // Blocked
    expect(col("ticket:DOC-12")).toBe("Merged"); // merged PR
    expect(col("ticket:API-90")).toBe("Pending"); // Backlog
    expect(col("ticket:WEB-402")).toBe("To Do");
  });
  test("a status change moves an unpinned card; a manual move pins it and automation stops", () => {
    const db = seeded();
    syncBoard(db, cfg, now);
    const id = getBoard(db, cfg, now).cards.find((c) => c.itemKey === "ticket:WEB-402")!.id;
    upsertEvents(db, [{ ...ticket("In Progress"), ticketKey: "WEB-402", nativeKey: "ticket:WEB-402", sourceId: "issue:WEB-402", title: "WEB-402 x", ts: now + 1 }]);
    expect(syncBoard(db, cfg, now).moved).toBe(1);
    expect(getBoard(db, cfg, now).cards.find((c) => c.id === id)!.col).toBe("In Progress");
    moveCard(db, cfg, id, "Deployed Stage");
    upsertEvents(db, [{ ...ticket("Backlog"), ticketKey: "WEB-402", nativeKey: "ticket:WEB-402", sourceId: "issue:WEB-402", title: "WEB-402 x", ts: now + 2 }]);
    syncBoard(db, cfg, now);
    const c = getBoard(db, cfg, now).cards.find((x) => x.id === id)!;
    expect(c.col).toBe("Deployed Stage");
    expect(c.pinned).toBe(true);
    updateCard(db, id, { pinned: false });
    syncBoard(db, cfg, now);
    expect(getBoard(db, cfg, now).cards.find((x) => x.id === id)!.col).toBe("Pending");
  });
});

describe("cards", () => {
  test("add, edit, move with ordering, remove", () => {
    const db = openDb(":memory:");
    const a = addCard(db, cfg, { title: "A", col: "Pending" });
    const b = addCard(db, cfg, { title: "B", col: "Pending" });
    const c = addCard(db, cfg, { title: "C", col: "Pending" });
    moveCard(db, cfg, c, "Pending", 0);
    expect(getBoard(db, cfg).cards.filter((x) => x.col === "Pending").map((x) => x.title)).toEqual(["C", "A", "B"]);
    moveCard(db, cfg, a, "In Progress");
    expect(getBoard(db, cfg).cards.find((x) => x.id === a)!.col).toBe("In Progress");
    updateCard(db, b, { title: "B2", notes: "n" });
    expect(getBoard(db, cfg).cards.find((x) => x.id === b)!.title).toBe("B2");
    removeCard(db, b);
    expect(getBoard(db, cfg).cards.some((x) => x.id === b)).toBe(false);
  });
  test("rejects empty titles, unknown columns and duplicates", () => {
    const db = openDb(":memory:");
    expect(() => addCard(db, cfg, { title: "  " })).toThrow(/title/);
    const id = addCard(db, cfg, { title: "x" });
    expect(() => moveCard(db, cfg, id, "Nowhere")).toThrow(/Unknown column/);
    addCard(db, cfg, { title: "linked", itemKey: "ticket:A-1" });
    expect(() => addCard(db, cfg, { title: "again", itemKey: "ticket:A-1" })).toThrow(/already/);
  });
  test("a card in a removed column shows in the first column instead of vanishing", () => {
    const db = openDb(":memory:");
    addCard(db, cfg, { title: "stranded", col: "Deployed Prod" });
    const two = { ...cfg, boardColumns: ["Todo", "Done"] };
    expect(getBoard(db, two).cards[0]!.col).toBe("Todo");
  });
  test("column setting validation", () => {
    const f = FIELDS.find((x) => x.key === "boardColumns")!;
    expect(() => validate(f, "Only one")).toThrow(/two columns/);
    expect(() => validate(f, "A\na")).toThrow(/unique/);
    expect(validate(f, "Todo\nDoing\nDone")).toEqual(["Todo", "Doing", "Done"]);
  });
});

describe("api", () => {
  const make = () => {
    const c = loadConfig({ WORK_INBOX_DEMO: "1" });
    const db = openDb(":memory:");
    seedDemo(db);
    rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
    const api = createApi({ db, cfg: c, adapters: [], run: demoRunner, settings: new ConfigManager(c, db, memoryStore(), {}) });
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const r = await api(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers }));
      return { status: r!.status, json: (await r!.json()) as any };
    };
    return { db, call };
  };
  test("GET /api/board syncs and returns columns + cards incl. manual ones", async () => {
    const { call } = make();
    const b = (await call("GET", "/api/board")).json;
    expect(b.columns).toEqual(PIPELINE_B);
    expect(b.cards.some((c: any) => c.title === "Hotfix: invoice rounding" && c.col === "Deployed Prod")).toBe(true);
    expect(b.cards.some((c: any) => c.itemKey === "ticket:PAY-231")).toBe(true);
  });
  test("create, move (pins), delete over HTTP; bad input is a 400", async () => {
    const { call } = make();
    const id = (await call("POST", "/api/board/cards", { title: "New thing", col: "To Do" })).json.id;
    expect((await call("PATCH", `/api/board/cards/${id}`, { col: "PR Review", index: 0 })).json.ok).toBe(true);
    const card = (await call("GET", "/api/board")).json.cards.find((c: any) => c.id === id);
    expect(card.col).toBe("PR Review");
    expect(card.pinned).toBe(true);
    expect((await call("PATCH", `/api/board/cards/${id}`, { col: "Nope" })).status).toBe(400);
    expect((await call("POST", "/api/board/cards", { title: "" })).status).toBe(400);
    expect((await call("DELETE", `/api/board/cards/${id}`)).json.ok).toBe(true);
  });
  test("any inbox item can be put on the board", async () => {
    const { call } = make();
    const r = await call("POST", "/api/items/chat:447700900007@c.us/board", { col: "Decision Needed" });
    expect(r.json.ok).toBe(true);
    const c = (await call("GET", "/api/board")).json.cards.find((x: any) => x.itemKey === "chat:447700900007@c.us");
    expect(c.col).toBe("Decision Needed");
    expect((await call("POST", "/api/items/chat:447700900007@c.us/board", {})).status).toBe(502); // already there
  });
});

describe("local-only API guard (CSRF / DNS rebinding)", () => {
  const g = (headers: Record<string, string>) => guardRequest(new Request("http://127.0.0.1:3571/api/inbox", { headers }), { host: "127.0.0.1", port: 3571 });
  test("same-origin browser requests pass", () => {
    expect(g({ host: "127.0.0.1:3571", origin: "http://127.0.0.1:3571", "sec-fetch-site": "same-origin" })).toBeNull();
    expect(g({ host: "localhost:3571" })).toBeNull();
  });
  test("non-browser clients (no Host/Origin) pass", () => {
    expect(g({})).toBeNull();
  });
  test("a rebinding Host is refused", async () => {
    expect((await g({ host: "evil.example:3571" }))!.status).toBe(403);
  });
  test("a cross-site page cannot write: foreign Origin and cross-site fetch are refused", async () => {
    expect((await g({ host: "127.0.0.1:3571", origin: "https://evil.example" }))!.status).toBe(403);
    expect((await g({ host: "127.0.0.1:3571", "sec-fetch-site": "cross-site" }))!.status).toBe(403);
    expect((await g({ host: "127.0.0.1:3571", "sec-fetch-site": "same-site" }))!.status).toBe(403); // another local dev server
  });
  test("the API applies it, and the webhook is exempt (WAHA comes from Docker)", async () => {
    const c = loadConfig({ WORK_INBOX_DEMO: "1", WAHA_URL: "http://waha", WAHA_WEBHOOK_TOKEN: "tok" });
    const db = openDb(":memory:");
    const api = createApi({ db, cfg: c, adapters: [], run: demoRunner, settings: new ConfigManager(c, db, memoryStore(), {}) });
    const bad = await api(new Request("http://evil.example:3571/api/board/cards", { method: "POST", headers: { host: "evil.example:3571", origin: "http://evil.example:3571" }, body: JSON.stringify({ title: "x" }) }));
    expect(bad!.status).toBe(403);
    const hook = await api(new Request("http://host.docker.internal:3571/webhook/waha?token=tok", { method: "POST", headers: { host: "host.docker.internal:3571" }, body: JSON.stringify({ event: "ping" }) }));
    expect(hook!.status).toBe(200);
  });
});

const issue = (meta: Record<string, unknown>): NormalizedEvent => ({ ...base, source: "github", sourceId: "gi", kind: "issue", nativeKey: "issue:o/r#5", ticketKey: null, title: "o/r#5 thing", meta: { assignedToMe: true, state: "open", labels: [], ...meta } });

describe("GitHub issues on the board", () => {
  test("open → To Do, blocked label → Decision Needed, closed → Merged", () => {
    expect(autoColumn([issue({})], cfg)).toBe("To Do");
    expect(autoColumn([issue({ labels: ["blocked"] })], cfg)).toBe("Decision Needed");
    expect(autoColumn([issue({ state: "closed" })], cfg)).toBe("Merged");
  });
});

describe("cards from a single message", () => {
  const chat = (id: string, body: string): NormalizedEvent => ({ ...base, source: "whatsapp", sourceId: id, kind: "chat", nativeKey: "chat:g1", ticketKey: null, title: "Acme Support Group", author: "Dana", body, meta: {} });
  test("makes a Pending card with a link back, and refuses a duplicate", () => {
    const db = openDb(":memory:");
    upsertEvents(db, [chat("m1", "Can you check the invoice export? It fails for EU customers.")]);
    const id = cardFromEvent(db, cfg, { itemKey: "chat:g1", eventId: "m1" }, now);
    const card = getBoard(db, cfg, now).cards.find((c) => c.id === id)!;
    expect(card.col).toBe("Pending");
    expect(card.title).toBe("Can you check the invoice export?");
    expect(card.originKey).toBe("chat:g1");
    expect(card.originLabel).toBe("WhatsApp · Acme Support Group");
    expect(() => cardFromEvent(db, cfg, { itemKey: "chat:g1", eventId: "m1" }, now)).toThrow(/already a card/);
  });
  test("unknown message is an error", () => {
    expect(() => cardFromEvent(openDb(":memory:"), cfg, { itemKey: "chat:g1", eventId: "nope" })).toThrow(/not found/);
  });
});

describe("Jira sync is one way", () => {
  test("boardSyncJira=false stops Jira tickets becoming cards", () => {
    const db = openDb(":memory:");
    upsertEvents(db, demoEvents(now));
    syncBoard(db, { ...cfg, boardSyncJira: false }, now);
    expect(getBoard(db, cfg, now).cards.some((c) => c.title.includes("PAY-231"))).toBe(false);
  });
  test("moving a card never calls the network", () => {
    const db = openDb(":memory:");
    upsertEvents(db, demoEvents(now));
    syncBoard(db, cfg, now);
    const orig = globalThis.fetch; let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error("no network"); }) as any;
    try { const c = getBoard(db, cfg, now).cards[0]; moveCard(db, cfg, c.id, "Deployed Prod"); } finally { globalThis.fetch = orig; }
    expect(calls).toBe(0);
  });
});
