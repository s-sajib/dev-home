/** Cross-source linking by ticket key (PROJ-123) in chat text, PR titles, branch names and commits. */
const KEY_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;
const BRANCH_RE = /(?:^|[/_\s-])([a-z][a-z0-9]{1,9}-\d{1,6})(?=$|[/_\s-])/i;

export function extractTicketKeys(text: string, allowedProjects?: string[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(KEY_RE)) {
    const key = m[1]!;
    const project = key.split("-")[0]!;
    if (allowedProjects?.length && !allowedProjects.includes(project)) continue;
    found.add(key);
  }
  return [...found];
}

/** First strict (uppercase) ticket key found across the given texts. */
export function firstTicketKey(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    if (!t) continue;
    const k = extractTicketKeys(t)[0];
    if (k) return k;
  }
  return null;
}

/** Branch names are often lowercase: feature/proj-123-fix-login */
export function keyFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null;
  const m = branch.match(BRANCH_RE);
  return m ? m[1]!.toUpperCase() : null;
}
