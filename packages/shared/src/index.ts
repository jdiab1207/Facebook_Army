export type AccountStatus =
  | "needs_login"
  | "ready"
  | "checkpoint"
  | "offline"
  | "busy"
  | "paused";

export type JobType =
  | "post_to_group"
  | "reply_comment"
  | "react"
  | "read_engagement"
  | "open_login"
  | "control"
  | "screenshot";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AccountDto {
  id: string;
  label: string;
  clientName: string;
  facebookName: string | null;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyType: string;
  timezone: string;
  locale: string;
  status: AccountStatus;
  lastSeenAt: string | null;
  lastActionAt: string | null;
  lastError: string | null;
  screenshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
  hasPassword: boolean;
}

export interface JobDto {
  id: string;
  accountId: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EngagementDto {
  id: string;
  accountId: string;
  postUrl: string;
  commentId: string | null;
  authorName: string | null;
  text: string | null;
  kind: string;
  seenAt: string;
  raw: Record<string, unknown> | null;
}

export interface CreateAccountInput {
  label: string;
  clientName: string;
  facebookName?: string;
  proxyUrl?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
  timezone?: string;
  locale?: string;
  password?: string;
}

export interface CreateActionInput {
  type: Exclude<JobType, "open_login" | "control" | "screenshot">;
  groupUrl?: string;
  postUrl?: string;
  commentId?: string;
  text?: string;
  reaction?: string;
  idempotencyKey?: string;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  clientName: string;
  keyPreview: string;
  accountIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface StationHealth {
  ok: boolean;
  version: string;
  uptimeSec: number;
  accounts: number;
  readyAccounts: number;
  queuedJobs: number;
  runningJobs: number;
  dataDir: string;
  profilesDir: string;
  platform: string;
}

export const STATION_VERSION = "1.0.0";
