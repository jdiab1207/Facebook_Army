import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { config, ensureDirs } from "../config.js";
import * as schema from "./schema.js";

ensureDirs();

const dbPath = path.join(config.dataDir, "station.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function migrate(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      client_name TEXT NOT NULL,
      facebook_name TEXT,
      proxy_host TEXT,
      proxy_port INTEGER,
      proxy_username TEXT,
      proxy_password_enc TEXT,
      proxy_type TEXT NOT NULL DEFAULT 'isp',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      locale TEXT NOT NULL DEFAULT 'en-US',
      status TEXT NOT NULL DEFAULT 'needs_login',
      password_enc TEXT,
      last_seen_at TEXT,
      last_action_at TEXT,
      last_error TEXT,
      last_screenshot TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      error TEXT,
      idempotency_key TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_idx
      ON jobs(account_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_preview TEXT NOT NULL,
      account_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS engagement (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      post_url TEXT NOT NULL,
      comment_id TEXT,
      author_name TEXT,
      text TEXT,
      kind TEXT NOT NULL DEFAULT 'comment',
      seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      api_key_id TEXT,
      account_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watched_posts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      post_url TEXT NOT NULL,
      group_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Ensure screenshots dir marker exists for portable installs
  fs.mkdirSync(config.screenshotsDir, { recursive: true });
}

export { schema };
