import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config";
import type { DB } from "./db";
import { dismissItem, listItems, rebuildItems, restoreItem, snoozeItem } from "./inbox";
import { jiraComment, jiraTransition } from "./adapters/jira";
import { completeReminder, createReminder, type RemindersDeps } from "./adapters/reminders";
import { handleWahaWebhook } from "./adapters/whatsapp";
import { draftReply, judgeItems, latestDraft, type Runner } from "./claude";
import { backfillChat } from "./adapters/whatsapp";
import { chatMessages } from "./chatllm";
import { autoHandleChats, clampN, getMode, latestSummary, LLM_MODES, modesByItem, setMode, summarizeChat, summaryDefault, type LlmMode } from "./chatllm";
import { testConnection, type Exec, type Target } from "./connect-test";
import type { ConfigManager } from "./settings";
import { addCard, getBoard, moveCard, removeCard, syncBoard, updateCard } from "./board";
import { demoRunner as demoAI, seedDemo } from "./demo";
import { getStatuses, pollOnce } from "./poller";
import { logAction } from "./store";
import type { SourceAdapter } from "./types";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The API is for this machine only. Browsers send Host and (for cross-site requests) Origin / Sec-Fetch-Site, so a
 * malicious web page can neither read responses (Host check defeats DNS rebinding) nor drive writes (Origin check).
 * Non-browser clients (Claude Code's MCP server, curl, tests) send neither and are allowed.
 */
export function guardRequest(req: Request, cfg: Pick<Config, "host" | "port">): Response | null {
  const allowed = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`, `[::1]:${cfg.port}`, `${cfg.host}:${cfg.port}`]);
  const host = req.headers.get("host");
  if (host && !allowed.has(host)) return json({ error: "forbidden host" }, 403);
  const origin = req.headers.get("origin");
  if (origin) {
    let ok = false;
    try { ok = allowed.has(new URL(origin).host); } catch { ok = false; }
    if (!ok) return json({ error: "forbidden origin" }, 403);
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) return json({ error: "cross-site request blocked" }, 403);
  return null;
}

export interface ApiDeps {
  db: DB;
  cfg: Config;
  adapters: SourceAdapter[];
  run: Runner;
  settings: ConfigManager;
  /** Test seam: overrides the live Reminders settings (and lets tests inject osascript) */
  reminders?: RemindersDeps;
  fetchImpl?: typeof fetch;
  exec?: Exec;
}

/**
 * All writes are explicit, logged commands triggered by a keypress. WhatsApp is never written to.
 * The webhook is the only inbound write path and requires the shared token.
 */
export function createApi({ db, cfg, adapters, run, settings, reminders: remindersOverride, fetchImpl, exec }: ApiDeps) {
  const remindersNow = (): RemindersDeps | undefined => remindersOverride ?? (cfg.reminders.enabled ? { list: cfg.reminders.list } : undefined);
  const ctx = () => ({ now: Date.now(), staleDays: cfg.staleDays, replyHours: cfg.replyHours });
  const refresh = () => rebuildItems(db, ctx());
  const summarizeDeps = () => ({
    db, cfg, run,
    backfill: cfg.whatsapp ? (key: string, n: number) => backfillChat(db, { cfg: cfg.whatsapp! }, key, n) : undefined,
  });

  return async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/webhook/waha") {
      if (!cfg.whatsapp) return json({ error: "WhatsApp not configured" }, 404);
      if (!cfg.whatsapp.webhookToken) return json({ error: "Set WAHA_WEBHOOK_TOKEN" }, 503);
      if (!safeEq(url.searchParams.get("token") ?? "", cfg.whatsapp.webhookToken)) return json({ error: "forbidden" }, 403);
      const result = await handleWahaWebhook(db, { cfg: cfg.whatsapp }, await req.json().catch(() => ({})));
      if (result.stored) refresh();
      return json(result);
    }

    if (!url.pathname.startsWith("/api/")) return null;
    const blocked = guardRequest(req, cfg);
    if (blocked) return blocked;
    const path = url.pathname.slice(4);
    const method = req.method;

    // demo mode only: put the made-up data back exactly as it started (used by the end-to-end tests)
    if (method === "POST" && path === "/demo/reset" && cfg.demo) {
      db.transaction(() => {
        for (const t of ["events", "items", "state", "drafts", "reminder_links", "actions_log", "source_status", "chats", "chat_settings", "summaries", "settings", "board_cards"]) db.exec(`DELETE FROM ${t}`);
      })();
      settings.reload();
      seedDemo(db);
      refresh();
      await judgeItems(db, cfg, demoAI);
      await autoHandleChats({ db, cfg, run: demoAI });
      return json({ ok: true });
    }

    // ---- read endpoints used by Claude Code (MCP) and handy for scripts ----
    if (method === "GET" && path === "/chat-messages") {
      const key = url.searchParams.get("key") ?? "";
      const n = clampN(url.searchParams.get("n"), summaryDefault(db, cfg));
      if (!key.startsWith("chat:")) return json({ error: "key must be a chat item key" }, 400);
      if (getMode(db, key) === "never") return json({ error: "This chat is set to Never: its text is not shared with Claude." }, 403);
      const stored = (db.query("SELECT COUNT(*) AS c FROM events WHERE native_key = ?").get(key) as { c: number }).c;
      if (stored < n && cfg.whatsapp) await backfillChat(db, { cfg: cfg.whatsapp }, key, n).catch(() => undefined);
      const msgs = chatMessages(db, key, n).map((m) => ({ ts: m.ts, author: m.authorIsMe ? "ME" : m.author, authorIsMe: m.authorIsMe, mentionsMe: m.mentionsMe, body: m.body }));
      return json({ itemKey: key, count: msgs.length, messages: msgs });
    }
    const one = path.match(/^\/items\/(.+)$/);
    if (method === "GET" && one) {
      const it = listItems(db, Date.now()).find((i) => i.itemKey === decodeURIComponent(one[1]!));
      return it ? json({ ...it, draft: latestDraft(db, it.itemKey)?.body ?? null, summary: it.itemKey.startsWith("chat:") ? latestSummary(db, it.itemKey) : null }) : json({ error: "unknown item" }, 404);
    }

    // ---- work board ----
    if (method === "GET" && path === "/board") {
      syncBoard(db, cfg);
      return json({ ...getBoard(db, cfg), statusMap: cfg.boardStatusMap });
    }
    if (method === "POST" && path === "/board/sync") return json({ ok: true, ...syncBoard(db, cfg) });
    if (path === "/board/cards" && method === "POST") {
      const b = (await req.json().catch(() => ({}))) as any;
      try {
        const id = addCard(db, cfg, { title: String(b.title ?? ""), notes: b.notes, col: b.col });
        logAction(db, null, "board-add", { title: b.title, col: b.col }, true, String(id));
        return json({ ok: true, id });
      } catch (e: any) {
        return json({ ok: false, error: String(e?.message ?? e) }, 400);
      }
    }
    const card = path.match(/^\/board\/cards\/(\d+)$/);
    if (card && (method === "PATCH" || method === "DELETE")) {
      const id = Number(card[1]);
      try {
        if (method === "DELETE") {
          removeCard(db, id);
          logAction(db, null, "board-remove", { id }, true, "removed");
          return json({ ok: true });
        }
        const b = (await req.json().catch(() => ({}))) as any;
        if (b.title !== undefined || b.notes !== undefined || b.pinned !== undefined) updateCard(db, id, { title: b.title, notes: b.notes, pinned: b.pinned });
        if (b.col !== undefined) {
          moveCard(db, cfg, id, String(b.col), b.index === undefined ? undefined : Number(b.index));
          logAction(db, null, "board-move", { id, col: b.col, index: b.index }, true, "moved");
        }
        return json({ ok: true });
      } catch (e: any) {
        return json({ ok: false, error: String(e?.message ?? e) }, 400);
      }
    }

    if (method === "GET" && path === "/inbox") {
      const now = Date.now();
      const modes = modesByItem(db);
      const items = listItems(db, now).map((i) => ({
        ...i,
        draft: latestDraft(db, i.itemKey)?.body ?? null,
        llmMode: i.itemKey.startsWith("chat:") ? (modes.get(i.itemKey) ?? "manual") : null,
        summary: i.itemKey.startsWith("chat:") ? latestSummary(db, i.itemKey) : null,
      }));
      return json({
        now,
        items: items.filter((i) => !i.hidden),
        hiddenCount: items.filter((i) => i.hidden && i.flags.length > 0).length,
        statuses: getStatuses(db),
        configured: { jira: !!cfg.jira, github: !!cfg.github, reminders: !!remindersNow(), whatsapp: !!cfg.whatsapp },
        transitions: cfg.transitions,
        ui: {
          refreshSeconds: cfg.uiRefreshSeconds,
          grouping: cfg.defaultGrouping,
          snoozeHours: cfg.snoozeHours,
          remindHours: cfg.remindHours,
          summaryPresets: cfg.summaryPresets,
          summaryDefault: summaryDefault(db, cfg),
          keys: cfg.keys,
        },
        demo: cfg.demo,
      });
    }

    if (method === "GET" && path === "/stats") {
      // success metric: share of AI verdicts I override
      const row = db.query("SELECT SUM(action = 'verdict_override') AS o, SUM(action IN ('accept','dismiss','snooze','transition','comment')) AS t FROM actions_log").get() as any;
      return json({ overrides: row?.o ?? 0, decisions: row?.t ?? 0 });
    }

    if (method === "POST" && path === "/poll") {
      await pollOnce(db, adapters, cfg);
      return json({ ok: true });
    }
    if (method === "GET" && path === "/settings") return json(settings.describe());
    if (method === "POST" && path === "/settings") {
      // body: { changes: { key: value | null } }  (null resets to the default). Secrets are written to the Keychain.
      const b = (await req.json().catch(() => ({}))) as { changes?: Record<string, unknown> };
      const errors: Record<string, string> = {};
      for (const [k, v] of Object.entries(b.changes ?? {})) {
        try {
          await settings.set(k, v);
          logAction(db, null, "setting", { key: k, reset: v === null, secret: /token|apikey/i.test(k) }, true, "saved");
        } catch (e: any) {
          errors[k] = String(e?.message ?? e);
        }
      }
      refresh();
      syncBoard(db, cfg); // rule settings (reply hours, stale days, flags, ignored authors) apply to the inbox right away
      return json({ ok: Object.keys(errors).length === 0, errors, ...settings.describe() }, Object.keys(errors).length ? 400 : 200);
    }
    if (method === "POST" && path === "/settings/test") {
      const b = (await req.json().catch(() => ({}))) as { target?: Target };
      return json(await testConnection(b.target as Target, cfg, { fetchImpl, exec, osa: remindersOverride?.osa }));
    }
    if (method === "POST" && path === "/auto") {
      return json({ ok: true, ...(await autoHandleChats(summarizeDeps())) });
    }
    if (method === "POST" && path === "/judge") {
      try {
        return json({ ok: true, judged: await judgeItems(db, cfg, run) });
      } catch (err: any) {
        return json({ ok: false, error: String(err?.message ?? err) }, 502);
      }
    }

    const m = path.match(/^\/items\/(.+)\/(dismiss|snooze|restore|accept|transition|comment|draft|draft-save|remind|complete|summarize|llm-mode|board)$/);
    if (method !== "POST" || !m) return json({ error: "not found" }, 404);

    const itemKey = decodeURIComponent(m[1]!);
    const action = m[2]!;
    const body = (await req.json().catch(() => ({}))) as any;
    const item = listItems(db, Date.now()).find((i) => i.itemKey === itemKey);
    const fail = (status: number, error: string) => (logAction(db, itemKey, action, body, false, error), json({ ok: false, error }, status));

    try {
      if (action === "restore") {
        restoreItem(db, itemKey);
        logAction(db, itemKey, "restore", {}, true, "restored");
        return json({ ok: true });
      }
      if (!item) return fail(404, "unknown item");

      if (action === "dismiss" || action === "accept" || action === "snooze") {
        // metric: dismissing a "needs me" or accepting a "drop" is an override of the AI verdict
        const override = (action === "dismiss" && item.verdict === "needs_me") || (action === "accept" && item.verdict === "drop");
        if (override) logAction(db, itemKey, "verdict_override", { verdict: item.verdict, action }, true, "override");
        if (action === "dismiss") dismissItem(db, itemKey);
        else if (action === "snooze") snoozeItem(db, itemKey, Date.now() + Number(body.hours ?? cfg.snoozeHours) * 3_600_000);
        logAction(db, itemKey, action, body, true, "ok");
        return json({ ok: true });
      }

      if (action === "board") {
        const id = addCard(db, cfg, { title: item.title, col: body.col, itemKey: item.itemKey, url: item.url, ticketKey: item.ticketKey });
        logAction(db, itemKey, "board-add", { col: body.col }, true, String(id));
        return json({ ok: true, id });
      }

      if (action === "llm-mode") {
        if (!itemKey.startsWith("chat:") || !LLM_MODES.includes(body.mode)) return fail(400, "invalid mode");
        setMode(db, itemKey, body.mode as LlmMode);
        logAction(db, itemKey, "llm-mode", { mode: body.mode }, true, "ok");
        return json({ ok: true, mode: getMode(db, itemKey) });
      }

      if (action === "summarize") {
        const n = clampN(body.n, summaryDefault(db, cfg));
        const summary = await summarizeChat(summarizeDeps(), itemKey, n);
        logAction(db, itemKey, "summarize", { n }, true, "summarised (nothing sent)");
        return json({ ok: true, summary });
      }

      if (action === "draft-save") {
        const text = String(body.text ?? "").trim();
        if (!itemKey.startsWith("chat:") || !text) return fail(400, "A draft needs a chat item and some text");
        db.query("INSERT INTO drafts (item_key, body, created_at) VALUES (?, ?, ?)").run(itemKey, text.slice(0, 4000), Date.now());
        logAction(db, itemKey, "draft-save", { by: req.headers.get("x-client") ?? "ui" }, true, "saved (copy-only, never sent)");
        return json({ ok: true });
      }

      if (action === "draft") {
        const draft = await draftReply(db, cfg, run, itemKey);
        logAction(db, itemKey, "draft", {}, true, "drafted (not sent)");
        return json({ ok: true, draft });
      }

      if (action === "remind") {
        const reminders = remindersNow();
        if (!reminders) return fail(400, "Reminders is off (turn it on in Settings; it needs a Mac)");
        const dueAt = Date.now() + Number(body.hours ?? cfg.remindHours) * 3_600_000;
        const id = await createReminder(reminders, {
          title: `Follow up: ${item.title}`,
          notes: `${item.url ?? ""}\n${item.itemKey}`.trim(),
          dueAt,
        });
        db.query("INSERT OR REPLACE INTO reminder_links (reminder_id, item_key, last_nudged_at, nudge_count) VALUES (?, ?, NULL, 0)").run(id, itemKey);
        logAction(db, itemKey, "remind", { dueAt }, true, id);
        return json({ ok: true, id, dueAt });
      }

      if (action === "complete") {
        const ev = item.itemKey.startsWith("reminder:") ? item.itemKey.slice(9) : null;
        const reminders = remindersNow();
        if (!reminders || !ev) return fail(400, "Not a reminder");
        await completeReminder(reminders, ev);
        db.query("UPDATE events SET meta = json_set(meta, '$.completed', json('true')) WHERE source = 'reminders' AND source_id = ?").run(`rem:${ev}`);
        refresh();
        logAction(db, itemKey, "complete", {}, true, ev);
        return json({ ok: true });
      }

      // Jira writes need a ticket key and an explicit confirmation from the UI
      if (req.headers.get("x-client") === "mcp" && !cfg.mcpAllowWrites) return fail(403, "Claude Code is not allowed to write to Jira. Turn on Settings → Claude Code → Let Claude Code write to Jira.");
      const ticket = item.ticketKey;
      if (!cfg.jira || !ticket) return fail(400, "Jira not configured or this item has no linked ticket");
      if (body.confirm !== true) return fail(400, "Confirmation required");
      const deps = { baseUrl: cfg.jira.baseUrl, email: cfg.jira.email, token: cfg.jira.token };
      const result = action === "transition" ? await jiraTransition(deps, ticket, String(body.status)) : await jiraComment(deps, ticket, String(body.text));
      logAction(db, itemKey, action, { ticket, status: body.status }, true, result);
      return json({ ok: true, result });
    } catch (err: any) {
      return fail(502, String(err?.message ?? err));
    }
  };
}
