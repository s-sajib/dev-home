import type { DB } from "./db";
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
    { ...base, source: "whatsapp", sourceId: "m1", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Priya (Acme)", body: "Morning! Any update on the failed webhooks (PAY-231)?", ts: now - 7 * H },
    { ...base, source: "whatsapp", sourceId: "m2", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Priya (Acme)", mentionsMe: true, body: "@You we have a demo at 3pm and need to know if retries land today", ts: now - 6 * H },
    { ...base, source: "whatsapp", sourceId: "m3", kind: "chat", nativeKey: "chat:120363@g.us", ticketKey: null, title: "Acme Support Group",
      author: "Tom (Acme)", body: "+1, we're seeing duplicates too", ts: now - 5.5 * H },

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
  for (const s of ["jira", "github", "whatsapp", "reminders"] as const) {
    setStatus(db, { source: s, ok: true, lastPollAt: now - 90_000, error: null, banner: null });
  }
}
