import type { NormalizedEvent, SourceAdapter } from "../types";

/** Atlassian Document Format helpers. Mention nodes carry the account id, which is what "mentions me" matches on. */
export function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "mention":
      return node.attrs?.text ?? "@someone";
    case "hardBreak":
      return "\n";
    case "inlineCard":
      return node.attrs?.url ?? "";
    case "emoji":
      return node.attrs?.text ?? node.attrs?.shortName ?? "";
    case "paragraph":
    case "heading":
      return (node.content ?? []).map(adfToText).join("") + "\n";
    case "listItem":
      return "- " + (node.content ?? []).map(adfToText).join("").trim() + "\n";
    case "codeBlock":
      return "```\n" + (node.content ?? []).map(adfToText).join("") + "\n```\n";
    default:
      return (node.content ?? []).map(adfToText).join("");
  }
}

export function adfMentionIds(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (node.type === "mention" && node.attrs?.id) out.push(String(node.attrs.id));
  for (const c of node.content ?? []) adfMentionIds(c, out);
  return out;
}

export interface JiraDeps {
  baseUrl: string;
  email: string;
  token: string;
  fetchImpl?: typeof fetch;
  lookbackDays?: number;
}

export function createJiraAdapter(deps: JiraDeps | null): SourceAdapter {
  return {
    source: "jira",
    configured: () => deps !== null,
    fetch: (since) => fetchJira(deps!, since),
  };
}

async function fetchJira(d: JiraDeps, since: number | null): Promise<NormalizedEvent[]> {
  const f = d.fetchImpl ?? fetch;
  const auth = "Basic " + Buffer.from(`${d.email}:${d.token}`).toString("base64");
  const call = async (path: string, init?: RequestInit) => {
    const res = await f(`${d.baseUrl}/rest/api/3${path}`, {
      ...init,
      headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Jira ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<any>;
  };

  const me = await call("/myself");
  const myId: string = me.accountId;
  const days = d.lookbackDays ?? 14;
  const jql = `(assignee = currentUser() OR watcher = currentUser() OR reporter = currentUser() OR comment ~ currentUser()) AND updated >= -${days}d ORDER BY updated DESC`;
  const search = await call("/search/jql", {
    method: "POST",
    body: JSON.stringify({ jql, fields: ["summary", "status", "assignee", "updated", "reporter"], maxResults: 50 }),
  });

  const events: NormalizedEvent[] = [];
  for (const issue of search.issues ?? []) {
    events.push(parseIssue(issue, myId, d.baseUrl));
    const updated = Date.parse(issue.fields?.updated ?? "") || 0;
    if (since && updated < since - 60_000) continue; // unchanged since last poll
    const comments = await call(`/issue/${issue.key}/comment?orderBy=-created&maxResults=30`);
    for (const c of comments.comments ?? []) events.push(parseComment(c, issue, myId, d.baseUrl));
    const changelog = await call(`/issue/${issue.key}/changelog?maxResults=30`).catch(() => ({ values: [] }));
    for (const h of changelog.values ?? []) {
      const ev = parseStatusChange(h, issue, myId, d.baseUrl);
      if (ev) events.push(ev);
    }
  }
  return events;
}

export function parseIssue(issue: any, myId: string, baseUrl: string): NormalizedEvent {
  const f = issue.fields ?? {};
  return {
    source: "jira",
    sourceId: `issue:${issue.key}`,
    kind: "ticket",
    nativeKey: `ticket:${issue.key}`,
    ticketKey: issue.key,
    title: `${issue.key} ${f.summary ?? ""}`.trim(),
    author: f.reporter?.displayName ?? "",
    authorIsMe: false,
    body: "",
    url: `${baseUrl}/browse/${issue.key}`,
    ts: Date.parse(f.updated ?? "") || Date.now(),
    mentionsMe: false,
    meta: {
      status: f.status?.name ?? null,
      statusCategory: f.status?.statusCategory?.key ?? null,
      assignedToMe: f.assignee?.accountId === myId,
    },
  };
}

export function parseComment(c: any, issue: any, myId: string, baseUrl: string): NormalizedEvent {
  return {
    source: "jira",
    sourceId: `comment:${issue.key}:${c.id}`,
    kind: "comment",
    nativeKey: `ticket:${issue.key}`,
    ticketKey: issue.key,
    title: `${issue.key} ${issue.fields?.summary ?? ""}`.trim(),
    author: c.author?.displayName ?? "",
    authorIsMe: c.author?.accountId === myId,
    body: adfToText(c.body).trim(),
    url: `${baseUrl}/browse/${issue.key}?focusedCommentId=${c.id}`,
    ts: Date.parse(c.updated ?? c.created ?? "") || Date.now(),
    mentionsMe: adfMentionIds(c.body).includes(myId),
    meta: {},
  };
}

export function parseStatusChange(h: any, issue: any, myId: string, baseUrl: string): NormalizedEvent | null {
  const item = (h.items ?? []).find((i: any) => i.field === "status");
  if (!item) return null;
  return {
    source: "jira",
    sourceId: `status:${issue.key}:${h.id}`,
    kind: "status_change",
    nativeKey: `ticket:${issue.key}`,
    ticketKey: issue.key,
    title: `${issue.key} ${issue.fields?.summary ?? ""}`.trim(),
    author: h.author?.displayName ?? "",
    authorIsMe: h.author?.accountId === myId,
    body: `${item.fromString ?? "?"} → ${item.toString ?? "?"}`,
    url: `${baseUrl}/browse/${issue.key}`,
    ts: Date.parse(h.created ?? "") || Date.now(),
    mentionsMe: false,
    meta: { from: item.fromString, to: item.toString },
  };
}

// ---- actions (on my keypress, logged by the caller) ----
export async function jiraTransition(d: JiraDeps, key: string, statusName: string): Promise<string> {
  const f = d.fetchImpl ?? fetch;
  const auth = "Basic " + Buffer.from(`${d.email}:${d.token}`).toString("base64");
  const headers = { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" };
  const tr = await f(`${d.baseUrl}/rest/api/3/issue/${key}/transitions`, { headers });
  if (!tr.ok) throw new Error(`Jira ${tr.status} listing transitions`);
  const list = ((await tr.json()) as any).transitions as { id: string; name: string; to?: { name: string } }[];
  const hit = list.find((t) => t.to?.name.toLowerCase() === statusName.toLowerCase() || t.name.toLowerCase() === statusName.toLowerCase());
  if (!hit) throw new Error(`No transition to "${statusName}". Available: ${list.map((t) => t.to?.name ?? t.name).join(", ")}`);
  const res = await f(`${d.baseUrl}/rest/api/3/issue/${key}/transitions`, {
    method: "POST", headers, body: JSON.stringify({ transition: { id: hit.id } }),
  });
  if (!res.ok) throw new Error(`Jira ${res.status} transitioning: ${(await res.text()).slice(0, 200)}`);
  return `${key} → ${hit.to?.name ?? hit.name}`;
}

export async function jiraComment(d: JiraDeps, key: string, text: string): Promise<string> {
  const f = d.fetchImpl ?? fetch;
  const auth = "Basic " + Buffer.from(`${d.email}:${d.token}`).toString("base64");
  const body = { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] } };
  const res = await f(`${d.baseUrl}/rest/api/3/issue/${key}/comment`, {
    method: "POST",
    headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jira ${res.status} commenting: ${(await res.text()).slice(0, 200)}`);
  return `commented on ${key}`;
}
