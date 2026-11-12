import { LayoutGroup, motion } from "motion/react";
import { useRef, useState } from "react";
import { ago } from "./format";
import { Glyph, Lamp, kindOf, why } from "./objects";

export interface BoardCard {
  id: number; itemKey: string | null; title: string; notes: string; url: string | null; ticketKey: string | null;
  col: string; pos: number; pinned: boolean; flags: string[]; sources: string[]; status: string | null; lastActivity: number | null;
}
export interface BoardData { columns: string[]; cards: BoardCard[] }

interface Props {
  board: BoardData; now: number; sel: number | null;
  onSelect: (id: number) => void; onOpen: (id: number) => void;
  onMove: (id: number, col: string, index: number) => void; onAdd: (col: string, title: string) => void;
  adding: string | null; setAdding: (col: string | null) => void;
}

/** The pipeline reads as one thread with a node per stage; cards sit under the stage they have reached. */
export function Board({ board, now, sel, onSelect, onOpen, onMove, onAdd, adding, setAdding }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const indexAt = (col: string, y: number): number => {
    const els = Array.from(colRefs.current[col]?.querySelectorAll<HTMLElement>("[data-card]") ?? []).filter((el) => Number(el.dataset.card) !== drag);
    let i = 0;
    for (const el of els) { const r = el.getBoundingClientRect(); if (y > r.top + r.height / 2) i++; }
    return i;
  };

  return (
    <div className="board" data-testid="board">
      <LayoutGroup>
      <div className="track">
        {board.columns.map((col) => {
          const cards = board.cards.filter((c) => c.col === col);
          return (
            <div key={col} className={`col ${over?.col === col ? "over" : ""}`} data-col={col}
              onDragOver={(e) => { e.preventDefault(); setOver({ col, index: indexAt(col, e.clientY) }); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.col === col ? null : o)); }}
              onDrop={(e) => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")) || drag; if (id) onMove(id, col, indexAt(col, e.clientY)); setDrag(null); setOver(null); }}>
              <header>
                <i />
                <h2>{col}</h2><span className="n">{cards.length}</span>
                <button className="add" title="Add card" onClick={() => setAdding(col)} aria-label={`Add card to ${col}`}>+</button>
              </header>
              {adding === col && (
                <div className="newcard">
                  <input autoFocus placeholder="Title, then Enter" onKeyDown={(e) => {
                    if (e.key === "Enter" && e.currentTarget.value.trim()) { onAdd(col, e.currentTarget.value.trim()); setAdding(null); }
                    if (e.key === "Escape") setAdding(null);
                  }} onBlur={() => setAdding(null)} />
                </div>
              )}
              <div className="cards" ref={(el) => { colRefs.current[col] = el; }}>
                {cards.map((c, i) => {
                  const w = why({ flags: c.flags as any, verdict: null, reason: null });
                  return (
                    <div key={c.id} style={{ display: "contents" }}>
                      {over?.col === col && over.index === i && <div className="drop-line" />}
                      <div data-card={c.id} className={`cardwrap ${drag === c.id ? "dragging" : ""}`} draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(c.id)); e.dataTransfer.effectAllowed = "move"; setDrag(c.id); }}
                        onDragEnd={() => { setDrag(null); setOver(null); }}>
                        <motion.button layout layoutId={`card-${c.id}`} transition={{ type: "spring", stiffness: 420, damping: 36 }}
                          className={`card ${sel === c.id ? "selected" : ""}`} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} whileHover="hover" variants={{ hover: { y: -1 } }}
                          onClick={() => onSelect(c.id)} onDoubleClick={() => onOpen(c.id)}>
                          <div className="ct"><Glyph kind={kindOf(c.itemKey)} live={w?.tone === "warn"} /><span>{c.title}</span></div>
                          {c.notes && <div className="cn">{c.notes}</div>}
                          <div className="cm">
                            {c.ticketKey && <span className="key">{c.ticketKey}</span>}
                            {w && w.tone && <Lamp tone={w.tone} />}
                            {c.pinned && <span className="pin" title="Placed by hand. Automation won't move it.">◆</span>}
                            {c.lastActivity && <span className="age">{ago(c.lastActivity, now)}</span>}
                          </div>
                        </motion.button>
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 && adding !== col && <div className="empty-col">nothing here</div>}
                {over?.col === col && over.index >= cards.length && <div className="drop-line" />}
              </div>
            </div>
          );
        })}
      </div>
      </LayoutGroup>
    </div>
  );
}
