# Block-1 spikes (run on your Mac)

These could not be run in the cloud build. Each has a pass criterion and a decided fallback.

## 1. WAHA pairing with the Business app (kill switch for WhatsApp)
1. `cp .env.example .env`, set `WAHA_API_KEY` and `WAHA_WEBHOOK_TOKEN` (any long random strings).
2. `docker compose -f docker-compose.waha.yml up -d`, open http://localhost:3000, start session `default`, scan the QR (Business app → Linked devices).
3. Pass: session status is `WORKING`.
   Fail: drop WhatsApp from v1. Everything else ships without it (leave `WAHA_URL` unset).
   Note: if the env var names in `docker-compose.waha.yml` are rejected by your WAHA version, fix them from WAHA's docs; they were written from memory.

## 2. Payload shapes (mentions, LID, own replies)
1. `bun scripts/spike-waha.ts` and point `WHATSAPP_HOOK_URL` at `http://host.docker.internal:3580/` (restart the container).
2. From another phone: @mention you in a group, quote-reply one of your messages, send you a DM. From your own phone: send a message in a group.
3. Look at `data/spike/*.json` and the console summary.
   - Pass: group mention shows your phone JID or LID in `mentionedIds` / `contextInfo.mentionedJid`; your own phone message arrives with `fromMe=true`.
   - Put every id of yours you see (phone JID and LID) into `WA_MY_IDS` (comma separated).
   - Fail (own messages missing): needs-reply cannot work. Decide: drop the needs-reply flag, keep the rest.
   - If a field is somewhere my parser doesn't look, send me the JSON (redact names) and I'll extend `extractContext` in `src/server/adapters/whatsapp.ts`.

## 3. Jira mention detection
`bun run poll` with Jira credentials. Pass: a comment that @mentions you shows the item flagged "Mentions you".
(This uses the REST API directly, so the PRD's `acli` question no longer applies.)

## 4. Reminders access
First run of `bun run dev` triggers a macOS Automation prompt for Reminders (allow it). Pass: reminders in a list called "Work Inbox" appear as items when overdue, and `r` on any item creates one.
