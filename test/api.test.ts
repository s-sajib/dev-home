import { describe, expect, test } from "vitest";
import { createApi } from "../src/server/api";
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { demoRunner, seedDemo } from "../src/server/demo";
import { rebuildItems } from "../src/server/inbox";
import { judgeItems } from "../src/server/claude";
import { memoryStore } from "../src/server/secrets";
import { ConfigManager } from "../src/server/settings";

const make = (env: Record<string, string> = {}, extra: any = {}) => {
  const cfg = loadConfig({ WORK_INBOX_DEMO: "1", ...env });
  const db = openDb(":memory:");
  seedDemo(db);
  rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
  const api = createApi({ db, cfg, adapters: [], run: demoRunner, settings: new ConfigManager(cfg, db, memoryStore(), {}), ...extra });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await api(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined }));
    return { status: res!.status, json: (await res!.json()) as any };
  };
  return { db, cfg, call };
};

describe("api", () => {
  test("webhook requires the shared token", async () => {
    const { call } = make({ WAHA_URL: "http://waha", WAHA_WEBHOOK_TOKEN: "secret" });
    expect((await call("POST", "/webhook/waha", { event: "message.any" })).status).toBe(403);
    expect((await call("POST", "/webhook/waha?token=wrong", {})).status).toBe(403);
    expect((await call("POST", "/webhook/waha?token=secret", { event: "ping" })).status).toBe(200);
  });
  test("webhook refuses to run with an empty token", async () => {
    const { call } = make({ WAHA_URL: "http://waha" });
    expect((await call("POST", "/webhook/waha?token=", {})).status).toBe(503);
  });

  test("jira writes require confirmation and a configured Jira", async () => {
    const { call } = make();
    expect((await call("POST", "/api/items/ticket:PAY-231/transition", { status: "Done" })).status).toBe(400);
    const withJira = make({ JIRA_BASE_URL: "https://x.atlassian.net", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t" });
    const r = await withJira.call("POST", "/api/items/ticket:PAY-231/transition", { status: "Done" });
    expect(r.json.error).toBe("Confirmation required");
  });

  test("every action is logged; failures are logged too", async () => {
    const { db, call } = make();
    await call("POST", "/api/items/ticket:OPS-88/dismiss", {});
    await call("POST", "/api/items/ticket:PAY-231/transition", { status: "Done" });
    const rows = db.query("SELECT action, ok FROM actions_log ORDER BY id").all() as any[];
    expect(rows.map((r) => r.action)).toEqual(["dismiss", "transition"]);
    expect(rows[1].ok).toBe(0);
  });

  test("verdict overrides are counted for the success metric", async () => {
    const { db, cfg, call } = make();
    await judgeItems(db, cfg, demoRunner);
    await call("POST", "/api/items/ticket:PAY-231/dismiss", {}); // dismissing a needs_me
    await call("POST", "/api/items/pr:acme%2Fweb%231203/accept", {}); // accepting a drop
    const stats = (await call("GET", "/api/stats")).json;
    expect(stats.overrides).toBe(2);
  });

  test("draft endpoint stores a draft and the inbox exposes it", async () => {
    const { call } = make();
    const r = await call("POST", "/api/items/chat:120363@g.us/draft", {});
    expect(r.json.ok).toBe(true);
    const inbox = (await call("GET", "/api/inbox")).json;
    expect(inbox.items.find((i: any) => i.itemKey === "chat:120363@g.us").draft).toContain("3pm");
  });

  test("remind creates a reminder with the item link in notes", async () => {
    const scripts: string[] = [];
    const { call, db } = make({}, { reminders: { list: "Work Inbox", osa: async (s: string) => (scripts.push(s), "NEW-ID") } });
    const r = await call("POST", "/api/items/ticket:WEB-402/remind", { hours: 1 });
    expect(r.json.id).toBe("NEW-ID");
    expect(scripts[0]).toContain("WEB-402");
    expect((db.query("SELECT item_key FROM reminder_links WHERE reminder_id = 'NEW-ID'").get() as any).item_key).toBe("ticket:WEB-402");
  });
});

describe("demo mode simulates Jira writes locally", () => {
  test("a transition moves the ticket and its board card; a comment clears an unanswered question", async () => {
    const { call } = make();
    await call("GET", "/api/board"); // sync cards
    expect((await call("POST", "/api/items/ticket:WEB-402/transition", { status: "In Progress" })).status).toBe(400); // still needs confirm
    const r = await call("POST", "/api/items/ticket:WEB-402/transition", { status: "In Progress", confirm: true });
    expect(r.json.result).toBe("WEB-402 → In Progress");
    const card = (await call("GET", "/api/board")).json.cards.find((c: any) => c.itemKey === "ticket:WEB-402");
    expect(card.col).toBe("In Progress");
    expect(card.status).toBe("In Progress");

    expect((await call("GET", "/api/inbox")).json.items.find((i: any) => i.itemKey === "ticket:API-77").flags).toContain("unanswered_comment");
    await call("POST", "/api/items/ticket:API-77/comment", { text: "Opaque cursor. I'll confirm with mobile.", confirm: true });
    const after = (await call("GET", "/api/inbox")).json.items.find((i: any) => i.itemKey === "ticket:API-77");
    expect(after?.flags ?? []).not.toContain("unanswered_comment");
  });
});
