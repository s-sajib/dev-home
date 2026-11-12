import type { Keymap } from "../shared/keys";
import { buildConfig } from "./settings";
import type { Flag } from "./types";

export interface WhatsappConfig {
  wahaUrl: string;
  session: string;
  apiKey: string | null;
  /** Shared secret in the webhook URL (?token=) so only WAHA can post events */
  webhookToken: string;
  /** Any of these JIDs / LIDs / bare numbers counts as "me" */
  myIds: string[];
  /** In 1:1 chats every incoming message is addressed to me */
  dmAddressesMe: boolean;
}

/**
 * Effective configuration. Built from defaults < environment < saved settings (the Settings screen) and
 * mutated in place when a setting changes, so code reading `cfg.x` always sees the live value.
 */
export interface Config {
  // process-level (restart needed)
  dbPath: string;
  port: number;
  host: string;
  demo: boolean;
  /** Stress mode: huge hostile dataset, failing sources, fault injection (implies demo) */
  harsh: boolean;

  // timing & rules
  pollIntervalMs: number;
  staleDays: number;
  replyHours: number;
  disabledFlags: Flag[];
  ignoreAuthors: string[];

  // nag
  nagEnabled: boolean;
  /** Nag window, local time. End may be earlier than start to cross midnight (8 -> 1 means 08:00 to 01:00). */
  workStartHour: number;
  workEndHour: number;
  /** 0 = Sunday ... 6 = Saturday */
  workDays: number[];
  /** Minutes between re-nags; the last value repeats */
  nagIntervalsMin: number[];

  // claude
  claudeBin: string;
  claudeModel: string | null;
  claudeTimeoutSeconds: number;
  autoJudge: boolean;

  // whatsapp summaries
  summaryDefault: number;
  summaryPresets: number[];
  autoSettleSeconds: number;
  purgeDays: number;
  chatDefaultMode: "manual" | "never";

  // ui
  uiRefreshSeconds: number;
  defaultGrouping: "auto" | "verdict" | "lane";
  snoozeHours: number;
  remindHours: number;
  keys: Keymap;

  // board
  boardColumns: string[];
  /** "Jira status = Column" lines */
  boardStatusMap: string[];
  boardIntake: string;
  boardIncludeReviews: boolean;
  mcpAllowWrites: boolean;
  theme: "system" | "dark" | "light";

  // sources
  jira: { baseUrl: string; email: string; token: string; lookbackDays: number; jql: string } | null;
  transitions: string[];
  github: { token: string; username: string; bots: string[]; reviewRequests: boolean; myPrs: boolean; mentions: boolean; merged: boolean } | null;
  reminders: { list: string; enabled: boolean };
  whatsapp: WhatsappConfig | null;
}

/** Environment-only configuration (tests, scripts, first run). Saved settings are layered on by ConfigManager. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return buildConfig(env, {}, {}).config;
}
