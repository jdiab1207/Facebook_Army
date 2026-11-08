import type { Page } from "playwright";
import { nanoid } from "nanoid";

async function humanPause(min = 400, max = 1200): Promise<void> {
  const ms = Math.floor(min + Math.random() * (max - min));
  await new Promise((r) => setTimeout(r, ms));
}

async function maybeDismissPopups(page: Page): Promise<void> {
  const candidates = [
    'button:has-text("Allow all cookies")',
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'div[aria-label="Close"]',
    'div[aria-label="Not Now"]',
    'span:has-text("Not Now")',
  ];
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 1500 });
        await humanPause(300, 700);
      }
    } catch {
      // ignore
    }
  }
}

export async function detectCheckpoint(page: Page): Promise<boolean> {
  const url = page.url();
  if (/checkpoint|two_factor|login\/identify|security/i.test(url)) return true;
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return (
    body.includes("confirm your identity") ||
    body.includes("suspicious activity") ||
    body.includes("enter the code") ||
    body.includes("we suspended your account")
  );
}

export async function postToGroup(
  page: Page,
  groupUrl: string,
  text: string
): Promise<{ postUrl: string | null; note: string }> {
  await page.goto(groupUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await humanPause(800, 1600);
  await maybeDismissPopups(page);

  if (await detectCheckpoint(page)) {
    throw Object.assign(new Error("Facebook checkpoint detected"), {
      code: "checkpoint_required",
    });
  }

  // Composer triggers vary across Facebook layouts
  const openers = [
    'div[role="button"]:has-text("Write something")',
    'div[role="button"]:has-text("on your mind")',
    'span:has-text("Write something")',
    'div[aria-label*="Write something"]',
    'div[aria-label*="Create a public post"]',
  ];

  let opened = false;
  for (const sel of openers) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click();
      opened = true;
      break;
    }
  }
  if (!opened) {
    throw new Error("Could not find group composer — Facebook UI may have changed");
  }

  await humanPause(500, 1000);

  const editors = [
    'div[role="dialog"] div[contenteditable="true"]',
    'div[aria-label*="Create a public post"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
  ];

  let typed = false;
  for (const sel of editors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click();
      await humanPause(200, 500);
      await page.keyboard.type(text, { delay: 18 + Math.floor(Math.random() * 25) });
      typed = true;
      break;
    }
  }
  if (!typed) {
    throw new Error("Could not find post text box");
  }

  await humanPause(600, 1200);

  const postButtons = [
    'div[role="dialog"] div[aria-label="Post"]',
    'div[role="dialog"] div[aria-label="Publish"]',
    'div[role="button"]:has-text("Post")',
    'div[aria-label="Post"]',
  ];

  let posted = false;
  for (const sel of postButtons) {
    const el = page.locator(sel).last();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      const disabled = await el.getAttribute("aria-disabled");
      if (disabled === "true") continue;
      await el.click();
      posted = true;
      break;
    }
  }
  if (!posted) {
    throw new Error("Could not click Post");
  }

  await humanPause(2000, 3500);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  // Best-effort: current URL or first permalink-looking link
  let postUrl: string | null = page.url();
  if (!/permalink|posts\//i.test(postUrl)) {
    const link = page.locator('a[href*="/posts/"], a[href*="permalink"]').first();
    if (await link.count()) {
      const href = await link.getAttribute("href");
      if (href) {
        postUrl = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
      }
    } else {
      postUrl = null;
    }
  }

  return {
    postUrl,
    note: postUrl
      ? "Post submitted; URL captured best-effort"
      : "Post submitted; permalink not detected — check the group feed",
  };
}

export async function replyToComment(
  page: Page,
  postUrl: string,
  text: string,
  commentId?: string
): Promise<{ ok: boolean; note: string }> {
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await humanPause(800, 1500);
  await maybeDismissPopups(page);

  if (await detectCheckpoint(page)) {
    throw Object.assign(new Error("Facebook checkpoint detected"), {
      code: "checkpoint_required",
    });
  }

  if (commentId) {
    const replyBtn = page
      .locator(`[href*="${commentId}"], [id*="${commentId}"]`)
      .locator('xpath=ancestor::*[.//span[contains(.,"Reply")]][1]//span[contains(.,"Reply")]')
      .first();
    if (await replyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await replyBtn.click();
      await humanPause(400, 800);
    }
  } else {
    const commentBox = page
      .locator('div[aria-label*="Write a comment"], div[aria-label*="comment"][contenteditable="true"]')
      .first();
    if (await commentBox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await commentBox.click();
    } else {
      const fallback = page.locator('div[contenteditable="true"][role="textbox"]').first();
      await fallback.click({ timeout: 5000 });
    }
  }

  await humanPause(300, 700);
  await page.keyboard.type(text, { delay: 18 + Math.floor(Math.random() * 25) });
  await humanPause(400, 800);
  await page.keyboard.press("Enter");
  await humanPause(1500, 2500);

  return { ok: true, note: "Reply submitted" };
}

export async function readEngagement(
  page: Page,
  postUrl: string
): Promise<{
  comments: Array<{
    commentId: string;
    authorName: string;
    text: string;
  }>;
}> {
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await humanPause(1000, 1800);
  await maybeDismissPopups(page);

  // Expand comments if a control is present
  const more = page.locator('div[role="button"]:has-text("View more comments"), span:has-text("View more comments")').first();
  if (await more.isVisible({ timeout: 1500 }).catch(() => false)) {
    await more.click().catch(() => undefined);
    await humanPause(800, 1400);
  }

  const comments: Array<{ commentId: string; authorName: string; text: string }> = [];

  // Heuristic scrape — Facebook DOM is volatile; return best-effort structured data
  const articles = page.locator('div[role="article"]');
  const count = Math.min(await articles.count(), 25);
  for (let i = 0; i < count; i++) {
    const article = articles.nth(i);
    const text = (await article.innerText().catch(() => "")).trim();
    if (!text || text.length < 2) continue;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const authorName = lines[0] || "Unknown";
    const body = lines.slice(1).join(" ").slice(0, 500);
    if (!body) continue;
    comments.push({
      commentId: nanoid(10),
      authorName,
      text: body,
    });
  }

  return { comments };
}

export async function reactToPost(
  page: Page,
  postUrl: string,
  _reaction = "like"
): Promise<{ ok: boolean }> {
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await humanPause(800, 1400);
  await maybeDismissPopups(page);

  const like = page.locator('div[aria-label="Like"][role="button"], div[aria-label="Remove Like"]').first();
  if (await like.isVisible({ timeout: 4000 }).catch(() => false)) {
    const label = await like.getAttribute("aria-label");
    if (label === "Like") {
      await like.click();
    }
  }
  await humanPause(800, 1200);
  return { ok: true };
}
