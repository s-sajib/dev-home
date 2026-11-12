import type { DB } from "./db";
import type { NormalizedEvent } from "./types";

export function upsertEvents(db: DB, events: NormalizedEvent[]): number {
  const stmt = db.query(`
    INSERT INTO events (source, source_id, kind, native_key, ticket_key, title, author, author_is_me, body, url, ts, mentions_me, meta)
    VALUES ($source, $sourceId, $kind, $nativeKey, $ticketKey, $title, $author, $authorIsMe, $body, $url, $ts, $mentionsMe, $meta)
    ON CONFLICT (source, source_id) DO UPDATE SET
      kind = excluded.kind, native_key = excluded.native_key, ticket_key = excluded.ticket_key,
      title = excluded.title, author = excluded.author, author_is_me = excluded.author_is_me,
      body = excluded.body, url = excluded.url, ts = excluded.ts,
      mentions_me = excluded.mentions_me, meta = excluded.meta
  `);
  db.transaction(() => {
    for (const e of events) {
      stmt.run({
        $source: e.source,
        $sourceId: e.sourceId,
        $kind: e.kind,
        $nativeKey: e.nativeKey,
        $ticketKey: e.ticketKey,
        $title: e.title,
        $author: e.author,
        $authorIsMe: e.authorIsMe ? 1 : 0,
        $body: e.body,
        $url: e.url,
        $ts: e.ts,
        $mentionsMe: e.mentionsMe ? 1 : 0,
        $meta: JSON.stringify(e.meta ?? {}),
      });
    }
  })();
  return events.length;
}

export function loadEvents(db: DB): NormalizedEvent[] {
  const rows = db.query("SELECT * FROM events ORDER BY ts ASC").all() as any[];
  return rows.map((r) => ({
    source: r.source,
    sourceId: r.source_id,
    kind: r.kind,
    nativeKey: r.native_key,
    ticketKey: r.ticket_key,
    title: r.title,
    author: r.author,
    authorIsMe: !!r.author_is_me,
    body: r.body,
    url: r.url,
    ts: r.ts,
    mentionsMe: !!r.mentions_me,
    meta: JSON.parse(r.meta),
  }));
}

export function logAction(db: DB, itemKey: string | null, action: string, args: unknown, ok: boolean, result: string) {
  db.query("INSERT INTO actions_log (ts, item_key, action, args, ok, result) VALUES (?, ?, ?, ?, ?, ?)").run(
    Date.now(),
    itemKey,
    action,
    JSON.stringify(args ?? {}),
    ok ? 1 : 0,
    result.slice(0, 2000),
  );
}
