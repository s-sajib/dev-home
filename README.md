# Work Inbox

A personal, local-first inbox that merges Jira, GitHub, WhatsApp Business and Apple Reminders into one keyboard-driven list of things that need me. Code fetches and flags; Claude (via `claude -p`) only judges and drafts; every outbound action is a keypress I trigger. macOS only, single user.

Stack: Bun, `bun:sqlite`, React. WhatsApp via WAHA (read-only). Reminders via `osascript`.

## Run

```bash
bun install
bun run demo      # made-up data, http://127.0.0.1:3571
bun test
```

Real data: `cp .env.example .env`, fill it in, `bun run dev`. Run at login: `scripts/install-launchd.sh`.
First read `CLAUDE.md` (what is verified vs not) and `SPIKE.md` (WhatsApp and Reminders checks).

## Keys

`j/k` move · `o` open · `a` accept · `d` dismiss · `s` snooze 4h · `r` remind · `x` complete reminder · `t` Jira transition · `m` Jira comment · `c` draft reply · `y` copy draft · `v` group by verdict/lane · `i` judge now · `g` refresh · `u` undo · `?` help

## Status

All PRD v1 requirements (F1–F12) are implemented and unit-tested; live verification on a Mac is the remaining work (see `CLAUDE.md`).
