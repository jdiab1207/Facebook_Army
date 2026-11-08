import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { findApiKeyByRaw, keyCanAccess } from "./services/apiKeys.js";
import type { ApiKeyDto } from "@facebook-army/shared";

export type AuthContext =
  | { kind: "admin" }
  | { kind: "apiKey"; key: ApiKeyDto };

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = req.headers["x-admin-token"];
  if (typeof token === "string" && token === config.adminToken) {
    req.auth = { kind: "admin" };
    return;
  }
  reply.code(401).send({ error: "Unauthorized — set X-Admin-Token" });
}

export async function requireApiOrAdmin(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const admin = req.headers["x-admin-token"];
  if (typeof admin === "string" && admin === config.adminToken) {
    req.auth = { kind: "admin" };
    return;
  }

  const apiKeyHeader = req.headers["x-api-key"] || req.headers.authorization;
  let raw: string | undefined;
  if (typeof apiKeyHeader === "string") {
    raw = apiKeyHeader.startsWith("Bearer ")
      ? apiKeyHeader.slice(7)
      : apiKeyHeader;
  }

  if (raw) {
    const found = findApiKeyByRaw(raw);
    if (found) {
      req.auth = { kind: "apiKey", key: found.dto };
      return;
    }
  }

  reply.code(401).send({ error: "Unauthorized — set X-API-Key or X-Admin-Token" });
}

export function assertAccountAccess(
  req: FastifyRequest,
  accountId: string
): boolean {
  if (!req.auth) return false;
  if (req.auth.kind === "admin") return true;
  return keyCanAccess(req.auth.key, accountId);
}
