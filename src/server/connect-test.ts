import type { Config } from "./config";
import { createRemindersAdapter } from "./adapters/reminders";
import { statusBanner, wahaGet } from "./adapters/whatsapp";

export type Target = "jira" | "github" | "whatsapp" | "claude" | "reminders";
export interface TestResult {
  ok: boolean;
  message: string;
}

export type Exec = (cmd: string[]) => Promise<{ code: number; out: string }>;
export const defaultExec: Exec = async (cmd) => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out: (out || err).trim() };
  } catch (e: any) {
    return { code: 127, out: String(e?.message ?? e) };
  }
};

/** "Test connection" buttons on the Settings screen. Read-only calls only. */
export async function testConnection(target: Target, cfg: Config, deps: { fetchImpl?: typeof fetch; exec?: Exec; osa?: (s: string) => Promise<string> } = {}): Promise<TestResult> {
  const f = deps.fetchImpl ?? fetch;
  try {
    if (target === "jira") {
      if (!cfg.jira) return { ok: false, message: "Jira is not configured: set the site URL, email and API token." };
      const res = await f(`${cfg.jira.baseUrl}/rest/api/3/myself`, { headers: { Authorization: "Basic " + Buffer.from(`${cfg.jira.email}:${cfg.jira.token}`).toString("base64"), Accept: "application/json" } });
      if (!res.ok) return { ok: false, message: `Jira answered ${res.status}. Check the site URL, email and token.` };
      const me: any = await res.json();
      return { ok: true, message: `Connected as ${me.displayName ?? me.emailAddress ?? "you"}.` };
    }
    if (target === "github") {
      if (!cfg.github) return { ok: false, message: "GitHub is not configured: set the username and token." };
      const res = await f("https://api.github.com/user", { headers: { Authorization: `Bearer ${cfg.github.token}`, Accept: "application/vnd.github+json" } });
      if (!res.ok) return { ok: false, message: `GitHub answered ${res.status}. Check the token.` };
      const me: any = await res.json();
      const mismatch = String(me.login).toLowerCase() !== cfg.github.username.toLowerCase();
      return { ok: !mismatch, message: mismatch ? `Token belongs to ${me.login}, but the username is set to ${cfg.github.username}.` : `Connected as ${me.login}.` };
    }
    if (target === "whatsapp") {
      if (!cfg.whatsapp) return { ok: false, message: "WhatsApp is off: set the WAHA URL." };
      const s = await wahaGet({ cfg: cfg.whatsapp, fetchImpl: f }, `/api/sessions/${encodeURIComponent(cfg.whatsapp.session)}`);
      const st = statusBanner(s?.status);
      const hook = cfg.whatsapp.webhookToken ? "" : " The webhook token is empty, so incoming messages will be refused.";
      return { ok: st.ok && !!cfg.whatsapp.webhookToken, message: st.ok ? `WAHA session is WORKING.${hook}` : `${st.banner}${hook}` };
    }
    if (target === "claude") {
      const r = await (deps.exec ?? defaultExec)([cfg.claudeBin, "--version"]);
      return r.code === 0 ? { ok: true, message: `Found ${r.out.split("\n")[0]}. (It must also be logged in: run \`claude\` once in a terminal.)` } : { ok: false, message: `Could not run "${cfg.claudeBin}": ${r.out.slice(0, 120)}` };
    }
    if (target === "reminders") {
      if (!cfg.reminders.enabled) return { ok: false, message: "Reminders is turned off (or this is not a Mac)." };
      const evs = await createRemindersAdapter({ list: cfg.reminders.list, osa: deps.osa }).fetch(null);
      return { ok: true, message: `Found ${evs.length} reminder(s) in "${cfg.reminders.list}".` };
    }
    return { ok: false, message: "Unknown target" };
  } catch (e: any) {
    return { ok: false, message: String(e?.message ?? e).slice(0, 200) };
  }
}
