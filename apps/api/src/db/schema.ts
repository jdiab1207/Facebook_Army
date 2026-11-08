import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  clientName: text("client_name").notNull(),
  facebookName: text("facebook_name"),
  proxyHost: text("proxy_host"),
  proxyPort: integer("proxy_port"),
  proxyUsername: text("proxy_username"),
  proxyPasswordEnc: text("proxy_password_enc"),
  proxyType: text("proxy_type").notNull().default("isp"),
  timezone: text("timezone").notNull().default("America/New_York"),
  locale: text("locale").notNull().default("en-US"),
  status: text("status").notNull().default("needs_login"),
  passwordEnc: text("password_enc"),
  lastSeenAt: text("last_seen_at"),
  lastActionAt: text("last_action_at"),
  lastError: text("last_error"),
  lastScreenshot: text("last_screenshot"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("queued"),
  payloadJson: text("payload_json").notNull().default("{}"),
  resultJson: text("result_json"),
  error: text("error"),
  idempotencyKey: text("idempotency_key"),
  createdBy: text("created_by"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  clientName: text("client_name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPreview: text("key_preview").notNull(),
  accountIdsJson: text("account_ids_json").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  lastUsedAt: text("last_used_at"),
});

export const engagement = sqliteTable("engagement", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  postUrl: text("post_url").notNull(),
  commentId: text("comment_id"),
  authorName: text("author_name"),
  text: text("text"),
  kind: text("kind").notNull().default("comment"),
  seenAt: text("seen_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  rawJson: text("raw_json"),
});

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  apiKeyId: text("api_key_id"),
  accountIdsJson: text("account_ids_json").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const watchedPosts = sqliteTable("watched_posts", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  postUrl: text("post_url").notNull(),
  groupUrl: text("group_url"),
  active: integer("active").notNull().default(1),
  lastCheckedAt: text("last_checked_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  accountId: text("account_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detailJson: text("detail_json"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
