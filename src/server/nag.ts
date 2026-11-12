import type { Config } from "./config";
import type { DB } from "./db";
import type { Notifier } from "./notify";
import { loadEvents, logAction } from "./store";

const MIN = 60_000;
/** Growing re-nag intervals (minutes, configurable); the last one repeats. */
export const DEFAULT_NAG_MINUTES = [15, 30, 60, 120, 240];

export function nagInterval(count: number, minutes: number[] = DEFAULT_NAG_MINUTES): number {
  return minutes[Math.min(count, minutes.length - 1)]! * MIN;
}

/** Inside the configured window and on a work day. Handles windows that cross midnight (8 -> 1). */
export function inWorkHours(now: number, cfg: Pick<Config, "workStartHour" | "workEndHour" | "workDays">): boolean {
  const d = new Date(now);
  const h = d.getHours() + d.getMinutes() / 60;
  const { workStartHour: a, workEndHour: b } = cfg;
  const wraps = b <= a;
  const inWindow = wraps ? h >= a || h < b : h >= a && h < b;
  if (!inWindow) return false;
  // the after-midnight part belongs to the previous day's shift
  const shiftDay = wraps && h < b ? (d.getDay() + 6) % 7 : d.getDay();
  return cfg.workDays.includes(shiftDay);
}

export interface Nag {
  reminderId: string;
  title: string;
  itemKey: string;
  count: number;
}

export function dueNags(db: DB, cfg: Pick<Config, "workStartHour" | "workEndHour" | "workDays"> & Partial<Pick<Config, "nagIntervalsMin" | "nagEnabled">>, now: number): Nag[] {
  if (cfg.nagEnabled === false || !inWorkHours(now, cfg)) return [];
  const links = new Map(
    (db.query("SELECT * FROM reminder_links").all() as any[]).map((r) => [r.reminder_id as string, r]),
  );
  const out: Nag[] = [];
  for (const e of loadEvents(db)) {
    if (e.kind !== "reminder" || e.meta.completed === true) continue;
    const due = e.meta.due as number | null;
    if (typeof due !== "number" || due > now) continue;
    const id = String(e.meta.reminderId ?? e.sourceId);
    const link = links.get(id);
    const count = link?.nudge_count ?? 0;
    const base = link?.last_nudged_at ?? due;
    if (now - base >= nagInterval(count, cfg.nagIntervalsMin)) out.push({ reminderId: id, title: e.title, itemKey: e.nativeKey, count });
  }
  return out;
}

export async function runNag(db: DB, cfg: Config, notify: Notifier, now = Date.now()): Promise<number> {
  const nags = dueNags(db, cfg, now);
  for (const n of nags) {
    try {
      await notify({
        title: `Overdue: ${n.title}`.slice(0, 120),
        body: n.count === 0 ? "Still open. Complete it or snooze it in the inbox." : `Still open (reminder #${n.count + 1}).`,
        openUrl: `http://${cfg.host}:${cfg.port}/?item=${encodeURIComponent(n.itemKey)}`,
      });
      db.query(
        `INSERT INTO reminder_links (reminder_id, item_key, last_nudged_at, nudge_count) VALUES (?, ?, ?, 1)
         ON CONFLICT (reminder_id) DO UPDATE SET last_nudged_at = excluded.last_nudged_at, nudge_count = nudge_count + 1`,
      ).run(n.reminderId, n.itemKey, now);
      logAction(db, n.itemKey, "nag", { count: n.count + 1 }, true, "notified");
    } catch (err: any) {
      logAction(db, n.itemKey, "nag", {}, false, String(err?.message ?? err));
    }
  }
  return nags.length;
}
