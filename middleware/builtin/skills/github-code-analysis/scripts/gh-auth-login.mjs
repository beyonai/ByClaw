#!/usr/bin/env node

/**
 * gh-auth-login.mjs — GitHub OAuth Device Flow login.
 *
 * Usage:
 *   node gh-auth-login.mjs --start    # request device code, print URL+code, save state
 *   node gh-auth-login.mjs --poll     # check if user authorized, save token
 *   node gh-auth-login.mjs --status   # check current auth status
 *
 * Stores token at ~/.openclaw/credentials/github-token
 * Stores pending device_code at ~/.openclaw/credentials/.github-device-pending
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, chmodSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLIENT_ID = "Ov23lidZA2zDLSm0gJf5";
const CREDENTIALS_DIR = join(homedir(), ".openclaw", "credentials");
const TOKEN_FILE = join(CREDENTIALS_DIR, "github-token");
const PENDING_FILE = join(CREDENTIALS_DIR, ".github-device-pending");

const args = process.argv.slice(2);

function ensureDir() {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
}

function getStoredToken() {
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

async function checkToken(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "byclaw-agent",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// --status
if (args.includes("--status")) {
  const token = process.env.GITHUB_TOKEN || getStoredToken();
  if (!token) {
    console.log(JSON.stringify({ ok: false, authenticated: false, message: "未登录。" }));
    process.exit(0);
  }
  const user = await checkToken(token);
  if (!user) {
    console.log(JSON.stringify({ ok: false, authenticated: false, message: "Token 已失效，请重新授权。" }));
    process.exit(0);
  }
  console.log(JSON.stringify({ ok: true, authenticated: true, user: user.login, name: user.name }));
  process.exit(0);
}

// --start
if (args.includes("--start")) {
  const codeRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "repo" }),
  });

  if (!codeRes.ok) {
    console.log(JSON.stringify({ ok: false, error: `Device code request failed: ${codeRes.status}` }));
    process.exit(1);
  }

  const codeData = await codeRes.json();
  const { device_code, user_code, verification_uri, expires_in, interval } = codeData;

  ensureDir();
  writeFileSync(PENDING_FILE, JSON.stringify({ device_code, expires_at: Date.now() + expires_in * 1000, interval: interval || 5 }), { mode: 0o600 });

  console.log(JSON.stringify({
    ok: true,
    action: "authorize",
    verification_uri,
    user_code,
    expires_in,
    message: `请在浏览器中打开链接并输入授权码：\n\n👉 ${verification_uri}\n📋 授权码: ${user_code}\n\n完成后告诉我"授权完了"。`,
  }));
  process.exit(0);
}

// --poll
if (args.includes("--poll")) {
  let pending;
  try {
    pending = JSON.parse(readFileSync(PENDING_FILE, "utf8"));
  } catch {
    console.log(JSON.stringify({ ok: false, error: "没有待完成的授权流程。请先运行 --start。" }));
    process.exit(1);
  }

  if (Date.now() > pending.expires_at) {
    try { unlinkSync(PENDING_FILE); } catch {}
    console.log(JSON.stringify({ ok: false, error: "授权已过期，请重新运行 --start。" }));
    process.exit(1);
  }

  const maxAttempts = 6;
  const pollInterval = (pending.interval || 5) * 1000;

  for (let i = 0; i < maxAttempts; i++) {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: pending.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      ensureDir();
      writeFileSync(TOKEN_FILE, tokenData.access_token, { mode: 0o600 });
      chmodSync(TOKEN_FILE, 0o600);
      try { unlinkSync(PENDING_FILE); } catch {}

      const user = await checkToken(tokenData.access_token);
      console.log(JSON.stringify({
        ok: true,
        action: "authorized",
        user: user?.login,
        name: user?.name,
        message: `授权成功！已登录为 ${user?.login || "unknown"}。`,
      }));
      process.exit(0);
    }

    if (tokenData.error === "authorization_pending") {
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, pollInterval));
      continue;
    } else if (tokenData.error === "slow_down") {
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, pollInterval + 5000));
      continue;
    } else if (tokenData.error === "expired_token") {
      try { unlinkSync(PENDING_FILE); } catch {}
      console.log(JSON.stringify({ ok: false, error: "授权已过期，请重新运行 --start。" }));
      process.exit(1);
    } else if (tokenData.error === "access_denied") {
      try { unlinkSync(PENDING_FILE); } catch {}
      console.log(JSON.stringify({ ok: false, error: "用户拒绝了授权。" }));
      process.exit(1);
    } else {
      console.log(JSON.stringify({ ok: false, error: `Unexpected: ${tokenData.error}` }));
      process.exit(1);
    }
  }

  console.log(JSON.stringify({ ok: false, error: "用户尚未完成授权。请在浏览器中完成后再试。", retry: true }));
  process.exit(1);
}

// No flag — show usage
console.log(JSON.stringify({
  ok: false,
  error: "Usage: gh-auth-login.mjs --start | --poll | --status",
}));
process.exit(1);
