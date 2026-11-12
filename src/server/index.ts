import { loadConfig } from "./config";
import { openDb } from "./db";
import { createApi } from "./api";
import { createGithubAdapter } from "./adapters/github";
import { createJiraAdapter } from "./adapters/jira";
import { createRemindersAdapter } from "./adapters/reminders";
import { createWhatsappAdapter, purgeOldChats } from "./adapters/whatsapp";
import { backfillChat } from "./adapters/whatsapp";
import { claudeRunner, judgeItems } from "./claude";
import { autoHandleChats } from "./chatllm";
import { demoRunner, seedDemo } from "./demo";
import { rebuildItems } from "./inbox";
import { consoleNotifier, macNotifier } from "./notify";
import { runNag } from "./nag";
import { pollOnce } from "./poller";
import index from "../web/index.html";

const cfg = loadConfig();
const db = openDb(cfg.demo ? ":memory:" : cfg.dbPath);
const reminders = cfg.reminders.enabled || cfg.demo ? { list: cfg.reminders.list } : undefined;
const adapters = [
  createJiraAdapter(cfg.jira),
  createGithubAdapter(cfg.github),
  createRemindersAdapter(cfg.reminders.enabled ? { list: cfg.reminders.list } : null),
  createWhatsappAdapter(cfg.whatsapp ? { cfg: cfg.whatsapp } : null),
];
const run = cfg.demo ? demoRunner : claudeRunner(cfg);
const api = createApi({ db, cfg, adapters, run, reminders: cfg.demo ? undefined : reminders });
const ctx = () => ({ now: Date.now(), staleDays: cfg.staleDays, replyHours: cfg.replyHours });

async function cycle() {
  await pollOnce(db, adapters, cfg);
  if (cfg.autoJudge) await judgeItems(db, cfg, run).catch((e) => console.warn("[judge]", e.message));
}

if (cfg.demo) {
  seedDemo(db);
  rebuildItems(db, ctx());
  await judgeItems(db, cfg, demoRunner);
  await autoHandleChats({ db, cfg, run: demoRunner });
} else {
  void cycle();
  setInterval(() => void cycle(), cfg.pollIntervalMs);
  // the nag runs in the server (not the browser) so it works with no window open
  const notify = process.platform === "darwin" ? macNotifier : consoleNotifier;
  setInterval(() => void runNag(db, cfg, notify).catch((e) => console.warn("[nag]", e.message)), 60_000);
  // auto-mode chats: summarise + draft when new activity has settled (never sends anything)
  const autoDeps = { db, cfg, run, backfill: cfg.whatsapp ? (k: string, n: number) => backfillChat(db, { cfg: cfg.whatsapp! }, k, n) : undefined };
  setInterval(() => void autoHandleChats(autoDeps).then((r) => r.errors.forEach((e) => console.warn("[auto]", e))), 120_000);
  setInterval(() => purgeOldChats(db), 6 * 3_600_000);
  purgeOldChats(db);
}

const server = Bun.serve({
  port: cfg.port,
  hostname: cfg.host, // 127.0.0.1 unless you opt out
  routes: { "/": index },
  async fetch(req) {
    return (await api(req)) ?? new Response("Not found", { status: 404 });
  },
});
console.log(`[work-inbox] http://${server.hostname}:${server.port}${cfg.demo ? " (demo data)" : ""}`);
