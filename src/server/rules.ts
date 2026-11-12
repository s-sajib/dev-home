import { runtime } from "./runtime";
import type { Flag, NormalizedEvent } from "./types";

export interface RuleContext {
  now: number;
  staleDays: number;
  replyHours: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Rule-based flags in plain code (PRD F2, F6, F10). No model involved.
 * `events` are all events of one item, oldest first.
 */
export function computeFlags(events: NormalizedEvent[], ctx: RuleContext): Flag[] {
  const flags = new Set<Flag>();
  if (events.length === 0) return [];

  const lastMine = Math.max(0, ...events.filter((e) => e.authorIsMe).map((e) => e.ts));
  const others = events.filter((e) => !e.authorIsMe);

  const ticket = events.find((e) => e.kind === "ticket");
  const issue = events.find((e) => e.kind === "issue");
  const openIssue = !!issue && issue.meta.assignedToMe === true && issue.meta.state !== "closed";
  const assignedToMe = (!!ticket && ticket.meta.assignedToMe === true) || openIssue;
  if (assignedToMe) flags.add("assigned");

  // mentions me: someone else mentioned me after I last acted on this item
  if (others.some((e) => e.mentionsMe && e.ts > lastMine && e.source !== "whatsapp" && e.kind !== "review_request")) flags.add("mentions_me");

  // unanswered comment: latest comment by someone else, nothing from me after it, and it's my ticket or addresses me
  const comments = events.filter((e) => e.kind === "comment" || e.kind === "pr_comment");
  const lastComment = comments[comments.length - 1];
  if (lastComment && !lastComment.authorIsMe && lastComment.ts > lastMine && (assignedToMe || lastComment.mentionsMe)) {
    flags.add("unanswered_comment");
  }

  // review requested
  const rr = events.filter((e) => e.kind === "review_request");
  if (rr.some((e) => e.meta.open !== false && e.ts > lastMine)) flags.add("review_requested");

  // status changed by someone else after my last activity
  if (others.some((e) => e.kind === "status_change" && e.ts > lastMine)) flags.add("status_changed_by_other");

  // stale: my assigned ticket without activity for N days
  const lastActivity = Math.max(...events.map((e) => e.ts));
  if (assignedToMe && ticket?.meta.statusCategory !== "done" && ctx.now - lastActivity > ctx.staleDays * DAY) {
    flags.add("stale");
  }

  // WhatsApp needs-reply (F6): mentioned or quoted, I haven't replied, and N hours have passed
  const chat = events.filter((e) => e.kind === "chat");
  const lastLeading = [...chat].reverse().find((e) => !e.authorIsMe && (e.mentionsMe || e.meta.quotesMe === true));
  if (lastLeading) {
    const replied = chat.some((e) => e.authorIsMe && e.ts > lastLeading.ts);
    if (!replied) {
      flags.add("mentions_me");
      if (ctx.now - lastLeading.ts > ctx.replyHours * HOUR) flags.add("needs_reply");
    }
  }

  // overdue reminders (F10)
  const rem = events.find((e) => e.kind === "reminder");
  if (rem && rem.meta.completed !== true && typeof rem.meta.due === "number" && rem.meta.due <= ctx.now) {
    flags.add("overdue_reminder");
  }

  return [...flags].filter((f) => !runtime.disabledFlags.includes(f));
}
