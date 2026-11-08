import { and, desc, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { EngagementDto } from "@facebook-army/shared";
import { db, schema } from "../db/index.js";

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function toEngagementDto(
  row: typeof schema.engagement.$inferSelect
): EngagementDto {
  return {
    id: row.id,
    accountId: row.accountId,
    postUrl: row.postUrl,
    commentId: row.commentId,
    authorName: row.authorName,
    text: row.text,
    kind: row.kind,
    seenAt: row.seenAt,
    raw: parseJson(row.rawJson),
  };
}

export function listEngagement(opts: {
  accountId: string;
  since?: string;
  limit?: number;
}): EngagementDto[] {
  const rows = opts.since
    ? db
        .select()
        .from(schema.engagement)
        .where(
          and(
            eq(schema.engagement.accountId, opts.accountId),
            gte(schema.engagement.seenAt, opts.since)
          )
        )
        .orderBy(desc(schema.engagement.seenAt))
        .limit(opts.limit || 100)
        .all()
    : db
        .select()
        .from(schema.engagement)
        .where(eq(schema.engagement.accountId, opts.accountId))
        .orderBy(desc(schema.engagement.seenAt))
        .limit(opts.limit || 100)
        .all();
  return rows.map(toEngagementDto);
}

export function upsertEngagementComments(
  accountId: string,
  postUrl: string,
  comments: Array<{ commentId: string; authorName: string; text: string }>
): EngagementDto[] {
  const created: EngagementDto[] = [];
  for (const c of comments) {
    const existing = db
      .select()
      .from(schema.engagement)
      .where(
        and(
          eq(schema.engagement.accountId, accountId),
          eq(schema.engagement.postUrl, postUrl),
          eq(schema.engagement.text, c.text),
          eq(schema.engagement.authorName, c.authorName)
        )
      )
      .all();
    if (existing.length) continue;

    const id = nanoid(12);
    db.insert(schema.engagement)
      .values({
        id,
        accountId,
        postUrl,
        commentId: c.commentId,
        authorName: c.authorName,
        text: c.text,
        kind: "comment",
        seenAt: new Date().toISOString(),
        rawJson: JSON.stringify(c),
      })
      .run();
    const [row] = db
      .select()
      .from(schema.engagement)
      .where(eq(schema.engagement.id, id))
      .all();
    if (row) created.push(toEngagementDto(row));
  }
  return created;
}

export function watchPost(accountId: string, postUrl: string, groupUrl?: string): void {
  const existing = db
    .select()
    .from(schema.watchedPosts)
    .where(
      and(
        eq(schema.watchedPosts.accountId, accountId),
        eq(schema.watchedPosts.postUrl, postUrl)
      )
    )
    .all();
  if (existing.length) return;
  db.insert(schema.watchedPosts)
    .values({
      id: nanoid(12),
      accountId,
      postUrl,
      groupUrl: groupUrl || null,
      active: 1,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export function listActiveWatchedPosts(): Array<typeof schema.watchedPosts.$inferSelect> {
  return db
    .select()
    .from(schema.watchedPosts)
    .where(eq(schema.watchedPosts.active, 1))
    .all();
}

export function registerWebhook(input: {
  url: string;
  apiKeyId?: string;
  accountIds: string[];
}): { id: string; url: string } {
  const id = nanoid(12);
  db.insert(schema.webhooks)
    .values({
      id,
      url: input.url,
      apiKeyId: input.apiKeyId || null,
      accountIdsJson: JSON.stringify(input.accountIds),
      createdAt: new Date().toISOString(),
    })
    .run();
  return { id, url: input.url };
}

export async function dispatchWebhooks(
  accountId: string,
  event: string,
  payload: unknown
): Promise<void> {
  const hooks = db.select().from(schema.webhooks).all();
  for (const hook of hooks) {
    let accountIds: string[] = [];
    try {
      accountIds = JSON.parse(hook.accountIdsJson) as string[];
    } catch {
      accountIds = [];
    }
    if (accountIds.length && !accountIds.includes(accountId)) continue;
    try {
      await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, accountId, payload, at: new Date().toISOString() }),
      });
    } catch {
      // best-effort
    }
  }
}
