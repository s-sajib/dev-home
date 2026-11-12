import { firstTicketKey, keyFromBranch } from "../linker";
import type { NormalizedEvent, SourceAdapter } from "../types";

export interface GithubDeps {
  token: string;
  username: string;
  fetchImpl?: typeof fetch;
}

export function createGithubAdapter(deps: GithubDeps | null): SourceAdapter {
  return {
    source: "github",
    configured: () => deps !== null,
    fetch: () => fetchGithub(deps!),
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
  const [reviewing, mine, mentioned] = await Promise.all([
    get(`/search/issues?q=${encodeURIComponent(`is:pr is:open review-requested:${u}`)}&per_page=30`),
    get(`/search/issues?q=${encodeURIComponent(`is:pr is:open author:${u}`)}&per_page=30`),
    get(`/search/issues?q=${encodeURIComponent(`is:pr is:open mentions:${u}`)}&per_page=30`),
  ]);

  const seen = new Map<string, { issue: any; reviewRequested: boolean; mine: boolean }>();
  const add = (issue: any, patch: { reviewRequested?: boolean; mine?: boolean }) => {
    const prev = seen.get(issue.html_url) ?? { issue, reviewRequested: false, mine: false };
    seen.set(issue.html_url, { issue, reviewRequested: prev.reviewRequested || !!patch.reviewRequested, mine: prev.mine || !!patch.mine });
  };
  for (const i of reviewing.items ?? []) add(i, { reviewRequested: true });
  for (const i of mine.items ?? []) add(i, { mine: true });
  for (const i of mentioned.items ?? []) add(i, {});

  const events: NormalizedEvent[] = [];
  for (const { issue, reviewRequested, mine: isMine } of seen.values()) {
    const repo = issue.repository_url.replace("https://api.github.com/repos/", "");
    const n = issue.number;
    const pr = await get(`/repos/${repo}/pulls/${n}`).catch(() => null);
    const ticketKey = firstTicketKey(issue.title, pr?.head?.ref) ?? keyFromBranch(pr?.head?.ref);
    const nativeKey = `pr:${repo}#${n}`;
    const base = { source: "github" as const, nativeKey, ticketKey, title: `${issue.title} (${repo}#${n})`, url: issue.html_url };

    let failing = false;
    if (isMine && pr?.head?.sha) {
      const checks = await get(`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=50`).catch(() => null);
      failing = (checks?.check_runs ?? []).some((c: any) => ["failure", "timed_out", "cancelled"].includes(c.conclusion));
    }
    events.push({
      ...base, sourceId: `pr:${repo}#${n}`, kind: "pr", author: issue.user?.login ?? "", authorIsMe: isMine,
      body: "", ts: Date.parse(issue.updated_at) || Date.now(), mentionsMe: false,
      meta: { mine: isMine, failingChecks: failing, draft: !!pr?.draft },
    });
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
      if (isBot(login)) return;
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
  return events;
}

export function isBot(login: string): boolean {
  return /\[bot\]$|^(dependabot|github-actions|renovate|codecov)/i.test(login);
}
