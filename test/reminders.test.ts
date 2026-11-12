import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { completeReminder, createReminder, createRemindersAdapter, parseReminders } from "../src/server/adapters/reminders";
import { dueNags, inWorkHours, nagInterval, runNag } from "../src/server/nag";
import { rebuildItems } from "../src/server/inbox";
import { upsertEvents } from "../src/server/store";

// Wednesday 2026-11-11 10:00 local
const wed10 = new Date(2026, 10, 11, 10, 0, 0).getTime();
const cfg = loadConfig({});
const MIN = 60_000;

const rows = JSON.stringify([
  { id: "A1", name: "Follow up on PAY-231", body: "https://x.atlassian.net/browse/PAY-231", due: wed10 - 60 * MIN, completed: false, modified: wed10 - 3 * 60 * MIN },
  { id: "B2", name: "Done thing", body: "", due: wed10 - 600 * MIN, completed: true, modified: null },
  { id: "C3", name: "Future", body: "", due: wed10 + 600 * MIN, completed: false, modified: null },
]);

describe("reminders adapter", () => {
  test("parses JXA output into events with ticket key and link", () => {
    const evs = parseReminders(rows, wed10);
    expect(evs).toHaveLength(3);
    expect(evs[0]!.ticketKey).toBe("PAY-231");
    expect(evs[0]!.url).toContain("PAY-231");
    expect(evs[1]!.meta.completed).toBe(true);
  });
  test("adapter uses the injected osascript runner and the configured list", async () => {
    let script = "";
    const a = createRemindersAdapter({ list: "Work Inbox", osa: async (s) => ((script = s), rows), now: () => wed10 });
    expect(await a.fetch(null)).toHaveLength(3);
    expect(script).toContain('"Work Inbox"');
  });
  test("create and complete build safe scripts (quotes escaped)", async () => {
    const scripts: string[] = [];
    const osa = async (s: string) => (scripts.push(s), "ID-1");
    expect(await createReminder({ list: "Work Inbox", osa }, { title: 'Say "hi"', notes: "https://x/PAY-1", dueAt: wed10 })).toBe("ID-1");
    await completeReminder({ list: "Work Inbox", osa }, "ID-1");
    expect(scripts[0]).toContain('"Say \\"hi\\""');
    expect(scripts[1]).toContain("completed = true");
  });
});

describe("nag (F11)", () => {
  const seed = () => {
    const db = openDb(":memory:");
    upsertEvents(db, parseReminders(rows, wed10));
    rebuildItems(db, { now: wed10, staleDays: 5, replyHours: 4 });
    return db;
  };
  test("default window is 08:00-01:00 every day, quiet 01:00-08:00", () => {
    expect(inWorkHours(wed10, cfg)).toBe(true);
    expect(inWorkHours(new Date(2026, 10, 11, 23, 30).getTime(), cfg)).toBe(true);
    expect(inWorkHours(new Date(2026, 10, 12, 0, 30).getTime(), cfg)).toBe(true); // after midnight
    expect(inWorkHours(new Date(2026, 10, 12, 3, 0).getTime(), cfg)).toBe(false);
    expect(inWorkHours(new Date(2026, 10, 12, 7, 59).getTime(), cfg)).toBe(false);
    expect(inWorkHours(new Date(2026, 10, 14, 11, 0).getTime(), cfg)).toBe(true); // Saturday
  });
  test("a 9-18 weekday config still excludes nights and weekends", () => {
    const office = loadConfig({ WORK_START_HOUR: "9", WORK_END_HOUR: "18", WORK_DAYS: "1,2,3,4,5" });
    expect(inWorkHours(wed10, office)).toBe(true);
    expect(inWorkHours(new Date(2026, 10, 11, 22, 0).getTime(), office)).toBe(false);
    expect(inWorkHours(new Date(2026, 10, 14, 11, 0).getTime(), office)).toBe(false);
  });
  test("intervals grow and cap", () => {
    expect(nagInterval(0)).toBe(15 * MIN);
    expect(nagInterval(2)).toBe(60 * MIN);
    expect(nagInterval(99)).toBe(240 * MIN);
  });
  test("nags overdue open reminders only; completed and future are left alone", () => {
    const nags = dueNags(seed(), cfg, wed10);
    expect(nags.map((n) => n.reminderId)).toEqual(["A1"]);
  });
  test("re-nags at a growing interval and stops when completed", async () => {
    const db = seed();
    const sent: string[] = [];
    const notify = async (n: { title: string }) => void sent.push(n.title);
    expect(await runNag(db, cfg, notify, wed10)).toBe(1);
    expect(await runNag(db, cfg, notify, wed10 + 5 * MIN)).toBe(0); // too soon
    expect(await runNag(db, cfg, notify, wed10 + 16 * MIN)).toBe(0); // 2nd interval is 30m
    expect(await runNag(db, cfg, notify, wed10 + 31 * MIN)).toBe(1);
    expect(sent).toHaveLength(2);
    // completing in Reminders stops it
    upsertEvents(db, parseReminders(JSON.stringify([{ id: "A1", name: "Follow up on PAY-231", body: "", due: wed10 - 60 * MIN, completed: true, modified: null }]), wed10));
    expect(await runNag(db, cfg, notify, wed10 + 600 * MIN)).toBe(0);
  });
  test("overdue reminder is an inbox item flagged overdue", () => {
    const db = seed();
    const items = rebuildItems(db, { now: wed10, staleDays: 5, replyHours: 4 });
    expect(items.find((i) => i.itemKey === "reminder:A1")!.flags).toContain("overdue_reminder");
    expect(items.find((i) => i.itemKey === "reminder:B2")?.hidden ?? true).toBe(true);
  });
});
