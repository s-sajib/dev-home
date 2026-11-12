import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxItem, SourceStatus } from "../server/types";
import { FLAG_LABEL, SOURCE_LABEL, VERDICT_LABEL, ago, buildGroups, sortFlags } from "./format";

type Item = InboxItem & { draft: string | null };

interface InboxResponse {
  now: number;
  items: Item[];
  hiddenCount: number;
  statuses: SourceStatus[];
  configured: { jira: boolean; github: boolean; reminders: boolean; whatsapp: boolean };
  transitions: string[];
  chatToLlm: boolean;
  demo: boolean;
}

type Modal = { kind: "transition"; picked: string | null } | { kind: "comment"; text: string } | { kind: "help" } | null;

export function App() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; error?: boolean } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [grouping, setGrouping] = useState<"auto" | "verdict" | "lane">("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => setData(await (await fetch("/api/inbox")).json()), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const mode = grouping === "auto" ? (data?.items.some((i) => i.verdict) ? "verdict" : "lane") : grouping;
  const groups = useMemo(() => (data ? buildGroups(data.items, mode) : []), [data, mode]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // deep link from a nag notification: /?item=reminder:abc
  useEffect(() => {
    const want = new URLSearchParams(location.search).get("item");
    if (want && flat.some((i) => i.itemKey === want)) setSelKey(want);
  }, [flat.length]);

  const idx = Math.max(0, flat.findIndex((i) => i.itemKey === selKey));
  const current: Item | undefined = flat[idx];

  const say = (text: string, opts: { undo?: () => void; error?: boolean } = {}) => {
    setToast({ text, ...opts });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), opts.error ? 9000 : 6000);
  };

  const post = async (key: string, action: string, body: object = {}) => {
    const res = await fetch(`/api/items/${encodeURIComponent(key)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; error?: string; [k: string]: any };
  };

  const move = (delta: number) => setSelKey(flat[Math.max(0, Math.min(flat.length - 1, idx + delta))]?.itemKey ?? null);

  const act = async (action: string, body: object = {}, okText?: string, undoable = false) => {
    if (!current) return;
    const key = current.itemKey;
    const nextKey = flat[idx + 1]?.itemKey ?? flat[idx - 1]?.itemKey ?? null;
    setBusy(action);
    const r = await post(key, action, body);
    setBusy(null);
    if (!r.ok) return say(r.error ?? "Failed", { error: true });
    if (okText) say(okText, undoable ? { undo: async () => { await post(key, "restore"); await load(); } } : {});
    if (["dismiss", "snooze"].includes(action)) setSelKey(nextKey);
    await load();
    return r;
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); say("Draft copied. Paste it into WhatsApp yourself; this tool never sends."); } catch { say("Copy failed", { error: true }); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "Enter" && modal?.kind === "comment" && modal.text.trim() && current) {
        e.preventDefault();
        act("comment", { text: modal.text, confirm: true }, "Comment posted to Jira.").then(() => setModal(null));
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") { if (e.key === "Escape") setModal(null); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (modal?.kind === "transition") {
        if (e.key === "Escape") return setModal(null);
        const n = Number(e.key);
        if (n >= 1 && n <= (data?.transitions.length ?? 0)) return setModal({ kind: "transition", picked: data!.transitions[n - 1]! });
        if (e.key === "Enter" && modal.picked && current) {
          act("transition", { status: modal.picked, confirm: true }, `Moved ${current.ticketKey} to ${modal.picked}.`).then(() => setModal(null));
        }
        return;
      }
      if (modal) { if (e.key === "Escape" || e.key === "?") setModal(null); return; }

      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); move(1); break;
        case "k": case "ArrowUp": e.preventDefault(); move(-1); break;
        case "d": act("dismiss", {}, "Dismissed. New activity brings it back.", true); break;
        case "s": act("snooze", { hours: 4 }, "Snoozed for 4 hours.", true); break;
        case "a": act("accept", {}, "Accepted."); break;
        case "o": case "Enter": if (current?.url) window.open(current.url, "_blank", "noopener"); break;
        case "u": if (toast?.undo) { toast.undo(); setToast(null); } break;
        case "g": fetch("/api/poll", { method: "POST" }).then(load); say("Refreshing…"); break;
        case "i": say("Judging…"); fetch("/api/judge", { method: "POST" }).then((r) => r.json()).then((r) => { say(r.ok ? `Judged ${r.judged} item(s).` : r.error, { error: !r.ok }); load(); }); break;
        case "v": setGrouping(mode === "verdict" ? "lane" : "verdict"); break;
        case "r": act("remind", { hours: 2 }, "Reminder created in Work Inbox (due in 2h)."); break;
        case "x": act("complete", {}, "Reminder completed."); break;
        case "c": if (current) { say("Drafting…"); act("draft", {}).then((r) => r?.draft && say("Draft ready. Press y to copy.")); } break;
        case "y": if (current?.draft) copy(current.draft); break;
        case "t": if (current?.ticketKey) setModal({ kind: "transition", picked: null }); else say("No linked Jira ticket.", { error: true }); break;
        case "m": if (current?.ticketKey) { e.preventDefault(); setModal({ kind: "comment", text: "" }); } else say("No linked Jira ticket.", { error: true }); break;
        case "?": setModal({ kind: "help" }); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => { document.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" }); }, [selKey, data]);

  if (!data) return <div className="loading">Loading…</div>;
  const banners = data.statuses.filter((s) => !s.ok || s.banner);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Work Inbox {data.demo && <span className="demo">demo data</span>}</div>
        <div className="statuses">
          {(["jira", "github", "whatsapp", "reminders"] as const).map((src) => {
            const st = data.statuses.find((s) => s.source === src);
            const cls = !st ? "off" : st.ok && !st.banner ? "ok" : "bad";
            return (
              <span key={src} className={`chip ${cls}`} title={st?.error ?? st?.banner ?? ""}>
                <i className="dot" />{SOURCE_LABEL[src]}<small>{st?.lastPollAt ? ago(st.lastPollAt, data.now) : "not connected"}</small>
              </span>
            );
          })}
        </div>
        <div className="count">{flat.length} need you{data.hiddenCount > 0 && <small> · {data.hiddenCount} hidden</small>}</div>
      </header>

      {banners.map((s) => (
        <div key={s.source} className="banner">
          <b>{SOURCE_LABEL[s.source]}:</b> {s.banner ?? s.error ?? "problem"}{!s.banner && " Items from this source may be missing, not absent."}
        </div>
      ))}

      <main className="split">
        <div className="list">
          {flat.length === 0 && <div className="empty">Nothing needs you right now.</div>}
          {groups.map((g) => (
            <section key={g.id}>
              <h2>{g.title} <small>{g.hint}</small></h2>
              {g.items.map((it) => {
                const top = sortFlags(it.flags)[0];
                return (
                  <div key={it.itemKey} className={`row ${it.itemKey === current?.itemKey ? "selected" : ""}`} onClick={() => setSelKey(it.itemKey)}>
                    <div className="srcs">{it.sources.map((s) => <span key={s} className={`src ${s}`}>{SOURCE_LABEL[s]}</span>)}</div>
                    <div className="title">{it.title}</div>
                    <div className="meta">
                      {it.verdict && mode === "lane" && <span className={`flag verdict ${it.verdict}`}>{VERDICT_LABEL[it.verdict]}</span>}
                      {top && <span className={`flag ${top}`}>{FLAG_LABEL[top]}</span>}
                      <span className="when">{ago(it.lastActivity, data.now)}</span>
                    </div>
                    {it.reason && mode === "verdict" && <div className="why">{it.reason}</div>}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <aside className="detail">
          {current ? <Detail item={current} now={data.now} onCopy={copy} drafting={busy === "draft"} chatToLlm={data.chatToLlm} /> : <div className="empty">Select an item</div>}
        </aside>
      </main>

      {toast && (
        <div className={`toast ${toast.error ? "err" : ""}`}>
          {toast.text}
          {toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo <kbd>u</kbd></button>}
        </div>
      )}

      <footer className="keys">
        <span><kbd>j</kbd><kbd>k</kbd> move</span>
        <span><kbd>o</kbd> open</span>
        <span><kbd>a</kbd> accept</span>
        <span><kbd>d</kbd> dismiss</span>
        <span><kbd>s</kbd> snooze</span>
        <span><kbd>r</kbd> remind</span>
        <span><kbd>t</kbd> transition</span>
        <span><kbd>m</kbd> comment</span>
        <span><kbd>c</kbd> draft</span>
        <span><kbd>y</kbd> copy</span>
        <span><kbd>v</kbd> group</span>
        <span><kbd>i</kbd> judge</span>
        <span><kbd>g</kbd> refresh</span>
        <span><kbd>?</kbd> help</span>
      </footer>

      {modal?.kind === "transition" && current && (
        <Overlay>
          <h3>Move {current.ticketKey}</h3>
          <ol className="choices">
            {data.transitions.map((t, i) => <li key={t} className={modal.picked === t ? "picked" : ""}><kbd>{i + 1}</kbd> {t}</li>)}
          </ol>
          <p className="dim">{modal.picked ? <>Press <kbd>Enter</kbd> to confirm moving to <b>{modal.picked}</b>, or <kbd>Esc</kbd> to cancel.</> : "Pick a status. Nothing is written to Jira until you confirm."}</p>
        </Overlay>
      )}
      {modal?.kind === "comment" && current && (
        <Overlay>
          <h3>Comment on {current.ticketKey}</h3>
          <textarea autoFocus value={modal.text} onChange={(e) => setModal({ kind: "comment", text: e.target.value })} placeholder="Write a comment…" />
          <p className="dim"><kbd>⌘</kbd><kbd>Enter</kbd> posts to Jira · <kbd>Esc</kbd> cancels</p>
        </Overlay>
      )}
      {modal?.kind === "help" && (
        <Overlay>
          <h3>How this works</h3>
          <p>Code fetches and flags. Claude (via <code>claude -p</code>) only adds a verdict and drafts replies. Every action is one key and is written to the actions log.</p>
          <p>The tool never sends WhatsApp messages and never writes to Jira without your confirmation. Dismissed items return on new activity.</p>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="overlay"><div className="card">{children}</div></div>;
}

function Detail({ item, now, onCopy, drafting, chatToLlm }: { item: Item; now: number; onCopy: (t: string) => void; drafting: boolean; chatToLlm: boolean }) {
  const isChat = item.sources.includes("whatsapp");
  return (
    <div>
      <h1>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> : item.title}</h1>
      <div className="flags">
        {item.verdict && <span className={`flag verdict ${item.verdict}`}>{VERDICT_LABEL[item.verdict]}</span>}
        {sortFlags(item.flags).map((f) => <span key={f} className={`flag ${f}`}>{FLAG_LABEL[f]}</span>)}
        {item.ticketKey && <span className="flag link">linked: {item.ticketKey}</span>}
      </div>
      {item.reason && <p className="reason">{item.reason}</p>}

      {isChat && (
        <div className="draft">
          {item.draft ? (
            <>
              <div className="draft-head"><b>Draft reply</b><small>copy only, never sent</small><button onClick={() => onCopy(item.draft!)}>Copy <kbd>y</kbd></button></div>
              <div className="body">{item.draft}</div>
            </>
          ) : (
            <div className="dim">{drafting ? "Drafting…" : chatToLlm ? <>Press <kbd>c</kbd> to draft a reply from this chat and the linked ticket.</> : <>Drafting is off: chat text is not allowed to go to the LLM yet (<code>ALLOW_CHAT_TO_LLM=1</code>).</>}</div>
          )}
        </div>
      )}

      <ol className="timeline">
        {item.events.map((e, i) => (
          <li key={i} className={e.mentionsMe ? "mention" : ""}>
            <div className="who">
              <span className={`src ${e.source}`}>{SOURCE_LABEL[e.source]}</span>
              <b>{e.authorIsMe ? "You" : e.author}</b>
              <small>{ago(e.ts, now)}</small>
            </div>
            <div className="body">{e.body}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
