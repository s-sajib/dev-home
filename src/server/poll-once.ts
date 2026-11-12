import { loadConfig } from "./config";
import { openDb } from "./db";
import { createGithubAdapter } from "./adapters/github";
import { createJiraAdapter } from "./adapters/jira";
import { getStatuses, pollOnce } from "./poller";
import { defaultSecretStore } from "./secrets";
import { ConfigManager } from "./settings";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
await new ConfigManager(cfg, db, defaultSecretStore()).load(); // saved settings + Keychain secrets
const items = await pollOnce(db, [createJiraAdapter(() => cfg.jira), createGithubAdapter(() => cfg.github)], cfg);
console.log(getStatuses(db));
console.log(`${items.filter((i) => !i.hidden).length} visible items`);
