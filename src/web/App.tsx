import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTIONS, type ActionId, type Keymap } from "../shared/keys";
import type { SourceStatus } from "../server/types";
import { Board, type BoardCard, type BoardData } from "./Board";
import { Chat, type Item, type LlmMode } from "./Chat";
import { SOURCE_LABEL, VERDICT_LABEL, ago, buildGroups } from "./format";
import { Glyph, KIND_LABEL, Lamp, ObjectRow, Verbs, kindOf, related, urlsOf, verbsFor, why, type Ops } from "./objects";
import { Settings } from "./Settings";
import { Drawer, Modal, TipProvider } from "./ui";

interface InboxResponse {
  now: number; items: Item[]; hiddenCount: number; statuses: SourceStatus[];
  configured: { jira: boolean; github: boolean; reminders: boolean; whatsapp: boolean };
  transitions: string[];
  ui: { refreshSeconds: number; grouping: "auto" | "verdict" | "lane"; snoozeHours: number; remindHours: number; summaryPresets: number[]; summaryDefault: number; keys: Keymap; theme: "system" | "dark" | "light" };
  demo: boolean;
}
type View = "inbox" | "board" | "settings";
type Modal = { kind: "transition"; item: Item; picked: string | null } | { kind: "comment"; item: Item; text: string } | { kind: "help" } | null;

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
  const [leaving, setLeaving] = useState<Record<string, "out" | "done">>({});
  const [landed, setLanded] = useState<{ id: number; col: string } | null>(null);
  const [glide, setGlide] = useState<{ y: number; h: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  /** One way to act on any object, whether it is selected in the inbox, open in the drawer or a relationship. */
  const actOn = async (item: Item | undefined, action: string, body: object = {}, okText?: string, undoable = false) => {
    if (!item) return;
    const key = item.itemKey;
    const nextKey = flat[idx + 1]?.itemKey ?? flat[idx - 1]?.itemKey ?? null;
    const exits = ["dismiss", "snooze", "complete"].includes(action) && view === "inbox";
    if (exits) { setLeaving((l) => ({ ...l, [key]: action === "complete" ? "done" : "out" })); await new Promise((r) => setTimeout(r, action === "complete" ? 520 : 230)); }
    setBusy(action);
    const r = await post(key, action, body);
    setBusy(null);
    if (exits) setLeaving((l) => { const n = { ...l }; delete n[key]; return n; });
    if (!r.ok) { say(r.error ?? "Failed", { error: true }); return r; }
    if (okText) say(okText, undoable ? { undo: async () => { await post(key, "restore"); await load(); } } : {});
    if (["dismiss", "snooze"].includes(action) && key === current?.itemKey) setSelKey(nextKey);
    await load();
    if (action === "board") await loadBoard();
    return r;
  };
  const act = (action: string, body: object = {}, okText?: string, undoable = false) => actOn(current, action, body, okText, undoable);

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

  const opsFor = (item: Item): Ops => ({
    open: (url) => window.open(url, "_blank", "noopener"),
    board: () => void actOn(item, "board", {}, "Added to the board."),
    snooze: () => void actOn(item, "snooze", {}, `Snoozed for ${data?.ui.snoozeHours ?? 4} hour(s).`, true),
    dismiss: () => void actOn(item, "dismiss", {}, "Dismissed. New activity brings it back.", true),
    transition: () => (item.ticketKey ? setModal({ kind: "transition", item, picked: null }) : say("No linked Jira ticket.", { error: true })),
    comment: () => (item.ticketKey ? setModal({ kind: "comment", item, text: "" }) : say("No linked Jira ticket.", { error: true })),
    complete: () => void actOn(item, "complete", {}, "Reminder completed."),
    remind: () => void actOn(item, "remind", {}, `Reminder created (due in ${data?.ui.remindHours ?? 2}h).`),
  });

  // ---- board ----
  const cols = board ? board.columns.map((c) => board.cards.filter((x) => x.col === c)) : [];
  const cardPos = (id: number | null): [number, number] | null => {
    for (let c = 0; c < cols.length; c++) { const i = cols[c]!.findIndex((x) => x.id === id); if (i >= 0) return [c, i]; }
    return null;
  };
  const moveCardTo = async (id: number, col: string, index?: number) => {
    const r = await (await fetch(`/api/board/cards/${id}`, json("PATCH", { col, index }))).json();
    if (!r.ok) say(r.error ?? "Could not move the card", { error: true });
    else { setLanded({ id, col }); window.setTimeout(() => setLanded(null), 700); }
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
  const goTo = (key: string) => { setDrawer(null); setView("inbox"); setSelKey(key); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view === "settings") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.metaKey && e.key === "Enter" && modal?.kind === "comment" && modal.text.trim()) {
        e.preventDefault();
        const m = modal;
        actOn(m.item, "comment", { text: m.text, confirm: true }, "Comment posted to Jira.").then(() => setModal(null));
        return;
      }
      if (tag === "INPUT" || tag === "TEXTAREA") { if (e.key === "Escape") { setModal(null); setAdding(null); } return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (modal?.kind === "transition") {
        if (e.key === "Escape") return setModal(null);
        const n = Number(e.key);
        if (n >= 1 && n <= (data?.transitions.length ?? 0)) return setModal({ ...modal, picked: data!.transitions[n - 1]! });
        if (e.key === "Enter" && modal.picked) { const m = modal; actOn(m.item, "transition", { status: m.picked, confirm: true }, `Moved ${m.item.ticketKey} to ${m.picked}.`).then(() => setModal(null)); }
        return;
      }
      if (modal) { if (e.key === "Escape") setModal(null); return; }
      if (drawer !== null && e.key === "Escape") return setDrawer(null);

      const keys = data?.ui.keys;
      if (!keys) return;
      const action: ActionId | undefined = (Object.keys(keys) as ActionId[]).find((a) => keys[a] === e.key);
      const a = e.key === "ArrowDown" ? "down" : e.key === "ArrowUp" ? "up" : e.key === "Enter" ? "open" : action;

      if (a === "viewInbox") return setView("inbox");
      if (a === "viewBoard") return setView("board");
      if (a === "settings") return setView("settings");
      if (a === "help") return setModal({ kind: "help" });
      if (a === "undo") { if (toast?.undo) { toast.undo(); setToast(null); } return; }
      if (a === "refresh") { fetch("/api/poll", json("POST")).then(() => { load(); loadBoard(); }); say("Refreshing…"); return; }

      if (view === "board") {
        const [ci, i] = cardPos(selCard?.id ?? null) ?? [0, 0];
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

      const ops = current ? opsFor(current) : null;
      switch (a) {
        case "down": e.preventDefault(); move(1); break;
        case "up": e.preventDefault(); move(-1); break;
        case "dismiss": ops?.dismiss(); break;
        case "snooze": ops?.snooze(); break;
        case "accept": act("accept", {}, "Accepted."); break;
        case "open": if (current?.url) ops?.open(current.url); break;
        case "judge": say("Judging…"); fetch("/api/judge", json("POST")).then((r) => r.json()).then((r) => { say(r.ok ? `Judged ${r.judged} item(s).` : r.error, { error: !r.ok }); load(); }); break;
        case "group": setGrouping(mode === "verdict" ? "lane" : "verdict"); break;
        case "remind": ops?.remind(); break;
        case "complete": ops?.complete(); break;
        case "summarize": summarize(); break;
        case "mode": if (current?.llmMode) setMode(({ manual: "auto", auto: "never", never: "manual" } as const)[current.llmMode]); break;
        case "draft": if (current) { say("Drafting…"); act("draft", {}).then((r) => r?.draft && say("Draft ready.")); } break;
        case "copy": if (current?.draft) copy(current.draft); break;
        case "addToBoard": ops?.board(); break;
        case "transition": e.preventDefault(); ops?.transition(); break;
        case "comment": e.preventDefault(); ops?.comment(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => { document.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" }); }, [selKey, data]);
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".row.selected");
    setGlide(el ? { y: el.offsetTop + 13, h: Math.max(8, el.offsetHeight - 26) } : null);
  }, [selKey, data, view, leaving]);

  if (!data) return <div className="loading">Loading…</div>;
  const keys = data.ui.keys;
  const down = data.statuses.filter((s) => !s.ok || s.banner);
  const drawerCard = board?.cards.find((c) => c.id === drawer);
  const today = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  const relatedNode = (item: Item) => {
    const rel = related(item, data.items);
    const card = board?.cards.find((c) => c.itemKey === item.itemKey);
    if (!rel.length && !card) return null;
    if (item.itemKey.startsWith("chat:")) {
      // a conversation keeps its related objects to one quiet line so the chat gets the room
      return (
        <div className="relline rel">
          {rel.map((o) => <button key={o.itemKey} data-key={o.itemKey} onClick={() => goTo(o.itemKey)}><Glyph kind={kindOf(o.itemKey)} size={13} />{o.itemKey.startsWith("ticket:") ? o.itemKey.slice(7) : o.title}</button>)}
          {card && <span>On the board · {card.col}</span>}
        </div>
      );
    }
    return (
      <section className="section rel">
        <h4>Related</h4>
        {rel.map((o) => <ObjectRow key={o.itemKey} item={o} now={data.now} detail="why" onClick={() => goTo(o.itemKey)} />)}
        {card && <div className="why" style={{ padding: "6px 0 0" }}>On the board · <b style={{ fontWeight: 560 }}>{card.col}</b></div>}
      </section>
    );
  };

  return (
    <TipProvider>
    <div className="shell">
      <aside className="rail">
        <div className="brand"><i />Work Inbox{data.demo && <small>demo</small>}</div>
        <button className={`nav ${view === "inbox" ? "on" : ""}`} onClick={() => setView("inbox")}>Inbox <span className="n">{flat.length}</span></button>
        <button className={`nav ${view === "board" ? "on" : ""}`} onClick={() => setView("board")}>Board <span className="n">{board?.cards.length ?? 0}</span></button>
        <button className={`nav ${view === "settings" ? "on" : ""}`} onClick={() => setView("settings")}>Settings</button>
        <div className="spacer" />
        <button className={`health ${down.length ? "bad" : ""}`} onClick={() => setView("settings")} title={data.statuses.map((s) => `${SOURCE_LABEL[s.source]}: ${s.ok && !s.banner ? "ok" : s.banner ?? s.error}`).join("\n")}>
          <i />{down.length ? `${down.map((s) => SOURCE_LABEL[s.source]).join(", ")} down` : "all sources live"}
        </button>
        <div className="hint"><kbd>{keys.help}</kbd> keys</div>
      </aside>

      <div className="main">
        {view !== "settings" && (
          <div className="topbar">
            <h1>{view === "inbox" ? "Inbox" : "Board"}</h1>
            <span className="sub">{today}{view === "inbox" && data.hiddenCount ? ` · ${data.hiddenCount} hidden` : ""}</span>
            {view === "board" && <div className="actions"><button className="pill primary" onClick={() => setAdding(board?.columns[0] ?? null)}>New card</button></div>}
          </div>
        )}
        {view !== "settings" && down.map((s) => (
          <div key={s.source} className="banner"><b>{SOURCE_LABEL[s.source]}:</b> {s.banner ?? s.error ?? "problem"}{!s.banner && " Items from this source may be missing, not absent."}</div>
        ))}

        {view === "settings" && <Settings onClose={() => { setView("inbox"); load(); loadBoard(); }} onChanged={() => { load(); loadBoard(); }} />}

        {view === "inbox" && (
          <div className="split">
            <div className="list" data-testid="list" ref={listRef}>
              {glide && <span className="glide" style={{ transform: `translateY(${glide.y}px)`, height: glide.h }} />}
              {flat.length === 0 && <div className="empty">Nothing needs you right now.</div>}
              {groups.map((g) => {
                let n = 0;
                return (
                  <section key={g.id} className="group">
                    <h2>{g.title} <em>{g.items.length}</em></h2>
                    {g.items.map((it) => <ObjectRow key={it.itemKey} item={it} now={data.now} index={n++} selected={it.itemKey === current?.itemKey} detail={mode === "verdict" ? "reason" : "why"} leaving={leaving[it.itemKey]} onClick={() => setSelKey(it.itemKey)} />)}
                  </section>
                );
              })}
            </div>
            <aside className={`detail ${current?.itemKey.startsWith("chat:") ? "chatmode" : ""}`}>
              {!current ? <div className="empty">Select an item</div> : current.itemKey.startsWith("chat:") ? (
                <Chat item={current} now={data.now} busy={busy} defaultN={defaultN} n={sumN ?? defaultN} presets={data.ui.summaryPresets} keys={keys}
                  verbs={[
                    { id: "draft", label: "Draft reply", key: keys.draft, onClick: () => { say("Drafting…"); act("draft", {}).then((r) => r?.draft && say("Draft ready.")); } },
                    ...verbsFor(current, opsFor(current), keys, urlsOf(current)).filter((v) => ["board", "snooze", "dismiss"].includes(v.id)),
                  ]}
                  relatedNode={relatedNode(current)} onCopy={copy} setN={setSumN} onSummarize={summarize} onDefault={setDefaultN} onMode={setMode} />
              ) : (
                <ObjectView item={current} now={data.now} keys={keys} ops={opsFor(current)} relatedNode={relatedNode(current)} />
              )}
            </aside>
          </div>
        )}

        {view === "board" && board && (
          <Board board={board} now={data.now} sel={selCard?.id ?? null} onSelect={setCardSel} onOpen={setDrawer} onMove={moveCardTo} onAdd={addCardTo} adding={adding} setAdding={setAdding} landed={landed} />
        )}
      </div>

      <Drawer open={!!drawerCard} onClose={() => setDrawer(null)} title={drawerCard?.title ?? "Card"}>
        {drawerCard && (
          <CardDrawer card={drawerCard} item={data.items.find((i) => i.itemKey === drawerCard.itemKey)} now={data.now} keys={keys} ops={(i) => opsFor(i)} relatedNode={relatedNode}
            onSave={async (patch) => { await fetch(`/api/board/cards/${drawerCard.id}`, json("PATCH", patch)); await loadBoard(); }}
            onDelete={async () => { await fetch(`/api/board/cards/${drawerCard.id}`, json("DELETE")); setDrawer(null); await loadBoard(); say("Card removed."); }} />
        )}
      </Drawer>

      {toast && <div key={toast.text} className={`toast ${toast.error ? "err" : ""}`} role="status">{toast.text}{toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}</div>}

      <Modal open={modal?.kind === "transition"} onClose={() => setModal(null)} title={modal?.kind === "transition" ? `Move ${modal.item.ticketKey}` : ""}>
        {modal?.kind === "transition" && (
          <>
            <ol className="choices">{data.transitions.map((t, i) => <li key={t} className={modal.picked === t ? "picked" : ""}><kbd>{i + 1}</kbd> {t}</li>)}</ol>
            <p className="dim">{modal.picked ? <>Press <kbd>Enter</kbd> to confirm moving to <b>{modal.picked}</b>, or <kbd>Esc</kbd> to cancel.</> : "Pick a status. Nothing is written to Jira until you confirm."}</p>
          </>
        )}
      </Modal>
      <Modal open={modal?.kind === "comment"} onClose={() => setModal(null)} title={modal?.kind === "comment" ? `Comment on ${modal.item.ticketKey}` : ""}>
        {modal?.kind === "comment" && (
          <>
            <textarea autoFocus value={modal.text} onChange={(e) => setModal({ ...modal, text: e.target.value })} placeholder="Write a comment…" />
            <p className="dim"><kbd>⌘</kbd> <kbd>Enter</kbd> posts to Jira · <kbd>Esc</kbd> cancels</p>
          </>
        )}
      </Modal>
      <Modal open={modal?.kind === "help"} onClose={() => setModal(null)} title="Keys" wide>
        <div className="keygrid">{(Object.keys(ACTIONS) as ActionId[]).map((a) => <div key={a} className="keyrow"><span>{ACTIONS[a].label}</span><kbd>{keys[a]}</kbd></div>)}</div>
        <p className="dim">Code fetches and flags; Claude only judges and drafts. Nothing is ever sent to WhatsApp, and Jira is only written to after you confirm. Rebind keys in Settings.</p>
      </Modal>
    </div>
    </TipProvider>
  );
}

function Thread({ events, now }: { events: Item["events"]; now: number }) {
  return (
    <ol className="thread">
      {events.map((e, i) => (
        <li key={i} className={e.mentionsMe ? "mention" : ""}>
          <div className="who"><b>{e.authorIsMe ? "You" : e.author}</b><span className="dim mono" style={{ fontSize: 11 }}>{SOURCE_LABEL[e.source]}</span><small>{ago(e.ts, now)}</small></div>
          <div className="body">{e.body}</div>
        </li>
      ))}
    </ol>
  );
}

/** The one full representation of a Ticket / PR / Reminder. Used by the inbox detail and the board drawer. */
function ObjectView({ item, now, keys, ops, relatedNode }: { item: Item; now: number; keys: Keymap; ops: Ops; relatedNode: React.ReactNode }) {
  const kind = kindOf(item.itemKey);
  const w = why(item);
  return (
    <div className="ov">
      <div className="kicker"><Glyph kind={kind} size={14} />{KIND_LABEL[kind]}{item.ticketKey && kind === "ticket" ? ` · ${item.ticketKey}` : ""}{item.verdict ? ` · ${VERDICT_LABEL[item.verdict].toLowerCase()}` : ""}</div>
      <h3 className="title">{item.title}</h3>
      {w && <p className="whyline"><Lamp tone={w.tone} />{w.text}{item.flags.length > 1 ? ` + ${item.flags.length - 1} more` : ""}</p>}
      {item.reason && <p className="reason">{item.reason}</p>}
      <Verbs verbs={verbsFor(item, ops, keys, urlsOf(item))} />
      {relatedNode}
      {item.events.length > 0 && <section className="section"><h4>Activity</h4><Thread events={item.events} now={now} /></section>}
    </div>
  );
}

function CardDrawer({ card, item, now, keys, ops, relatedNode, onSave, onDelete }: { card: BoardCard; item?: Item; now: number; keys: Keymap; ops: (i: Item) => Ops; relatedNode: (i: Item) => React.ReactNode; onSave: (p: object) => Promise<void>; onDelete: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  useEffect(() => { setTitle(card.title); setNotes(card.notes); }, [card.id]);
  return (
    <div className="ov" style={{ marginTop: 24 }}>
      {item ? <ObjectView item={item} now={now} keys={keys} ops={ops(item)} relatedNode={relatedNode(item)} /> : (
        <>
          <div className="kicker"><Glyph kind="note" size={14} />Note</div>
          <input className="tt" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== card.title && onSave({ title })} />
        </>
      )}
      <section className="section">
        <h4>On the board · {card.col}</h4>
        <textarea rows={4} value={notes} placeholder="Notes…" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== card.notes && onSave({ notes })} />
        <div className="verbs" style={{ marginTop: 10 }}>
          {card.pinned && <button className="verb" onClick={() => onSave({ pinned: false })}>◆ Placed by hand · let automation place it</button>}
          <button className="verb" onClick={onDelete}>Remove from board</button>
        </div>
      </section>
    </div>
  );
}
