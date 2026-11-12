import type { Config } from "./config";
import type { DB } from "./db";
import { rebuildItems } from "./inbox";
import { upsertEvents } from "./store";
import type { SourceAdapter, SourceStatus } from "./types";

/** Deterministic fetch: every configured adapter, fixed queries, errors recorded per source (never silent). */
export async function pollOnce(db: DB, adapters: SourceAdapter[], cfg: Pick<Config, "staleDays" | "replyHours">) {
  const now = Date.now();
  for (const a of adapters) {
    if (!a.configured()) continue;
    const prev = db.query("SELECT last_poll_at FROM source_status WHERE source = ?").get(a.source) as { last_poll_at: number | null } | null;
    try {
      const events = await a.fetch(prev?.last_poll_at ?? null);
      upsertEvents(db, events);
      setStatus(db, { source: a.source, ok: true, lastPollAt: now, error: null, banner: null });
    } catch (err: any) {
      setStatus(db, { source: a.source, ok: false, lastPollAt: prev?.last_poll_at ?? null, error: String(err?.message ?? err), banner: null });
    }
  }
  return rebuildItems(db, { now: Date.now(), staleDays: cfg.staleDays, replyHours: cfg.replyHours });
}

export function setStatus(db: DB, s: SourceStatus) {
  db.query(
    `INSERT INTO source_status (source, ok, last_poll_at, error, banner) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source) DO UPDATE SET ok = excluded.ok, last_poll_at = excluded.last_poll_at, error = excluded.error, banner = excluded.banner`,
  ).run(s.source, s.ok ? 1 : 0, s.lastPollAt, s.error, s.banner);
}

export function getStatuses(db: DB): SourceStatus[] {
  return (db.query("SELECT * FROM source_status").all() as any[]).map((r) => ({
    source: r.source, ok: !!r.ok, lastPollAt: r.last_poll_at, error: r.error, banner: r.banner,
  }));
}
