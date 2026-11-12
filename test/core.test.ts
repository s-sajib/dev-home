import { describe, expect, test } from "bun:test";
import { openDb } from "../src/server/db";
import { demoEvents } from "../src/server/demo";
import { dismissItem, listItems, rebuildItems, snoozeItem } from "../src/server/inbox";
import { extractTicketKeys, firstTicketKey, keyFromBranch } from "../src/server/linker";
import { upsertEvents } from "../src/server/store";
import type { NormalizedEvent } from "../src/server/types";

const H = 3_600_000;
const ctx = (now: number) => ({ now, staleDays: 5, replyHours: 4 });

describe("linker", () => {
  test("extracts uppercase ticket keys", () => {
    expect(extractTicketKeys("PAY-231 and OPS-88, not utf-8 or sha-256")).toEqual(["PAY-231", "OPS-88"]);
  });
  test("restricts to allowed projects", () => {
    expect(extractTicketKeys("PAY-1 OPS-2", ["OPS"])).toEqual(["OPS-2"]);
  });
  test("branch names are case-insensitive", () => {
    expect(keyFromBranch("feature/pay-231-retry")).toBe("PAY-231");
    expect(keyFromBranch("main")).toBeNull();
  });
  test("firstTicketKey scans titles in order", () => {
    expect(firstTicketKey("no key", "[API-77] paginate")).toBe("API-77");
  });
});

describe("inbox pipeline (demo data)", () => {
  const now = Date.now();
  const make = () => {
    const db = openDb(":memory:");
    upsertEvents(db, demoEvents(now));
    return db;
  };

  test("links Jira + GitHub by ticket key into one card, chat stays separate but linked", () => {
    const db = make();
    const items = rebuildItems(db, ctx(now));
    const pay = items.find((i) => i.itemKey === "ticket:PAY-231")!;
    expect(pay.sources.sort()).toEqual(["github", "jira"]);
    expect(pay.flags).toContain("review_requested");
    expect(pay.flags).toContain("mentions_me");
    const chat = items.find((i) => i.itemKey === "chat:120363@g.us")!;
    expect(chat.ticketKey).toBe("PAY-231");
    expect(chat.flags).toContain("needs_reply");
  });

  test("overdue reminders sort first", () => {
    const items = rebuildItems(make(), ctx(now));
    expect(items[0]!.flags).toContain("overdue_reminder");
  });

  test("stale and status-changed flags", () => {
    const items = rebuildItems(make(), ctx(now));
    expect(items.find((i) => i.itemKey === "ticket:WEB-402")!.flags).toContain("stale");
    expect(items.find((i) => i.itemKey === "ticket:OPS-88")!.flags).toContain("status_changed_by_other");
    expect(items.find((i) => i.itemKey === "ticket:API-77")!.flags).toContain("unanswered_comment");
  });

  test("reply from me clears needs_reply", () => {
    const db = make();
    const reply: NormalizedEvent = {
      source: "whatsapp", sourceId: "m4", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Me", authorIsMe: true, body: "On it, landing today", url: null, ts: now - 1 * H, mentionsMe: false, meta: {},
    };
    upsertEvents(db, [reply]);
    const chat = rebuildItems(db, ctx(now)).find((i) => i.itemKey === "chat:120363@g.us");
    expect(chat?.flags ?? []).not.toContain("needs_reply");
  });

  test("dismissed items stay hidden until NEW activity resurfaces them (F3)", () => {
    const db = make();
    rebuildItems(db, ctx(now));
    dismissItem(db, "ticket:OPS-88");
    expect(listItems(db, now).find((i) => i.itemKey === "ticket:OPS-88")!.hidden).toBe(true);

    upsertEvents(db, [{
      source: "jira", sourceId: "comment:OPS-88:9", kind: "comment", nativeKey: "ticket:OPS-88", ticketKey: "OPS-88",
      title: "OPS-88 Rotate staging database credentials", author: "Sam Okafor", authorIsMe: false,
      body: "Unblocked, go ahead", url: null, ts: now - 1000, mentionsMe: true, meta: {},
    }]);
    rebuildItems(db, ctx(now));
    expect(listItems(db, now).find((i) => i.itemKey === "ticket:OPS-88")!.hidden).toBe(false);
  });

  test("snooze hides until the deadline passes", () => {
    const db = make();
    rebuildItems(db, ctx(now));
    snoozeItem(db, "ticket:WEB-402", now + 4 * H);
    expect(listItems(db, now).find((i) => i.itemKey === "ticket:WEB-402")!.hidden).toBe(true);
    expect(listItems(db, now + 5 * H).find((i) => i.itemKey === "ticket:WEB-402")!.hidden).toBe(false);
  });

  test("event upsert is idempotent", () => {
    const db = make();
    upsertEvents(db, demoEvents(now));
    const n = (db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
    expect(n).toBe(demoEvents(now).length);
  });
});
