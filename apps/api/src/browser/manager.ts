import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { decryptSecret } from "../crypto.js";
import { db, schema } from "../db/index.js";

export type DeviceMode = "mobile" | "desktop";

export interface OpenOptions {
  headed?: boolean;
  startUrl?: string;
  deviceMode?: DeviceMode;
}

export const DEVICE_PRESETS = {
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
} as const;

type LiveSession = {
  context: BrowserContext;
  page: Page;
  headed: boolean;
  deviceMode: DeviceMode;
};

const sessions = new Map<string, LiveSession>();

export function profilePathFor(accountId: string): string {
  const dir = path.join(config.profilesDir, accountId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function screenshotPathFor(accountId: string): string {
  return path.join(config.screenshotsDir, `${accountId}.jpg`);
}

async function buildContext(
  accountId: string,
  headed: boolean,
  deviceMode: DeviceMode
): Promise<BrowserContext> {
  const [account] = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .all();

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const userDataDir = profilePathFor(accountId);
  const proxy =
    account.proxyHost && account.proxyPort
      ? {
          server: `http://${account.proxyHost}:${account.proxyPort}`,
          username: account.proxyUsername || undefined,
          password: account.proxyPasswordEnc
            ? decryptSecret(account.proxyPasswordEnc)
            : undefined,
        }
      : undefined;

  const preset = DEVICE_PRESETS[deviceMode];

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !headed,
    proxy,
    viewport: { ...preset.viewport },
    deviceScaleFactor: preset.deviceScaleFactor,
    isMobile: preset.isMobile,
    hasTouch: preset.hasTouch,
    userAgent: preset.userAgent,
    locale: account.locale || "en-US",
    timezoneId: account.timezone || "America/New_York",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-default-browser-check",
      "--disable-infobars",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  return context;
}

export async function getSession(
  accountId: string,
  opts: OpenOptions = {}
): Promise<LiveSession> {
  const headed = opts.headed ?? false;
  const deviceMode = opts.deviceMode ?? "mobile";
  const existing = sessions.get(accountId);
  if (existing) {
    if (headed !== existing.headed || deviceMode !== existing.deviceMode) {
      await closeSession(accountId);
    } else {
      if (opts.startUrl) {
        await existing.page.goto(opts.startUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
      }
      return existing;
    }
  }

  const context = await buildContext(accountId, headed, deviceMode);
  const page = context.pages()[0] || (await context.newPage());
  if (opts.startUrl) {
    await page.goto(opts.startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else if (page.url() === "about:blank") {
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  const session: LiveSession = { context, page, headed, deviceMode };
  sessions.set(accountId, session);

  context.on("close", () => {
    sessions.delete(accountId);
  });

  return session;
}

export async function closeSession(accountId: string): Promise<void> {
  const existing = sessions.get(accountId);
  if (!existing) return;
  sessions.delete(accountId);
  try {
    await existing.context.close();
  } catch {
    // already closed
  }
}

export async function captureScreenshot(accountId: string): Promise<string | null> {
  const session = sessions.get(accountId);
  if (!session) return null;

  const out = screenshotPathFor(accountId);
  await session.page.screenshot({
    path: out,
    type: "jpeg",
    quality: 62,
    fullPage: false,
  });

  const rel = path.relative(config.dataDir, out).replaceAll("\\", "/");
  db.update(schema.accounts)
    .set({
      lastScreenshot: rel,
      lastSeenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.accounts.id, accountId))
    .run();

  return rel;
}

export function listLiveAccountIds(): string[] {
  return [...sessions.keys()];
}

export function getSessionDeviceMode(accountId: string): DeviceMode | null {
  return sessions.get(accountId)?.deviceMode ?? null;
}

export async function shutdownAll(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.all(ids.map((id) => closeSession(id)));
}
