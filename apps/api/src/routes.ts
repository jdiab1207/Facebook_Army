import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { STATION_VERSION } from "@facebook-army/shared";
import { assertAccountAccess, requireAdmin, requireApiOrAdmin } from "./auth.js";
import { listLiveAccountIds } from "./browser/manager.js";
import { config } from "./config.js";
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "./services/accounts.js";
import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
} from "./services/apiKeys.js";
import {
  listEngagement,
  registerWebhook,
} from "./services/engagement.js";
import {
  cancelQueuedJobsForAccount,
  enqueueAction,
  enqueueJob,
  getJob,
  jobCounts,
  listJobs,
} from "./services/jobs.js";
import { closeSession } from "./browser/manager.js";
import { stopRemote } from "./browser/remote.js";

const createAccountSchema = z.object({
  label: z.string().min(1),
  clientName: z.string().min(1),
  facebookName: z.string().optional(),
  proxyUrl: z.string().optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  password: z.string().optional(),
});

const actionSchema = z.object({
  type: z.enum(["post_to_group", "reply_comment", "react", "read_engagement"]),
  groupUrl: z.string().url().optional(),
  postUrl: z.string().url().optional(),
  commentId: z.string().optional(),
  text: z.string().optional(),
  reaction: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    const accounts = listAccounts();
    const counts = jobCounts();
    return {
      ok: true,
      version: STATION_VERSION,
      uptimeSec: Math.floor(process.uptime()),
      accounts: accounts.length,
      readyAccounts: accounts.filter((a) => a.status === "ready").length,
      queuedJobs: counts.queued,
      runningJobs: counts.running,
      liveBrowsers: listLiveAccountIds().length,
      dataDir: config.dataDir,
      profilesDir: config.profilesDir,
      platform: `${os.platform()} ${os.arch()}`,
      setupComplete: Boolean(config.adminToken && config.masterKey),
    };
  });

  app.get("/api/setup/status", async () => {
    const envPath = path.join(config.rootDir, ".env");
    return {
      configured: fs.existsSync(envPath) && Boolean(config.adminToken),
      accountCount: listAccounts().length,
      hasAdminToken: Boolean(config.adminToken),
      port: config.port,
    };
  });

  // Admin bootstrap: allow from localhost or private/Tailscale networks.
  // Prefer pasting ADMIN_TOKEN when unlocking over untrusted networks.
  app.get("/api/admin/bootstrap", async (req, reply) => {
    const host = req.hostname || "";
    const ip = (req.ip || "").replace(/^::ffff:/, "");
    const allowed =
      host === "localhost" ||
      host === "127.0.0.1" ||
      ip === "127.0.0.1" ||
      ip === "::1" ||
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
      /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(ip); // Tailscale CGNAT

    if (!allowed) {
      return reply.code(403).send({
        error:
          "Auto-unlock blocked on this network. Paste ADMIN_TOKEN from your .env instead.",
      });
    }
    return {
      adminToken: config.adminToken,
      port: config.port,
      tip: "Store this token in the dashboard; it is also in your .env as ADMIN_TOKEN",
    };
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    admin.get("/api/accounts", async () => listAccounts());

    admin.post("/api/accounts", async (req, reply) => {
      const parsed = createAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      try {
        const account = createAccount(parsed.data);
        return reply.code(201).send(account);
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    admin.patch("/api/accounts/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Record<string, unknown>;
      try {
        const account = updateAccount(id, body as never);
        return account;
      } catch (err) {
        return reply.code(404).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    admin.delete("/api/accounts/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      deleteAccount(id);
      return reply.code(204).send();
    });

    admin.post("/api/accounts/:id/login", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!getAccount(id)) return reply.code(404).send({ error: "Not found" });
      // Drop embedded stream so a real login window can take the profile
      await stopRemote(id);
      const job = enqueueJob({
        accountId: id,
        type: "open_login",
        createdBy: "admin",
      });
      return job;
    });

    admin.post("/api/accounts/:id/mark-ready", async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        return updateAccount(id, { status: "ready" });
      } catch (err) {
        return reply.code(404).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    admin.post("/api/accounts/:id/screenshot", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!getAccount(id)) return reply.code(404).send({ error: "Not found" });
      return enqueueJob({
        accountId: id,
        type: "screenshot",
        createdBy: "admin",
      });
    });

    admin.post("/api/accounts/:id/control", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!getAccount(id)) return reply.code(404).send({ error: "Not found" });
      return enqueueJob({
        accountId: id,
        type: "control",
        createdBy: "admin",
      });
    });

    admin.post("/api/accounts/:id/pause", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!getAccount(id)) return reply.code(404).send({ error: "Not found" });
      const cancelled = cancelQueuedJobsForAccount(id);
      await stopRemote(id);
      await closeSession(id);
      const account = updateAccount(id, { status: "paused" });
      return {
        account,
        cancelledJobs: cancelled,
        note: "All traffic stopped for this session. Browser closed.",
      };
    });

    admin.post("/api/accounts/:id/resume", async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        return updateAccount(id, { status: "ready" });
      } catch (err) {
        return reply.code(404).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    admin.post("/api/accounts/:id/close-browser", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!getAccount(id)) return reply.code(404).send({ error: "Not found" });
      await stopRemote(id);
      await closeSession(id);
      return { ok: true };
    });

    admin.get("/api/jobs", async (req) => {
      const q = req.query as { accountId?: string; limit?: string };
      return listJobs(Number(q.limit || 50), q.accountId);
    });

    admin.get("/api/keys", async () => listApiKeys());

    admin.post("/api/keys", async (req, reply) => {
      const body = z
        .object({
          name: z.string().min(1),
          clientName: z.string().min(1),
          accountIds: z.array(z.string()).default([]),
        })
        .safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }
      const created = createApiKey(body.data);
      return reply.code(201).send(created);
    });

    admin.delete("/api/keys/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      deleteApiKey(id);
      return reply.code(204).send();
    });
  });

  // Agent-facing API (admin token OR scoped API key)
  app.register(async (v1) => {
    v1.addHook("preHandler", requireApiOrAdmin);

    v1.get("/v1/accounts", async (req) => {
      const all = listAccounts();
      if (req.auth?.kind === "admin") return all;
      const allowed = new Set(req.auth!.key.accountIds);
      return all.filter((a) => allowed.has(a.id));
    });

    v1.get("/v1/accounts/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!assertAccountAccess(req, id)) {
        return reply.code(403).send({ error: "Forbidden for this account" });
      }
      const account = getAccount(id);
      if (!account) return reply.code(404).send({ error: "Not found" });
      return account;
    });

    v1.post("/v1/accounts/:id/actions", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!assertAccountAccess(req, id)) {
        return reply.code(403).send({ error: "Forbidden for this account" });
      }
      const account = getAccount(id);
      if (!account) return reply.code(404).send({ error: "Not found" });
      if (account.status === "paused") {
        return reply.code(409).send({ error: "Account is paused" });
      }
      if (account.status === "needs_login") {
        return reply.code(409).send({ error: "Account needs login first" });
      }

      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const actor =
        req.auth?.kind === "apiKey" ? `key:${req.auth.key.id}` : "admin";
      const job = enqueueAction(id, parsed.data, actor);
      return reply.code(202).send(job);
    });

    v1.get("/v1/jobs/:jobId", async (req, reply) => {
      const { jobId } = req.params as { jobId: string };
      const job = getJob(jobId);
      if (!job) return reply.code(404).send({ error: "Not found" });
      if (!assertAccountAccess(req, job.accountId)) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      return job;
    });

    v1.get("/v1/accounts/:id/engagement", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!assertAccountAccess(req, id)) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const q = req.query as { since?: string; limit?: string };
      return listEngagement({
        accountId: id,
        since: q.since,
        limit: Number(q.limit || 100),
      });
    });

    v1.post("/v1/webhooks", async (req, reply) => {
      const body = z
        .object({
          url: z.string().url(),
          accountIds: z.array(z.string()).default([]),
        })
        .safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }
      let accountIds = body.data.accountIds;
      if (req.auth?.kind === "apiKey") {
        if (!accountIds.length) accountIds = req.auth.key.accountIds;
        accountIds = accountIds.filter((id) =>
          req.auth!.kind === "apiKey" ? assertAccountAccess(req, id) : true
        );
      }
      const hook = registerWebhook({
        url: body.data.url,
        accountIds,
        apiKeyId: req.auth?.kind === "apiKey" ? req.auth.key.id : undefined,
      });
      return reply.code(201).send(hook);
    });
  });
}
