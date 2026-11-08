import crypto from "node:crypto";
import { config } from "./config.js";

function keyBytes(): Buffer {
  const hex = config.masterKey;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  return crypto.createHash("sha256").update(hex).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyBytes(),
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): { raw: string; hash: string; preview: string } {
  const raw = `fa_${crypto.randomBytes(24).toString("base64url")}`;
  return {
    raw,
    hash: hashApiKey(raw),
    preview: `${raw.slice(0, 10)}…${raw.slice(-4)}`,
  };
}

export function generateToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
