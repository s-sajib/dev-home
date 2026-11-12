import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { Keymap } from "../shared/keys";
import type { Item } from "./Chat";
import { FLAG_LABEL, VERDICT_LABEL, ago, flagTone, sortFlags, type Tone } from "./format";
import { Tip } from "./ui";

/**
 * OOUX: the app has five objects. Each has ONE glyph, ONE way to name its "why you", ONE verb row,
 * and the same representation everywhere (inbox row, board card, detail, drawer).
 */
export type Kind = "ticket" | "pr" | "chat" | "reminder" | "note";
export const KIND_LABEL: Record<Kind, string> = { ticket: "Ticket", pr: "Pull request", chat: "Conversation", reminder: "Reminder", note: "Note" };

export function kindOf(itemKey: string | null): Kind {
  if (!itemKey) return "note";
  if (itemKey.startsWith("chat:")) return "chat";
  if (itemKey.startsWith("pr:")) return "pr";
  if (itemKey.startsWith("reminder:")) return "reminder";
  return "ticket";
}

/** Icons are variant-driven: any motion parent with whileHover="hover" makes them draw / turn. `live` keeps urgent ones moving slowly. */
const draw = { rest: { pathLength: 1 }, hover: { pathLength: [0, 1], transition: { duration: 0.55 } } };
const pop = { rest: { scale: 1 }, hover: { scale: [1, 1.5, 1], transition: { duration: 0.5 } } };
const center = { transformBox: "fill-box", transformOrigin: "center" } as const;
const view = { transformBox: "view-box", transformOrigin: "8px 8px" } as const;

export function Glyph({ kind, size = 16, live, done }: { kind: Kind; size?: number; live?: boolean; done?: boolean }) {
  let body: ReactNode;
  if (done) {
    body = <><circle cx="8" cy="8" r="5.5" /><motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.08 }} d="M5.2 8.3l2 2 3.6-4" /></>;
  } else if (kind === "ticket") {
    body = <><rect x="2.5" y="3" width="11" height="10" rx="2.5" /><motion.path variants={draw} d="M5.5 6.5h5M5.5 9.5h3" /></>;
  } else if (kind === "pr") {
    body = <>
      {[[4.5, 3.5], [4.5, 12.5], [11.5, 12.5]].map(([cx, cy], i) => <motion.circle key={i} variants={{ ...pop, hover: { ...pop.hover, transition: { duration: 0.5, delay: i * 0.08 } } }} style={center} cx={cx} cy={cy} r="1.6" />)}
      <motion.path variants={draw} d="M4.5 5.1v5.8M11.5 10.9V7.5a2 2 0 0 0-2-2H8" />
    </>;
  } else if (kind === "chat") {
    body = <motion.path variants={{ rest: { rotate: 0, y: 0 }, hover: { rotate: [0, -7, 4, 0], y: [0, -1, 0, 0], transition: { duration: 0.5 } } }} style={{ transformBox: "fill-box", transformOrigin: "30% 100%" }} d="M3 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H7.5L4.5 13v-2.5H5A2 2 0 0 1 3 8.5z" />;
  } else if (kind === "reminder") {
    body = <>
      <circle cx="8" cy="8" r="5.5" />
      {live
        ? <motion.path animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 24, ease: "linear" }} style={view} d="M8 8V5M8 8l2 1.3" />
        : <motion.path variants={{ rest: { rotate: 0 }, hover: { rotate: 360, transition: { duration: 0.9 } } }} style={view} d="M8 8V5M8 8l2 1.3" />}
    </>;
  } else {
    body = <motion.path variants={{ rest: { rotate: 0 }, hover: { rotate: 90, transition: { duration: 0.45 } } }} style={center} d="M8 2.5 13.5 8 8 13.5 2.5 8z" />;
  }
  return (
    <svg className={`glyph k-${kind} ${live ? "live" : ""} ${done ? "is-done" : ""}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-label={KIND_LABEL[kind]} role="img">
      {body}
    </svg>
  );
}

/** The single "why this is here" line every object shows. */
export function why(item: Pick<Item, "flags" | "verdict" | "reason">): { text: string; tone: Tone } | null {
  const top = sortFlags(item.flags)[0];
  if (!top) return null;
  return { text: FLAG_LABEL[top], tone: flagTone(top) };
}

export const Lamp = ({ tone }: { tone: Tone }) =>
  tone === "warn"
    ? <motion.i className="lamp warn" animate={{ opacity: [1, 0.75, 1], boxShadow: ["0 0 10px 1px var(--lamp)", "0 0 4px 0 var(--lamp)", "0 0 10px 1px var(--lamp)"] }} transition={{ repeat: Infinity, duration: 3.4, ease: "easeInOut" }} />
    : <i className={`lamp ${tone || "dim"}`} />;

/** Relationships: other objects that share this one's ticket key. */
export function related(item: Item, all: Item[]): Item[] {
  const tk = item.ticketKey;
  if (!tk) return [];
  return all.filter((o) => o.itemKey !== item.itemKey && (o.ticketKey === tk || o.itemKey === `ticket:${tk}`));
}

/** Compact representation, used in lists and as a relationship link. The selection pill slides between rows (shared layout). */
export function ObjectRow({ item, now, selected, index = 0, onClick, detail, done }: { item: Item; now: number; selected?: boolean; index?: number; onClick: () => void; detail: "reason" | "why"; done?: boolean }) {
  const w = why(item);
  const line = detail === "reason" && item.reason ? item.reason : w?.text;
  const kind = kindOf(item.itemKey);
  return (
    <motion.button
      layout="position" className={`row ${selected ? "selected" : ""}`} data-key={item.itemKey} onClick={onClick}
      variants={{ hidden: { opacity: 0, y: 6 }, rest: { opacity: 1, y: 0, x: 0, transition: { delay: Math.min(index, 14) * 0.03 } }, hover: { opacity: 1, y: 0, x: 0 } }}
      initial="hidden" animate="rest" whileHover="hover" exit={{ opacity: 0, x: -14, transition: { duration: 0.2 } }}
    >
      {selected && <motion.span layoutId="rowsel" className="rowsel" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
      <Glyph kind={kind} live={kind === "reminder" && item.flags.includes("overdue_reminder")} done={done} />
      <div className="rb">
        <div className="t">{item.title}</div>
        {line && <div className="why">{w && <Lamp tone={w.tone} />}{line}</div>}
      </div>
      <span className="when">{ago(item.lastActivity, now)}</span>
    </motion.button>
  );
}

export interface Verb { id: string; label: string; key?: string; primary?: boolean; onClick: () => void; hidden?: boolean }

/** One verb row per object. Keys appear on hover so the page stays quiet. */
export function Verbs({ verbs, lead }: { verbs: Verb[]; lead?: ReactNode }) {
  return (
    <div className="verbs">
      {lead}
      {verbs.filter((v) => !v.hidden).map((v) => (
        <Tip key={v.id} keyHint={v.key}><button className={`verb ${v.primary ? "primary" : ""}`} onClick={v.onClick}>{v.label}</button></Tip>
      ))}
    </div>
  );
}

export interface Ops {
  open: (url: string) => void; board: () => void; snooze: () => void; dismiss: () => void;
  transition: () => void; comment: () => void; complete: () => void; remind: () => void;
}

export function verbsFor(item: Item, ops: Ops, keys: Keymap, urls: { main: string | null; pr: string | null }): Verb[] {
  const kind = kindOf(item.itemKey);
  const common: Verb[] = [
    { id: "board", label: "Board", key: keys.addToBoard, onClick: ops.board },
    { id: "snooze", label: "Snooze", key: keys.snooze, onClick: ops.snooze },
    { id: "dismiss", label: "Dismiss", key: keys.dismiss, onClick: ops.dismiss },
  ];
  if (kind === "reminder") return [{ id: "complete", label: "Complete", key: keys.complete, primary: true, onClick: ops.complete }, ...common];
  const open: Verb[] = [
    { id: "open", label: kind === "ticket" ? "Open ticket ↗" : "Open ↗", key: keys.open, primary: true, hidden: !urls.main, onClick: () => ops.open(urls.main!) },
    { id: "pr", label: "Open PR ↗", hidden: !urls.pr, onClick: () => ops.open(urls.pr!) },
  ];
  const jira: Verb[] = kind === "ticket" && item.ticketKey ? [
    { id: "transition", label: "Move", key: keys.transition, onClick: ops.transition },
    { id: "comment", label: "Comment", key: keys.comment, onClick: ops.comment },
  ] : [];
  return [...open, ...jira, ...common];
}

export const urlsOf = (item: Item): { main: string | null; pr: string | null } => ({
  main: item.url,
  pr: item.events.find((e) => e.source === "github" && e.url && e.url !== item.url)?.url ?? (item.url?.includes("github.com") ? null : null),
});

export { VERDICT_LABEL };
