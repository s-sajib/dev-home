import { beforeEach, describe, expect, test } from "bun:test";
import { createApi } from "../src/server/api";
import { createGithubAdapter, isBot } from "../src/server/adapters/github";
import { createJiraAdapter } from "../src/server/adapters/jira";
import { parseWahaMessage } from "../src/server/adapters/whatsapp";
import { getMode } from "../src/server/chatllm";
import { loadConfig } from "../src/server/config";
import { testConnection } from "../src/server/connect-test";
import { openDb } from "../src/server/db";
import { demoEvents, demoRunner } from "../src/server/demo";
import { rebuildItems } from "../src/server/inbox";
import { dueNags, inWorkHours } from "../src/server/nag";
import { pollOnce } from "../src/server/poller";
import { configureRuntime } from "../src/server/runtime";
import { memoryStore } from "../src/server/secrets";
import { ConfigManager, FIELDS, validate } from "../src/server/settings";
import { upsertEvents } from "../src/server/store";
import { DEFAULT_KEYMAP, validateKeymap } from "../src/shared/keys";

const now = Date.now();
beforeEach(() => configureRuntime({ ignoreAuthors: [], disabledFlags: [], chatDefaultMode: "manual" }));

const make = (env: Record<string, string> = {}) => {
  const cfg = loadConfig(env);
  const db = openDb(":memory:");
  const store = memoryStore();
  const mgr = new ConfigManager(cfg, db, store, env);
  return { cfg, db, store, mgr };
};

describe("precedence: default < env < saved", () => {
  test("each layer overrides the previous and reset falls back", async () => {
    const { cfg, mgr } = make({ REPLY_HOURS: "6" });
    await mgr.load();
    expect(cfg.replyHours).toBe(6); // env beats default (4)
    await mgr.set("replyHours", 2);
    expect(cfg.replyHours).toBe(2); // saved beats env
    expect(mgr.describe().fields.find((f) => f.key === "replyHours")!.source).toBe("saved");
    await mgr.set("replyHours", null);
    expect(cfg.replyHours).toBe(6); // back to env
    expect(mgr.describe().fields.find((f) => f.key === "replyHours")!.source).toBe("env");
  });

  test("saved settings survive a restart (new manager on the same database)", async () => {
    const { db, store } = make();
    await new ConfigManager(loadConfig({}), db, store, {}).set("staleDays", 9);
    const cfg2 = loadConfig({});
    await new ConfigManager(cfg2, db, store, {}).load();
    expect(cfg2.staleDays).toBe(9);
  });

  test("every field has a default that passes its own validation", () => {
    for (const f of FIELDS) {
      if (f.type === "secret" || f.default === null) continue;
      expect(() => validate(f, f.default)).not.toThrow();
    }
  });
});

describe("validation", () => {
  const f = (k: string) => FIELDS.find((x) => x.key === k)!;
  test("numbers are range checked", () => {
    expect(() => validate(f("replyHours"), 0)).toThrow(/minimum/);
    expect(() => validate(f("workStartHour"), 24)).toThrow(/maximum/);
    expect(() => validate(f("staleDays"), "abc")).toThrow(/number/);
    expect(validate(f("staleDays"), "7")).toBe(7);
  });
  test("enums, days, flags, lists", () => {
    expect(() => validate(f("defaultGrouping"), "weird")).toThrow();
    expect(() => validate(f("workDays"), [])).toThrow();
    expect(() => validate(f("workDays"), [7])).toThrow();
    expect(validate(f("workDays"), [3, 1, 1])).toEqual([1, 3]);
    expect(() => validate(f("disabledFlags"), ["nope"])).toThrow(/unknown flag/);
    expect(validate(f("ignoreAuthors"), "Bot A, Bot B\nBot C")).toEqual(["Bot A", "Bot B", "Bot C"]);
    expect(validate(f("summaryPresets"), "10, 30,60")).toEqual([10, 30, 60]);
    expect(() => validate(f("summaryPresets"), "10, 9999")).toThrow();
  });
  test("urls need a scheme and lose trailing slashes", () => {
    expect(() => validate(f("jiraBaseUrl"), "example.com")).toThrow(/http/);
    expect(validate(f("jiraBaseUrl"), "https://x.atlassian.net//")).toBe("https://x.atlassian.net");
  });
  test("a bad value is rejected and nothing is saved", async () => {
    const { cfg, mgr } = make();
    await expect(mgr.set("replyHours", -1)).rejects.toThrow();
    expect(cfg.replyHours).toBe(4);
    await expect(mgr.set("nope", 1)).rejects.toThrow(/Unknown/);
  });
  test("keymap rejects duplicates, reserved and unknown actions", () => {
    expect(() => validateKeymap({ dismiss: "j" })).toThrow(/both/);
    expect(() => validateKeymap({ dismiss: "Escape" })).toThrow(/reserved/);
    expect(() => validateKeymap({ nope: "q" })).toThrow(/unknown/);
    expect(validateKeymap({ dismiss: "e" }).dismiss).toBe("e");
    expect(validateKeymap({}).down).toBe(DEFAULT_KEYMAP.down);
  });
});

describe("secrets", () => {
  test("go to the secret store, never into the database or the API response", async () => {
    const { cfg, db, store, mgr } = make();
    await mgr.set("jiraBaseUrl", "https://x.atlassian.net");
    await mgr.set("jiraEmail", "me@x.com");
    expect(cfg.jira).toBeNull(); // token still missing
    await mgr.set("jiraToken", "super-secret-token-123");
    expect(cfg.jira?.token).toBe("super-secret-token-123");
    expect(await store.get("jiraToken")).toBe("super-secret-token-123");
    expect(JSON.stringify(db.query("SELECT * FROM settings").all())).not.toContain("super-secret");
    const d = mgr.describe();
    expect(JSON.stringify(d)).not.toContain("super-secret");
    expect(d.fields.find((f) => f.key === "jiraToken")!.secretSet).toBe(true);
    await mgr.set("jiraToken", null);
    expect(cfg.jira).toBeNull();
    expect(await store.get("jiraToken")).toBeNull();
  });

  test("secrets from the environment still work and are labelled as such", () => {
    const { cfg, mgr } = make({ JIRA_BASE_URL: "https://x", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "env-token-1" });
    expect(cfg.jira?.token).toBe("env-token-1");
    expect(mgr.describe().fields.find((f) => f.key === "jiraToken")!.source).toBe("env");
  });

  test("the API never echoes a secret and the actions log does not store it", async () => {
    const { cfg, db, mgr } = make();
    const api = createApi({ db, cfg, adapters: [], run: demoRunner, settings: mgr });
    const res = await api(new Request("http://x/api/settings", { method: "POST", body: JSON.stringify({ changes: { githubToken: "ghp_topsecret_value", githubUsername: "me" } }) }));
    const text = await res!.text();
    expect(text).not.toContain("ghp_topsecret_value");
    expect(JSON.stringify(db.query("SELECT * FROM actions_log").all())).not.toContain("ghp_topsecret_value");
    expect(cfg.github?.username).toBe("me");
  });
});

describe("settings take effect live", () => {
  const seed = (db: ReturnType<typeof openDb>) => {
    upsertEvents(db, demoEvents(now));
  };
  const flagsOf = (db: any, key: string) => rebuildItems(db, { now, staleDays: cfgNow.staleDays, replyHours: cfgNow.replyHours }).find((i) => i.itemKey === key)?.flags ?? [];
  let cfgNow = loadConfig({});

  test("reply-owed hours change the needs_reply flag", async () => {
    const { cfg, db, mgr } = make();
    cfgNow = cfg;
    seed(db);
    expect(flagsOf(db, "chat:120363@g.us")).toContain("needs_reply"); // 4h default, message is 6h old
    await mgr.set("replyHours", 12);
    expect(flagsOf(db, "chat:120363@g.us")).not.toContain("needs_reply");
  });

  test("stale days change the stale flag", async () => {
    const { cfg, db, mgr } = make();
    cfgNow = cfg;
    seed(db);
    expect(flagsOf(db, "ticket:WEB-402")).toContain("stale");
    await mgr.set("staleDays", 30);
    expect(flagsOf(db, "ticket:WEB-402")).not.toContain("stale");
  });

  test("turning a flag off removes it, and an item with no flags leaves the inbox", async () => {
    const { cfg, db, mgr } = make();
    cfgNow = cfg;
    seed(db);
    await mgr.set("disabledFlags", ["review_requested"]);
    const items = rebuildItems(db, { now, staleDays: 5, replyHours: 4 });
    expect(items.find((i) => i.itemKey === "pr:acme/web#1203")!.hidden).toBe(true);
    expect(items.find((i) => i.itemKey === "ticket:PAY-231")!.flags).not.toContain("review_requested");
  });

  test("ignored authors no longer create flags or timeline entries", async () => {
    const { cfg, db, mgr } = make();
    cfgNow = cfg;
    seed(db);
    expect(flagsOf(db, "ticket:API-77")).toContain("unanswered_comment");
    await mgr.set("ignoreAuthors", ["lena park"]);
    expect(flagsOf(db, "ticket:API-77")).not.toContain("unanswered_comment");
  });

  test("new chats default to the configured Claude mode", async () => {
    const { db, mgr } = make();
    expect(getMode(db, "chat:new@g.us")).toBe("manual");
    await mgr.set("chatDefaultMode", "never");
    expect(getMode(db, "chat:new@g.us")).toBe("never");
  });

  test("nag window, days, intervals and on/off", async () => {
    const { cfg, db, mgr } = make();
    const wed3am = new Date(2026, 10, 11, 3, 0).getTime();
    expect(inWorkHours(wed3am, cfg)).toBe(false);
    await mgr.set("workStartHour", 2);
    expect(inWorkHours(wed3am, cfg)).toBe(true);
    await mgr.set("workDays", [1, 2, 4]); // no Wednesday
    expect(inWorkHours(wed3am, cfg)).toBe(false);

    await mgr.set("workDays", null);
    await mgr.set("workStartHour", 8);
    const wed10 = new Date(2026, 10, 11, 10, 0).getTime();
    upsertEvents(db, [{ source: "reminders", sourceId: "rem:1", kind: "reminder", nativeKey: "reminder:1", ticketKey: null, title: "t", author: "R", authorIsMe: false, body: "", url: null, ts: wed10 - 3_600_000, mentionsMe: false, meta: { due: wed10 - 3_600_000, completed: false, reminderId: "1" } }]);
    expect(dueNags(db, cfg, wed10)).toHaveLength(1);
    await mgr.set("nagEnabled", false);
    expect(dueNags(db, cfg, wed10)).toHaveLength(0);
    await mgr.set("nagEnabled", true);
    await mgr.set("nagIntervals", "120"); // first nag only after 2h overdue
    expect(dueNags(db, cfg, wed10)).toHaveLength(0);
  });

  test("snooze and reminder defaults come from settings", async () => {
    const { cfg, db, mgr } = make();
    const api = createApi({ db, cfg, adapters: [], run: demoRunner, settings: mgr });
    await mgr.set("snoozeHours", 1);
    rebuildItems(db, { now, staleDays: 5, replyHours: 4 });
    upsertEvents(db, demoEvents(Date.now()));
    rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
    const before = Date.now();
    await api(new Request("http://x/api/items/ticket:WEB-402/snooze", { method: "POST", body: "{}" }));
    const until = (db.query("SELECT snoozed_until FROM state WHERE item_key = 'ticket:WEB-402'").get() as any).snoozed_until;
    expect(until - before).toBeGreaterThan(3_500_000);
    expect(until - before).toBeLessThan(3_700_000);
  });
});

describe("adapters follow settings without being recreated", () => {
  const issue = { key: "PAY-1", fields: { summary: "S", updated: new Date().toISOString(), assignee: { accountId: "me" }, status: { name: "To Do" } } };

  test("jira: new credentials and a custom JQL are picked up on the next poll", async () => {
    const { cfg, db, mgr } = make();
    const bodies: string[] = [];
    const fake = (async (input: any, init?: any) => {
      const u = String(input);
      if (init?.body) bodies.push(String(init.body));
      const ok = (b: unknown) => new Response(JSON.stringify(b));
      if (u.endsWith("/myself")) return ok({ accountId: "me" });
      if (u.endsWith("/search/jql")) return ok({ issues: [issue] });
      return ok({ comments: [], values: [] });
    }) as any;
    const adapter = createJiraAdapter(() => (cfg.jira ? { ...cfg.jira, fetchImpl: fake } : null));
    expect(adapter.configured()).toBe(false);
    await mgr.set("jiraBaseUrl", "https://x.atlassian.net");
    await mgr.set("jiraEmail", "me@x.com");
    await mgr.set("jiraToken", "tok-12345");
    expect(adapter.configured()).toBe(true);
    await mgr.set("jiraJql", "project = PAY AND status = 'In Review'");
    await pollOnce(db, [adapter], cfg);
    expect(bodies.some((b) => b.includes("project = PAY AND status = 'In Review'"))).toBe(true);
    await mgr.set("jiraJql", null);
    await mgr.set("jiraLookbackDays", 3);
    bodies.length = 0;
    await pollOnce(db, [adapter], cfg);
    expect(bodies.some((b) => b.includes("updated >= -3d"))).toBe(true);
  });

  test("github: query toggles and custom bot list", async () => {
    const { cfg, db, mgr } = make({ GITHUB_TOKEN: "t-1234", GITHUB_USERNAME: "me" });
    const urls: string[] = [];
    const fake = (async (input: any) => (urls.push(decodeURIComponent(String(input))), new Response(JSON.stringify({ items: [] })))) as any;
    const adapter = createGithubAdapter(() => (cfg.github ? { ...cfg.github, fetchImpl: fake } : null));
    await mgr.set("githubMyPrs", false);
    await mgr.set("githubMentions", false);
    await pollOnce(db, [adapter], cfg);
    expect(urls.some((u) => u.includes("review-requested:me"))).toBe(true);
    expect(urls.some((u) => u.includes("author:me"))).toBe(false);
    expect(urls.some((u) => u.includes("mentions:me"))).toBe(false);
    expect(isBot("my-ci", ["my-ci"])).toBe(true);
    expect(isBot("someone[bot]", [])).toBe(true);
    expect(isBot("kai-lin", ["my-ci"])).toBe(false);
  });

  test("whatsapp: 1:1 messages only address me when the setting is on", () => {
    const dm = { id: "d", timestamp: 1, from: "4477@c.us", fromMe: false, body: "hey", _data: { notifyName: "Tom" } };
    expect(parseWahaMessage(dm, { myIds: ["1@c.us"], chatName: "Tom" })!.mentionsMe).toBe(true);
    expect(parseWahaMessage(dm, { myIds: ["1@c.us"], chatName: "Tom", dmAddressesMe: false })!.mentionsMe).toBe(false);
  });
});

describe("api + connection tests", () => {
  test("GET /api/settings lists every field grouped; POST validates and reports per-field errors", async () => {
    const { cfg, db, mgr } = make();
    const api = createApi({ db, cfg, adapters: [], run: demoRunner, settings: mgr });
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await api(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined }));
      return { status: r!.status, json: (await r!.json()) as any };
    };
    const get = await call("GET", "/api/settings");
    expect(get.json.fields.length).toBe(FIELDS.length);
    expect(get.json.groups).toContain("Jira");
    const bad = await call("POST", "/api/settings", { changes: { replyHours: 9999, staleDays: 7 } });
    expect(bad.status).toBe(400);
    expect(bad.json.errors.replyHours).toContain("maximum");
    expect(cfg.staleDays).toBe(7); // the valid one still applied
    const keys = await call("POST", "/api/settings", { changes: { keys: { dismiss: "e" } } });
    expect(keys.status).toBe(200);
    expect((await call("GET", "/api/inbox")).json.ui.keys.dismiss).toBe("e");
  });

  test("jira / github / waha / claude tests report clearly and use read-only calls", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      const u = String(url);
      if (u.includes("/myself")) return new Response(JSON.stringify({ displayName: "Sam" }));
      if (u.endsWith("/user")) return new Response(JSON.stringify({ login: "other-person" }));
      if (u.includes("/api/sessions/")) return new Response(JSON.stringify({ status: "SCAN_QR_CODE" }));
      return new Response("no", { status: 401 });
    }) as any;
    const cfg = loadConfig({ JIRA_BASE_URL: "https://x", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t-1234", GITHUB_TOKEN: "g-1234", GITHUB_USERNAME: "me", WAHA_URL: "http://waha" });
    expect((await testConnection("jira", cfg, { fetchImpl })).message).toBe("Connected as Sam.");
    const gh = await testConnection("github", cfg, { fetchImpl });
    expect(gh.ok).toBe(false);
    expect(gh.message).toContain("other-person");
    const wa = await testConnection("whatsapp", cfg, { fetchImpl });
    expect(wa.ok).toBe(false);
    expect(wa.message).toContain("SCAN_QR_CODE");
    expect(wa.message).toContain("webhook token is empty");
    expect((await testConnection("claude", cfg, { exec: async () => ({ code: 0, out: "2.1.322 (Claude Code)" }) })).ok).toBe(true);
    expect((await testConnection("claude", cfg, { exec: async () => ({ code: 127, out: "not found" }) })).ok).toBe(false);
    expect((await testConnection("jira", loadConfig({}), { fetchImpl })).message).toContain("not configured");
    expect(seen.every((s) => s.startsWith("GET"))).toBe(true);
  });
});
