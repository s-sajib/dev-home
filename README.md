# Work Inbox

A personal, local-first inbox that merges Jira, GitHub, WhatsApp Business and Apple Reminders into one keyboard-driven list of things that need me. Code fetches and flags; Claude only judges and drafts; every outbound action is a keypress I trigger. macOS only, single user.

Stack: Bun, `bun:sqlite`, React. WhatsApp via WAHA (read-only).

## Run

```bash
bun install
bun run demo      # made-up data, http://127.0.0.1:3571
bun test
```

Real data: copy `.env.example` to `.env` and fill in Jira / GitHub credentials, then `bun run dev`.

## Status

- [x] Core: schema, events, rules, ticket-key linker, dismiss/snooze/resurface
- [x] Jira adapter (REST, mention detection by account id), GitHub adapter
- [x] Keyboard inbox UI, Jira transition/comment API
- [ ] Reminders + nag, WAHA/WhatsApp, Claude verdicts and drafts
