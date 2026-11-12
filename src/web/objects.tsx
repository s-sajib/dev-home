import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Keymap } from "../shared/keys";
import type { Item } from "./Chat";
import { FLAG_LABEL, VERDICT_LABEL, ago, flagTone, sortFlags, type Tone } from "./format";

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

const PATHS: Record<Kind, ReactNode> = {
  ticket: <><rect x="2.5" y="3" width="11" height="10" rx="2.5" /><path d="M5.5 6.5h5M5.5 9.5h3" /></>,
  pr: <><circle cx="4.5" cy="3.5" r="1.6" /><circle cx="4.5" cy="12.5" r="1.6" /><circle cx="11.5" cy="12.5" r="1.6" /><path d="M4.5 5.1v5.8M11.5 10.9V7.5a2 2 0 0 0-2-2H8" /></>,
  chat: <path d="M3 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H7.5L4.5 13v-2.5H5A2 2 0 0 1 3 8.5z" />,
  reminder: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.3" /></>,
  note: <path d="M8 2.5 13.5 8 8 13.5 2.5 8z" />,
};

export function Glyph({ kind, size = 16 }: { kind: Kind; size?: number }) {
  return (
    <svg className={`glyph k-${kind}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-label={KIND_LABEL[kind]} role="img">
      {PATHS[kind]}
    </svg>
  );
}

/** The single "why this is here" line every object shows. */
export function why(item: Pick<Item, "flags" | "verdict" | "reason">): { text: string; tone: Tone } | null {
  const top = sortFlags(item.flags)[0];
  if (!top) return null;
  return { text: FLAG_LABEL[top], tone: flagTone(top) };
}

export const Lamp = ({ tone }: { tone: Tone }) => <i className={`lamp ${tone || "dim"}`} />;

/** Relationships: other objects that share this one's ticket key. */
export function related(item: Item, all: Item[]): Item[] {
  const tk = item.ticketKey;
  if (!tk) return [];
  return all.filter((o) => o.itemKey !== item.itemKey && (o.ticketKey === tk || o.itemKey === `ticket:${tk}`));
}

/** Compact representation, used in lists and as a relationship link. */
export function ObjectRow({ item, now, selected, index = 0, onClick, detail }: { item: Item; now: number; selected?: boolean; index?: number; onClick: () => void; detail: "reason" | "why" }) {
  const w = why(item);
  const line = detail === "reason" && item.reason ? item.reason : w?.text;
  return (
    <button className={`row ${selected ? "selected" : ""}`} data-key={item.itemKey} style={{ ["--i" as string]: index }} onClick={onClick}>
      <Glyph kind={kindOf(item.itemKey)} />
      <div className="rb">
        <div className="t">{item.title}</div>
        {line && <div className="why">{detail === "reason" && w ? <Lamp tone={w.tone} /> : w && <Lamp tone={w.tone} />}{line}</div>}
      </div>
      <span className="when">{ago(item.lastActivity, now)}</span>
    </button>
  );
}

export function Pop({ trigger, children, label, align = "left" }: { trigger: ReactNode; children: ReactNode; label: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div className="pop" ref={ref}>
      <button className="caret" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>{trigger}</button>
      {open && <div className={`panel ${align}`} role="dialog" aria-label={label}>{children}</div>}
    </div>
  );
}

export interface Verb { id: string; label: string; key?: string; primary?: boolean; onClick: () => void; hidden?: boolean }

/** One verb row per object. Keys appear on hover so the page stays quiet. */
export function Verbs({ verbs, lead }: { verbs: Verb[]; lead?: ReactNode }) {
  return (
    <div className="verbs">
      {lead}
      {verbs.filter((v) => !v.hidden).map((v) => (
        <button key={v.id} className={`verb ${v.primary ? "primary" : ""}`} onClick={v.onClick}>{v.label}{v.key && <kbd>{v.key}</kbd>}</button>
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
