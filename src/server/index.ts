import { loadConfig } from "./config";
import { openDb } from "./db";
import { createApi } from "./api";
import { createGithubAdapter } from "./adapters/github";
import { createJiraAdapter } from "./adapters/jira";
import { createRemindersAdapter } from "./adapters/reminders";
import { backfillChat, createWhatsappAdapter, purgeOldChats } from "./adapters/whatsapp";
import { claudeRunner, judgeItems } from "./claude";
import { autoHandleChats } from "./chatllm";
import { demoRunner, seedDemo } from "./demo";
import { seedHarsh, withChaos } from "./harsh";
import { rebuildItems } from "./inbox";
import { consoleNotifier, macNotifier } from "./notify";
import { runNag } from "./nag";
import { pollOnce } from "./poller";
import { defaultSecretStore, memoryStore } from "./secrets";
import { ConfigManager } from "./settings";
import index from "../web/index.html";

const cfg = loadConfig();
// stress mode keeps a real file so a crash and restart recovers state, like production
const db = openDb(cfg.harsh ? (process.env.WORK_INBOX_DB ?? "data/harsh.db") : cfg.demo ? ":memory:" : cfg.dbPath);
// saved settings + Keychain secrets are layered over the environment, and applied live whenever they change
const settings = new ConfigManager(cfg, db, cfg.demo ? memoryStore() : defaultSecretStore());
await settings.load();

// adapters read the live config on every call, so Settings changes apply without a restart
const adapters = [
  createJiraAdapter(() => cfg.jira),
  createGithubAdapter(() => cfg.github),
  createRemindersAdapter(() => (cfg.reminders.enabled && !cfg.demo ? { list: cfg.reminders.list } : null)),
  createWhatsappAdapter(() => (cfg.whatsapp ? { cfg: cfg.whatsapp } : null)),
];
const flakyRunner: typeof demoRunner = async (prompt, schema, system) => {
  await new Promise((r) => setTimeout(r, 1200 + Math.random() * 2800));
  if (Math.random() < 0.25) throw new Error("claude timed out after 120s (injected)");
  return demoRunner(prompt, schema, system);
};
const run = cfg.harsh ? flakyRunner : cfg.demo ? demoRunner : claudeRunner(cfg);
const apiBase = createApi({ db, cfg, adapters, run, settings });
const api = cfg.harsh && process.env.CHAOS !== "0" ? withChaos(apiBase) : apiBase;
const ctx = () => ({ now: Date.now(), staleDays: cfg.staleDays, replyHours: cfg.replyHours });
const backfill = (k: string, n: number) => (cfg.whatsapp ? backfillChat(db, { cfg: cfg.whatsapp }, k, n) : Promise.resolve(0));

async function cycle() {
  await pollOnce(db, adapters, cfg);
  if (cfg.autoJudge) await judgeItems(db, cfg, run).catch((e) => console.warn("[judge]", e.message));
}

if (cfg.harsh) {
  const have = (db.query("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;
  if (have === 0) { const t = Date.now(); const n = seedHarsh(db); console.log(`[harsh] seeded ${n} events in ${Date.now() - t}ms`); }
  rebuildItems(db, ctx());
  await judgeItems(db, cfg, demoRunner).catch(() => undefined);
} else if (cfg.demo) {
  seedDemo(db);
  rebuildItems(db, ctx());
  await judgeItems(db, cfg, demoRunner);
  await autoHandleChats({ db, cfg, run: demoRunner });
} else {
  // self-scheduling loop so a changed poll interval applies on the next cycle
  const loop = async () => {
    await cycle().catch((e) => console.warn("[poll]", e.message));
    setTimeout(loop, cfg.pollIntervalMs);
  };
  void loop();
  // the nag runs in the server (not the browser) so it works with no window open
  const notify = process.platform === "darwin" ? macNotifier : consoleNotifier;
  setInterval(() => void runNag(db, cfg, notify).catch((e) => console.warn("[nag]", e.message)), 60_000);
  // auto-mode chats: summarise + draft when new activity has settled (never sends anything)
  setInterval(() => void autoHandleChats({ db, cfg, run, backfill }).then((r) => r.errors.forEach((e) => console.warn("[auto]", e))), 120_000);
  setInterval(() => purgeOldChats(db, Date.now(), cfg.purgeDays), 6 * 3_600_000);
  purgeOldChats(db, Date.now(), cfg.purgeDays);
}

const server = Bun.serve({
  // React production build + minified bundle by default; `bun run dev` sets WORK_INBOX_DEV=1 for hot reload
  development: process.env.WORK_INBOX_DEV === "1",
  maxRequestBodySize: 1_000_000, // a webhook or API body above 1 MB is refused outright
  port: cfg.port,
  hostname: cfg.host, // 127.0.0.1 unless you opt out
  routes: { "/": index },
  async fetch(req) {
    return (await api(req)) ?? new Response("Not found", { status: 404 });
  },
});
console.log(`[work-inbox] http://${server.hostname}:${server.port}${cfg.harsh ? " (HARSH stress mode)" : cfg.demo ? " (demo data)" : ""}`);
