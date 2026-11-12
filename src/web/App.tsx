import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxItem, SourceStatus } from "../server/types";
import { FLAG_LABEL, SOURCE_LABEL, ago, groupItems, sortFlags } from "./format";

interface InboxResponse {
  now: number;
  items: InboxItem[];
  hiddenCount: number;
  statuses: SourceStatus[];
  configured: { jira: boolean; github: boolean };
  demo: boolean;
}

export function App() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [sel, setSel] = useState(0);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [help, setHelp] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const res = await fetch("/api/inbox");
    setData(await res.json());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const groups = useMemo(() => (data ? groupItems(data.items) : []), [data]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = flat[Math.min(sel, flat.length - 1)];

  const say = (text: string, undo?: () => void) => {
    setToast({ text, undo });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  };

  const post = async (key: string, action: string, body: object = {}) => {
    const res = await fetch(`/api/items/${encodeURIComponent(key)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return res.json();
  };

  const act = useCallback(
    async (action: "dismiss" | "snooze") => {
      if (!current) return;
      const key = current.itemKey;
      await post(key, action, action === "snooze" ? { hours: 4 } : {});
      say(action === "dismiss" ? "Dismissed. New activity will bring it back." : "Snoozed for 4 hours.", async () => {
        await post(key, "restore");
        await load();
      });
      await load();
    },
    [current, load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); break;
        case "k": case "ArrowUp": e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); break;
        case "d": act("dismiss"); break;
        case "s": act("snooze"); break;
        case "o": case "Enter": if (current?.url) window.open(current.url, "_blank", "noopener"); break;
        case "u": if (toast?.undo) { toast.undo(); setToast(null); } break;
        case "g": fetch("/api/poll", { method: "POST" }).then(load); say("Refreshing…"); break;
        case "?": setHelp((h) => !h); break;
        case "Escape": setHelp(false); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat.length, act, current, toast, load]);

  useEffect(() => {
    document.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" });
  }, [sel, data]);

  if (!data) return <div className="loading">Loading…</div>;
  const down = data.statuses.filter((s) => !s.ok || s.banner);

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
                <i className="dot" />
                {SOURCE_LABEL[src]}
                <small>{st?.lastPollAt ? ago(st.lastPollAt, data.now) : "not connected"}</small>
              </span>
            );
          })}
        </div>
        <div className="count">{flat.length} need you{data.hiddenCount > 0 && <small> · {data.hiddenCount} hidden</small>}</div>
      </header>

      {down.map((s) => (
        <div key={s.source} className="banner">
          {SOURCE_LABEL[s.source]}: {s.banner ?? s.error ?? "problem"} — items from this source may be missing, not absent.
        </div>
      ))}

      <main className="split">
        <div className="list">
          {flat.length === 0 && <div className="empty">Nothing needs you right now.</div>}
          {groups.map(({ lane, items }) => (
            <section key={lane.id}>
              <h2>{lane.title} <small>{lane.hint}</small></h2>
              {items.map((it) => {
                const idx = flat.indexOf(it);
                const top = sortFlags(it.flags)[0];
                return (
                  <div key={it.itemKey} className={`row ${idx === sel ? "selected" : ""}`} onClick={() => setSel(idx)}>
                    <div className="srcs">
                      {it.sources.map((s) => <span key={s} className={`src ${s}`}>{SOURCE_LABEL[s]}</span>)}
                    </div>
                    <div className="title">{it.title}</div>
                    <div className="meta">
                      {top && <span className={`flag ${top}`}>{FLAG_LABEL[top]}</span>}
                      <span className="when">{ago(it.lastActivity, data.now)}</span>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <aside className="detail">
          {current ? <Detail item={current} now={data.now} /> : <div className="empty">Select an item</div>}
        </aside>
      </main>

      {toast && (
        <div className="toast">
          {toast.text}
          {toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo <kbd>u</kbd></button>}
        </div>
      )}

      <footer className="keys">
        <span><kbd>j</kbd><kbd>k</kbd> move</span>
        <span><kbd>o</kbd> open</span>
        <span><kbd>d</kbd> dismiss</span>
        <span><kbd>s</kbd> snooze 4h</span>
        <span className="soon"><kbd>r</kbd> remind</span>
        <span className="soon"><kbd>t</kbd> transition</span>
        <span className="soon"><kbd>c</kbd> draft reply</span>
        <span><kbd>g</kbd> refresh</span>
        <span><kbd>?</kbd> help</span>
      </footer>

      {help && (
        <div className="overlay" onClick={() => setHelp(false)}>
          <div className="card">
            <h3>Keyboard</h3>
            <p>Every action is one key and is written to the actions log. The tool never sends WhatsApp messages and never writes to Jira without your confirmation.</p>
            <p>Greyed keys (remind, transition, draft) arrive in later checkpoints.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ item, now }: { item: InboxItem; now: number }) {
  return (
    <div>
      <h1>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> : item.title}</h1>
      <div className="flags">
        {sortFlags(item.flags).map((f) => <span key={f} className={`flag ${f}`}>{FLAG_LABEL[f]}</span>)}
        {item.ticketKey && <span className="flag link">linked: {item.ticketKey}</span>}
        {item.verdict && <span className={`flag verdict ${item.verdict}`}>{item.verdict.replace("_", " ")}</span>}
      </div>
      {item.reason && <p className="reason">{item.reason}</p>}
      <ol className="timeline">
        {item.events.map((e, i) => (
          <li key={i} className={e.mentionsMe ? "mention" : ""}>
            <div className="who">
              <span className={`src ${e.source}`}>{SOURCE_LABEL[e.source]}</span>
              <b>{e.authorIsMe ? "You" : e.author}</b>
              <small>{ago(e.ts, now)}</small>
            </div>
            <div className="body">{e.body || (e.kind === "ticket" ? "Ticket updated" : "")}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
