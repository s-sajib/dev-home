import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config";
import type { DB } from "./db";
import { dismissItem, listItems, rebuildItems, restoreItem, snoozeItem } from "./inbox";
import { jiraComment, jiraTransition } from "./adapters/jira";
import { completeReminder, createReminder, type RemindersDeps } from "./adapters/reminders";
import { handleWahaWebhook } from "./adapters/whatsapp";
import { draftReply, judgeItems, latestDraft, type Runner } from "./claude";
import { backfillChat } from "./adapters/whatsapp";
import { autoHandleChats, clampN, getMode, latestSummary, LLM_MODES, modesByItem, setMode, setSetting, summarizeChat, summaryDefault, type LlmMode } from "./chatllm";
import { getStatuses, pollOnce } from "./poller";
import { logAction } from "./store";
import type { SourceAdapter } from "./types";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface ApiDeps {
  db: DB;
  cfg: Config;
  adapters: SourceAdapter[];
  run: Runner;
  reminders?: RemindersDeps;
}

/**
 * All writes are explicit, logged commands triggered by a keypress. WhatsApp is never written to.
 * The webhook is the only inbound write path and requires the shared token.
 */
export function createApi({ db, cfg, adapters, run, reminders }: ApiDeps) {
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
    const path = url.pathname.slice(4);
    const method = req.method;

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
        configured: { jira: !!cfg.jira, github: !!cfg.github, reminders: !!reminders, whatsapp: !!cfg.whatsapp },
        transitions: cfg.transitions,
        settings: { summaryN: summaryDefault(db, cfg) },
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
    if (method === "POST" && path === "/settings") {
      const b = (await req.json().catch(() => ({}))) as any;
      if (b.summaryN !== undefined) setSetting(db, "summary_n", String(clampN(b.summaryN, cfg.summaryDefault)));
      return json({ ok: true, settings: { summaryN: summaryDefault(db, cfg) } });
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

    const m = path.match(/^\/items\/(.+)\/(dismiss|snooze|restore|accept|transition|comment|draft|remind|complete|summarize|llm-mode)$/);
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
        else if (action === "snooze") snoozeItem(db, itemKey, Date.now() + Number(body.hours ?? 4) * 3_600_000);
        logAction(db, itemKey, action, body, true, "ok");
        return json({ ok: true });
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

      if (action === "draft") {
        const draft = await draftReply(db, cfg, run, itemKey);
        logAction(db, itemKey, "draft", {}, true, "drafted (not sent)");
        return json({ ok: true, draft });
      }

      if (action === "remind") {
        if (!reminders) return fail(400, "Reminders is only available on macOS");
        const dueAt = Date.now() + Number(body.hours ?? 2) * 3_600_000;
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
        if (!reminders || !ev) return fail(400, "Not a reminder");
        await completeReminder(reminders, ev);
        db.query("UPDATE events SET meta = json_set(meta, '$.completed', json('true')) WHERE source = 'reminders' AND source_id = ?").run(`rem:${ev}`);
        refresh();
        logAction(db, itemKey, "complete", {}, true, ev);
        return json({ ok: true });
      }

      // Jira writes need a ticket key and an explicit confirmation from the UI
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
