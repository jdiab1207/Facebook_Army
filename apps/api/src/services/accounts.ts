import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { AccountDto, CreateAccountInput } from "@facebook-army/shared";
import { encryptSecret } from "../crypto.js";
import { db, schema } from "../db/index.js";
import { parseProxyUrl, formatProxyDisplay } from "../proxy.js";
import { profilePathFor } from "../browser/manager.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function toAccountDto(row: typeof schema.accounts.$inferSelect): AccountDto {
  return {
    id: row.id,
    label: row.label,
    clientName: row.clientName,
    facebookName: row.facebookName,
    proxyHost: row.proxyHost,
    proxyPort: row.proxyPort,
    proxyType: row.proxyType,
    timezone: row.timezone,
    locale: row.locale,
    status: row.status as AccountDto["status"],
    lastSeenAt: row.lastSeenAt,
    lastActionAt: row.lastActionAt,
    lastError: row.lastError,
    screenshotUrl: row.lastScreenshot
      ? `/media/${row.lastScreenshot.replace(/^screenshots\//, "screenshots/")}`
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasPassword: Boolean(row.passwordEnc),
  };
}

export function listAccounts(): AccountDto[] {
  return db.select().from(schema.accounts).all().map(toAccountDto);
}

export function getAccount(id: string): AccountDto | null {
  const [row] = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).all();
  return row ? toAccountDto(row) : null;
}

export function createAccount(input: CreateAccountInput): AccountDto {
  const id = nanoid(12);
  let proxyHost: string | null = null;
  let proxyPort: number | null = null;
  let proxyUsername: string | null = null;
  let proxyPasswordEnc: string | null = null;

  if (input.proxyUrl) {
    const parsed = parseProxyUrl(input.proxyUrl);
    proxyHost = parsed.host;
    proxyPort = parsed.port;
    proxyUsername = parsed.username || null;
    proxyPasswordEnc = parsed.password ? encryptSecret(parsed.password) : null;
  } else if (input.proxyHost && input.proxyPort) {
    proxyHost = input.proxyHost;
    proxyPort = input.proxyPort;
    proxyUsername = input.proxyUsername || null;
    proxyPasswordEnc = input.proxyPassword ? encryptSecret(input.proxyPassword) : null;
  }

  db.insert(schema.accounts)
    .values({
      id,
      label: input.label.trim(),
      clientName: input.clientName.trim(),
      facebookName: input.facebookName?.trim() || null,
      proxyHost,
      proxyPort,
      proxyUsername,
      proxyPasswordEnc,
      proxyType: proxyHost ? "isp" : "direct",
      timezone: input.timezone || "America/New_York",
      locale: input.locale || "en-US",
      status: "needs_login",
      passwordEnc: input.password ? encryptSecret(input.password) : null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .run();

  profilePathFor(id);
  return getAccount(id)!;
}

export function updateAccount(
  id: string,
  patch: Partial<CreateAccountInput> & { status?: string; facebookName?: string }
): AccountDto {
  const [existing] = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .all();
  if (!existing) throw new Error("Account not found");

  const next: Partial<typeof schema.accounts.$inferInsert> = {
    updatedAt: nowIso(),
  };

  if (patch.label !== undefined) next.label = patch.label.trim();
  if (patch.clientName !== undefined) next.clientName = patch.clientName.trim();
  if (patch.facebookName !== undefined) next.facebookName = patch.facebookName.trim() || null;
  if (patch.timezone !== undefined) next.timezone = patch.timezone;
  if (patch.locale !== undefined) next.locale = patch.locale;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.password !== undefined) {
    next.passwordEnc = patch.password ? encryptSecret(patch.password) : null;
  }

  if (patch.proxyUrl !== undefined) {
    if (!patch.proxyUrl.trim()) {
      next.proxyHost = null;
      next.proxyPort = null;
      next.proxyUsername = null;
      next.proxyPasswordEnc = null;
      next.proxyType = "direct";
    } else {
      const parsed = parseProxyUrl(patch.proxyUrl);
      next.proxyHost = parsed.host;
      next.proxyPort = parsed.port;
      next.proxyUsername = parsed.username || null;
      next.proxyPasswordEnc = parsed.password ? encryptSecret(parsed.password) : null;
      next.proxyType = "isp";
    }
  }

  db.update(schema.accounts).set(next).where(eq(schema.accounts.id, id)).run();
  return getAccount(id)!;
}

export function deleteAccount(id: string): void {
  db.delete(schema.jobs).where(eq(schema.jobs.accountId, id)).run();
  db.delete(schema.engagement).where(eq(schema.engagement.accountId, id)).run();
  db.delete(schema.watchedPosts).where(eq(schema.watchedPosts.accountId, id)).run();
  db.delete(schema.accounts).where(eq(schema.accounts.id, id)).run();
}

export function setAccountStatus(
  id: string,
  status: string,
  lastError?: string | null
): void {
  db.update(schema.accounts)
    .set({
      status,
      lastError: lastError === undefined ? undefined : lastError,
      updatedAt: nowIso(),
    })
    .where(eq(schema.accounts.id, id))
    .run();
}

export function proxyLabel(account: AccountDto): string | null {
  return formatProxyDisplay(account.proxyHost, account.proxyPort);
}
