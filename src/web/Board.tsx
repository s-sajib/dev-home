import { useRef, useState } from "react";
import { FLAG_LABEL, SOURCE_LABEL, ago, sortFlags } from "./format";

export interface BoardCard {
  id: number; itemKey: string | null; title: string; notes: string; url: string | null; ticketKey: string | null;
  col: string; pos: number; pinned: boolean; flags: string[]; sources: string[]; status: string | null; lastActivity: number | null;
}
export interface BoardData { columns: string[]; cards: BoardCard[] }

const ATTENTION = new Set(["needs_reply", "mentions_me", "unanswered_comment", "review_requested", "overdue_reminder"]);

interface Props {
  board: BoardData; now: number; sel: number | null;
  onSelect: (id: number) => void; onOpen: (id: number) => void;
  onMove: (id: number, col: string, index: number) => void; onAdd: (col: string, title: string) => void;
  adding: string | null; setAdding: (col: string | null) => void;
}

export function Board({ board, now, sel, onSelect, onOpen, onMove, onAdd, adding, setAdding }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const indexAt = (col: string, y: number): number => {
    const els = Array.from(colRefs.current[col]?.querySelectorAll<HTMLElement>("[data-card]") ?? []).filter((el) => Number(el.dataset.card) !== drag);
    let i = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) i++;
    }
    return i;
  };

  return (
    <div className="board" data-testid="board">
      {board.columns.map((col, ci) => {
        const cards = board.cards.filter((c) => c.col === col);
        const n = board.columns.length;
        const grad = { backgroundSize: `${n * 100}% 100%`, backgroundPosition: `${(ci / Math.max(1, n - 1)) * 100}% 0` };
        return (
          <div
            key={col}
            className={`col ${over?.col === col ? "over" : ""}`}
            data-col={col}
            onDragOver={(e) => { e.preventDefault(); setOver({ col, index: indexAt(col, e.clientY) }); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.col === col ? null : o)); }}
            onDrop={(e) => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")) || drag; if (id) onMove(id, col, indexAt(col, e.clientY)); setDrag(null); setOver(null); }}
          >
            <div className="bar" style={grad} />
            <header>
              <h2>{col}</h2><span className="n">{cards.length}</span>
              <button className="add" title="Add card" onClick={() => setAdding(col)} aria-label={`Add card to ${col}`}>+</button>
            </header>
            {adding === col && (
              <div className="newcard">
                <input autoFocus placeholder="Card title, Enter to add" onKeyDown={(e) => {
                  if (e.key === "Enter" && e.currentTarget.value.trim()) { onAdd(col, e.currentTarget.value.trim()); setAdding(null); }
                  if (e.key === "Escape") setAdding(null);
                }} onBlur={() => setAdding(null)} />
              </div>
            )}
            <div className="cards" ref={(el) => { colRefs.current[col] = el; }}>
              {cards.map((c, i) => (
                <div key={c.id} style={{ display: "contents" }}>
                  {over?.col === col && over.index === i && <div className="drop-line" />}
                  <button
                    data-card={c.id}
                    className={`card ${sel === c.id ? "selected" : ""} ${drag === c.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(c.id)); e.dataTransfer.effectAllowed = "move"; setDrag(c.id); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    onClick={() => onSelect(c.id)}
                    onDoubleClick={() => onOpen(c.id)}
                  >
                    <div className="ct">{c.title}</div>
                    {c.notes && <div className="cn">{c.notes}</div>}
                    <div className="cm">
                      {c.ticketKey && <span className="key">{c.ticketKey}</span>}
                      {c.sources.slice(0, 2).map((s) => <span key={s} className={`chip src-${s}`}>{SOURCE_LABEL[s as keyof typeof SOURCE_LABEL]}</span>)}
                      {c.flags.some((f) => ATTENTION.has(f)) && <span className="alert" title={sortFlags(c.flags as any)[0] ? FLAG_LABEL[sortFlags(c.flags as any)[0]!] : ""} />}
                      {c.pinned && <span className="pin" title="Placed by hand. Automation won't move it.">◆</span>}
                      {c.lastActivity && <span className="age">{ago(c.lastActivity, now)}</span>}
                    </div>
                  </button>
                </div>
              ))}
              {cards.length === 0 && adding !== col && <div className="empty-col">nothing here</div>}
              {over?.col === col && over.index >= cards.length && <div className="drop-line" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
