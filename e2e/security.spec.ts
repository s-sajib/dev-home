import { expect, test } from "@playwright/test";

test("the API refuses foreign origins, rebinding hosts and cross-site fetches", async ({ request }) => {
  const base = "http://127.0.0.1:3599";
  const post = (headers: Record<string, string>) => request.post(`${base}/api/board/cards`, { headers, data: { title: "x" } });
  expect((await post({ Origin: "https://evil.example" })).status()).toBe(403);
  expect((await post({ "Sec-Fetch-Site": "cross-site" })).status()).toBe(403);
  expect((await request.get(`${base}/api/inbox`, { headers: { Host: "evil.example:3599" } })).status()).toBe(403);
  expect((await post({})).ok()).toBeTruthy(); // same-machine clients (Claude Code MCP, curl) still work
});
