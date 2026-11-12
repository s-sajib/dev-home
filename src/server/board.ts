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
}

type BoardCfg = Pick<Config, "boardColumns" | "boardStatusMap" | "boardIntake" | "boardIncludeReviews">;

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
  const status = String(ticket?.meta.status ?? "");
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
    };
  });
  return { columns: cols, cards };
}

export function addCard(db: DB, cfg: BoardCfg, input: { title: string; notes?: string; col?: string; itemKey?: string; url?: string | null; ticketKey?: string | null }, now = Date.now()): number {
  const title = input.title.trim();
  if (!title) throw new Error("A card needs a title");
  const col = findCol(cfg.boardColumns, input.col) ?? cfg.boardColumns[0]!;
  if (input.itemKey) {
    const ex = db.query("SELECT id FROM board_cards WHERE item_key = ?").get(input.itemKey) as { id: number } | null;
    if (ex) throw new Error("This item is already on the board");
  }
  const r = db.query("INSERT INTO board_cards (item_key, title, notes, url, ticket_key, col, pos, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
    .run(input.itemKey ?? null, title.slice(0, 300), (input.notes ?? "").slice(0, 5000), input.url ?? null, input.ticketKey ?? null, col, nextPos(db, col), now, now);
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
