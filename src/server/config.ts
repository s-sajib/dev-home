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
  jira: { baseUrl: string; email: string; token: string } | null;
  github: { token: string; username: string } | null;
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
  return {
    dbPath: env.WORK_INBOX_DB ?? "data/work-inbox.db",
    port: num(env.PORT, 3571),
    demo: env.WORK_INBOX_DEMO === "1",
    staleDays: num(env.STALE_DAYS, 5),
    replyHours: num(env.REPLY_HOURS, 4),
    workStartHour: num(env.WORK_START_HOUR, 9),
    workEndHour: num(env.WORK_END_HOUR, 18),
    pollIntervalMs: num(env.POLL_MINUTES, 5) * 60_000,
    jira,
    github,
  };
}
