import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { getAccount } from "./services/accounts.js";
import { attachRemoteClient, stopRemote } from "./browser/remote.js";

export async function registerWebsocket(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get("/ws/session/:id", { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { token?: string; login?: string; mode?: string };
    const token = q.token || "";

    if (!token || token !== config.adminToken) {
      socket.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      socket.close();
      return;
    }

    if (!getAccount(id)) {
      socket.send(JSON.stringify({ type: "error", message: "Account not found" }));
      socket.close();
      return;
    }

    const deviceMode = q.mode === "desktop" ? "desktop" : "mobile";
    void attachRemoteClient(id, socket, {
      startLogin: q.login === "1",
      deviceMode,
    }).catch((err) => {
      socket.send(
        JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        })
      );
      socket.close();
    });
  });

  app.post("/api/accounts/:id/stop-remote", async (req, reply) => {
    const token = req.headers["x-admin-token"];
    if (token !== config.adminToken) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { id } = req.params as { id: string };
    await stopRemote(id);
    return { ok: true };
  });
}
