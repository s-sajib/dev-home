import { firstTicketKey } from "../linker";
import type { NormalizedEvent, SourceAdapter } from "../types";
import { current, type Maybe } from "./maybe";

/** Runs a JXA script via osascript and returns stdout. Injected so tests never touch macOS. */
export type Osa = (script: string) => Promise<string>;

export const osascript: Osa = async (script) => {
  const proc = Bun.spawn(["osascript", "-l", "JavaScript", "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`osascript failed: ${err.trim().slice(0, 300)}`);
  return out.trim();
};

export interface RemindersDeps {
  list: string;
  osa?: Osa;
  now?: () => number;
}

const q = (s: string) => JSON.stringify(s);

function listScript(list: string): string {
  return `
    const app = Application('Reminders');
    let l;
    try { l = app.lists.byName(${q(list)}); l.id(); } catch (e) { l = null; }
    if (!l) { JSON.stringify([]); } else {
      const R = l.reminders;
      const ids = R.id(), names = R.name(), bodies = R.body(), due = R.dueDate(), done = R.completed(), mod = R.modificationDate();
      JSON.stringify(ids.map((id, i) => ({
        id, name: names[i] || '', body: bodies[i] || '',
        due: due[i] ? due[i].getTime() : null, completed: !!done[i], modified: mod[i] ? mod[i].getTime() : null,
      })));
    }`;
}

export function parseReminders(json: string, now: number): NormalizedEvent[] {
  const rows = JSON.parse(json || "[]") as { id: string; name: string; body: string; due: number | null; completed: boolean; modified: number | null }[];
  return rows.map((r) => ({
    source: "reminders" as const,
    sourceId: `rem:${r.id}`,
    kind: "reminder" as const,
    nativeKey: `reminder:${r.id}`,
    ticketKey: firstTicketKey(r.name, r.body),
    title: r.name,
    author: "Reminders",
    authorIsMe: false,
    body: r.body,
    url: r.body.match(/https?:\/\/\S+/)?.[0] ?? null,
    ts: r.due ?? r.modified ?? now,
    mentionsMe: false,
    meta: { due: r.due, completed: r.completed, reminderId: r.id },
  }));
}

export function createRemindersAdapter(deps: Maybe<RemindersDeps>): SourceAdapter {
  return {
    source: "reminders",
    configured: () => current(deps) !== null,
    fetch: async () => {
      const d = current(deps)!;
      return parseReminders(await (d.osa ?? osascript)(listScript(d.list)), (d.now ?? Date.now)());
    },
  };
}

/** `r` on any item: create a reminder with the item's link in its notes (Reminders has no URL field). */
export async function createReminder(deps: RemindersDeps, input: { title: string; notes: string; dueAt: number }): Promise<string> {
  const osa = deps.osa ?? osascript;
  const script = `
    const app = Application('Reminders');
    let l;
    try { l = app.lists.byName(${q(deps.list)}); l.id(); } catch (e) { l = app.List({ name: ${q(deps.list)} }); app.lists.push(l); }
    const r = app.Reminder({ name: ${q(input.title.slice(0, 200))}, body: ${q(input.notes)}, dueDate: new Date(${Math.round(input.dueAt)}) });
    l.reminders.push(r);
    r.id();`;
  return osa(script);
}

export async function completeReminder(deps: RemindersDeps, reminderId: string): Promise<void> {
  const osa = deps.osa ?? osascript;
  await osa(`const app = Application('Reminders'); app.reminders.byId(${q(reminderId)}).completed = true; 'ok'`);
}
