import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { assertConfigured, config, ensureDirs } from "./config.js";
import { migrate } from "./db/index.js";
import { registerRoutes } from "./routes.js";
import { registerWebsocket } from "./ws.js";
import { startWorker, stopWorker } from "./worker.js";

async function main(): Promise<void> {
  ensureDirs();
  assertConfigured();
  migrate();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await registerWebsocket(app);

  // Serve screenshots and other media from data dir
  await app.register(fastifyStatic, {
    root: config.dataDir,
    prefix: "/media/",
    decorateReply: false,
  });

  await registerRoutes(app);

  if (fs.existsSync(config.dashboardDist)) {
    await app.register(fastifyStatic, {
      root: config.dashboardDist,
      prefix: "/",
    });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.url.startsWith("/api") ||
        req.url.startsWith("/v1") ||
        req.url.startsWith("/media") ||
        req.url.startsWith("/ws")
      ) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      message: "Facebook Army API is running. Dashboard not built yet.",
      tip: "Run npm run dev from the repo root for API + Vite dashboard.",
      health: "/api/health",
    }));
  }

  startWorker();

  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  Facebook Army station listening on http://${config.host}:${config.port}`);
  console.log(`  Local:     http://127.0.0.1:${config.port}`);
  if (config.host === "0.0.0.0") {
    console.log(`  Tailscale: http://<your-tailscale-ip>:${config.port}`);
  }
  console.log(`  Profiles:  ${config.profilesDir}`);
  console.log(`  Data:      ${config.dataDir}\n`);

  const shutdown = async () => {
    await stopWorker();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
