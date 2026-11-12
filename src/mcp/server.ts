/**
 * MCP server (stdio) that lets Claude Code use the running Work Inbox app.
 *   claude mcp add work-inbox -- bun /path/to/dev-home/src/mcp/server.ts
 * or just open this repo in Claude Code (see .mcp.json). Talks to the app over its local HTTP API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { INSTRUCTIONS, registerTools, type Call } from "./tools";

const base = (process.env.WORK_INBOX_URL ?? "http://127.0.0.1:3571").replace(/\/$/, "");

const call: Call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", "x-client": "mcp" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const server = new McpServer({ name: "work-inbox", version: "0.1.0" }, { instructions: INSTRUCTIONS });
registerTools(server, call);
await server.connect(new StdioServerTransport());
