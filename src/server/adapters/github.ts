import { firstTicketKey, keyFromBranch } from "../linker";
import type { NormalizedEvent, SourceAdapter } from "../types";
import { current, type Maybe } from "./maybe";

export interface GithubDeps {
  token: string;
  username: string;
  fetchImpl?: typeof fetch;
  /** Extra bot logins to ignore (accounts ending in [bot] are always ignored) */
  bots?: string[];
  reviewRequests?: boolean;
  myPrs?: boolean;
  mentions?: boolean;
  /** Include my recently merged PRs (feeds the board's Merged column) */
  merged?: boolean;
  mergedDays?: number;
  /** Issues assigned to me / mentioning me (open, plus recently closed) */
  issues?: boolean;
}

export function createGithubAdapter(deps: Maybe<GithubDeps>): SourceAdapter {
  return {
    source: "github",
    configured: () => current(deps) !== null,
    fetch: () => fetchGithub(current(deps)!),
  };
}

async function fetchGithub(d: GithubDeps): Promise<NormalizedEvent[]> {
  const f = d.fetchImpl ?? fetch;
  const get = async (url: string) => {
    const res = await f(url.startsWith("http") ? url : `https://api.github.com${url}`, {
      headers: { Authorization: `Bearer ${d.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<any>;
  };
  const u = d.username;
  const search = (q: string) => get(`/search/issues?q=${encodeURIComponent(`is:pr is:open ${q}:${u}`)}&per_page=30`);
  const none = Promise.resolve({ items: [] });
  const since = new Date(Date.now() - (d.mergedDays ?? 14) * 86_400_000).toISOString().slice(0, 10);
  const [reviewing, mine, mentioned, merged] = await Promise.all([
    d.reviewRequests === false ? none : search("review-requested"),
    d.myPrs === false ? none : search("author"),
    d.mentions === false ? none : search("mentions"),
    d.merged === false || d.myPrs === false
      ? none
      : get(`/search/issues?q=${encodeURIComponent(`is:pr is:merged author:${u} merged:>=${since}`)}&per_page=30`),
  ]);

  const seen = new Map<string, { issue: any; reviewRequested: boolean; mine: boolean }>();
  const add = (issue: any, patch: { reviewRequested?: boolean; mine?: boolean }) => {
    const prev = seen.get(issue.html_url) ?? { issue, reviewRequested: false, mine: false };
    seen.set(issue.html_url, { issue, reviewRequested: prev.reviewRequested || !!patch.reviewRequested, mine: prev.mine || !!patch.mine });
  };
  for (const i of reviewing.items ?? []) add(i, { reviewRequested: true });
  for (const i of mine.items ?? []) add(i, { mine: true });
  for (const i of mentioned.items ?? []) add(i, {});
  const mergedUrls = new Set<string>((merged.items ?? []).map((i: any) => i.html_url));
  for (const i of merged.items ?? []) add(i, { mine: true });

  const events: NormalizedEvent[] = [];
  for (const { issue, reviewRequested, mine: isMine } of seen.values()) {
    const repo = issue.repository_url.replace("https://api.github.com/repos/", "");
    const n = issue.number;
    const isMerged = mergedUrls.has(issue.html_url);
    const pr = await get(`/repos/${repo}/pulls/${n}`).catch(() => null);
    const ticketKey = firstTicketKey(issue.title, pr?.head?.ref) ?? keyFromBranch(pr?.head?.ref);
    const nativeKey = `pr:${repo}#${n}`;
    const base = { source: "github" as const, nativeKey, ticketKey, title: `${issue.title} (${repo}#${n})`, url: issue.html_url };

    let failing = false;
    if (isMine && !isMerged && pr?.head?.sha) {
      const checks = await get(`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=50`).catch(() => null);
      failing = (checks?.check_runs ?? []).some((c: any) => ["failure", "timed_out", "cancelled"].includes(c.conclusion));
    }
    events.push({
      ...base, sourceId: `pr:${repo}#${n}`, kind: "pr", author: issue.user?.login ?? "", authorIsMe: isMine,
      body: "", ts: Date.parse(issue.updated_at) || Date.now(), mentionsMe: false,
      meta: { mine: isMine, failingChecks: failing, draft: !!pr?.draft, merged: isMerged },
    });
    if (isMerged) continue; // merged PRs only feed the board; no comments or review flags
    if (reviewRequested) {
      events.push({
        ...base, sourceId: `rr:${repo}#${n}`, kind: "review_request", author: issue.user?.login ?? "", authorIsMe: false,
        body: "Review requested", ts: Date.parse(issue.updated_at) || Date.now(), mentionsMe: true, meta: { open: true },
      });
    }
    const [issueComments, reviewComments, reviews] = await Promise.all([
      get(`/repos/${repo}/issues/${n}/comments?per_page=30`).catch(() => []),
      get(`/repos/${repo}/pulls/${n}/comments?per_page=30`).catch(() => []),
      get(`/repos/${repo}/pulls/${n}/reviews?per_page=30`).catch(() => []),
    ]);
    const push = (c: any, prefix: string, text: string) => {
      const login = c.user?.login ?? "";
      if (isBot(login, d.bots)) return;
      events.push({
        ...base, sourceId: `${prefix}:${repo}#${n}:${c.id}`, kind: "pr_comment", author: login, authorIsMe: login.toLowerCase() === u.toLowerCase(),
        body: text, url: c.html_url ?? base.url, ts: Date.parse(c.updated_at ?? c.submitted_at ?? c.created_at) || Date.now(),
        mentionsMe: new RegExp(`@${u}\\b`, "i").test(text), meta: {},
      });
    };
    for (const c of issueComments) push(c, "ic", c.body ?? "");
    for (const c of reviewComments) push(c, "rc", c.body ?? "");
    for (const r of reviews) if (r.body) push(r, "rv", r.body);
  }
  if (d.issues !== false) events.push(...(await fetchIssues(d, get, since)));
  return events;
}

/** GitHub issues: assigned to me or mentioning me. Open ones are work; recently closed ones update their card. */
async function fetchIssues(d: GithubDeps, get: (url: string) => Promise<any>, since: string): Promise<NormalizedEvent[]> {
  const u = d.username;
  const q = (extra: string) => get(`/search/issues?q=${encodeURIComponent(`is:issue ${extra}`)}&per_page=30`).catch(() => ({ items: [] }));
  const [assignedOpen, assignedClosed, mentioned] = await Promise.all([
    q(`is:open assignee:${u}`),
    q(`is:closed assignee:${u} closed:>=${since}`),
    d.mentions === false ? Promise.resolve({ items: [] }) : q(`is:open mentions:${u}`),
  ]);
  const seen = new Map<string, any>();
  for (const i of [...(mentioned.items ?? []), ...(assignedClosed.items ?? []), ...(assignedOpen.items ?? [])]) seen.set(i.html_url, i);
  const out: NormalizedEvent[] = [];
  for (const issue of seen.values()) {
    if (issue.pull_request) continue; // PRs come from the PR queries
    const repo = issue.repository_url.replace("https://api.github.com/repos/", "");
    const n = issue.number;
    const nativeKey = `issue:${repo}#${n}`;
    const assignedToMe = (issue.assignees ?? []).some((a: any) => String(a.login).toLowerCase() === u.toLowerCase()) || String(issue.assignee?.login).toLowerCase() === u.toLowerCase();
    const ticketKey = firstTicketKey(issue.title) ?? null;
    const title = `${issue.title} (${repo}#${n})`;
    const ts = Date.parse(issue.updated_at) || Date.now();
    out.push({ source: "github", sourceId: nativeKey, kind: "issue", nativeKey, ticketKey, title, author: issue.user?.login ?? "", authorIsMe: false, body: "", url: issue.html_url, ts, mentionsMe: false,
      meta: { assignedToMe, state: issue.state, labels: (issue.labels ?? []).map((l: any) => String(l.name ?? l).toLowerCase()) } });
    if (issue.state === "closed") continue;
    const comments = await get(`/repos/${repo}/issues/${n}/comments?per_page=20`).catch(() => []);
    for (const c of comments) {
      const login = c.user?.login ?? "";
      if (isBot(login, d.bots)) continue;
      out.push({ source: "github", sourceId: `ic:${repo}#${n}:${c.id}`, kind: "comment", nativeKey, ticketKey, title, author: login, authorIsMe: login.toLowerCase() === u.toLowerCase(), body: c.body ?? "", url: c.html_url ?? issue.html_url,
        ts: Date.parse(c.updated_at ?? c.created_at) || Date.now(), mentionsMe: new RegExp(`@${u}\\b`, "i").test(c.body ?? ""), meta: {} });
    }
  }
  return out;
}

const DEFAULT_BOTS = ["dependabot", "github-actions", "renovate", "codecov"];
export function isBot(login: string, bots: string[] = DEFAULT_BOTS): boolean {
  const l = login.toLowerCase();
  return l.endsWith("[bot]") || bots.some((b) => b.trim() && l === b.trim().toLowerCase().replace(/\[bot\]$/, ""));
}
