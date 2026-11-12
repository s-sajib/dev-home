import { useSyncExternalStore } from "react";

/**
 * Every request goes through `call`: it never throws, times out instead of hanging, and records whether the app is
 * reachable so the UI can say so, keep showing the last data, and reconnect by itself.
 */
export interface Conn { ok: boolean; lastOk: number; failures: number }
let conn: Conn = { ok: true, lastOk: Date.now(), failures: 0 };
const subs = new Set<() => void>();
const setConn = (c: Conn) => { conn = c; subs.forEach((f) => f()); };
export const useConn = () => useSyncExternalStore((f) => { subs.add(f); return () => void subs.delete(f); }, () => conn);

export interface Res<T = any> { ok: boolean; status: number; data: T; error?: string; network?: boolean }

export async function call<T = any>(method: string, url: string, body?: unknown, timeoutMs = 8000): Promise<Res<T>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* a proxy or crash page, not our JSON */ }
    setConn({ ok: true, lastOk: Date.now(), failures: 0 });
    const ok = r.ok && data?.ok !== false;
    return { ok, status: r.status, data, error: ok ? undefined : data?.error ?? `The app answered with an error (${r.status}).` };
  } catch (e: any) {
    setConn({ ok: false, lastOk: conn.lastOk, failures: conn.failures + 1 });
    const timeout = e?.name === "AbortError";
    return { ok: false, status: 0, data: {} as T, network: true, error: timeout ? "The app is not answering (timed out)." : "Can't reach the app. It may have crashed; it will reconnect by itself." };
  } finally {
    clearTimeout(timer);
  }
}
