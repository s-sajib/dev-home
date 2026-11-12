import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIONS, type ActionId, type Keymap } from "../shared/keys";
import type { SourceStatus } from "../server/types";
import { Board, type BoardCard, type BoardData } from "./Board";
import { Chat, type Item, type LlmMode } from "./Chat";
import { FLAG_LABEL, SOURCE_LABEL, VERDICT_LABEL, ago, buildGroups, flagTone, sortFlags, verdictTone } from "./format";
import { Settings } from "./Settings";

interface InboxResponse {
  now: number; items: Item[]; hiddenCount: number; statuses: SourceStatus[];
  configured: { jira: boolean; github: boolean; reminders: boolean; whatsapp: boolean };
  transitions: string[];
  ui: { refreshSeconds: number; grouping: "auto" | "verdict" | "lane"; snoozeHours: number; remindHours: number; summaryPresets: number[]; summaryDefault: number; keys: Keymap; theme: "system" | "dark" | "light" };
  demo: boolean;
}
type View = "inbox" | "board" | "settings";
type Modal = { kind: "transition"; picked: string | null } | { kind: "comment"; text: string } | { kind: "help" } | null;

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export function App() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [view, setView] = useState<View>("inbox");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [cardSel, setCardSel] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<number | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; error?: boolean } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [grouping, setGrouping] = useState<"auto" | "verdict" | "lane" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sumN, setSumN] = useState<number | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => setData(await (await fetch("/api/inbox")).json()), []);
  const loadBoard = useCallback(async () => setBoard(await (await fetch("/api/board")).json()), []);
  const refreshMs = (data?.ui.refreshSeconds ?? 30) * 1000;
  useEffect(() => {
    load(); loadBoard();
    const t = setInterval(() => { load(); loadBoard(); }, refreshMs);
    return () => clearInterval(t);
  }, [load, loadBoard, refreshMs]);

  useEffect(() => {
    const t = data?.ui.theme;
    if (!t || t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }, [data?.ui.theme]);

  const wanted = grouping ?? data?.ui.grouping ?? "auto";
  const mode = wanted === "auto" ? (data?.items.some((i) => i.verdict) ? "verdict" : "lane") : wanted;
  const groups = useMemo(() => (data ? buildGroups(data.items, mode) : []), [data, mode]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const idx = Math.max(0, flat.findIndex((i) => i.itemKey === selKey));
  const current: Item | undefined = flat[idx];

  // deep link from a nag notification: /?item=reminder:abc
  useEffect(() => {
    const want = new URLSearchParams(location.search).get("item");
    if (want && flat.some((i) => i.itemKey === want)) setSelKey(want);
  }, [flat.length]);

  const say = (text: string, opts: { undo?: () => void; error?: boolean } = {}) => {
    setToast({ text, ...opts });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), opts.error ? 9000 : 6000);
  };
  const post = async (key: string, action: string, body: object = {}) =>
    (await (await fetch(`/api/items/${encodeURIComponent(key)}/${action}`, json("POST", body))).json()) as { ok: boolean; error?: string; [k: string]: any };
  const move = (delta: number) => setSelKey(flat[Math.max(0, Math.min(flat.length - 1, idx + delta))]?.itemKey ?? null);

  const act = async (action: string, body: object = {}, okText?: string, undoable = false) => {
    if (!current) return;
    const key = current.itemKey;
    const nextKey = flat[idx + 1]?.itemKey ?? flat[idx - 1]?.itemKey ?? null;
    setBusy(action);
    const r = await post(key, action, body);
    setBusy(null);
    if (!r.ok) { say(r.error ?? "Failed", { error: true }); return r; }
    if (okText) say(okText, undoable ? { undo: async () => { await post(key, "restore"); await load(); } } : {});
    if (["dismiss", "snooze"].includes(action)) setSelKey(nextKey);
    await load();
    if (action === "board") await loadBoard();
    return r;
  };

  const defaultN = data?.ui.summaryDefault ?? 20;
  const summarize = async (n = sumN ?? defaultN) => {
    if (!current?.itemKey.startsWith("chat:")) return say("Summaries are for WhatsApp chats.", { error: true });
    say(`Summarising the last ${n} messages…`);
    const r = await act("summarize", { n });
    if (r?.summary) say(`Summary ready (last ${r.summary.n} messages).`);
  };
  const setDefaultN = async (n: number) => {
    await fetch("/api/settings", json("POST", { changes: { summaryDefault: n } }));
    say(`Default is now ${n} messages.`);
    await load();
  };
  const setMode = async (m: LlmMode) => {
    if (!current) return;
    await post(current.itemKey, "llm-mode", { mode: m });
    say(m === "auto" ? "Auto: new activity in this chat is summarised and drafted for you (never sent)." : m === "never" ? "Never: this chat's text will not be sent to Claude." : "Manual: Claude only sees this chat when you press a key.");
    await load();
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); say("Draft copied. Paste it into WhatsApp yourself; this tool never sends."); } catch { say("Copy failed", { error: true }); }
  };

  // ---- board ----
  const cols = board ? board.columns.map((c) => board.cards.filter((x) => x.col === c)) : [];
  const cardPos = (id: number | null): [number, number] | null => {
    for (let c = 0; c < cols.length; c++) { const i = cols[c]!.findIndex((x) => x.id === id); if (i >= 0) return [c, i]; }
    return null;
  };
  const moveCardTo = async (id: number, col: string, index?: number) => {
    const r = await (await fetch(`/api/board/cards/${id}`, json("PATCH", { col, index }))).json();
    if (!r.ok) say(r.error ?? "Could not move the card", { error: true });
    await loadBoard();
  };
  const addCardTo = async (col: string, title: string) => {
    const r = await (await fetch("/api/board/cards", json("POST", { title, col }))).json();
    if (!r.ok) return say(r.error ?? "Could not add the card", { error: true });
    say(`Added to ${col}.`);
    await loadBoard();
    setCardSel(r.id);
  };
  const selCard: BoardCard | undefined = board?.cards.find((c) => c.id === cardSel) ?? (cols.flat()[0] as BoardCard | undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view === "settings") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.metaKey && e.key === "Enter" && modal?.kind === "comment" && modal.text.trim() && current) {
        e.preventDefault();
        act("comment", { text: modal.text, confirm: true }, "Comment posted to Jira.").then(() => setModal(null));
        return;
      }
      if (tag === "INPUT" || tag === "TEXTAREA") { if (e.key === "Escape") { setModal(null); setAdding(null); } return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (modal?.kind === "transition") {
        if (e.key === "Escape") return setModal(null);
        const n = Number(e.key);
        if (n >= 1 && n <= (data?.transitions.length ?? 0)) return setModal({ kind: "transition", picked: data!.transitions[n - 1]! });
        if (e.key === "Enter" && modal.picked && current) act("transition", { status: modal.picked, confirm: true }, `Moved ${current.ticketKey} to ${modal.picked}.`).then(() => setModal(null));
        return;
      }
      if (modal) { if (e.key === "Escape") setModal(null); return; }
      if (drawer !== null && e.key === "Escape") return setDrawer(null);

      const keys = data?.ui.keys;
      if (!keys) return;
      const action: ActionId | undefined = (Object.keys(keys) as ActionId[]).find((a) => keys[a] === e.key);
      const a = e.key === "ArrowDown" ? "down" : e.key === "ArrowUp" ? "up" : e.key === "Enter" ? "open" : action;

      // global
      if (a === "viewInbox") return setView("inbox");
      if (a === "viewBoard") return setView("board");
      if (a === "settings") return setView("settings");
      if (a === "help") return setModal({ kind: "help" });
      if (a === "undo") { if (toast?.undo) { toast.undo(); setToast(null); } return; }
      if (a === "refresh") { fetch("/api/poll", json("POST")).then(() => { load(); loadBoard(); }); say("Refreshing…"); return; }

      if (view === "board") {
        const p = cardPos(selCard?.id ?? null) ?? [0, 0];
        const [ci, i] = p;
        const pick = (c: number, row: number) => { const col = cols[c]; if (col?.length) setCardSel(col[Math.max(0, Math.min(row, col.length - 1))]!.id); };
        switch (a) {
          case "down": e.preventDefault(); pick(ci, i + 1); break;
          case "up": e.preventDefault(); pick(ci, i - 1); break;
          case "colLeft": for (let c = ci - 1; c >= 0; c--) if (cols[c]!.length) { pick(c, i); break; } break;
          case "colRight": for (let c = ci + 1; c < cols.length; c++) if (cols[c]!.length) { pick(c, i); break; } break;
          case "moveLeft": if (selCard && ci > 0) moveCardTo(selCard.id, board!.columns[ci - 1]!); break;
          case "moveRight": if (selCard && ci < cols.length - 1) moveCardTo(selCard.id, board!.columns[ci + 1]!); break;
          case "newCard": e.preventDefault(); setAdding(board!.columns[ci] ?? board!.columns[0]!); break;
          case "open": if (selCard) setDrawer(selCard.id); break;
        }
        return;
      }

      switch (a) {
        case "down": e.preventDefault(); move(1); break;
        case "up": e.preventDefault(); move(-1); break;
        case "dismiss": act("dismiss", {}, "Dismissed. New activity brings it back.", true); break;
        case "snooze": act("snooze", {}, `Snoozed for ${data!.ui.snoozeHours} hour(s).`, true); break;
        case "accept": act("accept", {}, "Accepted."); break;
        case "open": if (current?.url) window.open(current.url, "_blank", "noopener"); break;
        case "judge": say("Judging…"); fetch("/api/judge", json("POST")).then((r) => r.json()).then((r) => { say(r.ok ? `Judged ${r.judged} item(s).` : r.error, { error: !r.ok }); load(); }); break;
        case "group": setGrouping(mode === "verdict" ? "lane" : "verdict"); break;
        case "remind": act("remind", {}, `Reminder created in Work Inbox (due in ${data!.ui.remindHours}h).`); break;
        case "complete": act("complete", {}, "Reminder completed."); break;
        case "summarize": summarize(); break;
        case "mode": if (current?.llmMode) setMode(({ manual: "auto", auto: "never", never: "manual" } as const)[current.llmMode]); break;
        case "draft": if (current) { say("Drafting…"); act("draft", {}).then((r) => r?.draft && say("Draft ready.")); } break;
        case "copy": if (current?.draft) copy(current.draft); break;
        case "addToBoard": act("board", {}, "Added to the board.").then(() => undefined); break;
        case "transition": if (current?.ticketKey) setModal({ kind: "transition", picked: null }); else say("No linked Jira ticket.", { error: true }); break;
        case "comment": if (current?.ticketKey) { e.preventDefault(); setModal({ kind: "comment", text: "" }); } else say("No linked Jira ticket.", { error: true }); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => { document.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" }); }, [selKey, data]);

  if (!data) return <div className="loading">Loading…</div>;
  const banners = data.statuses.filter((s) => !s.ok || s.banner);
  const keys = data.ui.keys;
  const drawerCard = board?.cards.find((c) => c.id === drawer);
  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand"><i />Work Inbox{data.demo && <small>demo</small>}</div>
        <button className={`nav ${view === "inbox" ? "on" : ""}`} onClick={() => setView("inbox")}>Inbox <kbd>{keys.viewInbox}</kbd><span className="n">{flat.length}</span></button>
        <button className={`nav ${view === "board" ? "on" : ""}`} onClick={() => setView("board")}>Board <kbd>{keys.viewBoard}</kbd><span className="n">{board?.cards.length ?? 0}</span></button>
        <button className={`nav ${view === "settings" ? "on" : ""}`} onClick={() => setView("settings")}>Settings <kbd>{keys.settings}</kbd></button>
        <h4>Sources</h4>
        {(["jira", "github", "whatsapp", "reminders"] as const).map((src) => {
          const st = data.statuses.find((s) => s.source === src);
          const cls = !st ? "off" : st.ok && !st.banner ? "ok" : "bad";
          return <div key={src} className={`src ${cls}`} title={st?.error ?? st?.banner ?? ""}><i className="dot" />{SOURCE_LABEL[src]}<small>{st?.lastPollAt ? ago(st.lastPollAt, data.now) : "off"}</small></div>;
        })}
        <div className="spacer" />
        <div className="hints">
          <kbd>{keys.down}</kbd> <kbd>{keys.up}</kbd> move · <kbd>{keys.open}</kbd> open<br />
          {view === "board" ? <><kbd>{keys.moveLeft}</kbd> <kbd>{keys.moveRight}</kbd> move card · <kbd>{keys.newCard}</kbd> new</> : <><kbd>{keys.dismiss}</kbd> dismiss · <kbd>{keys.addToBoard}</kbd> to board</>}<br />
          <kbd>{keys.help}</kbd> help
        </div>
      </aside>

      <div className="main">
        {view !== "settings" && (
          <div className="topbar">
            <h1>{view === "inbox" ? "Inbox" : "Board"}</h1>
            <span className="sub">{today}{view === "inbox" ? ` · ${flat.length} need you${data.hiddenCount ? ` · ${data.hiddenCount} hidden` : ""}` : ` · ${board?.cards.length ?? 0} cards`}</span>
            <div className="actions">
              {view === "inbox" && <button className="pill" onClick={() => setGrouping(mode === "verdict" ? "lane" : "verdict")}>Group by {mode === "verdict" ? "rule" : "verdict"} <kbd>{keys.group}</kbd></button>}
              {view === "board" && <button className="pill primary" onClick={() => setAdding(board?.columns[0] ?? null)}>New card <kbd>{keys.newCard}</kbd></button>}
            </div>
          </div>
        )}
        {view !== "settings" && banners.map((s) => (
          <div key={s.source} className="banner"><b>{SOURCE_LABEL[s.source]}:</b> {s.banner ?? s.error ?? "problem"}{!s.banner && " Items from this source may be missing, not absent."}</div>
        ))}

        {view === "settings" && <Settings onClose={() => { setView("inbox"); load(); loadBoard(); }} onChanged={() => { load(); loadBoard(); }} />}

        {view === "inbox" && (
          <div className="split">
            <div className="list" data-testid="list">
              {flat.length === 0 && <div className="empty">Nothing needs you right now.</div>}
              {groups.map((g) => (
                <section key={g.id} className="group">
                  <h2>{g.title} <em>{g.items.length}</em><small>{g.hint}</small></h2>
                  {g.items.map((it) => {
                    const top = sortFlags(it.flags)[0];
                    return (
                      <button key={it.itemKey} className={`row ${it.itemKey === current?.itemKey ? "selected" : ""}`} data-key={it.itemKey} onClick={() => setSelKey(it.itemKey)}>
                        <div className="t">{it.title}</div>
                        {it.reason && mode === "verdict" && <div className="why">{it.reason}</div>}
                        <div className="m">
                          {it.sources.map((s) => <span key={s} className={`chip src-${s}`}>{SOURCE_LABEL[s]}</span>)}
                          {it.llmMode === "auto" && <span className="chip good">auto</span>}
                          {it.llmMode === "never" && <span className="chip bad">no AI</span>}
                          {it.summary?.sensitive && <span className="chip bad">sensitive?</span>}
                          {it.verdict && mode === "lane" && <span className={`chip ${verdictTone(it.verdict)}`}>{VERDICT_LABEL[it.verdict]}</span>}
                          {top && <span className={`chip ${flagTone(top)}`}>{FLAG_LABEL[top]}</span>}
                          <span className="when">{ago(it.lastActivity, data.now)}</span>
                        </div>
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
            <aside className="detail">
              {!current ? <div className="empty">Select an item</div> : current.itemKey.startsWith("chat:") ? (
                <Chat item={current} now={data.now} busy={busy} defaultN={defaultN} n={sumN ?? defaultN} presets={data.ui.summaryPresets} keys={keys}
                  onCopy={copy} setN={setSumN} onSummarize={summarize} onDefault={setDefaultN} onMode={setMode} onBoard={() => act("board", {}, "Added to the board.")} />
              ) : (
                <ItemDetail item={current} now={data.now} onBoard={() => act("board", {}, "Added to the board.")} />
              )}
            </aside>
          </div>
        )}

        {view === "board" && board && (
          <Board board={board} now={data.now} sel={selCard?.id ?? null} onSelect={setCardSel} onOpen={setDrawer} onMove={moveCardTo} onAdd={addCardTo} adding={adding} setAdding={setAdding} />
        )}
      </div>

      {drawerCard && (
        <aside className="drawer" data-testid="drawer">
          <button className="pill x" onClick={() => setDrawer(null)}>Close <kbd>Esc</kbd></button>
          <CardDrawer card={drawerCard} item={data.items.find((i) => i.itemKey === drawerCard.itemKey)} now={data.now}
            onSave={async (patch) => { await fetch(`/api/board/cards/${drawerCard.id}`, json("PATCH", patch)); await loadBoard(); }}
            onDelete={async () => { await fetch(`/api/board/cards/${drawerCard.id}`, json("DELETE")); setDrawer(null); await loadBoard(); say("Card removed."); }} />
        </aside>
      )}

      {toast && <div className={`toast ${toast.error ? "err" : ""}`} role="status">{toast.text}{toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}</div>}

      {modal?.kind === "transition" && current && (
        <div className="overlay"><div className="sheet">
          <h3>Move {current.ticketKey}</h3>
          <ol className="choices">{data.transitions.map((t, i) => <li key={t} className={modal.picked === t ? "picked" : ""}><kbd>{i + 1}</kbd> {t}</li>)}</ol>
          <p className="dim">{modal.picked ? <>Press <kbd>Enter</kbd> to confirm moving to <b>{modal.picked}</b>, or <kbd>Esc</kbd> to cancel.</> : "Pick a status. Nothing is written to Jira until you confirm."}</p>
        </div></div>
      )}
      {modal?.kind === "comment" && current && (
        <div className="overlay"><div className="sheet">
          <h3>Comment on {current.ticketKey}</h3>
          <textarea autoFocus value={modal.text} onChange={(e) => setModal({ kind: "comment", text: e.target.value })} placeholder="Write a comment…" />
          <p className="dim"><kbd>⌘</kbd> <kbd>Enter</kbd> posts to Jira · <kbd>Esc</kbd> cancels</p>
        </div></div>
      )}
      {modal?.kind === "help" && (
        <div className="overlay" onClick={() => setModal(null)}><div className="sheet" style={{ maxWidth: 640 }}>
          <h3>Keys</h3>
          <div className="keygrid">{(Object.keys(ACTIONS) as ActionId[]).map((a) => <div key={a} className="keyrow"><span>{ACTIONS[a].label}</span><kbd>{keys[a]}</kbd></div>)}</div>
          <p className="dim">Code fetches and flags; Claude only judges and drafts. Nothing is ever sent to WhatsApp, and Jira is only written to after you confirm. Rebind keys in Settings.</p>
        </div></div>
      )}
    </div>
  );
}

function Thread({ events, now }: { events: Item["events"]; now: number }) {
  return (
    <ol className="thread">
      {events.map((e, i) => (
        <li key={i} className={e.mentionsMe ? "mention" : ""}>
          <div className="who"><span className={`chip src-${e.source}`}>{SOURCE_LABEL[e.source]}</span><b>{e.authorIsMe ? "You" : e.author}</b><small>{ago(e.ts, now)}</small></div>
          <div className="body">{e.body}</div>
        </li>
      ))}
    </ol>
  );
}

function ItemDetail({ item, now, onBoard }: { item: Item; now: number; onBoard: () => void }) {
  return (
    <div>
      <h3 className="title">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> : item.title}</h3>
      <div className="chips">
        {item.verdict && <span className={`chip ${verdictTone(item.verdict)}`}>{VERDICT_LABEL[item.verdict]}</span>}
        {sortFlags(item.flags).map((f) => <span key={f} className={`chip ${flagTone(f)}`}>{FLAG_LABEL[f]}</span>)}
        {item.ticketKey && <span className="chip accent">{item.ticketKey}</span>}
        <button className="pill" onClick={onBoard}>+ Board</button>
      </div>
      {item.reason && <p className="reason">{item.reason}</p>}
      <Thread events={item.events} now={now} />
    </div>
  );
}

function CardDrawer({ card, item, now, onSave, onDelete }: { card: BoardCard; item?: Item; now: number; onSave: (p: object) => Promise<void>; onDelete: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  useEffect(() => { setTitle(card.title); setNotes(card.notes); }, [card.id]);
  return (
    <div>
      <div className="chips" style={{ marginTop: 28 }}>
        <span className="chip accent">{card.col}</span>
        {card.ticketKey && <span className="chip">{card.ticketKey}</span>}
        {card.status && <span className="chip">{card.status}</span>}
        {card.pinned ? <button className="pill" onClick={() => onSave({ pinned: false })}>◆ Placed by hand · let automation place it</button> : <span className="chip">auto-placed</span>}
      </div>
      {card.itemKey ? <h3 className="title">{card.url ? <a href={card.url} target="_blank" rel="noopener noreferrer">{card.title}</a> : card.title}</h3>
        : <input className="tt" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== card.title && onSave({ title })} />}
      <label className="dim mono" style={{ fontSize: 11 }}>NOTES</label>
      <textarea rows={5} value={notes} placeholder="Notes…" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== card.notes && onSave({ notes })} />
      {item && <><h4 className="dim mono" style={{ fontSize: 11, margin: "22px 0 10px" }}>ACTIVITY</h4><Thread events={item.events} now={now} /></>}
      <p><button className="pill" onClick={onDelete}>Remove from board</button></p>
    </div>
  );
}
