import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { CreateActionInput, JobDto, JobType } from "@facebook-army/shared";
import { db, schema } from "../db/index.js";

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJobDto(row: typeof schema.jobs.$inferSelect): JobDto {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type as JobType,
    status: row.status as JobDto["status"],
    payload: parseJson(row.payloadJson, {}),
    result: parseJson(row.resultJson, null),
    error: row.error,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function enqueueJob(opts: {
  accountId: string;
  type: JobType;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  createdBy?: string;
}): JobDto {
  if (opts.idempotencyKey) {
    const [existing] = db
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.accountId, opts.accountId),
          eq(schema.jobs.idempotencyKey, opts.idempotencyKey)
        )
      )
      .all();
    if (existing) return toJobDto(existing);
  }

  const id = nanoid(14);
  db.insert(schema.jobs)
    .values({
      id,
      accountId: opts.accountId,
      type: opts.type,
      status: "queued",
      payloadJson: JSON.stringify(opts.payload || {}),
      idempotencyKey: opts.idempotencyKey || null,
      createdBy: opts.createdBy || "admin",
      createdAt: nowIso(),
    })
    .run();

  return getJob(id)!;
}

export function enqueueAction(
  accountId: string,
  input: CreateActionInput,
  createdBy: string
): JobDto {
  const payload: Record<string, unknown> = { ...input };
  delete payload.type;
  delete payload.idempotencyKey;
  return enqueueJob({
    accountId,
    type: input.type,
    payload,
    idempotencyKey: input.idempotencyKey || null,
    createdBy,
  });
}

export function getJob(id: string): JobDto | null {
  const [row] = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).all();
  return row ? toJobDto(row) : null;
}

export function listJobs(limit = 50, accountId?: string): JobDto[] {
  const rows = accountId
    ? db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.accountId, accountId))
        .orderBy(desc(schema.jobs.createdAt))
        .limit(limit)
        .all()
    : db
        .select()
        .from(schema.jobs)
        .orderBy(desc(schema.jobs.createdAt))
        .limit(limit)
        .all();
  return rows.map(toJobDto);
}

export function claimNextJobs(limit: number): Array<typeof schema.jobs.$inferSelect> {
  const queued = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "queued"))
    .orderBy(schema.jobs.createdAt)
    .limit(50)
    .all();

  const claimed: Array<typeof schema.jobs.$inferSelect> = [];
  const busyAccounts = new Set(
    db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.status, "running"))
      .all()
      .map((j) => j.accountId)
  );

  for (const job of queued) {
    if (claimed.length >= limit) break;
    if (busyAccounts.has(job.accountId)) continue;

    const [account] = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, job.accountId))
      .all();
    // Paused accounts: no automated traffic (admin control jobs still allowed)
    if (
      account?.status === "paused" &&
      job.type !== "open_login" &&
      job.type !== "screenshot" &&
      job.type !== "control"
    ) {
      continue;
    }

    db.update(schema.jobs)
      .set({ status: "running", startedAt: nowIso() })
      .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, "queued")))
      .run();
    const [fresh] = db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).all();
    if (fresh?.status === "running") {
      claimed.push(fresh);
      busyAccounts.add(job.accountId);
    }
  }
  return claimed;
}

export function cancelQueuedJobsForAccount(accountId: string): number {
  const queued = db
    .select()
    .from(schema.jobs)
    .where(
      and(eq(schema.jobs.accountId, accountId), eq(schema.jobs.status, "queued"))
    )
    .all();
  for (const job of queued) {
    db.update(schema.jobs)
      .set({
        status: "cancelled",
        error: "Traffic stopped by admin",
        finishedAt: nowIso(),
      })
      .where(eq(schema.jobs.id, job.id))
      .run();
  }
  return queued.length;
}

export function finishJob(
  id: string,
  status: "succeeded" | "failed" | "cancelled",
  result?: Record<string, unknown> | null,
  error?: string | null
): void {
  db.update(schema.jobs)
    .set({
      status,
      resultJson: result ? JSON.stringify(result) : null,
      error: error || null,
      finishedAt: nowIso(),
    })
    .where(eq(schema.jobs.id, id))
    .run();
}

export function jobCounts(): { queued: number; running: number } {
  const queued = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "queued"))
    .all().length;
  const running = db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "running"))
    .all().length;
  return { queued, running };
}

export function recentJobsForAccounts(accountIds: string[], limit = 20): JobDto[] {
  if (!accountIds.length) return [];
  return db
    .select()
    .from(schema.jobs)
    .where(inArray(schema.jobs.accountId, accountIds))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit)
    .all()
    .map(toJobDto);
}
