import type { Runner } from "./claude";
import type { DB } from "./db";
import { addCard, PIPELINE_B } from "./board";
import { setMode } from "./chatllm";
import { setStatus } from "./poller";
import { upsertEvents } from "./store";
import type { NormalizedEvent } from "./types";

const H = 3_600_000;
const D = 24 * H;

/** Entirely made-up data, used for screenshots and local trial runs. */
export function demoEvents(now: number): NormalizedEvent[] {
  const base = { mentionsMe: false, authorIsMe: false, body: "", url: null as string | null, meta: {} as Record<string, unknown> };
  const jira = "https://example.atlassian.net/browse";
  return [
    // Overdue reminder (top of inbox)
    { ...base, source: "reminders", sourceId: "r1", kind: "reminder", nativeKey: "reminder:r1", ticketKey: "PAY-231",
      title: "Follow up on PAY-231 with Dana", author: "Reminders", body: "Due Friday 10:00 — https://example.atlassian.net/browse/PAY-231",
      ts: now - 20 * H, meta: { due: now - 20 * H, completed: false, nudges: 2 } },

    // PAY-231: Jira mention + PR review request + WhatsApp chat linked
    { ...base, source: "jira", sourceId: "issue:PAY-231", kind: "ticket", nativeKey: "ticket:PAY-231", ticketKey: "PAY-231",
      title: "PAY-231 Retry failed webhook deliveries", author: "Dana Rivera", url: `${jira}/PAY-231`, ts: now - 3 * H,
      meta: { status: "In Progress", statusCategory: "indeterminate", assignedToMe: true } },
    { ...base, source: "jira", sourceId: "comment:PAY-231:1", kind: "comment", nativeKey: "ticket:PAY-231", ticketKey: "PAY-231",
      title: "PAY-231 Retry failed webhook deliveries", author: "Dana Rivera", mentionsMe: true,
      body: "@You can we cap retries at 5 with exponential backoff? Client asked about this again this morning.", url: `${jira}/PAY-231?focusedCommentId=1`, ts: now - 3 * H },
    { ...base, source: "github", sourceId: "rr:acme/payments#482", kind: "review_request", nativeKey: "pr:acme/payments#482", ticketKey: "PAY-231",
      title: "PAY-231 Add retry policy to webhook dispatcher (acme/payments#482)", author: "kai-lin", mentionsMe: true, body: "Review requested",
      url: "https://github.com/acme/payments/pull/482", ts: now - 5 * H, meta: { open: true } },
    { ...base, source: "github", sourceId: "ic:acme/payments#482:9", kind: "pr_comment", nativeKey: "pr:acme/payments#482", ticketKey: "PAY-231",
      title: "PAY-231 Add retry policy to webhook dispatcher (acme/payments#482)", author: "kai-lin", body: "Ready for another look — I moved the backoff into its own module.",
      url: "https://github.com/acme/payments/pull/482#issuecomment-9", ts: now - 4 * H },

    // WhatsApp group mention, owed reply
    { ...base, source: "whatsapp", sourceId: "m0", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Me", authorIsMe: true, body: "Looking into the webhook failures now, will update the group shortly.", ts: now - 8 * H },
    { ...base, source: "whatsapp", sourceId: "m1", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Priya (Acme)", body: "Morning! Any update on the failed webhooks (PAY-231)?", ts: now - 7 * H },
    { ...base, source: "whatsapp", sourceId: "m2", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Priya (Acme)", mentionsMe: true, body: "@You we have a demo at 3pm and need to know if retries land today", ts: now - 6 * H },
    { ...base, source: "whatsapp", sourceId: "m3", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Tom (Acme)", body: "+1, we're seeing duplicates too", ts: now - 5.5 * H },

    // Board: a merged ticket + manual cards further down the pipeline
    { ...base, source: "jira", sourceId: "issue:DOC-12", kind: "ticket", nativeKey: "ticket:DOC-12", ticketKey: "DOC-12",
      title: "DOC-12 Document webhook retry policy", author: "Lena Park", url: `${jira}/DOC-12`, ts: now - 6 * H,
      meta: { status: "In Progress", statusCategory: "indeterminate", assignedToMe: true } },
    { ...base, source: "github", sourceId: "pr:acme/docs#77", kind: "pr", nativeKey: "pr:acme/docs#77", ticketKey: "DOC-12",
      title: "DOC-12 Retry policy page (acme/docs#77)", author: "me", authorIsMe: true, url: "https://github.com/acme/docs/pull/77", ts: now - 4 * H,
      meta: { mine: true, merged: true } },
    { ...base, source: "jira", sourceId: "issue:API-90", kind: "ticket", nativeKey: "ticket:API-90", ticketKey: "API-90",
      title: "API-90 Rate-limit headers on /v2", author: "Sam Okafor", url: `${jira}/API-90`, ts: now - 30 * H,
      meta: { status: "Backlog", statusCategory: "new", assignedToMe: true } },

    // GitHub issues: open + labelled, open + plain, closed
    { ...base, source: "github", sourceId: "issue:acme/web#311", kind: "issue", nativeKey: "issue:acme/web#311", ticketKey: null, title: "Cookie banner blocks the mobile menu (acme/web#311)", author: "Lena Park",
      url: "https://github.com/acme/web/issues/311", ts: now - 9 * H, meta: { assignedToMe: true, state: "open", labels: ["bug", "blocked"] } },
    { ...base, source: "github", sourceId: "ic:acme/web#311:1", kind: "comment", nativeKey: "issue:acme/web#311", ticketKey: null, title: "Cookie banner blocks the mobile menu (acme/web#311)", author: "Lena Park", mentionsMe: true,
      body: "@You can you confirm the z-index fix? Reproduces on iOS Safari only.", url: "https://github.com/acme/web/issues/311#issuecomment-1", ts: now - 8 * H },
    { ...base, source: "github", sourceId: "issue:acme/docs#12", kind: "issue", nativeKey: "issue:acme/docs#12", ticketKey: null, title: "Document the retry policy in the API reference (acme/docs#12)", author: "Dana Rivera",
      url: "https://github.com/acme/docs/issues/12", ts: now - 3 * D, meta: { assignedToMe: true, state: "open", labels: ["documentation"] } },
    { ...base, source: "github", sourceId: "issue:acme/api#88", kind: "issue", nativeKey: "issue:acme/api#88", ticketKey: null, title: "Pagination returns duplicates on page 2 (acme/api#88)", author: "Sam Okafor",
      url: "https://github.com/acme/api/issues/88", ts: now - 2 * D, meta: { assignedToMe: true, state: "closed", labels: ["bug"] } },

    // 1:1 chat with a teammate, owed reply
    { ...base, source: "whatsapp", sourceId: "d1", kind: "chat", nativeKey: "chat:447700900007@c.us", ticketKey: null, title: "Lena Park",
      author: "Lena Park", mentionsMe: true, body: "Hey, can you review my pagination PR when you get a sec? I'm blocked on API-77 until it's merged.", ts: now - 5 * H },
    { ...base, source: "whatsapp", sourceId: "d2", kind: "chat", nativeKey: "chat:447700900007@c.us", ticketKey: null, title: "Lena Park",
      author: "Lena Park", mentionsMe: true, body: "Also the cursor question in the ticket, mobile needs it by Thursday", ts: now - 4.5 * H },

    // Assigned ticket, status changed by someone else
    { ...base, source: "jira", sourceId: "issue:OPS-88", kind: "ticket", nativeKey: "ticket:OPS-88", ticketKey: "OPS-88",
      title: "OPS-88 Rotate staging database credentials", author: "Sam Okafor", url: `${jira}/OPS-88`, ts: now - 26 * H,
      meta: { status: "Blocked", statusCategory: "indeterminate", assignedToMe: true } },
    { ...base, source: "jira", sourceId: "status:OPS-88:1", kind: "status_change", nativeKey: "ticket:OPS-88", ticketKey: "OPS-88",
      title: "OPS-88 Rotate staging database credentials", author: "Sam Okafor", body: "In Progress → Blocked", ts: now - 26 * H },

    // Stale assigned ticket
    { ...base, source: "jira", sourceId: "issue:WEB-402", kind: "ticket", nativeKey: "ticket:WEB-402", ticketKey: "WEB-402",
      title: "WEB-402 Update cookie banner copy", author: "Lena Park", url: `${jira}/WEB-402`, ts: now - 9 * D,
      meta: { status: "To Do", statusCategory: "new", assignedToMe: true } },

    // Review request on a PR without a ticket
    { ...base, source: "github", sourceId: "rr:acme/web#1203", kind: "review_request", nativeKey: "pr:acme/web#1203", ticketKey: null,
      title: "Bump eslint and fix new lint errors (acme/web#1203)", author: "dependabot-fix", mentionsMe: true, body: "Review requested",
      url: "https://github.com/acme/web/pull/1203", ts: now - 30 * H, meta: { open: true } },

    // Unanswered Jira comment on my ticket
    { ...base, source: "jira", sourceId: "issue:API-77", kind: "ticket", nativeKey: "ticket:API-77", ticketKey: "API-77",
      title: "API-77 Paginate /v2/invoices endpoint", author: "Lena Park", url: `${jira}/API-77`, ts: now - 2 * D,
      meta: { status: "In Review", statusCategory: "indeterminate", assignedToMe: true } },
    { ...base, source: "jira", sourceId: "comment:API-77:4", kind: "comment", nativeKey: "ticket:API-77", ticketKey: "API-77",
      title: "API-77 Paginate /v2/invoices endpoint", author: "Lena Park", body: "Should the cursor be opaque or an invoice id? Mobile team needs to know before Thursday.",
      url: `${jira}/API-77?focusedCommentId=4`, ts: now - 2 * D },
  ];
}

export function seedDemo(db: DB, now = Date.now()) {
  upsertEvents(db, demoEvents(now));
  setMode(db, "chat:120363@g.us", "auto");
  const at = (title: string, col: string, notes = "") => addCard(db, { boardColumns: PIPELINE_B, boardStatusMap: [], boardIntake: "To Do", boardIncludeReviews: true }, { title, col, notes }, now);
  at("Stage smoke test for billing v2", "Deployed Stage", "Run the 12-step checklist before promoting.");
  at("Release notes 4.12", "Ready for Release");
  at("Hotfix: invoice rounding", "Deployed Prod");
  at("Draft Q4 platform roadmap", "Pending", "Waiting on infra estimates."); // the client group is fine to handle automatically in the demo
  for (const s of ["jira", "github", "whatsapp", "reminders"] as const) {
    setStatus(db, { source: s, ok: true, lastPollAt: now - 90_000, error: null, banner: null });
  }
}

/** Canned "Claude" for demo mode so screenshots and trial runs never call a model. */
export const demoRunner: Runner = async (prompt, schema) => {
  if ("reply_needed" in ((schema as any).properties ?? {})) {
    const lines = (prompt.match(/^\[\d{4}-/gm) ?? []).length;
    return prompt.includes("Lena Park")
      ? {
          summary: "Lena is blocked on API-77 until her pagination PR gets a review, and mobile needs the cursor format decided by Thursday.",
          action_items: ["Review Lena's pagination PR", "Decide: opaque cursor or invoice id (needed Thursday)"],
          reply_needed: true,
          reply_draft: "Hi Lena, I'll review the PR this afternoon. On the cursor: let's go with an opaque cursor, I'll confirm on the ticket.",
          sensitive: false,
        }
      : {
          summary: `Acme's Priya asked for an update on the failed webhooks and says they have a demo at 3pm; Tom sees duplicate deliveries too. Nobody from your side has answered (${lines} messages read).`,
          action_items: ["Confirm whether the retry fix lands before the 3pm demo", "Look into the duplicate deliveries Tom reported"],
          reply_needed: true,
          reply_draft: "Hi Priya, thanks for the ping. The retry fix is in review right now and I'm planning to have it merged and deployed before your 3pm demo. I'll confirm here by 2pm either way.",
          sensitive: false,
        };
  }
  if ("draft" in ((schema as any).properties ?? {})) {
    return { draft: "Hi Priya, thanks for the ping. The retry fix is in review right now and I'm planning to have it merged and deployed before your 3pm demo. I'll confirm here by 2pm either way." };
  }
  const known: Record<string, [string, string]> = {
    "reminder:r1": ["needs_me", "You set this yourself and it is past due."],
    "ticket:PAY-231": ["needs_me", "Client demo at 3pm depends on this retry fix, and a review is waiting on you."],
    "chat:120363@g.us": ["needs_me", "Client asked directly whether retries land today; no reply from you yet."],
    "ticket:API-77": ["delegate", "Question about cursor format is for the mobile contract; Lena can decide with them."],
    "pr:acme/web#1203": ["drop", "Automated lint bump with green CI; approve when convenient."],
    "ticket:OPS-88": ["needs_me", "Blocked by Sam; unblocking credentials rotation is on you."],
    "ticket:WEB-402": ["drop", "Copy tweak with no deadline; park it."],
  };
  const keys = [...prompt.matchAll(/<data id="([^"]+)">/g)].map((m) => m[1]!);
  return { verdicts: keys.map((k) => ({ itemKey: k, verdict: known[k]?.[0] ?? "needs_me", reason: known[k]?.[1] ?? "Needs a look." })) };
};

/** Demo mode has no Jira, so writes are simulated locally: a transition updates the ticket's status, a comment is "posted" as me. */
export function demoTransition(db: DB, ticketKey: string, status: string, now = Date.now()): string {
  const row = db.query("SELECT id, meta FROM events WHERE source = 'jira' AND source_id = ?").get(`issue:${ticketKey}`) as { id: number; meta: string } | null;
  if (!row) throw new Error(`Unknown ticket ${ticketKey}`);
  const meta = JSON.parse(row.meta);
  const from = meta.status;
  meta.status = status;
  meta.statusCategory = /done|closed/i.test(status) ? "done" : /to do|backlog/i.test(status) ? "new" : "indeterminate";
  db.query("UPDATE events SET meta = ?, ts = ? WHERE id = ?").run(JSON.stringify(meta), now, row.id);
  upsertEvents(db, [{ source: "jira", sourceId: `status:${ticketKey}:${now}`, kind: "status_change", nativeKey: `ticket:${ticketKey}`, ticketKey, title: "", author: "Me", authorIsMe: true, body: `${from} → ${status}`, url: null, ts: now, mentionsMe: false, meta: { from, to: status } }]);
  return `${ticketKey} → ${status}`;
}

export function demoComment(db: DB, ticketKey: string, text: string, now = Date.now()): string {
  upsertEvents(db, [{ source: "jira", sourceId: `comment:${ticketKey}:${now}`, kind: "comment", nativeKey: `ticket:${ticketKey}`, ticketKey, title: "", author: "Me", authorIsMe: true, body: text, url: null, ts: now, mentionsMe: false, meta: {} }]);
  return `commented on ${ticketKey}`;
}
