import { describe, expect, test } from "bun:test";
import { adfMentionIds, adfToText, createJiraAdapter, jiraTransition, parseComment, parseIssue } from "../src/server/adapters/jira";
import { createGithubAdapter, isBot } from "../src/server/adapters/github";
import { pollOnce, getStatuses } from "../src/server/poller";
import { openDb } from "../src/server/db";

const ME = "acc-me-123";
const commentBody = {
  type: "doc", version: 1,
  content: [{ type: "paragraph", content: [
    { type: "mention", attrs: { id: ME, text: "@Me" } }, { type: "text", text: " can you check this?" },
  ] }],
};

describe("jira parsing", () => {
  test("mention nodes are matched by account id, not by name text", () => {
    expect(adfMentionIds(commentBody)).toEqual([ME]);
    expect(adfToText(commentBody).trim()).toBe("@Me can you check this?");
    const issue = { key: "PAY-1", fields: { summary: "S" } };
    const ev = parseComment({ id: "1", author: { displayName: "Dana", accountId: "other" }, body: commentBody, created: "2026-01-01T10:00:00.000+0000" }, issue, ME, "https://x.atlassian.net");
    expect(ev.mentionsMe).toBe(true);
    expect(ev.authorIsMe).toBe(false);
    const notMe = parseComment({ id: "2", author: { accountId: "other" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: "someone-else", text: "@Me" } }] }] } }, issue, ME, "");
    expect(notMe.mentionsMe).toBe(false);
  });
  test("issue snapshot records assignment", () => {
    const ev = parseIssue({ key: "PAY-1", fields: { summary: "S", assignee: { accountId: ME }, status: { name: "In Progress", statusCategory: { key: "indeterminate" } }, updated: "2026-01-01T10:00:00.000+0000" } }, ME, "https://x.atlassian.net");
    expect(ev.meta.assignedToMe).toBe(true);
    expect(ev.url).toBe("https://x.atlassian.net/browse/PAY-1");
  });
});

describe("adapters through the poller", () => {
  test("a failing source is recorded as an error, never silent", async () => {
    const db = openDb(":memory:");
    const jira = createJiraAdapter({ baseUrl: "https://x", email: "a@b.c", token: "t", fetchImpl: (async () => new Response("nope", { status: 401 })) as any });
    await pollOnce(db, [jira], { staleDays: 5, replyHours: 4 });
    const st = getStatuses(db).find((s) => s.source === "jira")!;
    expect(st.ok).toBe(false);
    expect(st.error).toContain("401");
  });

  test("unconfigured adapters are skipped without error", async () => {
    const db = openDb(":memory:");
    await pollOnce(db, [createJiraAdapter(null), createGithubAdapter(null)], { staleDays: 5, replyHours: 4 });
    expect(getStatuses(db)).toEqual([]);
  });

  test("jira end to end with a fake server: mention becomes an item", async () => {
    const fake = (async (input: any) => {
      const u = String(input);
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (u.endsWith("/myself")) return ok({ accountId: ME });
      if (u.endsWith("/search/jql")) return ok({ issues: [{ key: "PAY-1", fields: { summary: "Retries", updated: new Date().toISOString(), assignee: { accountId: "other" }, status: { name: "To Do" } } }] });
      if (u.includes("/comment")) return ok({ comments: [{ id: "7", author: { displayName: "Dana", accountId: "other" }, body: commentBody, created: new Date().toISOString(), updated: new Date().toISOString() }] });
      if (u.includes("/changelog")) return ok({ values: [] });
      return new Response("?", { status: 404 });
    }) as any;
    const db = openDb(":memory:");
    const items = await pollOnce(db, [createJiraAdapter({ baseUrl: "https://x.atlassian.net", email: "me@x.com", token: "t", fetchImpl: fake })], { staleDays: 5, replyHours: 4 });
    const it = items.find((i) => i.itemKey === "ticket:PAY-1")!;
    expect(it.hidden).toBe(false);
    expect(it.flags).toContain("mentions_me");
  });

  test("jira transition matches status names and reports available ones on failure", async () => {
    const calls: string[] = [];
    const fake = (async (input: any, init?: any) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (!init?.method) return new Response(JSON.stringify({ transitions: [{ id: "31", name: "Start", to: { name: "In Progress" } }] }), { status: 200 });
      return new Response(null, { status: 204 });
    }) as any;
    const deps = { baseUrl: "https://x", email: "e", token: "t", fetchImpl: fake };
    expect(await jiraTransition(deps, "PAY-1", "in progress")).toBe("PAY-1 → In Progress");
    await expect(jiraTransition(deps, "PAY-1", "Done")).rejects.toThrow(/Available: In Progress/);
  });
});

describe("github", () => {
  test("bots are ignored", () => {
    expect(isBot("dependabot[bot]")).toBe(true);
    expect(isBot("kai-lin")).toBe(false);
  });
});
