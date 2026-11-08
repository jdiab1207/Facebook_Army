import { eq } from "drizzle-orm";
import { config } from "./config.js";
import {
  captureScreenshot,
  getSession,
  shutdownAll,
} from "./browser/manager.js";
import {
  detectCheckpoint,
  postToGroup,
  reactToPost,
  readEngagement,
  replyToComment,
} from "./browser/flows.js";
import { db, schema } from "./db/index.js";
import { setAccountStatus } from "./services/accounts.js";
import {
  dispatchWebhooks,
  listActiveWatchedPosts,
  upsertEngagementComments,
  watchPost,
} from "./services/engagement.js";
import { claimNextJobs, finishJob } from "./services/jobs.js";

let running = false;
let timer: NodeJS.Timeout | null = null;
let engagementTimer: NodeJS.Timeout | null = null;

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function respectGap(accountId: string): Promise<void> {
  const [account] = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .all();
  if (!account?.lastActionAt) return;
  const last = Date.parse(account.lastActionAt);
  if (Number.isNaN(last)) return;
  const wait = config.minActionGapMs - (Date.now() - last);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function runJob(job: typeof schema.jobs.$inferSelect): Promise<void> {
  const payload = parsePayload(job.payloadJson);
  setAccountStatus(job.accountId, "busy");

  try {
    await respectGap(job.accountId);

    if (job.type === "open_login") {
      // Real Chromium window for login / 2FA / captcha — desktop so challenges are usable
      await getSession(job.accountId, {
        headed: true,
        deviceMode: "desktop",
        startUrl: "https://www.facebook.com/login",
      });
      await captureScreenshot(job.accountId);
      setAccountStatus(job.accountId, "needs_login", null);
      finishJob(job.id, "succeeded", {
        note: "Desktop login window opened. Sign in there, then Mark Ready.",
      });
      return;
    }

    if (job.type === "control") {
      await getSession(job.accountId, {
        headed: false,
        startUrl: "https://www.facebook.com/",
      });
      await captureScreenshot(job.accountId);
      const [acct] = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, job.accountId))
        .all();
      if (acct?.status !== "paused" && acct?.status !== "checkpoint") {
        setAccountStatus(
          job.accountId,
          acct?.status === "needs_login" ? "needs_login" : "ready",
          null
        );
      }
      finishJob(job.id, "succeeded", {
        note: "Session ready for embedded control.",
      });
      return;
    }

    if (job.type === "screenshot") {
      const session = await getSession(job.accountId, { headed: false });
      if (await detectCheckpoint(session.page)) {
        setAccountStatus(job.accountId, "checkpoint", "Checkpoint detected");
        finishJob(job.id, "failed", null, "checkpoint_required");
        return;
      }
      const shot = await captureScreenshot(job.accountId);
      setAccountStatus(job.accountId, "ready", null);
      finishJob(job.id, "succeeded", { screenshot: shot });
      return;
    }

    const { page } = await getSession(job.accountId, { headed: false });

    if (await detectCheckpoint(page)) {
      setAccountStatus(job.accountId, "checkpoint", "Checkpoint detected");
      await captureScreenshot(job.accountId);
      finishJob(job.id, "failed", null, "checkpoint_required");
      return;
    }

    let result: Record<string, unknown> = {};

    if (job.type === "post_to_group") {
      const groupUrl = String(payload.groupUrl || "");
      const text = String(payload.text || "");
      if (!groupUrl || !text) throw new Error("groupUrl and text are required");
      const out = await postToGroup(page, groupUrl, text);
      result = out;
      if (out.postUrl) {
        watchPost(job.accountId, out.postUrl, groupUrl);
      }
    } else if (job.type === "reply_comment") {
      const postUrl = String(payload.postUrl || "");
      const text = String(payload.text || "");
      if (!postUrl || !text) throw new Error("postUrl and text are required");
      result = await replyToComment(
        page,
        postUrl,
        text,
        payload.commentId ? String(payload.commentId) : undefined
      );
    } else if (job.type === "read_engagement") {
      const postUrl = String(payload.postUrl || "");
      if (!postUrl) throw new Error("postUrl is required");
      const out = await readEngagement(page, postUrl);
      const fresh = upsertEngagementComments(job.accountId, postUrl, out.comments);
      result = { comments: out.comments, newCount: fresh.length };
      if (fresh.length) {
        await dispatchWebhooks(job.accountId, "engagement.new", fresh);
      }
    } else if (job.type === "react") {
      const postUrl = String(payload.postUrl || "");
      if (!postUrl) throw new Error("postUrl is required");
      result = await reactToPost(page, postUrl, String(payload.reaction || "like"));
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }

    await captureScreenshot(job.accountId);
    db.update(schema.accounts)
      .set({
        status: "ready",
        lastActionAt: new Date().toISOString(),
        lastError: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.accounts.id, job.accountId))
      .run();

    finishJob(job.id, "succeeded", result);
    await dispatchWebhooks(job.accountId, "job.succeeded", {
      jobId: job.id,
      type: job.type,
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const checkpoint =
      message.includes("checkpoint") ||
      (err as { code?: string })?.code === "checkpoint_required";
    setAccountStatus(job.accountId, checkpoint ? "checkpoint" : "ready", message);
    await captureScreenshot(job.accountId).catch(() => null);
    finishJob(job.id, "failed", null, message);
    await dispatchWebhooks(job.accountId, "job.failed", {
      jobId: job.id,
      type: job.type,
      error: message,
    });
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const jobs = claimNextJobs(config.maxConcurrentJobs);
    await Promise.all(jobs.map((job) => runJob(job)));
  } finally {
    running = false;
  }
}

async function engagementTick(): Promise<void> {
  const watched = listActiveWatchedPosts();
  for (const post of watched) {
    const [account] = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, post.accountId))
      .all();
    if (!account || account.status === "paused" || account.status === "checkpoint") {
      continue;
    }
    try {
      const { page } = await getSession(post.accountId, { headed: false });
      const out = await readEngagement(page, post.postUrl);
      const fresh = upsertEngagementComments(post.accountId, post.postUrl, out.comments);
      db.update(schema.watchedPosts)
        .set({ lastCheckedAt: new Date().toISOString() })
        .where(eq(schema.watchedPosts.id, post.id))
        .run();
      if (fresh.length) {
        await dispatchWebhooks(post.accountId, "engagement.new", fresh);
      }
      await captureScreenshot(post.accountId).catch(() => null);
    } catch {
      // keep watching
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export function startWorker(): void {
  timer = setInterval(() => {
    void tick();
  }, 1500);
  engagementTimer = setInterval(() => {
    void engagementTick();
  }, config.engagementPollMs);
  void tick();
}

export async function stopWorker(): Promise<void> {
  if (timer) clearInterval(timer);
  if (engagementTimer) clearInterval(engagementTimer);
  await shutdownAll();
}
