export type Source = "jira" | "github" | "whatsapp" | "reminders";

export type EventKind =
  | "ticket" // snapshot of a ticket assigned to / watched by me
  | "comment" // Jira comment
  | "status_change" // Jira status changed
  | "review_request" // GitHub: my review was requested
  | "pr" // GitHub: a PR (mine or related)
  | "pr_comment" // GitHub comment / review
  | "chat" // WhatsApp message
  | "reminder"; // Apple Reminders entry

/** One normalized thing that happened in a source. Adapters produce these; nothing else writes events. */
export interface NormalizedEvent {
  source: Source;
  sourceId: string; // unique within source
  kind: EventKind;
  /** Native grouping key, e.g. "pr:org/repo#12", "chat:123@g.us", "reminder:abc". Tickets use "ticket:PROJ-1". */
  nativeKey: string;
  ticketKey: string | null;
  title: string; // item-level title (ticket summary, PR title, chat name)
  author: string; // display name
  authorIsMe: boolean;
  body: string;
  url: string | null;
  ts: number; // epoch ms
  mentionsMe: boolean;
  /** Extra source-specific facts used by rules (status, due date, quotedMe...) */
  meta: Record<string, unknown>;
}

export type Flag =
  | "mentions_me"
  | "unanswered_comment"
  | "review_requested"
  | "stale"
  | "status_changed_by_other"
  | "needs_reply"
  | "overdue_reminder"
  | "assigned";

export type Verdict = "needs_me" | "drop" | "delegate";

export interface InboxItem {
  itemKey: string;
  title: string;
  ticketKey: string | null;
  sources: Source[];
  flags: Flag[];
  lastActivity: number;
  url: string | null;
  verdict: Verdict | null;
  reason: string | null;
  /** Visible = not dismissed/snoozed (or resurfaced by new activity) */
  hidden: boolean;
  snoozedUntil: number | null;
  /** I pressed accept and nothing has happened on it since */
  accepted: boolean;
  events: ItemEvent[];
}

export interface ItemEvent {
  source: Source;
  kind: EventKind;
  author: string;
  authorIsMe: boolean;
  body: string;
  url: string | null;
  ts: number;
  mentionsMe: boolean;
}

export interface SourceStatus {
  source: Source;
  ok: boolean;
  lastPollAt: number | null;
  error: string | null;
  /** e.g. WhatsApp disconnected */
  banner: string | null;
}

/** Every adapter implements this. Parsing of external formats stays inside the adapter file. */
export interface SourceAdapter {
  source: Source;
  /** True when credentials/config are present; unconfigured adapters are skipped, not errors. */
  configured(): boolean;
  fetch(since: number | null): Promise<NormalizedEvent[]>;
  /** Optional liveness check (e.g. WhatsApp session state). A banner is shown while not ok. */
  health?(): Promise<{ ok: boolean; banner: string | null }>;
}
