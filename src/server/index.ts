import { loadConfig } from "./config";
import { openDb } from "./db";
import { createApi } from "./api";
import { createGithubAdapter } from "./adapters/github";
import { createJiraAdapter } from "./adapters/jira";
import { seedDemo } from "./demo";
import { pollOnce } from "./poller";
import { rebuildItems } from "./inbox";
import index from "../web/index.html";

const cfg = loadConfig();
const db = openDb(cfg.demo ? ":memory:" : cfg.dbPath);
const adapters = [createJiraAdapter(cfg.jira), createGithubAdapter(cfg.github)];
const api = createApi(db, cfg, adapters);

if (cfg.demo) {
  seedDemo(db);
  rebuildItems(db, { now: Date.now(), staleDays: cfg.staleDays, replyHours: cfg.replyHours });
} else {
  void pollOnce(db, adapters, cfg);
  setInterval(() => void pollOnce(db, adapters, cfg), cfg.pollIntervalMs);
}

const server = Bun.serve({
  port: cfg.port,
  hostname: "127.0.0.1", // local only
  routes: { "/": index },
  async fetch(req) {
    return (await api(req)) ?? new Response("Not found", { status: 404 });
  },
});
console.log(`[work-inbox] http://${server.hostname}:${server.port}${cfg.demo ? " (demo data)" : ""}`);
