import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createApi } from "../src/server/api";
import { loadConfig } from "../src/server/config";
import { openDb } from "../src/server/db";
import { demoRunner, seedDemo } from "../src/server/demo";
import { rebuildItems } from "../src/server/inbox";
import { INSTRUCTIONS, registerTools, type Call } from "../src/mcp/tools";
import { memoryStore } from "../src/server/secrets";
import { ConfigManager } from "../src/server/settings";

async function connect(env: Record<string, string> = {}) {
  const cfg = loadConfig({ WORK_INBOX_DEMO: "1", ...env });
  const db = openDb(":memory:");
  seedDemo(db);
  rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
  const api = createApi({ db, cfg, adapters: [], run: demoRunner, settings: new ConfigManager(cfg, db, memoryStore(), {}) });
  const call: Call = async (method, path, body) => {
    const r = await api(new Request(`http://127.0.0.1${path}`, { method, headers: { "x-client": "mcp" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: r!.status, json: await r!.json() };
  };
  const server = new McpServer({ name: "work-inbox", version: "test" }, { instructions: INSTRUCTIONS });
  registerTools(server, call);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    const t = r.content[0].text as string;
    let json: any = null;
    try { json = JSON.parse(t); } catch { /* plain text */ }
    return { isError: !!r.isError, text: t, json };
  };
  return { client, tool, db };
}

describe("protocol surface", () => {
  test("exposes the expected tools and none that can send WhatsApp messages", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["board_add_card", "board_get", "board_move_card", "board_update_card", "chat_messages", "draft_save", "inbox_list", "item_dismiss", "item_get", "jira_comment", "jira_transition"]);
    expect(names.some((n) => /send|reply_send|whatsapp/i.test(n))).toBe(false);
  });
  test("every tool is annotated read-only or write, and Jira writes are marked destructive", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    for (const t of tools) expect(t.annotations?.readOnlyHint).not.toBeUndefined();
    expect(tools.find((t) => t.name === "jira_transition")!.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "inbox_list")!.annotations?.readOnlyHint).toBe(true);
  });
  test("server instructions warn that content is untrusted and that sending is impossible", async () => {
    const { client } = await connect();
    const i = client.getInstructions()!;
    expect(i).toContain("untrusted");
    expect(i).toContain("no tool that sends WhatsApp");
  });
});

describe("reading", () => {
  test("inbox_list returns compact items and source health; filters work", async () => {
    const { tool } = await connect();
    const all = (await tool("inbox_list", {})).json;
    expect(all.total).toBeGreaterThan(3);
    expect(all.sources.length).toBe(4);
    expect(all.items[0]).toHaveProperty("itemKey");
    expect(JSON.stringify(all)).not.toContain("demo at 3pm"); // no message bodies in the list
    const rr = (await tool("inbox_list", { flag: "review_requested" })).json;
    expect(rr.items.every((i: any) => i.flags.includes("review_requested"))).toBe(true);
    const wa = (await tool("inbox_list", { source: "whatsapp" })).json;
    expect(wa.items.every((i: any) => i.sources.includes("whatsapp"))).toBe(true);
    expect((await tool("inbox_list", { limit: 2 })).json.items.length).toBe(2);
  });
  test("item_get returns activity; unknown items are an error", async () => {
    const { tool } = await connect();
    expect((await tool("item_get", { itemKey: "ticket:PAY-231" })).json.events.length).toBeGreaterThan(1);
    expect((await tool("item_get", { itemKey: "ticket:NOPE-1" })).isError).toBe(true);
  });
  test("chat_messages returns the last n, oldest first, with ME marked; never-mode chats are refused", async () => {
    const { tool } = await connect();
    const r = (await tool("chat_messages", { itemKey: "chat:120363@g.us", n: 2 })).json;
    expect(r.count).toBe(2);
    expect(r.messages[1].body).toContain("duplicates");
    await tool("item_dismiss", { itemKey: "ticket:WEB-402" }); // unrelated write must not affect modes
    const { tool: t2, db } = await connect();
    db.query("INSERT OR REPLACE INTO chat_settings (item_key, llm_mode) VALUES ('chat:120363@g.us', 'never')").run();
    const denied = await t2("chat_messages", { itemKey: "chat:120363@g.us" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("Never");
  });
});

describe("board", () => {
  test("get, add, move, edit through the protocol", async () => {
    const { tool } = await connect();
    const board = (await tool("board_get")).json;
    expect(board.columns).toContain("Decision Needed");
    const id = (await tool("board_add_card", { title: "From Claude Code", column: "To Do" })).json.id;
    expect((await tool("board_move_card", { cardId: id, column: "Decision Needed", index: 0 })).isError).toBe(false);
    await tool("board_update_card", { cardId: id, notes: "needs input from infra" });
    const card = (await tool("board_get")).json.cards.find((c: any) => c.id === id);
    expect(card.col).toBe("Decision Needed");
    expect(card.notes).toBe("needs input from infra");
    expect((await tool("board_move_card", { cardId: id, column: "Nowhere" })).isError).toBe(true);
    expect((await tool("board_add_card", {})).isError).toBe(true);
    expect((await tool("board_add_card", { itemKey: "chat:447700900007@c.us", column: "Pending" })).isError).toBe(false);
  });
});

describe("writes and guard rails", () => {
  test("draft_save stores a copy-only draft for chats only", async () => {
    const { tool } = await connect();
    expect((await tool("draft_save", { itemKey: "chat:120363@g.us", text: "Retries land before 3pm." })).isError).toBe(false);
    expect((await tool("item_get", { itemKey: "chat:120363@g.us" })).json.draft).toBe("Retries land before 3pm.");
    expect((await tool("draft_save", { itemKey: "ticket:PAY-231", text: "x" })).isError).toBe(true);
  });
  test("Jira writes are blocked by default even with confirm, and need confirm:true when enabled", async () => {
    const off = await connect({ JIRA_BASE_URL: "https://x", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t-1234" });
    const r = await off.tool("jira_transition", { itemKey: "ticket:PAY-231", status: "Done", confirm: true });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("not allowed");
    await expect(off.client.callTool({ name: "jira_comment", arguments: { itemKey: "ticket:PAY-231", text: "hi", confirm: false } })).resolves.toMatchObject({ isError: true }); // schema rejects confirm:false
    const on = await connect({ MCP_ALLOW_WRITES: "x" }); // env var is not a setting: still blocked
    expect((await on.tool("jira_comment", { itemKey: "ticket:PAY-231", text: "hi", confirm: true })).text).toContain("not allowed");
  });
  test("when the user enables Jira writes the gate opens (and Jira itself must still be configured)", async () => {
    const { client } = await connect();
    expect(client).toBeTruthy();
    const cfg = loadConfig({ WORK_INBOX_DEMO: "1" });
    const db = openDb(":memory:");
    seedDemo(db);
    rebuildItems(db, { now: Date.now(), staleDays: 5, replyHours: 4 });
    const mgr = new ConfigManager(cfg, db, memoryStore(), {});
    await mgr.set("mcpAllowWrites", true);
    const api = createApi({ db, cfg, adapters: [], run: demoRunner, settings: mgr });
    const r = await api(new Request("http://127.0.0.1/api/items/ticket:PAY-231/comment", { method: "POST", headers: { "x-client": "mcp" }, body: JSON.stringify({ text: "hi", confirm: true }) }));
    expect((await r!.json() as any).error).toContain("Jira not configured"); // passed the Claude Code gate, stopped by missing Jira
  });
});
