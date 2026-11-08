import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");

dotenv.config({ path: path.join(rootDir, ".env") });

function resolveDir(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}

export const config = {
  rootDir,
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "127.0.0.1",
  dataDir: resolveDir(process.env.DATA_DIR, "./data"),
  profilesDir: resolveDir(process.env.PROFILES_DIR, "./profiles"),
  screenshotsDir: resolveDir(process.env.SCREENSHOTS_DIR, "./data/screenshots"),
  masterKey: process.env.MASTER_KEY || "",
  adminToken: process.env.ADMIN_TOKEN || "",
  engagementPollMs: Number(process.env.ENGAGEMENT_POLL_MS || 600_000),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 2),
  minActionGapMs: Number(process.env.MIN_ACTION_GAP_MS || 45_000),
  dashboardDist: path.resolve(rootDir, "apps/dashboard/dist"),
};

export function ensureDirs(): void {
  for (const dir of [config.dataDir, config.profilesDir, config.screenshotsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function assertConfigured(): void {
  if (!config.masterKey || config.masterKey.length < 32) {
    throw new Error(
      "MASTER_KEY missing or too short. Run `npm run setup` from the project root."
    );
  }
  if (!config.adminToken || config.adminToken.length < 16) {
    throw new Error(
      "ADMIN_TOKEN missing. Run `npm run setup` from the project root."
    );
  }
}
