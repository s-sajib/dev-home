import type { Config } from "./config";
import type { DB } from "./db";
import { itemKeyFor, listItems, visibleEvents } from "./inbox";
import { loadEvents } from "./store";
import type { Flag, NormalizedEvent, Source } from "./types";

/**
 * Work board. Cards are either linked to an inbox item (Jira ticket + its PRs, or a standalone PR) and placed
 * automatically, or manual. Moving a card by hand pins it so automation never fights you; unpin to hand it back.
 * Placement is local: moving a card never writes to Jira or GitHub.
 */

export const PIPELINE_A = ["Pending", "To Do", "In Progress", "Decision Needed", "PR Review", "Merged", "Deployed Stage", "Deployed Prod"];
export const PIPELINE_B = ["Pending", "To Do", "In Progress", "Decision Needed", "PR Review", "Merged", "Deployed Stage", "Ready for Release", "Deployed Prod"];
export const DEFAULT_STATUS_MAP = [
  "Backlog = Pending",
  "Open = To Do",
  "To Do = To Do",
  "Selected for Development = To Do",
  "In Progress = In Progress",
  "Blocked = Decision Needed",
  "On Hold = Decision Needed",
  "In Review = PR Review",
  "Code Review = PR Review",
  "Done = Merged",
  "Closed = Merged",
  // GitHub issues: state and labels use the same map
  "blocked = Decision Needed",
  "needs decision = Decision Needed",
  "in progress = In Progress",
  "in review = PR Review",
];

export interface BoardCard {
  id: number;
  itemKey: string | null;
  title: string;
  notes: string;
  url: string | null;
  ticketKey: string | null;
  col: string;
  pos: number;
  pinned: boolean;
  /** live info from the linked item (null for manual cards) */
  flags: Flag[];
  sources: Source[];
  status: string | null;
  lastActivity: number | null;
  /** set when the card was made from a single message / comment */
  originKey: string | null;
  originLabel: string | null;
  originUrl: string | null;
}

type BoardCfg = Pick<Config, "boardColumns" | "boardStatusMap" | "boardIntake" | "boardIncludeReviews"> & Partial<Pick<Config, "boardSyncJira" | "boardMessageColumn">>;

export function parseStatusMap(lines: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of lines) {
    const i = l.indexOf("=");
    if (i > 0) m.set(l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim());
  }
  return m;
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const findCol = (cols: string[], name: string | undefined | null) => (name ? cols.find((c) => eq(c, name)) ?? null : null);

/**
 * Where an item belongs, from its Jira status and PR state. The furthest-along signal wins (so an open PR pulls an
 * "In Progress" ticket into PR Review and a merged PR into Merged), except that "Decision Needed" always wins.
 */
export function autoColumn(events: NormalizedEvent[], cfg: BoardCfg): string | null {
  const cols = cfg.boardColumns;
  const map = parseStatusMap(cfg.boardStatusMap);
  const ticket = events.find((e) => e.kind === "ticket");
  const issue = events.find((e) => e.kind === "issue");
  // Jira status first; for a GitHub issue, its labels (first one the map knows) then its open/closed state
  const keys = ticket ? [String(ticket.meta.status ?? "")] : issue ? [...((issue.meta.labels as string[]) ?? []), String(issue.meta.state ?? "")] : [];
  const status = keys.find((k) => map.has(k.toLowerCase())) ?? "";
  const fromJira = findCol(cols, map.get(status.toLowerCase()));
  if (fromJira && eq(fromJira, "Decision Needed")) return fromJira;

  const prs = events.filter((e) => e.kind === "pr" || e.kind === "review_request");
  const prCol = findCol(cols, "PR Review");
  const mergedCol = findCol(cols, "Merged");
  let fromPr: string | null = null;
  if (prs.length) {
    const openPr = prs.some((e) => e.kind === "review_request" || (e.kind === "pr" && e.meta.merged !== true));
    const merged = prs.some((e) => e.kind === "pr" && e.meta.merged === true);
    fromPr = openPr ? prCol : merged ? mergedCol : null;
  }
  const candidates = [fromJira, fromPr].filter((c): c is string => !!c);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (cols.indexOf(b) > cols.indexOf(a) ? b : a));
}

function nextPos(db: DB, col: string): number {
  const r = db.query("SELECT MAX(pos) AS m FROM board_cards WHERE col = ?").get(col) as { m: number | null };
  return (r.m ?? 0) + 1000;
}

const qualifies = (events: NormalizedEvent[], cfg: BoardCfg) =>
  events.some((e) => e.kind === "ticket" && e.meta.assignedToMe === true) ||
  events.some((e) => e.kind === "issue" && e.meta.assignedToMe === true) ||
  events.some((e) => e.kind === "pr" && e.meta.mine === true) ||
  (cfg.boardIncludeReviews && events.some((e) => e.kind === "review_request" && e.meta.open !== false));

/** Create cards for new work and re-place unpinned cards when the underlying status changed. */
export function syncBoard(db: DB, cfg: BoardCfg, now = Date.now()): { created: number; moved: number } {
  const groups = new Map<string, NormalizedEvent[]>();
  for (const e of visibleEvents(loadEvents(db))) {
    if (e.source === "whatsapp" || e.source === "reminders") continue;
    const k = itemKeyFor(e);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  let created = 0;
  let moved = 0;
  db.transaction(() => {
    for (const [key, evs] of groups) {
      if (!qualifies(evs, cfg)) continue;
      if (cfg.boardSyncJira === false && evs.some((e) => e.source === "jira")) continue; // one-way Jira sync switched off
      const target = autoColumn(evs, cfg) ?? findCol(cfg.boardColumns, cfg.boardIntake) ?? cfg.boardColumns[0]!;
      const titled = [...evs].reverse().find((e) => e.title);
      const urlEv = [...evs].reverse().find((e) => e.url && (e.kind === "ticket" || e.kind === "pr" || e.kind === "review_request")) ?? evs.find((e) => e.url);
      const ticketKey = evs.find((e) => e.ticketKey)?.ticketKey ?? null;
      const row = db.query("SELECT id, col, pinned FROM board_cards WHERE item_key = ?").get(key) as { id: number; col: string; pinned: number } | null;
      if (!row) {
        db.query("INSERT INTO board_cards (item_key, title, url, ticket_key, col, pos, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
          .run(key, titled?.title || key, urlEv?.url ?? null, ticketKey, target, nextPos(db, target), now, now);
        created++;
      } else {
        db.query("UPDATE board_cards SET title = ?, url = ?, ticket_key = ?, updated_at = ? WHERE id = ?").run(titled?.title || key, urlEv?.url ?? null, ticketKey, now, row.id);
        if (!row.pinned && row.col !== target) {
          db.query("UPDATE board_cards SET col = ?, pos = ? WHERE id = ?").run(target, nextPos(db, target), row.id);
          moved++;
        }
      }
    }
  })();
  return { created, moved };
}

export function getBoard(db: DB, cfg: BoardCfg & Pick<Config, "boardColumns">, now = Date.now()) {
  const items = new Map(listItems(db, now).map((i) => [i.itemKey, i]));
  const status = new Map<string, string>();
  for (const e of loadEvents(db)) if (e.kind === "ticket" && e.meta.status) status.set(`ticket:${e.ticketKey}`, String(e.meta.status));
  const rows = db.query("SELECT * FROM board_cards ORDER BY pos ASC, id ASC").all() as any[];
  const cols = cfg.boardColumns;
  const cards: BoardCard[] = rows.map((r) => {
    const it = r.item_key ? items.get(r.item_key) : undefined;
    return {
      id: r.id, itemKey: r.item_key, title: it?.title ?? r.title, notes: r.notes, url: it?.url ?? r.url, ticketKey: r.ticket_key,
      // a card whose column was removed from settings shows in the first column until moved
      col: findCol(cols, r.col) ?? cols[0]!, pos: r.pos, pinned: !!r.pinned,
      flags: it?.flags ?? [], sources: it?.sources ?? [], status: status.get(r.item_key) ?? null, lastActivity: it?.lastActivity ?? null,
      originKey: r.origin_key ?? null, originLabel: r.origin_label ?? null, originUrl: r.origin_url ?? null,
    };
  });
  return { columns: cols, cards };
}

export function addCard(db: DB, cfg: BoardCfg, input: { title: string; notes?: string; col?: string; itemKey?: string; url?: string | null; ticketKey?: string | null; origin?: { key: string; label: string; url: string | null; event: string } }, now = Date.now()): number {
  const title = input.title.trim();
  if (!title) throw new Error("A card needs a title");
  const col = findCol(cfg.boardColumns, input.col) ?? cfg.boardColumns[0]!;
  if (input.itemKey) {
    const ex = db.query("SELECT id FROM board_cards WHERE item_key = ?").get(input.itemKey) as { id: number } | null;
    if (ex) throw new Error("This item is already on the board");
  }
  const o = input.origin;
  if (o && db.query("SELECT id FROM board_cards WHERE origin_key = ? AND origin_event = ?").get(o.key, o.event)) throw new Error("This message is already a card on the board");
  const r = db.query("INSERT INTO board_cards (item_key, title, notes, url, ticket_key, col, pos, pinned, created_at, updated_at, origin_key, origin_label, origin_url, origin_event) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)")
    .run(input.itemKey ?? null, title.slice(0, 300), (input.notes ?? "").slice(0, 5000), input.url ?? null, input.ticketKey ?? null, col, nextPos(db, col), now, now, o?.key ?? null, o?.label ?? null, o?.url ?? null, o?.event ?? null);
  return Number(r.lastInsertRowid);
}

/** Move a card to a column at an index (0 = top). A manual move pins the card. */
export function moveCard(db: DB, cfg: BoardCfg, id: number, col: string, index?: number, now = Date.now()) {
  const target = findCol(cfg.boardColumns, col);
  if (!target) throw new Error(`Unknown column "${col}". Columns: ${cfg.boardColumns.join(", ")}`);
  if (!db.query("SELECT id FROM board_cards WHERE id = ?").get(id)) throw new Error("Unknown card");
  db.transaction(() => {
    const others = (db.query("SELECT id FROM board_cards WHERE col = ? AND id != ? ORDER BY pos ASC, id ASC").all(target, id) as { id: number }[]).map((r) => r.id);
    const at = index === undefined ? others.length : Math.max(0, Math.min(index, others.length));
    others.splice(at, 0, id);
    others.forEach((cid, i) => db.query("UPDATE board_cards SET col = ?, pos = ?, updated_at = ?, pinned = CASE WHEN id = ? THEN 1 ELSE pinned END WHERE id = ?").run(target, (i + 1) * 1000, now, id, cid));
  })();
}

export function updateCard(db: DB, id: number, patch: { title?: string; notes?: string; pinned?: boolean }, now = Date.now()) {
  const row = db.query("SELECT * FROM board_cards WHERE id = ?").get(id) as any;
  if (!row) throw new Error("Unknown card");
  const title = patch.title !== undefined ? patch.title.trim() : row.title;
  if (!title) throw new Error("A card needs a title");
  db.query("UPDATE board_cards SET title = ?, notes = ?, pinned = ?, updated_at = ? WHERE id = ?").run(
    title.slice(0, 300), (patch.notes ?? row.notes).slice(0, 5000), patch.pinned === undefined ? row.pinned : patch.pinned ? 1 : 0, now, id,
  );
}

export function removeCard(db: DB, id: number) {
  db.query("DELETE FROM board_cards WHERE id = ?").run(id);
}

const SOURCE_NAME: Record<string, string> = { whatsapp: "WhatsApp", jira: "Jira", github: "GitHub", reminders: "Reminders" };

/** Make a board card from one message or comment. The card links back to where it came from. */
export function cardFromEvent(db: DB, cfg: BoardCfg, input: { itemKey: string; eventId: string; col?: string }, now = Date.now()): number {
  const row = db.query("SELECT * FROM events WHERE source_id = ? AND (native_key = ? OR ticket_key = ?)").get(input.eventId, input.itemKey, input.itemKey.replace(/^ticket:/, "")) as any;
  if (!row) throw new Error("That message or comment was not found");
  const clean = String(row.body ?? "").replace(/@[\w.-]+/g, "").replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const title = (firstSentence.length > 8 ? firstSentence : clean || "Follow up").slice(0, 90);
  const when = new Date(row.ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const who = row.author_is_me ? "Me" : row.author;
  const place = row.source === "whatsapp" ? `WhatsApp · ${row.title}` : `${SOURCE_NAME[row.source] ?? row.source} · ${row.title}`;
  return addCard(db, cfg, {
    title,
    notes: `“${String(row.body ?? "").trim().slice(0, 800)}”\n— ${who}, ${when}`,
    col: input.col ?? cfg.boardMessageColumn ?? cfg.boardColumns[0],
    ticketKey: row.ticket_key ?? null,
    origin: { key: input.itemKey, label: place, url: row.url ?? null, event: input.eventId },
  }, now);
}
