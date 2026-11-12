import type { Flag, InboxItem, Source } from "../server/types";

export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const FLAG_LABEL: Record<Flag, string> = {
  overdue_reminder: "Overdue reminder",
  needs_reply: "Reply owed",
  mentions_me: "Mentions you",
  review_requested: "Review requested",
  unanswered_comment: "Unanswered comment",
  status_changed_by_other: "Status changed",
  assigned: "Assigned to you",
  stale: "Stale",
};

export const SOURCE_LABEL: Record<Source, string> = { jira: "Jira", github: "GitHub", whatsapp: "WhatsApp", reminders: "Reminders" };

export type Lane = { id: string; title: string; hint: string; match: (f: Flag[]) => boolean };

export const LANES: Lane[] = [
  { id: "reminders", title: "Overdue reminders", hint: "Keeps nagging until you act", match: (f) => f.includes("overdue_reminder") },
  { id: "replies", title: "Mentions & replies owed", hint: "Someone is waiting on you", match: (f) => f.some((x) => ["needs_reply", "mentions_me", "unanswered_comment"].includes(x)) },
  { id: "reviews", title: "Review requests", hint: "PRs waiting for your review", match: (f) => f.includes("review_requested") },
  { id: "tickets", title: "Your tickets", hint: "Assigned, changed or stale", match: () => true },
];

export function laneOf(item: InboxItem): string {
  return LANES.find((l) => l.match(item.flags))!.id;
}

export function groupItems<T extends InboxItem>(items: T[]): { lane: Lane; items: T[] }[] {
  const out = LANES.map((lane) => ({ lane, items: [] as T[] }));
  for (const it of items) out[LANES.findIndex((l) => l.id === laneOf(it))]!.items.push(it);
  return out.filter((g) => g.items.length > 0);
}

const PRIORITY: Flag[] = ["overdue_reminder", "needs_reply", "mentions_me", "review_requested", "unanswered_comment", "status_changed_by_other", "assigned", "stale"];
export function sortFlags(flags: Flag[]): Flag[] {
  return [...flags].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
}

export const VERDICT_LABEL = { needs_me: "Needs me", delegate: "Delegate", drop: "Drop" } as const;

export type Group<T extends InboxItem = InboxItem> = { id: string; title: string; hint: string; items: T[] };

/** Overdue reminders always lead; the rest group by AI verdict once any exist, otherwise by rule lane. */
export function buildGroups<T extends InboxItem>(items: T[], mode: "verdict" | "lane"): Group<T>[] {
  const rem = items.filter((i) => i.flags.includes("overdue_reminder"));
  const rest = items.filter((i) => !i.flags.includes("overdue_reminder"));
  const out: Group<T>[] = [];
  if (rem.length) out.push({ id: "reminders", title: "Overdue reminders", hint: "Keeps nagging until you act", items: rem });
  if (mode === "lane") {
    for (const g of groupItems(rest)) out.push({ id: g.lane.id, title: g.lane.title, hint: g.lane.hint, items: g.items });
    return out;
  }
  const spec: [string, string, string, (i: T) => boolean][] = [
    ["needs_me", "Needs me", "Accept with a, act, or dismiss", (i) => i.verdict === "needs_me"],
    ["delegate", "Delegate", "Note it; someone else should take this", (i) => i.verdict === "delegate"],
    ["drop", "Drop", "Probably safe to dismiss", (i) => i.verdict === "drop"],
    ["unjudged", "Not judged yet", "Rule flags only", (i) => !i.verdict],
  ];
  for (const [id, title, hint, f] of spec) {
    const its = rest.filter(f);
    if (its.length) out.push({ id, title, hint, items: its });
  }
  return out;
}
