import type { DB } from "./db";
import { computeFlags, type RuleContext } from "./rules";
import { runtime } from "./runtime";
import { loadEvents } from "./store";
import type { Flag, InboxItem, NormalizedEvent, Source, Verdict } from "./types";
import { extractTicketKeys } from "./linker";

/** Which item an event belongs to. Jira + GitHub link by ticket key; chats/reminders stay their own item. */
export function itemKeyFor(e: NormalizedEvent): string {
  if (e.source === "whatsapp" || e.source === "reminders") return e.nativeKey;
  return e.ticketKey ? `ticket:${e.ticketKey}` : e.nativeKey;
}

const PRIORITY: Flag[] = ["overdue_reminder", "needs_reply", "mentions_me", "review_requested", "unanswered_comment", "status_changed_by_other", "assigned", "stale"];

/** Recompute items from events, persist them (keeping cached verdicts), and return the visible+hidden list. */
export function rebuildItems(db: DB, ctx: RuleContext): InboxItem[] {
  const events = visibleEvents(loadEvents(db));
  const groups = new Map<string, NormalizedEvent[]>();
  for (const e of events) {
    const k = itemKeyFor(e);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }

  const upsert = db.query(`
    INSERT INTO items (item_key, title, ticket_key, sources, flags, last_activity, url)
    VALUES ($k, $title, $ticket, $sources, $flags, $last, $url)
    ON CONFLICT (item_key) DO UPDATE SET
      title = excluded.title, ticket_key = excluded.ticket_key, sources = excluded.sources,
      flags = excluded.flags, last_activity = excluded.last_activity, url = excluded.url
  `);

  db.transaction(() => {
    const live = new Set<string>();
    for (const [key, evs] of groups) {
      live.add(key);
      const flags = computeFlags(evs, ctx);
      const last = Math.max(...evs.map((e) => e.ts));
      const titled = [...evs].reverse().find((e) => e.title);
      const urlEv = [...evs].reverse().find((e) => e.url && (e.kind === "ticket" || e.kind === "pr" || e.kind === "review_request")) ?? [...evs].reverse().find((e) => e.url);
      // chats link to a ticket via keys mentioned in recent messages
      let ticketKey = evs.find((e) => e.ticketKey)?.ticketKey ?? null;
      if (!ticketKey && evs[0]?.source === "whatsapp") {
        for (const e of [...evs].reverse().slice(0, 15)) {
          const k = extractTicketKeys(e.body)[0];
          if (k) { ticketKey = k; break; }
        }
      }
      upsert.run({
        $k: key,
        $title: titled?.title || key,
        $ticket: ticketKey,
        $sources: JSON.stringify([...new Set(evs.map((e) => e.source))]),
        $flags: JSON.stringify(flags),
        $last: last,
        $url: urlEv?.url ?? null,
      });
    }
    // drop items whose events are gone
    for (const r of db.query("SELECT item_key FROM items").all() as { item_key: string }[]) {
      if (!live.has(r.item_key)) db.query("DELETE FROM items WHERE item_key = ?").run(r.item_key);
    }
  })();

  return listItems(db, ctx.now);
}

/** Activity from ignored authors (automation accounts, noisy people) never counts. */
export function visibleEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const ignore = new Set(runtime.ignoreAuthors.map((a) => a.toLowerCase()));
  if (ignore.size === 0) return events;
  return events.filter((e) => e.authorIsMe || !ignore.has(e.author.toLowerCase()));
}

export function listItems(db: DB, now: number): InboxItem[] {
  const rows = db
    .query(
      `SELECT i.*, s.dismissed_at_activity, s.snoozed_until FROM items i LEFT JOIN state s ON s.item_key = i.item_key`,
    )
    .all() as any[];
  const events = visibleEvents(loadEvents(db));
  const byItem = new Map<string, NormalizedEvent[]>();
  for (const e of events) {
    const k = itemKeyFor(e);
    (byItem.get(k) ?? byItem.set(k, []).get(k)!).push(e);
  }

  const items: InboxItem[] = rows.map((r) => {
    const flags = JSON.parse(r.flags) as Flag[];
    const dismissed = r.dismissed_at_activity != null && r.last_activity <= r.dismissed_at_activity;
    const snoozed = r.snoozed_until != null && r.snoozed_until > now;
    return {
      itemKey: r.item_key,
      title: r.title,
      ticketKey: r.ticket_key,
      sources: JSON.parse(r.sources) as Source[],
      flags,
      lastActivity: r.last_activity,
      url: r.url,
      verdict: (r.verdict as Verdict | null) ?? null,
      reason: r.reason,
      hidden: dismissed || snoozed || flags.length === 0,
      snoozedUntil: snoozed ? r.snoozed_until : null,
      events: (byItem.get(r.item_key) ?? [])
        .filter((e) => e.body)
        .map((e) => ({
          source: e.source, kind: e.kind, author: e.author, authorIsMe: e.authorIsMe,
          body: e.body, url: e.url, ts: e.ts, mentionsMe: e.mentionsMe,
        }))
        .slice(-12),
    };
  });

  return items.sort((a, b) => {
    const ra = a.flags.includes("overdue_reminder") ? 0 : 1;
    const rb = b.flags.includes("overdue_reminder") ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return b.lastActivity - a.lastActivity;
  });
}

export function topFlag(flags: Flag[]): Flag | null {
  return PRIORITY.find((f) => flags.includes(f)) ?? null;
}

// ---- local state (F3) ----
export function dismissItem(db: DB, itemKey: string) {
  const row = db.query("SELECT last_activity FROM items WHERE item_key = ?").get(itemKey) as { last_activity: number } | null;
  if (!row) return false;
  db.query(
    `INSERT INTO state (item_key, dismissed_at_activity) VALUES (?, ?)
     ON CONFLICT (item_key) DO UPDATE SET dismissed_at_activity = excluded.dismissed_at_activity, snoozed_until = NULL`,
  ).run(itemKey, row.last_activity);
  return true;
}

export function snoozeItem(db: DB, itemKey: string, until: number) {
  db.query(
    `INSERT INTO state (item_key, snoozed_until) VALUES (?, ?)
     ON CONFLICT (item_key) DO UPDATE SET snoozed_until = excluded.snoozed_until, dismissed_at_activity = NULL`,
  ).run(itemKey, until);
}

export function restoreItem(db: DB, itemKey: string) {
  db.query("DELETE FROM state WHERE item_key = ?").run(itemKey);
}
