import type { Config } from "./config";
import type { DB } from "./db";
import { dismissItem, listItems, restoreItem, snoozeItem } from "./inbox";
import { jiraComment, jiraTransition } from "./adapters/jira";
import { getStatuses, pollOnce } from "./poller";
import { logAction } from "./store";
import type { SourceAdapter } from "./types";

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** All writes are explicit, logged commands triggered by a keypress. WhatsApp is never written to. */
export function createApi(db: DB, cfg: Config, adapters: SourceAdapter[]) {
  return async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return null;
    const path = url.pathname.slice(4);
    const method = req.method;

    if (method === "GET" && path === "/inbox") {
      const now = Date.now();
      const items = listItems(db, now);
      return json({
        now,
        items: items.filter((i) => !i.hidden),
        hiddenCount: items.filter((i) => i.hidden && i.flags.length > 0).length,
        statuses: getStatuses(db),
        configured: { jira: !!cfg.jira, github: !!cfg.github },
        demo: cfg.demo,
      });
    }

    if (method === "POST" && path === "/poll") {
      await pollOnce(db, adapters, cfg);
      return json({ ok: true });
    }

    const m = path.match(/^\/items\/(.+)\/(dismiss|snooze|restore|transition|comment)$/);
    if (method === "POST" && m) {
      const itemKey = decodeURIComponent(m[1]!);
      const action = m[2]!;
      const body = (await req.json().catch(() => ({}))) as any;
      try {
        if (action === "dismiss") {
          const ok = dismissItem(db, itemKey);
          logAction(db, itemKey, "dismiss", {}, ok, ok ? "dismissed" : "unknown item");
          return json({ ok });
        }
        if (action === "snooze") {
          const hours = Number(body.hours ?? 4);
          const until = Date.now() + hours * 3_600_000;
          snoozeItem(db, itemKey, until);
          logAction(db, itemKey, "snooze", { hours }, true, `until ${new Date(until).toISOString()}`);
          return json({ ok: true, until });
        }
        if (action === "restore") {
          restoreItem(db, itemKey);
          logAction(db, itemKey, "restore", {}, true, "restored");
          return json({ ok: true });
        }
        // Jira writes need a ticket key and a confirmation flag from the UI
        const ticket = itemKey.startsWith("ticket:") ? itemKey.slice(7) : String(body.ticketKey ?? "");
        if (!cfg.jira || !ticket) return json({ ok: false, error: "Jira not configured or item has no ticket" }, 400);
        if (body.confirm !== true) return json({ ok: false, error: "Confirmation required" }, 400);
        const deps = { baseUrl: cfg.jira.baseUrl, email: cfg.jira.email, token: cfg.jira.token };
        const result =
          action === "transition" ? await jiraTransition(deps, ticket, String(body.status)) : await jiraComment(deps, ticket, String(body.text));
        logAction(db, itemKey, action, { ticket, status: body.status }, true, result);
        return json({ ok: true, result });
      } catch (err: any) {
        logAction(db, itemKey, action, body, false, String(err?.message ?? err));
        return json({ ok: false, error: String(err?.message ?? err) }, 502);
      }
    }
    return json({ error: "not found" }, 404);
  };
}
