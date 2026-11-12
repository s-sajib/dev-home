# Work Inbox: notes for Claude Code sessions

Personal local-first inbox (Jira + GitHub + WhatsApp + Apple Reminders). Bun + `bun:sqlite` + React. macOS, single user.
Rules that must not be broken: code fetches and flags, Claude (via `claude -p`) only judges and drafts; every write is a logged keypress action; WhatsApp is strictly read-only (no send/reaction/presence/read-receipt anywhere); Jira writes need explicit confirmation.

## Layout
- `src/server/adapters/*` one adapter per source; external-format parsing stays inside the file.
- `rules.ts` flags, `linker.ts` ticket keys, `inbox.ts` items/state, `claude.ts` verdicts+drafts, `nag.ts` reminder nag, `api.ts` HTTP.
- `src/web/*` React UI. `demo.ts` made-up data (`bun run demo`).
- Tests: `bun test` (fixtures only, no network). Typecheck: `bunx tsc --noEmit`.

## What was built without a Mac or real accounts (UNVERIFIED against the real world)
Built and unit-tested in a Linux cloud container with fixtures. Please verify, in this order, and fix what differs from reality:
1. **Checkpoint 1 – Jira + GitHub live.** Fill `.env`, `bun run poll`, then `bun run dev`. Compare the inbox with Jira's bell and GitHub notifications. Check mention detection, review requests, failing checks.
2. **Checkpoint 2 – Claude.** `claude -p` must be logged in. Press `i`; verdicts should appear. Press `c` on a chat (needs `ALLOW_CHAT_TO_LLM=1`).
3. **Checkpoint 3 – Reminders + nag.** Grant Automation permission. Make an overdue reminder in "Work Inbox"; confirm the notification fires inside work hours and re-fires at 15/30/60/120/240 min. `scripts/install-launchd.sh` runs it at login.
4. **Checkpoint 4 – WhatsApp.** Follow `SPIKE.md` first. Parsing in `adapters/whatsapp.ts` is written against my memory of WAHA payloads.
5. Jira `t` (transition) and `m` (comment) against a throwaway ticket. Status names differ per project (`JIRA_TRANSITIONS`).

## Open decisions for the owner
- May client/team chat text go to an LLM? Until `ALLOW_CHAT_TO_LLM=1`, chat text is withheld from prompts and drafting is disabled.
- Work hours (`WORK_START_HOUR`/`WORK_END_HOUR`), reply-owed hours (`REPLY_HOURS`), poll interval (`POLL_MINUTES`).
