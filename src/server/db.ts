import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database;

/** Append-only. Never edit or reorder an existing entry. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    native_key TEXT NOT NULL,
    ticket_key TEXT,
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    author_is_me INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    url TEXT,
    ts INTEGER NOT NULL,
    mentions_me INTEGER NOT NULL DEFAULT 0,
    meta TEXT NOT NULL DEFAULT '{}',
    UNIQUE (source, source_id)
  );
  CREATE INDEX events_ticket ON events (ticket_key);
  CREATE INDEX events_native ON events (native_key);

  CREATE TABLE items (
    item_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    ticket_key TEXT,
    sources TEXT NOT NULL,
    flags TEXT NOT NULL,
    last_activity INTEGER NOT NULL,
    url TEXT,
    verdict TEXT,
    reason TEXT,
    verdict_for_activity INTEGER
  );

  CREATE TABLE state (
    item_key TEXT PRIMARY KEY,
    dismissed_at_activity INTEGER,
    snoozed_until INTEGER,
    last_seen_activity INTEGER
  );

  CREATE TABLE drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE reminder_links (
    reminder_id TEXT PRIMARY KEY,
    item_key TEXT,
    last_nudged_at INTEGER,
    nudge_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE actions_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    item_key TEXT,
    action TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '{}',
    ok INTEGER NOT NULL,
    result TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE source_status (
    source TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    last_poll_at INTEGER,
    error TEXT,
    banner TEXT
  );
  `,
];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.query("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | null;
  const current = row?.version ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.exec("DELETE FROM schema_version");
      db.query("INSERT INTO schema_version (version) VALUES (?)").run(i + 1);
    })();
  }
}
