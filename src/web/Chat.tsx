import { useEffect, useRef, useState } from "react";
import type { Keymap } from "../shared/keys";
import type { InboxItem } from "../server/types";
import { FLAG_LABEL, ago, dayLabel, flagTone, initials, personColor, sortFlags, timeLabel, verdictTone, VERDICT_LABEL } from "./format";

export type LlmMode = "manual" | "auto" | "never";
export interface SummaryDto { n: number; summary: string; actionItems: string[]; replyNeeded: boolean; sensitive: boolean; createdAt: number }
export type Item = InboxItem & { draft: string | null; llmMode: LlmMode | null; summary: SummaryDto | null };

export interface ChatProps {
  item: Item; now: number; busy: string | null; defaultN: number; n: number; presets: number[]; keys: Keymap;
  onCopy: (t: string) => void; setN: (n: number) => void; onSummarize: (n: number) => void;
  onDefault: (n: number) => void; onMode: (m: LlmMode) => void; onBoard: () => void;
}

interface Run { author: string; mine: boolean; mention: boolean; msgs: { body: string; ts: number; mention: boolean }[] }

/** Consecutive messages by the same person within 5 minutes read as one run, like a real chat. */
export function toRuns(events: Item["events"]): { day: string | null; run: Run }[] {
  const out: { day: string | null; run: Run }[] = [];
  let lastDay = "";
  let cur: Run | null = null;
  let lastTs = 0;
  for (const e of events) {
    const day = new Date(e.ts).toDateString();
    const newDay = day !== lastDay;
    if (!cur || newDay || e.authorIsMe !== cur.mine || (!e.authorIsMe && e.author !== cur.author) || e.ts - lastTs > 5 * 60_000) {
      cur = { author: e.author, mine: e.authorIsMe, mention: false, msgs: [] };
      out.push({ day: newDay ? String(e.ts) : null, run: cur });
      lastDay = day;
    }
    cur.msgs.push({ body: e.body, ts: e.ts, mention: e.mentionsMe });
    lastTs = e.ts;
  }
  return out;
}

const withMentions = (s: string) => s.split(/(@[\w.\-]+)/).map((p, i) => (/^@[\w.\-]+$/.test(p) ? <span key={i} className="at">{p}</span> : p));

export function Chat(p: ChatProps) {
  const { item, now } = p;
  const never = item.llmMode === "never";
  const sm = item.summary;
  const end = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [item.itemKey]);
  const isCustom = !p.presets.includes(p.n);
  const runs = toRuns(item.events);
  const isGroup = item.itemKey.endsWith("@g.us");

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [item.itemKey, item.events.length, item.draft]);

  return (
    <div className="chat" data-testid="chat">
      <div className="chat-head">
        <div className="avatar">{initials(item.title)}</div>
        <div>
          <h3>{item.title}</h3>
          <div className="sub">{isGroup ? "group" : "direct"} · last activity {ago(item.lastActivity, now)}</div>
        </div>
        <div className="chips">
          {item.verdict && <span className={`chip ${verdictTone(item.verdict)}`}>{VERDICT_LABEL[item.verdict]}</span>}
          {sortFlags(item.flags).slice(0, 2).map((f) => <span key={f} className={`chip ${flagTone(f)}`}>{FLAG_LABEL[f]}</span>)}
          {item.ticketKey && <span className="chip accent">{item.ticketKey}</span>}
        </div>
        <button className="pill" onClick={p.onBoard} title="Add to board">+ Board</button>
      </div>

      <div className="toolbar">
        <div className="grp">
        <span className="lbl">Summarise last</span>
        <div className="seg">
          {p.presets.map((x) => (
            <button key={x} className={p.n === x ? "on" : ""} disabled={never} onClick={() => p.setN(x)}>{x}{x === p.defaultN && <i title="default"> ★</i>}</button>
          ))}
          <input className={isCustom ? "on" : ""} placeholder="custom" inputMode="numeric" value={custom} disabled={never}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setCustom(d); if (Number(d) > 0) p.setN(Math.min(Number(d), 500)); }} />
        </div>
        <button className="go" disabled={never || p.busy === "summarize"} onClick={() => p.onSummarize(p.n)}>{p.busy === "summarize" ? "Summarising…" : <>Summarise <kbd>{p.keys.summarize}</kbd></>}</button>
        {p.n !== p.defaultN && <button className="link" onClick={() => p.onDefault(p.n)}>make {p.n} the default</button>}
        </div>
        <div className="grp end">
        <span className="lbl">Claude</span>
        <div className="seg" title="Who may send this chat to Claude">
          {(["manual", "auto", "never"] as const).map((m) => (
            <button key={m} className={item.llmMode === m ? `on ${m}` : ""} onClick={() => p.onMode(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
        </div>
      </div>

      {sm && (
        <section className="summary" data-testid="summary">
          <header>
            <b>Summary</b>
            {sm.replyNeeded && <span className="chip warn">reply needed</span>}
            {sm.sensitive && <span className="chip bad">may be sensitive</span>}
            <small>last {sm.n} messages · {ago(sm.createdAt, now)}</small>
          </header>
          <p className={open ? "" : "clamp"}>{sm.summary}</p>
          {open && sm.actionItems.length > 0 && <ul>{sm.actionItems.map((a, i) => <li key={i}>{a}</li>)}</ul>}
          <button className="link" onClick={() => setOpen(!open)}>{open ? "Show less" : `Show ${sm.actionItems.length} action item${sm.actionItems.length === 1 ? "" : "s"}`}</button>
        </section>
      )}

      <div className="convo">
        {runs.map(({ day, run }, i) => (
          <div key={i} style={{ display: "contents" }}>
            {day && <div className="day">{dayLabel(Number(day), now)}</div>}
            {run.msgs.map((m, j) => (
              <div key={j} className={`msg ${run.mine ? "out" : "in"} ${j === 0 ? "first" : ""}`} data-testid={run.mine ? "msg-out" : "msg-in"}>
                {j === 0 && !run.mine && isGroup && <div className="who-name" style={{ color: personColor(run.author) }}>{run.author}</div>}
                <div className={`bubble ${m.mention ? "mention" : ""}`}>{withMentions(m.body)}</div>
                {j === run.msgs.length - 1 && <div className="stamp">{timeLabel(m.ts)}</div>}
              </div>
            ))}
          </div>
        ))}
        {item.draft && (
          <div className="draftbubble" data-testid="draft">
            <header>Draft · not sent <button className="copy" onClick={() => p.onCopy(item.draft!)}>Copy <kbd>{p.keys.copy}</kbd></button></header>
            <div>{item.draft}</div>
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="composer">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="7" width="10" height="7" rx="2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
        Read-only. Drafts appear above as a dashed bubble; you send them yourself from your phone.
      </div>
    </div>
  );
}
