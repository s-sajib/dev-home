import { describe, expect, test } from "bun:test";
import { draftReply, itemsNeedingVerdict, judgeItems, latestDraft, parseClaudeOutput, redact, type Runner } from "../src/server/claude";
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { demoEvents } from "../src/server/demo";
import { rebuildItems } from "../src/server/inbox";
import { upsertEvents } from "../src/server/store";

const now = Date.now();
const setup = () => {
  const db = openDb(":memory:");
  upsertEvents(db, demoEvents(now));
  rebuildItems(db, { now, staleDays: 5, replyHours: 4 });
  return db;
};

describe("claude -p output parsing", () => {
  test("reads a JSON string in result", () => {
    expect(parseClaudeOutput(JSON.stringify({ is_error: false, result: '{"draft":"hi"}' }))).toEqual({ draft: "hi" });
  });
  test("prefers structured_output when present", () => {
    expect(parseClaudeOutput(JSON.stringify({ structured_output: { a: 1 }, result: "ignored" }))).toEqual({ a: 1 });
  });
  test("extracts JSON wrapped in prose", () => {
    expect(parseClaudeOutput(JSON.stringify({ result: 'Here you go: {"a":2} done' }))).toEqual({ a: 2 });
  });
  test("surfaces CLI errors", () => {
    expect(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: "Not logged in" }))).toThrow(/Not logged in/);
  });
});

describe("redaction", () => {
  test("strips emails, phone numbers and long tokens", () => {
    const r = redact("mail dana@acme.com or +1 (555) 123-4567 key ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(r).not.toContain("dana@acme.com");
    expect(r).not.toContain("555");
    expect(r).not.toContain("ghp_");
  });
});

describe("verdicts", () => {
  test("judges visible items, caches per activity, ignores unrequested keys and bad enums", async () => {
    const db = setup();
    const prompts: string[] = [];
    const run: Runner = async (prompt) => {
      prompts.push(prompt);
      return { verdicts: [
        { itemKey: "ticket:PAY-231", verdict: "needs_me", reason: "Client demo today" },
        { itemKey: "ticket:OPS-88", verdict: "banana", reason: "x" },
        { itemKey: "ticket:NOT-THERE", verdict: "drop", reason: "x" },
      ] };
    };
    const cfg = loadConfig({});
    expect(await judgeItems(db, cfg, run, now)).toBe(1);
    expect(itemsNeedingVerdict(db, now).some((i) => i.itemKey === "ticket:PAY-231")).toBe(false);
    expect(itemsNeedingVerdict(db, now).some((i) => i.itemKey === "ticket:OPS-88")).toBe(true);
    // chat text is withheld unless allowed
    expect(prompts.join()).toContain("[chat text withheld]");
    expect(prompts.join()).not.toContain("demo at 3pm");
  });

  test("new activity makes a cached verdict stale again", async () => {
    const db = setup();
    const run: Runner = async () => ({ verdicts: [{ itemKey: "ticket:PAY-231", verdict: "needs_me", reason: "r" }] });
    await judgeItems(db, loadConfig({}), run, now);
    upsertEvents(db, [{ source: "jira", sourceId: "comment:PAY-231:99", kind: "comment", nativeKey: "ticket:PAY-231", ticketKey: "PAY-231", title: "PAY-231 x", author: "Dana", authorIsMe: false, body: "ping", url: null, ts: now - 10, mentionsMe: false, meta: {} }]);
    rebuildItems(db, { now, staleDays: 5, replyHours: 4 });
    expect(itemsNeedingVerdict(db, now).some((i) => i.itemKey === "ticket:PAY-231")).toBe(true);
  });
});

describe("drafts", () => {
  test("refuses until chat text is allowed", async () => {
    await expect(draftReply(setup(), loadConfig({}), async () => ({ draft: "x" }), "chat:120363@g.us", now)).rejects.toThrow(/ALLOW_CHAT_TO_LLM/);
  });
  test("includes chat plus linked ticket, stores the draft, never sends", async () => {
    const db = setup();
    let seen = "";
    const run: Runner = async (p) => { seen = p; return { draft: "Retries land today, I'll confirm by 2pm." }; };
    const d = await draftReply(db, loadConfig({ ALLOW_CHAT_TO_LLM: "1" }), run, "chat:120363@g.us", now);
    expect(d).toContain("2pm");
    expect(seen).toContain("demo at 3pm");
    expect(seen).toContain("PAY-231");
    expect(latestDraft(db, "chat:120363@g.us")?.body).toBe(d);
  });
});
