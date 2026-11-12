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
2. **Checkpoint 2 – Claude.** `claude -p` must be logged in. Press `i`; verdicts should appear. On a WhatsApp chat press `z` (summarise last N) and `c` (draft).
3. **Checkpoint 3 – Reminders + nag.** Grant Automation permission. Make an overdue reminder in "Work Inbox"; confirm the notification fires inside work hours and re-fires at 15/30/60/120/240 min. `scripts/install-launchd.sh` runs it at login.
4. **Checkpoint 4 – WhatsApp.** Follow `SPIKE.md` first. Parsing in `adapters/whatsapp.ts` is written against my memory of WAHA payloads.
5. Jira `t` (transition) and `m` (comment) against a throwaway ticket. Status names differ per project (`JIRA_TRANSITIONS`).

## WhatsApp + Claude: per-chat modes (src/server/chatllm.ts)
- **manual** (default): chat text goes to Claude only when the owner presses a key on that chat (`z` summarise last N, `c` draft).
- **auto**: new settled activity is summarised and a copy-only draft is prepared automatically; auto-judge may include the chat text. Never auto-dismisses and never sends.
- **never**: chat text is never sent, not even on a keypress.
- Summary size: 20/50/100/200/custom (max 500), default 20 and changeable in the UI. Older history is pulled from WAHA with a GET when fewer messages are stored.
- This replaced the old global `ALLOW_CHAT_TO_LLM` switch; consent is now per chat.

## Settings (everything is configurable)
`src/server/settings.ts` holds the schema (FIELDS). Precedence: default < `.env` < saved (SQLite `settings`, keys `cfg.*`). Secrets (Jira/GitHub tokens, WAHA key, webhook token) live in the macOS Keychain (`secrets.ts`; file fallback off-Mac) and are never returned by the API or logged. `ConfigManager` mutates the shared `cfg` in place, adapters read `cfg` per call, rule-affecting saves trigger an immediate rebuild. UI: `src/web/Settings.tsx` (press `,`). Add a new option = add a FIELDS entry + use `cfg.x`.
Verify on the Mac: Settings → each group's "Test ..." button, then the Keychain prompts when saving a token.

## Tunables (also in Settings)
Nag window defaults to 08:00-01:00 every day (`WORK_START_HOUR`, `WORK_END_HOUR`, `WORK_DAYS`); reply-owed hours `REPLY_HOURS`; poll interval `POLL_MINUTES`.
