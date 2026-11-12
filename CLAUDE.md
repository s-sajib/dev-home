# Work Inbox: notes for Claude Code sessions

Personal local-first inbox (Jira + GitHub + WhatsApp + Apple Reminders). Bun + `bun:sqlite` + React. macOS, single user.
Rules that must not be broken: code fetches and flags, Claude (via `claude -p`) only judges and drafts; every write is a logged keypress action; WhatsApp is strictly read-only (no send/reaction/presence/read-receipt anywhere); Jira writes need explicit confirmation.

## Layout
- `src/server/adapters/*` one adapter per source; external-format parsing stays inside the file.
- `rules.ts` flags, `linker.ts` ticket keys, `inbox.ts` items/state, `claude.ts` verdicts+drafts, `nag.ts` reminder nag, `api.ts` HTTP.
- `src/web/*` React UI. `demo.ts` made-up data (`bun run demo`).
- Tests: `bun run test` (Vitest on Bun, fixtures only, no network), `bun run test:e2e` (Playwright vs the demo server, reset via `POST /api/demo/reset`), typecheck `bunx tsc --noEmit`.
- Design: tokens in `src/web/styles.css` are the 'dusk' skin of sajib.website (same hex values, Schibsted Grotesk + Geist Mono self-hosted in `src/web/fonts`). Change colours there only.
- UI follows OOUX: five objects (Ticket, Pull request, Conversation, Reminder, Note) each with ONE glyph, ONE why-line, ONE verb row, rendered by the same components everywhere (`src/web/objects.tsx`: ObjectRow, Verbs, Glyph, related). Relationships are clickable. Less is more: no chip stacks, urgency is a lamp dot, key hints show on hover, Claude controls live in one menu.
- Radix primitives (Dialog, Popover, Tooltip, ToggleGroup, Switch) wrapped in `src/web/ui.tsx` for focus handling and a11y; Motion (`motion/react`) does all movement: shared-layout selection pill, AnimatePresence exits that slide siblings up, board cards travelling between columns (`layoutId`), variant-driven icons (`objects.tsx` Glyph), dialog/drawer/menu/toast enter+exit, sliding segmented pills. `MotionConfig reducedMotion="user"` honours the OS setting. Looks live in styles.css; keep it quiet. Only button press feedback stays CSS.
- Icons are AnimateIcons (`src/web/icons.tsx`, imported per file). Play them with `useIconHover()` on the parent (`ref` + `triggerProps`) or `startAnimation()`; objects get one icon per kind (`Glyph`). Add icons there, don't hand-draw SVG.
- macOS feel lives in styles.css tokens: `--material` + `--blur` for sidebar/toolbar/menus/sheets, `--hair` hairlines, `--shadow-1..3`, `--btn` bordered buttons, accent-gradient primary buttons, macOS-style segmented control/switch, 3px focus ring, overlay scrollbars. Reuse these instead of new one-off shadows.
- Board: `src/server/board.ts`; columns/status map are Settings. A manual move pins a card; moves are local and never write to Jira.

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

## Performance and resilience rules (learned the hard way under `demo:harsh`)
- Serve the production bundle (dev mode = `WORK_INBOX_DEV=1`); React's dev build alone was ~5x slower with 250 rows.
- Lists: rows are `memo`ised and read selection from `selection.ts` (external store), so a keypress re-renders two rows, not hundreds. Layout animation (`layout` props) only when a list/board is small (<=80 rows, <=60 cards). Don't put `layout` on every item.
- Animated icons mount lazily via IntersectionObserver (`Glyph`). `content-visibility: auto` on rows, cards and columns.
- All client requests go through `net.ts` `call()`: it never throws, times out, drives the "Can't reach the app" banner and backoff retry. Don't call `fetch` directly in components.
- The server caps request bodies at 1 MB; the UI renders only the latest 120 messages of a chat.
- Narrow windows: <=1000px the rail is icons, <=860px the split stacks. Keep `.detail` > 280px wide.
- Measured on the harsh dataset (headless Chromium, no GPU): navigation key to paint p50 ~28 ms / p95 ~90 ms; switching Inbox<->Board ~190 ms.

## Claude Code protocol (MCP)
`src/mcp/*` + `.mcp.json`; spec in `docs/PROTOCOL.md`. Tools map 1:1 to REST endpoints; there is no tool that sends WhatsApp. If you are Claude Code working in this repo you can use the `work-inbox` tools against the running app (`bun run dev`).

## Settings (everything is configurable)
`src/server/settings.ts` holds the schema (FIELDS). Precedence: default < `.env` < saved (SQLite `settings`, keys `cfg.*`). Secrets (Jira/GitHub tokens, WAHA key, webhook token) live in the macOS Keychain (`secrets.ts`; file fallback off-Mac) and are never returned by the API or logged. `ConfigManager` mutates the shared `cfg` in place, adapters read `cfg` per call, rule-affecting saves trigger an immediate rebuild. UI: `src/web/Settings.tsx` (press `,`). Add a new option = add a FIELDS entry + use `cfg.x`.
Verify on the Mac: Settings → each group's "Test ..." button, then the Keychain prompts when saving a token.

## Tunables (also in Settings)
Nag window defaults to 08:00-01:00 every day (`WORK_START_HOUR`, `WORK_END_HOUR`, `WORK_DAYS`); reply-owed hours `REPLY_HOURS`; poll interval `POLL_MINUTES`.
