#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function say(msg) {
  console.log(msg);
}

function writeEnvIfNeeded() {
  const envPath = path.join(root, ".env");
  const examplePath = path.join(root, ".env.example");
  if (fs.existsSync(envPath)) {
    say("✓ .env already exists — leaving it alone");
    return;
  }

  let template = fs.readFileSync(examplePath, "utf8");
  const masterKey = crypto.randomBytes(32).toString("hex");
  const adminToken = crypto.randomBytes(24).toString("base64url");
  template = template
    .replace(/MASTER_KEY=.*/, `MASTER_KEY=${masterKey}`)
    .replace(/ADMIN_TOKEN=.*/, `ADMIN_TOKEN=${adminToken}`);
  fs.writeFileSync(envPath, template);
  say("✓ Created .env with MASTER_KEY and ADMIN_TOKEN");
}

function ensureDirs() {
  for (const dir of ["data", "data/screenshots", "profiles"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  say("✓ Created data/ and profiles/");
}

function run(cmd, args, opts = {}) {
  say(`→ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
}

say("\nFacebook Army — setup\n");
writeEnvIfNeeded();
ensureDirs();
run("npm", ["install"]);
run("npx", ["playwright", "install", "chromium"]);
say(`
Setup complete.

Next:
  1. npm run dev
  2. Open http://127.0.0.1:5173  (dev) or http://127.0.0.1:8787 after build
  3. Click “Unlock dashboard”
  4. Add account → sticky ISP proxy → Open login → Mark ready
  5. Create an API key for your client AI

Mac Mini transfer:
  Copy this whole folder (including .env, data/, profiles/) via thumb drive.
  On the Mac: install Node 20+, run npm install && npx playwright install chromium,
  then npm run build && npm start
  Optional always-on: see ops/mac-mini.plist
`);
