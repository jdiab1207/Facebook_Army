import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { ApiKeyDto } from "@facebook-army/shared";
import { generateApiKey, hashApiKey } from "../crypto.js";
import { db, schema } from "../db/index.js";

function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function toApiKeyDto(row: typeof schema.apiKeys.$inferSelect): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    clientName: row.clientName,
    keyPreview: row.keyPreview,
    accountIds: parseIds(row.accountIdsJson),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function listApiKeys(): ApiKeyDto[] {
  return db.select().from(schema.apiKeys).all().map(toApiKeyDto);
}

export function createApiKey(input: {
  name: string;
  clientName: string;
  accountIds: string[];
}): { key: ApiKeyDto; rawKey: string } {
  const generated = generateApiKey();
  const id = nanoid(12);
  db.insert(schema.apiKeys)
    .values({
      id,
      name: input.name.trim(),
      clientName: input.clientName.trim(),
      keyHash: generated.hash,
      keyPreview: generated.preview,
      accountIdsJson: JSON.stringify(input.accountIds),
      createdAt: new Date().toISOString(),
    })
    .run();

  const [row] = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).all();
  return { key: toApiKeyDto(row!), rawKey: generated.raw };
}

export function deleteApiKey(id: string): void {
  db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id)).run();
}

export function findApiKeyByRaw(raw: string): {
  dto: ApiKeyDto;
  row: typeof schema.apiKeys.$inferSelect;
} | null {
  const hash = hashApiKey(raw);
  const [row] = db
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyHash, hash))
    .all();
  if (!row) return null;
  db.update(schema.apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(schema.apiKeys.id, row.id))
    .run();
  return { dto: toApiKeyDto(row), row };
}

export function keyCanAccess(key: ApiKeyDto, accountId: string): boolean {
  return key.accountIds.includes(accountId);
}
