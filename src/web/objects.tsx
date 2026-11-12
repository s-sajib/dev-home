import { motion } from "motion/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type { Keymap } from "../shared/keys";
import type { Item } from "./Chat";
import { FLAG_LABEL, VERDICT_LABEL, ago, flagTone, sortFlags, type Tone } from "./format";
import { AlarmClockIcon, ArrowUpRightIcon, CircleCheckIcon, GitPullRequestIcon, MessageCircleIcon, StickyNoteIcon, TicketIcon, useIconHover, type IconHandle } from "./icons";
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

const ICON = { ticket: TicketIcon, pr: GitPullRequestIcon, chat: MessageCircleIcon, reminder: AlarmClockIcon, note: StickyNoteIcon } as const;
const LIVE_EVERY_MS = 6000;

/**
 * One animated icon per object kind. Parents play it via `useIconHover` (pass its `ref`); `live` makes an urgent
 * object ring every few seconds; `done` swaps in a check that draws itself.
 */
export const Glyph = forwardRef<IconHandle, { kind: Kind; size?: number; live?: boolean; done?: boolean }>(function Glyph({ kind, size = 17, live, done }, ref) {
  const inner = useRef<IconHandle>(null);
  const [plays, setPlays] = useState(0);
  useImperativeHandle(ref, () => ({ startAnimation: () => inner.current?.startAnimation(), stopAnimation: () => inner.current?.stopAnimation() }));
  useEffect(() => {
    if (!live) return;
    const play = () => { inner.current?.startAnimation(); setPlays((n) => n + 1); };
    const first = setTimeout(play, 900);
    const every = setInterval(play, LIVE_EVERY_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [live]);
  useEffect(() => { if (done) inner.current?.startAnimation(); }, [done]);
  const Icon = done ? CircleCheckIcon : ICON[kind];
  return (
    <span className={`glyph k-${kind} ${live ? "live" : ""} ${done ? "is-done" : ""}`} role="img" aria-label={KIND_LABEL[kind]} data-plays={plays}>
      <Icon ref={inner} size={size} />
    </span>
  );
});

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
  const hover = useIconHover();
  return (
    <motion.button
      layout="position" className={`row ${selected ? "selected" : ""}`} data-key={item.itemKey} onClick={onClick} {...hover.triggerProps}
      variants={{ hidden: { opacity: 0, y: 6 }, rest: { opacity: 1, y: 0, x: 0, transition: { delay: Math.min(index, 14) * 0.03 } } }}
      initial="hidden" animate="rest" exit={{ opacity: 0, x: -14, transition: { duration: 0.2 } }}
    >
      {selected && <motion.span layoutId="rowsel" className="rowsel" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
      <Glyph ref={hover.ref} kind={kind} live={kind === "reminder" && item.flags.includes("overdue_reminder")} done={done} />
      <div className="rb">
        <div className="t">{item.title}</div>
        {line && <div className="why">{w && <Lamp tone={w.tone} />}{line}</div>}
      </div>
      <span className="when">{ago(item.lastActivity, now)}</span>
    </motion.button>
  );
}

export interface Verb { id: string; label: string; key?: string; primary?: boolean; onClick: () => void; hidden?: boolean; icon?: (p: { ref: React.Ref<IconHandle> }) => ReactNode }

/** One verb row per object. Keys appear on hover so the page stays quiet. */
export function Verbs({ verbs, lead }: { verbs: Verb[]; lead?: ReactNode }) {
  return (
    <div className="verbs">
      {lead}
      {verbs.filter((v) => !v.hidden).map((v) => <VerbButton key={v.id} verb={v} />)}
    </div>
  );
}

function VerbButton({ verb: v }: { verb: Verb }) {
  const hover = useIconHover();
  return (
    <Tip keyHint={v.key}>
      <button className={`verb ${v.primary ? "primary" : ""}`} onClick={v.onClick} {...hover.triggerProps}>{v.label}{v.icon?.({ ref: hover.ref })}</button>
    </Tip>
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
    { id: "open", label: kind === "ticket" ? "Open ticket" : "Open", key: keys.open, primary: true, hidden: !urls.main, onClick: () => ops.open(urls.main!), icon: ({ ref }) => <ArrowUpRightIcon ref={ref} size={14} /> },
    { id: "pr", label: "Open PR", hidden: !urls.pr, onClick: () => ops.open(urls.pr!), icon: ({ ref }) => <ArrowUpRightIcon ref={ref} size={14} /> },
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
