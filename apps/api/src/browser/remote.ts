import type { CDPSession, Page } from "playwright";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  captureScreenshot,
  DEVICE_PRESETS,
  getSession,
  type DeviceMode,
} from "./manager.js";

type SocketLike = {
  readyState: number;
  OPEN: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
};

type StreamState = {
  accountId: string;
  cdp: CDPSession;
  page: Page;
  sockets: Set<SocketLike>;
  running: boolean;
  deviceMode: DeviceMode;
  viewW: number;
  viewH: number;
};

const streams = new Map<string, StreamState>();

function send(ws: SocketLike, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(state: StreamState, payload: unknown): void {
  const raw = JSON.stringify(payload);
  for (const ws of state.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(raw);
  }
}

async function forceStopStream(accountId: string): Promise<void> {
  const state = streams.get(accountId);
  if (!state) return;
  state.running = false;
  for (const ws of [...state.sockets]) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  state.sockets.clear();
  try {
    await state.cdp.send("Page.stopScreencast");
  } catch {
    // ignore
  }
  try {
    await state.cdp.detach();
  } catch {
    // ignore
  }
  streams.delete(accountId);
}

async function startStream(
  accountId: string,
  deviceMode: DeviceMode,
  startUrl?: string
): Promise<StreamState> {
  const existing = streams.get(accountId);
  if (existing?.running && existing.deviceMode === deviceMode) {
    if (startUrl) {
      await existing.page.goto(startUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    return existing;
  }
  if (existing) {
    await forceStopStream(accountId);
  }

  const preset = DEVICE_PRESETS[deviceMode];
  const session = await getSession(accountId, {
    headed: false,
    deviceMode,
    startUrl,
  });
  const cdp = await session.context.newCDPSession(session.page);

  const state: StreamState = {
    accountId,
    cdp,
    page: session.page,
    sockets: new Set(),
    running: true,
    deviceMode,
    viewW: preset.viewport.width,
    viewH: preset.viewport.height,
  };
  streams.set(accountId, state);

  cdp.on("Page.screencastFrame", (frame) => {
    broadcast(state, {
      type: "frame",
      data: frame.data,
      metadata: frame.metadata,
      vw: state.viewW,
      vh: state.viewH,
      deviceMode: state.deviceMode,
    });
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
  });

  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 55,
    maxWidth: state.viewW * (deviceMode === "mobile" ? 2 : 1),
    maxHeight: state.viewH * (deviceMode === "mobile" ? 2 : 1),
    everyNthFrame: 1,
  });

  db.update(schema.accounts)
    .set({
      lastSeenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.accounts.id, accountId))
    .run();

  return state;
}

async function stopStreamIfEmpty(accountId: string): Promise<void> {
  const state = streams.get(accountId);
  if (!state) return;
  if (state.sockets.size > 0) return;

  state.running = false;
  try {
    await state.cdp.send("Page.stopScreencast");
  } catch {
    // ignore
  }
  try {
    await state.cdp.detach();
  } catch {
    // ignore
  }
  streams.delete(accountId);
  await captureScreenshot(accountId).catch(() => null);
}

function mapCoords(
  x: number,
  y: number,
  displayW: number,
  displayH: number,
  viewW: number,
  viewH: number
) {
  const px = (x / displayW) * viewW;
  const py = (y / displayH) * viewH;
  return {
    x: Math.max(0, Math.min(viewW, px)),
    y: Math.max(0, Math.min(viewH, py)),
  };
}

export async function attachRemoteClient(
  accountId: string,
  ws: SocketLike,
  opts: { startLogin?: boolean; deviceMode?: DeviceMode } = {}
): Promise<void> {
  const deviceMode = opts.deviceMode === "desktop" ? "desktop" : "mobile";
  const startUrl = opts.startLogin
    ? "https://www.facebook.com/login"
    : undefined;

  const state = await startStream(accountId, deviceMode, startUrl);
  state.sockets.add(ws);
  send(ws, {
    type: "ready",
    accountId,
    vw: state.viewW,
    vh: state.viewH,
    deviceMode: state.deviceMode,
  });

  ws.on("message", (...args: unknown[]) => {
    const raw = args[0];
    void (async () => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const page = state.page;
      const type = String(msg.type || "");
      const viewW = state.viewW;
      const viewH = state.viewH;

      try {
        if (type === "pointer") {
          const displayW = Number(msg.displayW || viewW);
          const displayH = Number(msg.displayH || viewH);
          const { x, y } = mapCoords(
            Number(msg.x),
            Number(msg.y),
            displayW,
            displayH,
            viewW,
            viewH
          );
          const kind = String(msg.kind || "click");
          if (kind === "down") {
            await page.mouse.move(x, y);
            await page.mouse.down();
          } else if (kind === "up") {
            await page.mouse.move(x, y);
            await page.mouse.up();
          } else if (kind === "move") {
            await page.mouse.move(x, y);
          } else if (kind === "dblclick") {
            await page.mouse.dblclick(x, y);
          } else {
            await page.mouse.click(x, y);
          }
        } else if (type === "wheel") {
          const displayW = Number(msg.displayW || viewW);
          const displayH = Number(msg.displayH || viewH);
          const { x, y } = mapCoords(
            Number(msg.x),
            Number(msg.y),
            displayW,
            displayH,
            viewW,
            viewH
          );
          await page.mouse.move(x, y);
          await page.mouse.wheel(Number(msg.deltaX || 0), Number(msg.deltaY || 0));
        } else if (type === "key") {
          const kind = String(msg.kind || "press");
          const key = String(msg.key || "");
          if (!key) return;
          if (kind === "down") await page.keyboard.down(key);
          else if (kind === "up") await page.keyboard.up(key);
          else await page.keyboard.press(key);
        } else if (type === "type") {
          const text = String(msg.text || "");
          if (text) await page.keyboard.type(text, { delay: 15 });
        } else if (type === "navigate") {
          const url = String(msg.url || "https://www.facebook.com/");
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        } else if (type === "ping") {
          send(ws, { type: "pong" });
        }
      } catch (err) {
        send(ws, {
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });

  const onClose = () => {
    state.sockets.delete(ws);
    void stopStreamIfEmpty(accountId);
  };
  ws.on("close", onClose);
  ws.on("error", onClose);
}

export function isStreaming(accountId: string): boolean {
  return streams.has(accountId);
}

export async function stopRemote(accountId: string): Promise<void> {
  await forceStopStream(accountId);
  await captureScreenshot(accountId).catch(() => null);
}
