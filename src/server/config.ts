export interface Config {
  dbPath: string;
  port: number;
  demo: boolean;
  staleDays: number;
  replyHours: number;
  /** Work hours for nags, local time, 24h */
  workStartHour: number;
  workEndHour: number;
  pollIntervalMs: number;
  /** Claude Code CLI used in print mode (`claude -p`) for verdicts and drafts. */
  claudeBin: string;
  claudeModel: string | null;
  autoJudge: boolean;
  /** PRD open question: may client/team chat text be sent to an LLM? Off until you say so. */
  allowChatToLlm: boolean;
  host: string;
  jira: { baseUrl: string; email: string; token: string } | null;
  github: { token: string; username: string } | null;
  reminders: { list: string; enabled: boolean };
  whatsapp: WhatsappConfig | null;
  /** Status names offered on the `t` key */
  transitions: string[];
}

export interface WhatsappConfig {
  wahaUrl: string;
  session: string;
  apiKey: string | null;
  /** Shared secret in the webhook URL (?token=) so only WAHA can post events */
  webhookToken: string;
  /** Any of these JIDs / LIDs / bare numbers counts as "me" */
  myIds: string[];
}

function num(v: string | undefined, d: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const jira =
    env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN
      ? { baseUrl: env.JIRA_BASE_URL.replace(/\/$/, ""), email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN }
      : null;
  const github =
    env.GITHUB_TOKEN && env.GITHUB_USERNAME ? { token: env.GITHUB_TOKEN, username: env.GITHUB_USERNAME } : null;
  const wa: WhatsappConfig | null = env.WAHA_URL
    ? {
        wahaUrl: env.WAHA_URL.replace(/\/$/, ""),
        session: env.WAHA_SESSION ?? "default",
        apiKey: env.WAHA_API_KEY ?? null,
        webhookToken: env.WAHA_WEBHOOK_TOKEN ?? "",
        myIds: (env.WA_MY_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      }
    : null;
  return {
    dbPath: env.WORK_INBOX_DB ?? "data/work-inbox.db",
    port: num(env.PORT, 3571),
    demo: env.WORK_INBOX_DEMO === "1",
    staleDays: num(env.STALE_DAYS, 5),
    replyHours: num(env.REPLY_HOURS, 4),
    workStartHour: num(env.WORK_START_HOUR, 9),
    workEndHour: num(env.WORK_END_HOUR, 18),
    pollIntervalMs: num(env.POLL_MINUTES, 5) * 60_000,
    claudeBin: env.CLAUDE_BIN ?? "claude",
    claudeModel: env.CLAUDE_MODEL ?? null,
    autoJudge: env.AUTO_JUDGE !== "0",
    allowChatToLlm: env.ALLOW_CHAT_TO_LLM === "1" || env.WORK_INBOX_DEMO === "1",
    host: env.HOST ?? "127.0.0.1",
    jira,
    github,
    reminders: {
      list: env.REMINDERS_LIST ?? "Work Inbox",
      enabled: env.REMINDERS !== "0" && process.platform === "darwin",
    },
    whatsapp: wa,
    transitions: (env.JIRA_TRANSITIONS ?? "In Progress,In Review,Done").split(",").map((x) => x.trim()).filter(Boolean),
  };
}
