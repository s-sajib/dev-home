import { useCallback, useEffect, useState } from "react";
import { ACTIONS, type ActionId, type Keymap } from "../shared/keys";
import { Toggle } from "./ui";

type Source = "default" | "env" | "saved";
interface Field {
  presets?: Record<string, unknown>;
  key: string; group: string; label: string; help?: string; type: string; options?: string[]; placeholder?: string; restart?: boolean;
  value: any; default: any; secretSet?: boolean; source: Source;
}
interface Described { groups: string[]; fields: Field[] }
type Test = { ok: boolean; message: string } | "running";

const TESTS: Record<string, { target: string; label: string }> = {
  Jira: { target: "jira", label: "Test Jira" },
  GitHub: { target: "github", label: "Test GitHub" },
  WhatsApp: { target: "whatsapp", label: "Test WAHA" },
  Claude: { target: "claude", label: "Test claude" },
  Reminders: { target: "reminders", label: "Test Reminders" },
  "Claude Code": { target: "", label: "" },
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FLAG_NAMES: Record<string, string> = {
  mentions_me: "Mentions you", unanswered_comment: "Unanswered comment", review_requested: "Review requested", stale: "Stale ticket",
  status_changed_by_other: "Status changed by someone else", needs_reply: "Reply owed", overdue_reminder: "Overdue reminder", assigned: "Assigned to you",
};

export function Settings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Described | null>(null);
  const [group, setGroup] = useState("General");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, Test>>({});

  const load = useCallback(async () => setData(await (await fetch("/api/settings")).json()), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (e.target as HTMLElement)?.tagName !== "SELECT") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (key: string, value: unknown) => {
    const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes: { [key]: value } }) });
    const j = await res.json();
    setErrors((e) => ({ ...e, [key]: j.errors?.[key] ?? "" }));
    if (j.fields) setData({ groups: j.groups, fields: j.fields });
    if (!j.errors?.[key]) {
      setSaved(key);
      window.setTimeout(() => setSaved((s) => (s === key ? null : s)), 1800);
      onChanged();
    }
    return !j.errors?.[key];
  };

  const runTest = async (target: string) => {
    setTests((t) => ({ ...t, [target]: "running" }));
    const r = await (await fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) })).json();
    setTests((t) => ({ ...t, [target]: r }));
  };

  if (!data) return <div className="loading">Loading settings…</div>;
  const fields = data.fields.filter((f) => f.group === group);
  const t = TESTS[group]?.target ? TESTS[group] : undefined;

  return (
    <div className="settings">
      <nav className="snav">
                {data.groups.map((g) => (
          <button key={g} className={g === group ? "on" : ""} onClick={() => setGroup(g)}>{g}</button>
        ))}
        <button className="close" onClick={onClose}>Back to inbox <kbd>Esc</kbd></button>
      </nav>
      <section className="sbody">
        <h2>{group}</h2>
        {t && (
          <div className="test">
            <button className="go" onClick={() => runTest(t.target)} disabled={tests[t.target] === "running"}>{tests[t.target] === "running" ? "Testing…" : t.label}</button>
            {tests[t.target] && tests[t.target] !== "running" && (
              <span className={(tests[t.target] as any).ok ? "good" : "badtxt"}>{(tests[t.target] as any).message}</span>
            )}
          </div>
        )}
        {fields.map((f) => (
          <div key={f.key} className="field">
            <div className="fhead">
              <label>{f.label}</label>
              <span className={`src-badge ${f.source}`}>{f.source === "saved" ? "saved" : f.source === "env" ? "from .env" : "default"}</span>
              {f.restart && <span className="src-badge restart">restart needed</span>}
              {saved === f.key && <span className="good">saved ✓</span>}
              {f.source === "saved" && f.type !== "secret" && <button className="link" onClick={() => save(f.key, null)}>reset</button>}
            </div>
            {f.help && <div className="fhelp">{f.help}</div>}
            <Editor f={f} onSave={(v) => save(f.key, v)} onClear={() => save(f.key, null)} />
            {errors[f.key] && <div className="ferr">{errors[f.key]}</div>}
          </div>
        ))}
      </section>
    </div>
  );
}

function Editor({ f, onSave, onClear }: { f: Field; onSave: (v: unknown) => Promise<boolean>; onClear: () => void }) {
  const asText = (v: any) => (Array.isArray(v) ? v.join(f.type === "list" ? "\n" : ", ") : v == null ? "" : String(v));
  const [draft, setDraft] = useState(asText(f.value));
  useEffect(() => setDraft(asText(f.value)), [f.value]);
  const commit = () => { if (draft !== asText(f.value)) onSave(draft); };

  switch (f.type) {
    case "bool":
      return <Toggle checked={!!f.value} onChange={(v) => void onSave(v)} label={f.value ? "On" : "Off"} />;
    case "enum":
      return <select value={f.value} onChange={(e) => onSave(e.target.value)}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>;
    case "days":
      return (
        <div className="dchips">
          {DAY_NAMES.map((d, i) => {
            const on = (f.value as number[]).includes(i);
            return <button key={d} className={on ? "on" : ""} onClick={() => onSave(on ? (f.value as number[]).filter((x) => x !== i) : [...f.value, i])}>{d}</button>;
          })}
        </div>
      );
    case "flags":
      return (
        <div className="checks">
          {Object.entries(FLAG_NAMES).map(([k, label]) => {
            const off = (f.value as string[]).includes(k);
            return <label key={k}><input type="checkbox" checked={off} onChange={() => onSave(off ? (f.value as string[]).filter((x) => x !== k) : [...f.value, k])} /> {label}</label>;
          })}
        </div>
      );
    case "list":
      return (
        <>
          {f.presets && (
            <div className="presets">
              {Object.entries(f.presets).map(([label, v]) => <button key={label} className="pill" onClick={() => onSave(v)}>{label}</button>)}
            </div>
          )}
          <textarea rows={Math.min(6, Math.max(2, (f.value?.length ?? 0) + 1))} value={draft} placeholder="one per line" onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
        </>
      );
    case "secret":
      return <SecretEditor f={f} onSave={onSave} onClear={onClear} />;
    case "keys":
      return <KeyEditor value={f.value as Keymap} onSave={onSave} />;
    default:
      return <input value={draft} placeholder={f.placeholder} inputMode={f.type === "number" ? "decimal" : undefined} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
  }
}

function SecretEditor({ f, onSave, onClear }: { f: Field; onSave: (v: unknown) => Promise<boolean>; onClear: () => void }) {
  const [val, setVal] = useState("");
  const [replacing, setReplacing] = useState(false);
  if (f.secretSet && !replacing) {
    return (
      <div className="secret">
        <span className="good">● set{f.source === "env" ? " (from .env)" : ""}</span>
        <button className="link" onClick={() => setReplacing(true)}>replace</button>
        {f.source === "saved" && <button className="link" onClick={onClear}>remove</button>}
      </div>
    );
  }
  return (
    <div className="secret">
      <input type="password" autoComplete="off" value={val} placeholder="paste token" onChange={(e) => setVal(e.target.value)} />
      <button className="go" disabled={val.length < 4} onClick={async () => { if (await onSave(val)) { setVal(""); setReplacing(false); } }}>Save to Keychain</button>
      {replacing && <button className="link" onClick={() => { setReplacing(false); setVal(""); }}>cancel</button>}
    </div>
  );
}

function KeyEditor({ value, onSave }: { value: Keymap; onSave: (v: unknown) => Promise<boolean> }) {
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") return setCapturing(null);
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      onSave({ ...value, [capturing]: e.key }).then(() => setCapturing(null));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, value, onSave]);
  return (
    <div className="keygrid">
      {(Object.keys(ACTIONS) as ActionId[]).map((a) => (
        <div key={a} className="keyrow">
          <span>{ACTIONS[a].label}</span>
          <button className={capturing === a ? "on" : ""} onClick={() => setCapturing(a)}>{capturing === a ? "press a key…" : <kbd>{value[a]}</kbd>}</button>
        </div>
      ))}
    </div>
  );
}
