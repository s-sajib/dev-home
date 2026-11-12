import { resolveKeymap, validateKeymap, DEFAULT_KEYMAP } from "../shared/keys";
import type { Config } from "./config";
import type { DB } from "./db";
import { DEFAULT_STATUS_MAP, PIPELINE_A, PIPELINE_B } from "./board";
import { configureRuntime } from "./runtime";
import type { SecretStore } from "./secrets";
import type { Flag } from "./types";

export type FieldType = "number" | "text" | "bool" | "list" | "numlist" | "enum" | "days" | "flags" | "secret" | "keys";

export interface Field {
  key: string;
  group: string;
  label: string;
  help?: string;
  type: FieldType;
  default: unknown;
  env?: string;
  min?: number;
  max?: number;
  options?: string[];
  placeholder?: string;
  /** Takes effect after restarting the server */
  restart?: boolean;
  /** One-click value sets shown as buttons (list fields) */
  presets?: Record<string, unknown>;
}

export const FLAGS: Flag[] = ["mentions_me", "unanswered_comment", "review_requested", "stale", "status_changed_by_other", "needs_reply", "overdue_reminder", "assigned"];
const IS_MAC = process.platform === "darwin";

export const GROUPS = ["General", "Board", "Rules", "Nag & hours", "Jira", "GitHub", "WhatsApp", "Claude", "Reminders", "Claude Code", "Keyboard", "Server"] as const;

export const FIELDS: Field[] = [
  // General
  { key: "pollMinutes", group: "General", label: "Poll interval (minutes)", help: "How often Jira, GitHub and Reminders are fetched.", type: "number", default: 5, min: 1, max: 1440, env: "POLL_MINUTES" },
  { key: "theme", group: "General", label: "Theme", help: "System follows your Mac's light/dark setting.", type: "enum", options: ["system", "dark", "light"], default: "system" },
  { key: "uiRefreshSeconds", group: "General", label: "Screen refresh (seconds)", type: "number", default: 30, min: 5, max: 3600 },
  { key: "defaultGrouping", group: "General", label: "Default grouping", help: "Auto groups by Claude's verdict once any exist, otherwise by rule.", type: "enum", options: ["auto", "verdict", "lane"], default: "auto" },
  { key: "snoozeHours", group: "General", label: "Snooze length (hours)", type: "number", default: 4, min: 0.25, max: 720 },
  { key: "remindHours", group: "General", label: "New reminder due in (hours)", type: "number", default: 2, min: 0.1, max: 720 },
  { key: "purgeDays", group: "General", label: "Delete chat text older than (days)", help: "WhatsApp messages are purged from the local database after this.", type: "number", default: 90, min: 1, max: 3650 },

  // Board
  { key: "boardColumns", group: "Board", label: "Columns", help: "One per line, left to right. Pick a pipeline or write your own. Cards in a removed column show in the first one.", type: "list", default: PIPELINE_B, presets: { "Pipeline A (Stage, Prod)": PIPELINE_A, "Pipeline B (Stage, Ready for Release, Prod)": PIPELINE_B } },
  { key: "boardStatusMap", group: "Board", label: "Jira status → column", help: "One per line as `Jira status = Column`. An open PR pulls a ticket to PR Review and a merged PR to Merged; Decision Needed always wins. Moving a card by hand pins it.", type: "list", default: DEFAULT_STATUS_MAP },
  { key: "boardIntake", group: "Board", label: "Column for unmapped statuses", type: "text", default: "To Do" },
  { key: "boardSyncJira", group: "Board", label: "Sync Jira tickets to the board (one way)", help: "Tickets assigned to me create cards and their Jira status moves unpinned cards. Moving a card on the board never changes Jira.", type: "bool", default: true },
  { key: "boardMessageColumn", group: "Board", label: "Column for cards made from a message or comment", type: "text", default: "Pending" },
  { key: "boardIncludeReviews", group: "Board", label: "Put PRs waiting for my review on the board", type: "bool", default: true },

  // Rules
  { key: "replyHours", group: "Rules", label: "Reply owed after (hours)", help: "A mention or quote you haven't answered becomes 'Reply owed' after this long.", type: "number", default: 4, min: 0.25, max: 168, env: "REPLY_HOURS" },
  { key: "staleDays", group: "Rules", label: "Ticket is stale after (days)", type: "number", default: 5, min: 1, max: 365, env: "STALE_DAYS" },
  { key: "disabledFlags", group: "Rules", label: "Turn off these flags", help: "Checked flags no longer put items in your inbox.", type: "flags", default: [] },
  { key: "ignoreAuthors", group: "Rules", label: "Ignore activity from", help: "Display names or logins, one per line or comma separated (automation accounts, noisy people).", type: "list", default: [] },

  // Nag
  { key: "nagEnabled", group: "Nag & hours", label: "Nag about overdue reminders", type: "bool", default: true },
  { key: "workStartHour", group: "Nag & hours", label: "Nag window starts (hour, 0-23)", type: "number", default: 8, min: 0, max: 23, env: "WORK_START_HOUR" },
  { key: "workEndHour", group: "Nag & hours", label: "Nag window ends (hour, 0-23)", help: "Earlier than the start means it crosses midnight: 8 to 1 is 08:00-01:00.", type: "number", default: 1, min: 0, max: 23, env: "WORK_END_HOUR" },
  { key: "workDays", group: "Nag & hours", label: "Nag on these days", type: "days", default: [0, 1, 2, 3, 4, 5, 6], env: "WORK_DAYS" },
  { key: "nagIntervals", group: "Nag & hours", label: "Minutes between re-nags", help: "Grows with each nag; the last value repeats.", type: "numlist", default: [15, 30, 60, 120, 240], min: 1, max: 1440 },

  // Jira
  { key: "jiraBaseUrl", group: "Jira", label: "Site URL", type: "text", default: "", placeholder: "https://your-org.atlassian.net", env: "JIRA_BASE_URL" },
  { key: "jiraEmail", group: "Jira", label: "Email", type: "text", default: "", env: "JIRA_EMAIL" },
  { key: "jiraToken", group: "Jira", label: "API token", help: "Stored in the macOS Keychain.", type: "secret", default: null, env: "JIRA_API_TOKEN" },
  { key: "jiraLookbackDays", group: "Jira", label: "Look back (days)", type: "number", default: 14, min: 1, max: 365 },
  { key: "jiraJql", group: "Jira", label: "Custom JQL (optional)", help: "Replaces the default query (assigned, watching, reported or commented, updated recently).", type: "text", default: "" },
  { key: "jiraTransitions", group: "Jira", label: "Statuses offered on the transition key", type: "list", default: ["In Progress", "In Review", "Done"], env: "JIRA_TRANSITIONS" },

  // GitHub
  { key: "githubUsername", group: "GitHub", label: "Username", type: "text", default: "", env: "GITHUB_USERNAME" },
  { key: "githubToken", group: "GitHub", label: "Personal access token", help: "Stored in the macOS Keychain.", type: "secret", default: null, env: "GITHUB_TOKEN" },
  { key: "githubReviewRequests", group: "GitHub", label: "Include review requests", type: "bool", default: true },
  { key: "githubMyPrs", group: "GitHub", label: "Include my own PRs (comments, failing checks)", type: "bool", default: true },
  { key: "githubMentions", group: "GitHub", label: "Include PRs that mention me", type: "bool", default: true },
  { key: "githubMerged", group: "GitHub", label: "Include my recently merged PRs", help: "Feeds the board's Merged column.", type: "bool", default: true },
  { key: "githubIssues", group: "GitHub", label: "Include issues assigned to me or mentioning me", help: "They become Issue items and board cards. Labels can place them: add lines like `blocked = Decision Needed` to the board status map.", type: "bool", default: true },
  { key: "githubBots", group: "GitHub", label: "Ignore these bot accounts", help: "Accounts ending in [bot] are always ignored.", type: "list", default: ["dependabot", "github-actions", "renovate", "codecov"] },

  // WhatsApp
  { key: "wahaUrl", group: "WhatsApp", label: "WAHA URL", help: "Leave empty to turn WhatsApp off.", type: "text", default: "", placeholder: "http://localhost:3000", env: "WAHA_URL" },
  { key: "wahaSession", group: "WhatsApp", label: "WAHA session", type: "text", default: "default", env: "WAHA_SESSION" },
  { key: "wahaApiKey", group: "WhatsApp", label: "WAHA API key", type: "secret", default: null, env: "WAHA_API_KEY" },
  { key: "wahaWebhookToken", group: "WhatsApp", label: "Webhook token", help: "Must match the ?token= in WHATSAPP_HOOK_URL. Required, otherwise the webhook is refused.", type: "secret", default: null, env: "WAHA_WEBHOOK_TOKEN" },
  { key: "waMyIds", group: "WhatsApp", label: "My WhatsApp ids", help: "Phone JID and LID. Learned automatically from WAHA, add extras here.", type: "list", default: [], env: "WA_MY_IDS" },
  { key: "waDmAddressesMe", group: "WhatsApp", label: "Treat every 1:1 message as addressed to me", type: "bool", default: true },
  { key: "summaryDefault", group: "WhatsApp", label: "Default summary size (messages)", type: "number", default: 20, min: 1, max: 500, env: "SUMMARY_MESSAGES" },
  { key: "summaryPresets", group: "WhatsApp", label: "Summary size buttons", type: "numlist", default: [20, 50, 100, 200], min: 1, max: 500 },
  { key: "chatDefaultMode", group: "WhatsApp", label: "Claude mode for new chats", help: "Manual: Claude sees a chat only when you press a key. Never: no chat is sent unless you switch it on.", type: "enum", options: ["manual", "never"], default: "manual" },
  { key: "autoSettleSeconds", group: "WhatsApp", label: "Auto mode waits for quiet (seconds)", help: "Auto-mode chats are summarised once nothing new arrived for this long.", type: "number", default: 60, min: 0, max: 3600 },

  // Claude
  { key: "autoJudge", group: "Claude", label: "Judge items automatically", help: "Adds Needs me / Drop / Delegate after each poll.", type: "bool", default: true, env: "AUTO_JUDGE" },
  { key: "claudeBin", group: "Claude", label: "claude command", type: "text", default: "claude", env: "CLAUDE_BIN" },
  { key: "claudeModel", group: "Claude", label: "Model (optional)", help: "Alias or full id passed to `claude --model`. Empty uses your default.", type: "text", default: "", env: "CLAUDE_MODEL" },
  { key: "claudeTimeoutSeconds", group: "Claude", label: "Timeout per call (seconds)", type: "number", default: 120, min: 10, max: 900 },

  // Reminders
  { key: "remindersEnabled", group: "Reminders", label: "Use Apple Reminders", type: "bool", default: IS_MAC },
  { key: "remindersList", group: "Reminders", label: "Reminders list", type: "text", default: "Work Inbox", env: "REMINDERS_LIST" },

  // Claude Code (MCP)
  { key: "mcpAllowWrites", group: "Claude Code", label: "Let Claude Code write to Jira", help: "Off: Claude Code can read the inbox and board, move cards, and leave drafts. On: it may also transition tickets and comment (each call still needs confirm). It can never send WhatsApp messages.", type: "bool", default: false },

  // Keyboard
  { key: "keys", group: "Keyboard", label: "Keyboard shortcuts", type: "keys", default: DEFAULT_KEYMAP },

  // Server
  { key: "port", group: "Server", label: "Port", type: "number", default: 3571, min: 1, max: 65535, env: "PORT", restart: true },
  { key: "host", group: "Server", label: "Host", help: "Keep 127.0.0.1 unless WAHA in Docker cannot reach the webhook.", type: "text", default: "127.0.0.1", env: "HOST", restart: true },
];

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
export const SECRET_KEYS = FIELDS.filter((f) => f.type === "secret").map((f) => f.key);

// ---------- parsing & validation ----------
const splitList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,\n]/)).map((x) => x.trim()).filter(Boolean);

/** Validate a value from the UI/API and return its typed form. Throws a readable error. */
export function validate(f: Field, raw: unknown): unknown {
  switch (f.type) {
    case "number": {
      const n = typeof raw === "string" ? Number(raw.trim()) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${f.label}: must be a number`);
      if (f.min !== undefined && n < f.min) throw new Error(`${f.label}: minimum is ${f.min}`);
      if (f.max !== undefined && n > f.max) throw new Error(`${f.label}: maximum is ${f.max}`);
      return n;
    }
    case "text": {
      const s = String(raw ?? "").trim();
      if (s.length > 2000) throw new Error(`${f.label}: too long`);
      if (f.key === "jiraBaseUrl" || f.key === "wahaUrl") {
        if (s && !/^https?:\/\/[^\s/]+/.test(s)) throw new Error(`${f.label}: must start with http:// or https://`);
        return s.replace(/\/+$/, "");
      }
      return s;
    }
    case "bool":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "false") return raw === "true";
      throw new Error(`${f.label}: must be on or off`);
    case "list": {
      const list = splitList(raw).slice(0, 200);
      if (f.key === "boardColumns") {
        if (list.length < 2) throw new Error(`${f.label}: need at least two columns`);
        if (new Set(list.map((x) => x.toLowerCase())).size !== list.length) throw new Error(`${f.label}: column names must be unique`);
      }
      return list;
    }
    case "numlist": {
      const nums = splitList(raw).map(Number);
      if (nums.length === 0) throw new Error(`${f.label}: needs at least one number`);
      for (const n of nums) {
        if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) throw new Error(`${f.label}: each value must be between ${f.min} and ${f.max}`);
      }
      return nums.slice(0, 20);
    }
    case "enum":
      if (!f.options!.includes(String(raw))) throw new Error(`${f.label}: must be one of ${f.options!.join(", ")}`);
      return String(raw);
    case "days": {
      const days = (Array.isArray(raw) ? raw : splitList(raw)).map(Number);
      if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error(`${f.label}: pick at least one day`);
      return [...new Set(days)].sort();
    }
    case "flags": {
      const flags = splitList(raw);
      const bad = flags.find((x) => !FLAGS.includes(x as Flag));
      if (bad) throw new Error(`${f.label}: unknown flag ${bad}`);
      return flags;
    }
    case "keys":
      return validateKeymap(raw);
    case "secret":
      throw new Error(`${f.label}: secrets are set separately`);
  }
}

function fromEnv(f: Field, env: Record<string, string | undefined>): unknown | undefined {
  const v = f.env ? env[f.env] : undefined;
  if (v === undefined || v === "") return undefined;
  try {
    if (f.type === "bool") return !(v === "0" || v === "false");
    if (f.type === "secret") return v;
    if (f.type === "number") return Number(v);
    return validate(f, v);
  } catch {
    return undefined;
  }
}

export type Source = "default" | "env" | "saved";

export function buildConfig(env: Record<string, string | undefined>, saved: Record<string, unknown>, secrets: Record<string, string>) {
  const v: Record<string, any> = {};
  const src: Record<string, Source> = {};
  for (const f of FIELDS) {
    if (f.type === "secret") {
      if (secrets[f.key]) [v[f.key], src[f.key]] = [secrets[f.key], "saved"];
      else if (fromEnv(f, env) !== undefined) [v[f.key], src[f.key]] = [fromEnv(f, env), "env"];
      else [v[f.key], src[f.key]] = [null, "default"];
      continue;
    }
    if (f.key in saved) [v[f.key], src[f.key]] = [saved[f.key], "saved"];
    else if (fromEnv(f, env) !== undefined) [v[f.key], src[f.key]] = [fromEnv(f, env), "env"];
    else [v[f.key], src[f.key]] = [f.default, "default"];
  }
  // REMINDERS=0 in the environment keeps working
  if (env.REMINDERS === "0" && src.remindersEnabled === "default") v.remindersEnabled = false;

  const config: Config = {
    dbPath: env.WORK_INBOX_DB ?? "data/work-inbox.db",
    demo: env.WORK_INBOX_DEMO === "1" || env.WORK_INBOX_DEMO === "harsh",
    harsh: env.WORK_INBOX_DEMO === "harsh",
    port: v.port,
    host: v.host,
    pollIntervalMs: v.pollMinutes * 60_000,
    staleDays: v.staleDays,
    replyHours: v.replyHours,
    disabledFlags: v.disabledFlags,
    ignoreAuthors: v.ignoreAuthors,
    nagEnabled: v.nagEnabled,
    workStartHour: v.workStartHour,
    workEndHour: v.workEndHour,
    workDays: v.workDays,
    nagIntervalsMin: v.nagIntervals,
    claudeBin: v.claudeBin || "claude",
    claudeModel: v.claudeModel || null,
    claudeTimeoutSeconds: v.claudeTimeoutSeconds,
    autoJudge: v.autoJudge,
    summaryDefault: v.summaryDefault,
    summaryPresets: v.summaryPresets,
    autoSettleSeconds: v.autoSettleSeconds,
    purgeDays: v.purgeDays,
    chatDefaultMode: v.chatDefaultMode,
    uiRefreshSeconds: v.uiRefreshSeconds,
    defaultGrouping: v.defaultGrouping,
    snoozeHours: v.snoozeHours,
    remindHours: v.remindHours,
    keys: resolveKeymap(v.keys),
    boardColumns: v.boardColumns,
    boardStatusMap: v.boardStatusMap,
    boardIntake: v.boardIntake,
    boardIncludeReviews: v.boardIncludeReviews,
    boardSyncJira: v.boardSyncJira,
    boardMessageColumn: v.boardMessageColumn || "Pending",
    mcpAllowWrites: v.mcpAllowWrites,
    theme: v.theme,
    jira:
      v.jiraBaseUrl && v.jiraEmail && v.jiraToken
        ? { baseUrl: String(v.jiraBaseUrl).replace(/\/$/, ""), email: v.jiraEmail, token: v.jiraToken, lookbackDays: v.jiraLookbackDays, jql: v.jiraJql }
        : null,
    transitions: v.jiraTransitions,
    github:
      v.githubUsername && v.githubToken
        ? { token: v.githubToken, username: v.githubUsername, bots: v.githubBots, reviewRequests: v.githubReviewRequests, myPrs: v.githubMyPrs, mentions: v.githubMentions, merged: v.githubMerged, issues: v.githubIssues }
        : null,
    reminders: { list: v.remindersList || "Work Inbox", enabled: v.remindersEnabled },
    whatsapp: v.wahaUrl
      ? { wahaUrl: String(v.wahaUrl).replace(/\/$/, ""), session: v.wahaSession || "default", apiKey: v.wahaApiKey, webhookToken: v.wahaWebhookToken ?? "", myIds: v.waMyIds, dmAddressesMe: v.waDmAddressesMe }
      : null,
  };
  return { config, values: v, sources: src };
}

// ---------- manager: saved settings + secrets, applied live ----------
const KEY = (k: string) => `cfg.${k}`;

export class ConfigManager {
  private secrets: Record<string, string> = {};
  constructor(
    public cfg: Config,
    private db: DB,
    private store: SecretStore,
    private env: Record<string, string | undefined> = process.env,
  ) {}

  private saved(): Record<string, unknown> {
    const rows = this.db.query("SELECT key, value FROM settings WHERE key LIKE 'cfg.%'").all() as { key: string; value: string }[];
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      const k = r.key.slice(4);
      if (!BY_KEY.has(k) || BY_KEY.get(k)!.type === "secret") continue;
      try { out[k] = JSON.parse(r.value); } catch { /* ignore corrupt row */ }
    }
    return out;
  }

  /** Read secrets from the store, then (re)build and apply the live config. Call once at startup. */
  async load(): Promise<void> {
    for (const k of SECRET_KEYS) {
      const s = await this.store.get(k).catch(() => null);
      if (s) this.secrets[k] = s;
    }
    this.apply();
  }

  private apply() {
    const { demo, harsh, dbPath } = this.cfg;
    Object.assign(this.cfg, buildConfig(this.env, this.saved(), this.secrets).config, { demo, harsh, dbPath });
    configureRuntime({ ignoreAuthors: this.cfg.ignoreAuthors, disabledFlags: this.cfg.disabledFlags, chatDefaultMode: this.cfg.chatDefaultMode });
  }

  /** Re-read saved settings (e.g. after the demo database was reset). */
  reload() {
    this.apply();
  }

  /** Save one setting (value) or reset it to the default (null). Secrets go to the Keychain. */
  async set(key: string, value: unknown): Promise<void> {
    const f = BY_KEY.get(key);
    if (!f) throw new Error(`Unknown setting ${key}`);
    if (f.type === "secret") {
      if (value === null || value === "") {
        await this.store.del(key);
        delete this.secrets[key];
      } else {
        const s = String(value).trim();
        if (s.length < 4 || s.length > 500) throw new Error(`${f.label}: that does not look like a valid token`);
        await this.store.set(key, s);
        this.secrets[key] = s;
      }
    } else if (value === null) {
      this.db.query("DELETE FROM settings WHERE key = ?").run(KEY(key));
    } else {
      const typed = validate(f, value);
      this.db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(KEY(key), JSON.stringify(typed));
    }
    this.apply();
  }

  /** Everything the Settings screen needs. Secret values are never included. */
  describe() {
    const { values, sources } = buildConfig(this.env, this.saved(), this.secrets);
    return {
      groups: GROUPS,
      fields: FIELDS.map((f) => ({
        ...f,
        value: f.type === "secret" ? null : f.type === "keys" ? resolveKeymap(values[f.key]) : values[f.key],
        secretSet: f.type === "secret" ? !!values[f.key] : undefined,
        source: sources[f.key],
      })),
    };
  }
}
