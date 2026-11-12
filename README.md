# Work Inbox

A personal, local-first inbox and work board that merges Jira, GitHub, WhatsApp Business and Apple Reminders into one keyboard-driven list of things that need me. Code fetches and flags; Claude (via `claude -p`) only judges and drafts; every outbound action is a keypress I trigger. macOS only, single user.

Views: **Inbox** (WhatsApp chats read like conversations), **Board** (configurable pipeline, drag and drop), **Settings**. Claude Code can drive it through MCP: see `docs/PROTOCOL.md`.

Stack: Bun, `bun:sqlite`, React. WhatsApp via WAHA (read-only). Reminders via `osascript`.

## Run

```bash
bun install
bun run demo      # made-up data, http://127.0.0.1:3571
bun run test       # Vitest (runs on Bun)
bun run test:e2e   # Playwright (boots the demo server on :3599)
bun run test:all   # typecheck + unit + e2e
```

Real data: `bun run dev`, open the app, press `,` for **Settings** and fill in Jira, GitHub, WhatsApp and the rest (tokens go to the macOS Keychain). `.env` still works and is optional; saved settings win over it. Everything applies live, no restart (except port/host). Run at login: `scripts/install-launchd.sh`.
First read `CLAUDE.md` (what is verified vs not) and `SPIKE.md` (WhatsApp and Reminders checks).

## Keys

`j/k` move · `o` open · `a` accept · `d` dismiss · `s` snooze 4h · `r` remind · `x` complete reminder · `t` Jira transition · `m` Jira comment · `z` summarise chat (last 20/50/100/200/custom) · `w` cycle Claude mode for a chat (manual → auto → never) · `c` draft reply · `y` copy draft · `v` group by verdict/lane · `i` judge now · `g` refresh · `u` undo · `,` settings · `?` help (every key can be rebound in Settings → Keyboard)

## Status

All PRD v1 requirements (F1–F12) are implemented and unit-tested; live verification on a Mac is the remaining work (see `CLAUDE.md`).

## Credits

Icons: [AnimateIcons](https://animateicons.in) (MIT), whose shapes come from [Lucide](https://lucide.dev) (ISC); their notices ship in `node_modules/@animateicons/react/THIRD_PARTY_NOTICES.md`. Colours and fonts: the "dusk" skin of sajib.website (Schibsted Grotesk, Geist Mono).
